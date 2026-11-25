/**
 * The map, written out for the model.
 *
 * The composer panel draws this model as a picture; this file writes it as
 * text the model can act on: the blocks a file owns, the calls between them,
 * the value that travels with each call, the source behind a block, and the
 * structure problems the map found.
 *
 * Two shapes come out of every report: `text`, which the model reads, and
 * `facts`, the same information as data for anything that wants to reason
 * about it without parsing prose. Both are derived from one model, so the
 * picture on screen and the facts in the tool can never disagree.
 *
 * Every function here is pure: a model in, an answer out. That is what makes
 * the model's view of the code checkable without a running session.
 */

import { bindTranslator } from '../i18n.js'
import { areaGraph, areaBlockGraph } from '../project.js'
import { signatureOf } from '../text.js'

/**
 * The model's own words for a problem.
 *
 * The same explanations the panel shows, so the model and the human read one
 * diagnosis rather than two. The panel passes its own translator in, so the
 * text a person reads under the picture is the text the model reads, in the
 * language each of them works in.
 */
const english = bindTranslator('en')

/** How much one answer holds before it points at the next step. */
const MAX_AREAS = 40
const MAX_BLOCKS = 120
const MAX_EDGES = 200
const MAX_ISSUES = 80
const MAX_SOURCE = 8000

/**
 * The project as a whole: its parts, its public surface, and what is wrong
 * with it.
 *
 * @param {object} project - the project model.
 * @param {(key: string, values?: object) => string} [translate] - the words for a problem.
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function reportOverview(project, translate = english) {
  const stats = project.stats
  const areas = areaGraph(project).nodes
  const lines = []
  lines.push(`PROJECT ${project.name}  root=${project.root}`)
  lines.push(`${stats.files} files, ${stats.blocks} blocks, ${stats.crossEdges} cross-file links, ${stats.diagnostics} structure problems`)
  lines.push('')
  lines.push('AREAS')
  for (const area of areas.slice(0, MAX_AREAS)) {
    const summary = area.summary === undefined ? '' : ` — ${area.summary}`
    lines.push(`  ${area.subtitle}  ${area.files} files, ${area.blocks} blocks, ${area.entries} entries${summary}`)
  }
  if (areas.length > MAX_AREAS) lines.push(`  ... ${areas.length - MAX_AREAS} more areas`)
  const entries = entriesOf(project)
  lines.push('')
  lines.push('ENTRIES (exported and not called inside the project)')
  for (const entry of entries.slice(0, MAX_BLOCKS)) lines.push(`  ${entry}`)
  if (entries.length > MAX_BLOCKS) lines.push(`  ... ${entries.length - MAX_BLOCKS} more`)
  const counts = issueCounts(project)
  lines.push('')
  lines.push('ISSUES BY CODE')
  for (const [code, count] of counts) lines.push(`  ${code}: ${count}`)
  if (counts.length === 0) lines.push('  (none)')
  lines.push('')
  lines.push('Read one area with action=area path=<area>, one file with action=file path=<file>, one block with '
    + 'action=block path=<file> name=<block>, the values through one block with action=flow, the public surface '
    + 'with action=contracts, or every issue with action=diagnostics.')
  return {
    scope: 'overview',
    text: lines.join('\n'),
    facts: {
      kind: 'overview',
      files: project.files.map(file => fileFact(file)),
      blocks: [],
      edges: [],
      issues: project.diagnostics.map(item => issueFact(item, translate)),
      areas: areas.map(area => ({
        key: area.subtitle,
        files: area.files,
        blocks: area.blocks,
        entries: area.entries,
        ...(area.summary === undefined ? {} : { summary: area.summary }),
      })),
      entries,
    },
  }
}

/**
 * One functional area: the blocks it owns and the flow between them.
 *
 * @param {object} project - the project model.
 * @param {string} key - the area key, such as `src/api`.
 * @param {(key: string, values?: object) => string} [translate] - the words for a problem.
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function reportArea(project, key, translate = english) {
  const graph = areaBlockGraph(project, key)
  if (graph.nodes.length === 0) {
    const known = areaGraph(project).nodes.map(area => area.subtitle)
    return empty(`area ${key}`, `No area "${key}". Areas: ${known.length === 0 ? '(none)' : known.join(', ')}`)
  }
  const ctx = contextOf(project)
  const files = [...new Set(graph.nodes.map(node => relOfNode(node)).filter(Boolean))]
  const lines = []
  lines.push(`AREA ${key}`)
  lines.push(`${graph.nodes.length} blocks in ${files.length} files`)
  lines.push('')
  lines.push('BLOCKS')
  let shown = 0
  for (const node of graph.nodes) {
    if (shown >= MAX_BLOCKS) break
    lines.push(`  ${blockHead(node)}`)
    if (node.subtitle !== undefined && node.subtitle.length > 0) lines.push(`      doc: ${node.subtitle}`)
    const file = project.files.find(candidate => candidate.rel === relOfNode(node))
    const source = file?.nodes.find(candidate => candidate.name === node.name)
    if (source !== undefined) {
      for (const line of callLines(ctx, source)) lines.push(line)
    }
    shown++
  }
  if (shown < graph.nodes.length) lines.push(`  ... ${graph.nodes.length - shown} more blocks`)
  const edges = graph.edges.slice(0, MAX_EDGES)
  if (edges.length > 0) {
    lines.push('')
    lines.push('DATA FLOW')
    for (const edge of edges) lines.push(`  ${edgeLabel(edge)}`)
    if (graph.edges.length > MAX_EDGES) lines.push(`  ... ${graph.edges.length - MAX_EDGES} more`)
  }
  const issues = project.diagnostics.filter(item => files.some(rel => item.file === rel))
  const issueLines = issueBlock(project, issues, translate)
  if (issueLines.length > 0) {
    lines.push('')
    lines.push('ISSUES')
    lines.push(...issueLines)
  }
  return {
    scope: `area ${key}`,
    text: lines.join('\n'),
    facts: {
      kind: 'area',
      files: files.map(rel => fileFact(project.files.find(candidate => candidate.rel === rel))),
      blocks: graph.nodes.map(node => areaBlockFact(project, node)),
      edges: graph.edges.map(edgeFact),
      issues: issues.map(item => issueFact(item, translate)),
    },
  }
}

/**
 * One file: its blocks, the blocks it calls elsewhere, the data that moves
 * between them, the problems found in it, and its source.
 *
 * @param {object} project - the project model.
 * @param {string} rel - the file's path relative to the project root.
 * @param {(key: string, values?: object) => string} [translate] - the words for a problem.
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function reportFile(project, rel, translate = english) {
  const file = project.files.find(candidate => candidate.rel === rel)
  if (file === undefined) return empty(`file ${rel}`, `No file "${rel}".`)
  const ctx = contextOf(project)
  const edges = edgesOf(project, rel)
  const lines = []
  lines.push(`FILE ${rel}  (${file.lang}, ${file.nodes.length} blocks, ${lineCount(file.text)} lines)`)
  lines.push('')
  lines.push('BLOCKS')
  for (const node of file.nodes.slice(0, MAX_BLOCKS)) {
    lines.push(`  ${blockHead(node)}`)
    if (node.doc !== undefined && node.doc.length > 0) lines.push(`      doc: ${node.doc}`)
    if (node.exported === true) lines.push('      exported')
    if (node.entry === true) lines.push('      entry point')
    lines.push(...callLines(ctx, node))
    const callers = callersOf(project, rel, node.name)
    if (callers.length > 0) lines.push(`      called by: ${callers.join(', ')}`)
  }
  if (file.nodes.length > MAX_BLOCKS) lines.push(`  ... ${file.nodes.length - MAX_BLOCKS} more blocks`)
  const shown = edges.slice(0, MAX_EDGES)
  if (shown.length > 0) {
    lines.push('')
    lines.push('DATA FLOW')
    for (const edge of shown) lines.push(`  ${edgeLabel(edge)}`)
    if (edges.length > MAX_EDGES) lines.push(`  ... ${edges.length - MAX_EDGES} more`)
  }
  const issues = project.diagnostics.filter(item => item.file === rel)
  const issueLines = issueBlock(project, issues, translate)
  if (issueLines.length > 0) {
    lines.push('')
    lines.push('ISSUES')
    lines.push(...issueLines)
  }
  lines.push('')
  lines.push(`SOURCE ${rel}`)
  lines.push(sourceBlock(file))
  return {
    scope: `file ${rel}`,
    text: lines.join('\n'),
    facts: {
      kind: 'file',
      files: [fileFact(file)],
      blocks: file.nodes.map(node => blockFact(project, file, node)),
      edges: edges.map(edgeFact),
      issues: issues.map(item => issueFact(item, translate)),
    },
  }
}

/**
 * One block: what it is, the values it moves, who touches it, and its code.
 *
 * @param {object} project - the project model.
 * @param {string} rel - the file's path relative to the project root.
 * @param {string} name - the block's name.
 * @param {(key: string, values?: object) => string} [translate] - the words for a problem.
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function reportBlock(project, rel, name, translate = english) {
  const file = project.files.find(candidate => candidate.rel === rel)
  if (file === undefined) return empty(`block ${rel} ${name}`, `No file "${rel}".`)
  const node = file.nodes.find(candidate => candidate.name === name)
  if (node === undefined) {
    const known = file.nodes.map(candidate => candidate.name)
    return empty(`block ${rel} ${name}`,
      `No block "${name}" in ${rel}. Blocks: ${known.length === 0 ? '(none)' : known.join(', ')}`)
  }
  const lines = []
  const ctx = contextOf(project)
  lines.push(`BLOCK ${node.name}  (${rel}:${node.line})`)
  lines.push(`  ${signatureOf(node)}  [${node.kind}]`)
  if (node.doc !== undefined && node.doc.length > 0) lines.push(`  doc: ${node.doc}`)
  if (node.exported === true) lines.push('  exported')
  if (node.entry === true) lines.push('  entry point')
  const calls = node.calls ?? []
  if (calls.length > 0) {
    lines.push('  calls:')
    lines.push(...callLines(ctx, node))
  }
  const callers = callersOf(project, rel, node.name)
  if (callers.length > 0) lines.push(`  called by: ${callers.join(', ')}`)
  const issues = project.diagnostics.filter(item => item.file === rel && (item.node === undefined || item.node === node.name))
  const issueLines = issueBlock(project, issues, translate)
  if (issueLines.length > 0) {
    lines.push('  issues:')
    lines.push(...issueLines.map(line => `    ${line}`))
  }
  const source = sourceOf(file, node)
  if (source !== undefined) {
    lines.push('')
    lines.push(`SOURCE ${rel}:${node.line}`)
    lines.push(source)
  }
  return {
    scope: `block ${rel} ${name}`,
    text: lines.join('\n'),
    facts: {
      kind: 'block',
      files: [fileFact(file)],
      blocks: [blockFact(project, file, node)],
      edges: edgesOf(project, rel).filter(edge => edge.from === node.name || edge.to === node.name).map(edgeFact),
      issues: issues.map(item => issueFact(item, translate)),
    },
  }
}

/**
 * The values that move through one block: what it passes on, what it is
 * given, and who calls it.
 *
 * @param {object} project - the project model.
 * @param {string} rel - the file's path relative to the project root.
 * @param {string} name - the block's name.
 * @param {(key: string, values?: object) => string} [translate] - the words for a problem.
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function reportFlow(project, rel, name, translate = english) {
  const file = project.files.find(candidate => candidate.rel === rel)
  if (file === undefined) return empty(`flow ${rel} ${name}`, `No file "${rel}".`)
  const node = file.nodes.find(candidate => candidate.name === name)
  if (node === undefined) {
    const known = file.nodes.map(candidate => candidate.name)
    return empty(`flow ${rel} ${name}`,
      `No block "${name}" in ${rel}. Blocks: ${known.length === 0 ? '(none)' : known.join(', ')}`)
  }
  const incoming = []
  const outgoing = []
  for (const edge of file.edges) {
    const from = edge.from.replace(/^fn:/, '')
    const to = edge.to.replace(/^fn:/, '')
    if (edge.kind !== 'data') continue
    if (to === node.name) incoming.push({ from, to, kind: edge.kind, label: edge.label })
    if (from === node.name) outgoing.push({ from, to, kind: edge.kind, label: edge.label })
  }
  for (const edge of project.crossEdges) {
    if (edge.kind !== 'data') continue
    if (edge.toFile === rel && edge.toNode === node.name) {
      incoming.push({ from: `${edge.fromFile}#${edge.fromNode}`, to: node.name, kind: edge.kind, label: edge.label })
    }
    if (edge.fromFile === rel && edge.fromNode === node.name) {
      outgoing.push({ from: node.name, to: `${edge.toFile}#${edge.toNode}`, kind: edge.kind, label: edge.label })
    }
  }
  const lines = []
  lines.push(`FLOW ${node.name}  (${rel}:${node.line})`)
  lines.push(`  ${signatureOf(node)}`)
  const params = (node.params ?? []).map(param => (param.type === undefined ? param.name : `${param.name}: ${param.type}`))
  lines.push(`  inputs: ${params.length === 0 ? '(none)' : params.join(', ')}`)
  const outputs = node.outputs ?? []
  lines.push(`  returns: ${outputs.length === 0 ? '(none)' : outputs.join(', ')}`)
  lines.push('  values it is given:')
  if (incoming.length === 0) lines.push('    (none the map can trace)')
  for (const edge of incoming) lines.push(`    ${edge.from} --${edge.label ?? 'value'}--> ${node.name}`)
  lines.push('  values it passes on:')
  if (outgoing.length === 0) lines.push('    (none the map can trace)')
  for (const edge of outgoing) lines.push(`    ${node.name} --${edge.label ?? 'value'}--> ${edge.to}`)
  const passes = (node.calls ?? []).filter(call => call.payload !== undefined)
  if (passes.length > 0) {
    lines.push('  arguments that carry a value:')
    for (const call of passes) {
      const producer = call.payload.producer === call.name ? '' : ` from ${call.payload.producer}`
      lines.push(`    ${call.name}(${call.payload.label})${producer}`)
    }
  }
  const callers = callersOf(project, rel, node.name)
  lines.push(`  called by: ${callers.length === 0 ? '(nobody in the project)' : callers.join(', ')}`)
  return {
    scope: `flow ${rel} ${name}`,
    text: lines.join('\n'),
    facts: {
      kind: 'flow',
      files: [fileFact(file)],
      blocks: [blockFact(project, file, node)],
      edges: [...incoming, ...outgoing].map(edgeFact),
      issues: [],
    },
  }
}

/**
 * The project's public surface: the blocks other code may call, and who
 * calls them.
 *
 * @param {object} project - the project model.
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function reportContracts(project, translate = english) {
  const lines = []
  lines.push('CONTRACTS (exported blocks and the callers that depend on them)')
  const blocks = []
  for (const file of project.files) {
    const exported = file.nodes.filter(node => node.exported === true || node.entry === true)
    if (exported.length === 0) continue
    lines.push(`  ${file.rel}`)
    for (const node of exported) {
      const callers = callersOf(project, file.rel, node.name)
      lines.push(`    ${signatureOf(node)}  [${node.kind}] L${node.line}`)
      if (node.doc !== undefined && node.doc.length > 0) lines.push(`      doc: ${node.doc}`)
      lines.push(`      called by: ${callers.length === 0 ? '(nobody in the project)' : callers.join(', ')}`)
      blocks.push(blockFact(project, file, node))
    }
  }
  if (blocks.length === 0) lines.push('  (no exported blocks found)')
  return {
    scope: 'contracts',
    text: lines.join('\n'),
    facts: {
      kind: 'contracts',
      files: project.files.map(file => fileFact(file)),
      blocks,
      edges: [],
      issues: [],
    },
  }
}

/**
 * The structure problems the map found.
 *
 * @param {object} project - the project model.
 * @param {string} [scope] - limit the report to this file or area.
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function reportDiagnostics(project, scope, translate = english) {
  const wanted = scope === undefined || scope === '' ? undefined : scope
  const items = wanted === undefined
    ? project.diagnostics
    : project.diagnostics.filter(item => item.file === wanted || item.file.startsWith(`${wanted}/`))
  if (items.length === 0) {
    return empty(`diagnostics ${wanted ?? ''}`.trim(),
      wanted === undefined ? 'No structure problems found.' : `No structure problems in ${wanted}.`)
  }
  const lines = [`${items.length} structure problems`]
  lines.push(...issueBlock(project, items, translate))
  return {
    scope: `diagnostics ${wanted ?? ''}`.trim(),
    text: lines.join('\n'),
    facts: {
      kind: 'diagnostics',
      files: [],
      blocks: [],
      edges: [],
      issues: items.map(item => issueFact(item, translate)),
    },
  }
}

/** An answer with no facts behind it: the request did not name anything real. */
function empty(scope, text) {
  return { scope, text, facts: { kind: 'empty', files: [], blocks: [], edges: [], issues: [] } }
}

/**
 * The names the project's blocks answer to.
 *
 * A method is named `Class.run` but called by its bare name, so the bare name
 * is indexed as well: that is how a call site is placed.
 *
 * @param {object} project - the project model.
 * @returns {{ project: object, bare: Map<string, object[]> }} the lookup.
 */
function contextOf(project) {
  const bare = new Map()
  const add = (name, entry) => {
    const list = bare.get(name) ?? []
    list.push(entry)
    bare.set(name, list)
  }
  for (const [key, entries] of project.index) {
    for (const entry of entries) {
      add(key, entry)
      if (key.includes('.')) add(key.slice(key.indexOf('.') + 1), entry)
    }
  }
  return { project, bare }
}

/** One block on one line: what it is and where it lives. */
function blockHead(node) {
  return `${signatureOf(node)}  [${node.kind}] L${node.line ?? 0}`
}

/**
 * The calls one block makes, one per line.
 *
 * A call is `local` when the block lives in this file, `cross-file` when the
 * name is one block of the project that lives elsewhere, `unresolved` when
 * several blocks carry that name and the call site cannot say which one it
 * means, and `external` when the name is not a block of this project at all.
 * The model needs that difference: the last two are gaps it may have to ask
 * about.
 */
function callLines(ctx, node) {
  const lines = []
  const seen = new Set()
  for (const call of node.calls ?? []) {
    const key = `${call.name}#${call.line ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    const where = callWhere(ctx, call)
    const payload = call.payload === undefined ? '' : `  data=${call.payload.label}`
    const at = call.line === undefined ? '' : `  L${call.line}`
    lines.push(`      calls ${call.name}  ${where}${payload}${at}`)
  }
  return lines
}

/**
 * Where a call reaches: inside this file, another file of the project, an
 * undecidable name, or outside the project.
 */
function callWhere(ctx, call) {
  if (call.resolved === true) return 'local'
  const candidates = ctx.bare.get(call.name) ?? []
  if (candidates.length === 0) return 'external'
  if (candidates.length > 1) return 'unresolved'
  return `cross-file ${candidates[0].rel}#${candidates[0].node.name}`
}

/** One edge on one line: who calls whom, and what value moves with it. */
function edgeLabel(edge) {
  if (edge.kind === 'data') return `${edge.from} -> ${edge.to}  (data: ${edge.label ?? ''})`
  return `${edge.from} -> ${edge.to}`
}

/**
 * The edges that touch one file: the calls inside it and the calls that cross
 * its boundary, in one list.
 *
 * @param {object} project - the project model.
 * @param {string} rel - the file's relative path.
 * @returns {object[]} the edges.
 */
function edgesOf(project, rel) {
  const file = project.files.find(candidate => candidate.rel === rel)
  const edges = []
  if (file !== undefined) {
    for (const edge of file.edges) {
      edges.push({
        from: edge.from.replace(/^fn:/, ''),
        to: edge.to.replace(/^fn:/, ''),
        kind: edge.kind,
        label: edge.label,
      })
    }
  }
  for (const edge of project.crossEdges) {
    if (edge.fromFile !== rel && edge.toFile !== rel) continue
    edges.push({
      from: edge.fromFile === rel ? edge.fromNode : `${edge.fromFile}#${edge.fromNode}`,
      to: edge.toFile === rel ? edge.toNode : `${edge.toFile}#${edge.toNode}`,
      kind: edge.kind,
      label: edge.label,
    })
  }
  return edges
}

/**
 * The blocks that call one block.
 *
 * A data edge points from the producer to the consumer, so the caller of a
 * value-carrying call is found by looking for the block that passed the value
 * on — the edge alone does not name it.
 *
 * @param {object} project - the project model.
 * @param {string} rel - the block's file.
 * @param {string} name - the block's name.
 * @returns {string[]} the callers, as `file#block`.
 */
function callersOf(project, rel, name) {
  const callers = []
  const push = (value) => {
    if (!callers.includes(value)) callers.push(value)
  }
  const file = project.files.find(candidate => candidate.rel === rel)
  if (file !== undefined) {
    for (const node of file.nodes) {
      if (node.name === name) continue
      const calls = node.calls ?? []
      if (calls.some(call => call.name === name || (call.candidates ?? []).includes(name))) {
        push(`${rel}#${node.name}`)
      }
    }
  }
  for (const edge of project.crossEdges) {
    if (edge.toFile !== rel || edge.toNode !== name) continue
    if (edge.kind === 'call') {
      push(`${edge.fromFile}#${edge.fromNode}`)
      continue
    }
    const from = project.files.find(candidate => candidate.rel === edge.fromFile)
    if (from === undefined) continue
    for (const node of from.nodes) {
      const passes = (node.calls ?? []).some(call => call.name === name && call.payload?.producer === edge.fromNode)
      if (passes) push(`${edge.fromFile}#${node.name}`)
    }
  }
  return callers
}

/** The exported blocks of the project, as `file#name  signature`. */
function entriesOf(project) {
  const entries = []
  for (const file of project.files) {
    for (const node of file.nodes) {
      if (node.entry !== true) continue
      entries.push(`${file.rel}#${node.name}  ${signatureOf(node)}`)
    }
  }
  return entries
}

/** How many problems of each kind the project has. */
function issueCounts(project) {
  const counts = new Map()
  for (const item of project.diagnostics) {
    counts.set(item.code, (counts.get(item.code) ?? 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])
}

/** The problems as lines the model can read. */
function issueBlock(project, items, translate = english) {
  const lines = []
  for (const item of items.slice(0, MAX_ISSUES)) {
    const where = item.node === undefined ? `${item.file}:${item.line ?? ''}` : `${item.file}:${item.line ?? ''} ${item.node}`
    lines.push(`  ${where}  ${item.code}  ${translate(`diag.${item.code}`, item.values ?? {})}`)
  }
  if (items.length > MAX_ISSUES) lines.push(`  ... ${items.length - MAX_ISSUES} more`)
  return lines
}

/** One file as data. */
function fileFact(file) {
  if (file === undefined) return { rel: '', lang: '', blocks: 0, lines: 0 }
  return { rel: file.rel, lang: file.lang, blocks: file.nodes.length, lines: lineCount(file.text) }
}

/** One block as data: what it is, what it calls, who calls it. */
function blockFact(project, file, node) {
  return {
    name: node.name,
    file: file.rel,
    line: node.line,
    kind: node.kind,
    signature: signatureOf(node),
    params: (node.params ?? []).map(param => param.name),
    outputs: node.outputs ?? [],
    ...(node.doc === undefined ? {} : { doc: node.doc }),
    exported: node.exported === true,
    entry: node.entry === true,
    calls: (node.calls ?? []).map(call => ({
      name: call.name,
      resolved: call.resolved === true,
      ...(call.line === undefined ? {} : { line: call.line }),
      ...(call.payload === undefined ? {} : { data: call.payload.label, producer: call.payload.producer }),
    })),
    calledBy: callersOf(project, file.rel, node.name),
  }
}

/** The file a node belongs to: its own file, or the file a stub points at. */
function relOfNode(node) {
  if (typeof node.file === 'string' && node.file.length > 0) return node.file
  if (typeof node.subtitle === 'string' && node.subtitle.includes('/')) return node.subtitle
  return ''
}

/** One block of an area as data. */
function areaBlockFact(project, node) {
  const rel = relOfNode(node)
  const file = project.files.find(candidate => candidate.rel === rel)
  const source = file?.nodes.find(candidate => candidate.name === node.name)
  if (file === undefined || source === undefined) {
    // A stub of a block in another file: it keeps the same shape as a real
    // one, so the facts of an answer stay one shape.
    return {
      name: node.name,
      file: rel,
      line: node.line ?? 0,
      kind: node.kind,
      signature: node.name,
      params: [],
      outputs: [],
      exported: false,
      entry: false,
      calls: [],
      calledBy: [],
    }
  }
  return blockFact(project, file, source)
}

/** One edge as data. */
function edgeFact(edge) {
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    ...(edge.label === undefined ? {} : { label: edge.label }),
  }
}

/** One problem as data. */
function issueFact(item, translate = english) {
  return {
    code: item.code,
    severity: item.severity ?? 'warn',
    // A broken data flow and a broken convention are different things, and
    // the model is told which one it is looking at.
    kind: item.kind ?? 'flow',
    file: item.file,
    ...(item.line === undefined ? {} : { line: item.line }),
    ...(item.node === undefined ? {} : { node: item.node }),
    message: translate(`diag.${item.code}`, item.values ?? {}),
  }
}

/** How many lines a file has. */
function lineCount(text) {
  return String(text ?? '').split('\n').length
}

/**
 * A file's own text, fenced and cut when it is long.
 *
 * The cut is stated, so the model knows it is looking at a part of the file
 * and can ask for the rest.
 */
function sourceBlock(file) {
  const text = file.text ?? ''
  const fence = '```'
  if (text.length <= MAX_SOURCE) return `${fence}${file.lang}\n${text}\n${fence}`
  return `${fence}${file.lang}\n${text.slice(0, MAX_SOURCE)}\n${fence}\n(cut: the file is ${text.length} characters, ${MAX_SOURCE} shown)`
}

/**
 * A block's own text, cut at the last line the block owns.
 *
 * The text starts at the line the declaration sits on, so the modifiers
 * around it (`export`, `public`, `async`) are part of what the model reads.
 */
function sourceOf(file, node) {
  if (typeof node.start !== 'number' || typeof node.end !== 'number') return undefined
  const text = file.text.slice(lineStartOf(file.text, node.start), node.end)
  if (text.length <= MAX_SOURCE) return text
  return `${text.slice(0, MAX_SOURCE)}\n... cut, the block is longer`
}

/** The offset where the line that holds `offset` begins. */
function lineStartOf(text, offset) {
  const index = text.lastIndexOf('\n', Math.max(0, offset - 1))
  return index < 0 ? 0 : index + 1
}
