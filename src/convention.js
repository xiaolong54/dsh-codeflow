/**
 * The convention the AI must hold to, and the two answers that hold it up.
 *
 * The plugin draws a project as function blocks and the values that move
 * between them. That picture only stays honest when the code is written in a
 * modular shape: one named function per feature, explicit parameters and
 * return values, entry functions that only orchestrate, a one-line
 * description above every function.
 *
 * This module keeps that shape in three forms:
 *
 * - `CONVENTION_RULES` — the rules as data, so a report or a prompt can
 *   quote them without parsing prose.
 * - `conventionReport` — how well a project holds to the rules, and where it
 *   does not.
 * - `scaffoldReport` — how the framework of a scope should be built: the
 *   modules, the blocks in them, the data that flows between them, and the
 *   template a new block follows.
 *
 * Both reports are pure: a project model in, an answer out. Nothing here
 * touches the DOM, a timer or a service, so the same answer can be produced
 * on the Host and in the browser.
 *
 * Every name this module declares at the top level starts with `convention`
 * or `scaffold`: the browser artifact concatenates all `src/` modules into
 * one scope, so two modules that share a helper name would break it.
 */

import { bindTranslator } from './i18n.js'
import { signatureOf } from './text.js'
import { dirName, projectAreas } from './project.js'
import { areaPurpose } from './outline.js'

/** How many violations one answer lists before it points at the rest. */
const conventionMaxViolations = 80
/** How many data edges one answer lists. */
const conventionMaxFlow = 200

/** The rules the AI must hold to, as data the reports and the prompt can quote. */
export const CONVENTION_RULES = [
  {
    id: 'named-block',
    title: 'One feature, one named function',
    text: 'Every feature lives in its own named top-level function or class method; business logic never hides in an anonymous callback.',
  },
  {
    id: 'doc-line',
    title: 'One line of description per function',
    text: 'A one-line comment directly above every function says what it does; a block without one has no name on the map.',
  },
  {
    id: 'explicit-io',
    title: 'Data goes in through parameters and comes out through return values',
    text: 'No module-level mutable state, no hidden shared state, no writing to a variable that was not passed in.',
  },
  {
    id: 'orchestrator-entry',
    title: 'An entry function orchestrates, it does not implement',
    text: 'An entry function only calls named blocks in order; the work itself belongs to a named block.',
  },
  {
    id: 'small-block',
    title: 'A block stays small',
    text: 'At most 80 lines and at most 6 parameters; beyond that it is split.',
  },
  {
    id: 'static-import',
    title: 'Imports are explicit',
    text: 'Cross-file access through a static import/require; no dynamic import and no reflection.',
  },
  {
    id: 'one-responsibility',
    title: 'A module has one responsibility',
    text: 'A file holds one area of the system, and the area\'s blocks are the ones the map shows.',
  },
  {
    id: 'pure-core',
    title: 'Side effects live in a few IO blocks',
    text: 'Reading files, network and database access are concentrated in a few named functions; the rest is pure computation.',
  },
]

/**
 * The words for a problem.
 *
 * The panel passes its own translator in, so the text a person reads is the
 * text the model reads. A translator that does not know a code still gets a
 * sentence: the report never shows a bare key to the model.
 *
 * @param {{ translate?: (key: string, values?: object) => string }} [options]
 * @returns {(key: string, values?: object) => string} the translator.
 */
function conventionTranslator(options) {
  const translate = options?.translate
  if (typeof translate === 'function') return translate
  return bindTranslator('en')
}

/**
 * The sentence that explains one violation.
 *
 * @param {(key: string, values?: object) => string} translate - the translator.
 * @param {string} code - the violation's code.
 * @param {object} values - the values the sentence needs.
 * @returns {string} the sentence.
 */
function conventionMessage(translate, code, values) {
  const key = `diag.${code}`
  const translated = typeof translate === 'function' ? translate(key, values) : undefined
  if (typeof translated === 'string' && translated.length > 0 && translated !== key) return translated
  return conventionFallbackMessage(code, values)
}

/** The English sentence for a code the dictionary does not carry. */
function conventionFallbackMessage(code, values) {
  if (code === 'missing-doc') return `${values.name} has no one-line description above it`
  if (code === 'block-too-large') {
    return `${values.name} has ${values.lines} lines; split it into smaller blocks`
  }
  if (code === 'too-many-params') {
    return `${values.name} takes ${values.params} parameters; pass one parameter object`
  }
  if (code === 'orchestrator-entry') {
    return `${values.name} is an entry that does the work itself; move the work into named blocks`
  }
  if (code === 'inline-callback') {
    return `${values.name} holds a ${values.lines}-line anonymous callback; make it a named block`
  }
  if (code === 'nested-definition') {
    return `${values.name} defines a named function inside itself; move it to the top level`
  }
  if (code === 'explicit-io') {
    return `${values.name} writes ${values.token}, which it did not receive as a parameter`
  }
  return `${values.name} breaks the convention`
}

/**
 * The violations the project model already found.
 *
 * The detection lives in the project layer, so there is exactly one list of
 * problems: the person sees it in the panel, and the model sees it here. A
 * second detector would be a second truth, and the two would drift.
 *
 * @param {object} project - the project model.
 * @param {object[]} files - the files the answer covers.
 * @param {(key: string, values?: object) => string} translate - the translator.
 * @returns {object[]} the violations.
 */
function conventionViolationsFor(project, files, translate) {
  const wanted = new Set(files.map(file => file.rel))
  const issues = []
  for (const item of project?.diagnostics ?? []) {
    if (item.kind !== 'convention') continue
    if (!wanted.has(item.file)) continue
    const values = item.values ?? {}
    issues.push({
      code: item.code,
      severity: item.severity ?? 'warn',
      file: item.file,
      line: item.line,
      node: item.node,
      values,
      message: conventionMessage(translate, item.code, values),
    })
  }
  return issues
}

/**
 * The files a scope covers.
 *
 * A scope is a file's path or a directory's path; anything else covers the
 * whole project.
 *
 * @param {object} project - the project model.
 * @param {string} scope - the scope.
 * @returns {object[]} the files.
 */
function conventionScopeFiles(project, scope) {
  const files = project?.files ?? []
  if (typeof scope !== 'string' || scope.length === 0) return files
  const exact = files.find(file => file.rel === scope)
  if (exact !== undefined) return [exact]
  return files.filter(file => file.rel.startsWith(`${scope}/`))
}

/**
 * The name a project calls itself.
 *
 * @param {object} project - the project model.
 * @returns {string} the name.
 */
function conventionProjectName(project) {
  return project?.name ?? 'project'
}

/**
 * The blocks that call one block.
 *
 * @param {object} project - the project model.
 * @param {object} file - the block's file.
 * @param {object} node - the block.
 * @returns {string[]} the callers, as `file#block`.
 */
function conventionCallers(project, file, node) {
  const callers = []
  const push = (value) => {
    if (!callers.includes(value)) callers.push(value)
  }
  for (const other of file.nodes ?? []) {
    if (other.name === node.name) continue
    for (const call of other.calls ?? []) {
      if (call.name === node.name || (call.candidates ?? []).includes(node.name)) {
        push(`${file.rel}#${other.name}`)
      }
    }
  }
  for (const edge of project?.crossEdges ?? []) {
    if (edge.toFile !== file.rel || edge.toNode !== node.name) continue
    if (edge.kind === 'call') {
      push(`${edge.fromFile}#${edge.fromNode}`)
      continue
    }
    const from = (project.files ?? []).find(candidate => candidate.rel === edge.fromFile)
    if (from === undefined) continue
    for (const other of from.nodes ?? []) {
      const passes = (other.calls ?? []).some(call => call.name === node.name && call.payload?.producer === edge.fromNode)
      if (passes) push(`${edge.fromFile}#${other.name}`)
    }
  }
  return callers
}

/**
 * One file as data.
 *
 * @param {object} file - the file.
 * @returns {object} the fact.
 */
function conventionFileFact(file) {
  if (file === undefined) return { rel: '', lang: '', blocks: 0, lines: 0 }
  const lines = String(file.text ?? '').split('\n').length
  return { rel: file.rel, lang: file.lang, blocks: (file.nodes ?? []).length, lines }
}

/**
 * One block as data: what it is, what it calls, who calls it.
 *
 * @param {object} project - the project model.
 * @param {object} file - the block's file.
 * @param {object} node - the block.
 * @returns {object} the fact.
 */
function conventionBlockFact(project, file, node) {
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
    calledBy: conventionCallers(project, file, node),
  }
}

/**
 * One violation as data.
 *
 * @param {object} issue - the violation.
 * @returns {object} the fact.
 */
function conventionIssueFact(issue) {
  return {
    code: issue.code,
    severity: issue.severity ?? 'warn',
    kind: 'convention',
    file: issue.file,
    ...(issue.line === undefined ? {} : { line: issue.line }),
    ...(issue.node === undefined ? {} : { node: issue.node }),
    message: issue.message,
  }
}

/**
 * The eight rules as lines the model can read.
 *
 * @returns {string[]} the lines.
 */
function conventionRuleLines() {
  const lines = []
  CONVENTION_RULES.forEach((rule, index) => {
    lines.push(`  ${index + 1}. ${rule.title} — ${rule.text}`)
  })
  return lines
}

/**
 * How well a project holds to the convention, and where it does not.
 *
 * The answer names every rule, says which files were checked, and points at
 * the blocks that break one. The facts carry the same information as data,
 * so a caller can reason about the answer without reading the prose.
 *
 * @param {object} project - the project model.
 * @param {{ translate?: (key: string, values?: object) => string, scope?: string }} [options]
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function conventionReport(project, options = {}) {
  const translate = conventionTranslator(options)
  const scope = typeof options.scope === 'string' ? options.scope.trim() : ''
  const files = conventionScopeFiles(project, scope)
  const issues = conventionViolationsFor(project, files, translate)
  const byFile = new Map()
  for (const issue of issues) byFile.set(issue.file, (byFile.get(issue.file) ?? 0) + 1)
  const lines = []
  lines.push(`CONVENTION ${scope === '' ? conventionProjectName(project) : scope}`)
  lines.push('RULES')
  lines.push(...conventionRuleLines())
  lines.push('CHECKED')
  for (const file of files) {
    const count = byFile.get(file.rel) ?? 0
    lines.push(`  ${file.rel}  ${(file.nodes ?? []).length} blocks  ${count === 0 ? 'ok' : `${count} violations`}`)
  }
  lines.push('VIOLATIONS')
  if (issues.length === 0) lines.push('  (none)')
  for (const issue of issues.slice(0, conventionMaxViolations)) {
    lines.push(`  ${issue.file}:${issue.line ?? 0}  ${issue.node ?? ''}  ${issue.code}  ${issue.message}`)
  }
  if (issues.length > conventionMaxViolations) lines.push(`  ... ${issues.length - conventionMaxViolations} more`)
  const blocks = files.reduce((total, file) => total + (file.nodes ?? []).length, 0)
  const undescribed = files.filter(file => (file.nodes ?? []).some(node => node.doc === undefined || node.doc.length === 0)).length
  lines.push('SUMMARY')
  lines.push(`  ${blocks} blocks, ${issues.length} violations, ${undescribed} files without a description`)
  const blocksOfScope = []
  for (const file of files) {
    for (const node of file.nodes ?? []) blocksOfScope.push(conventionBlockFact(project, file, node))
  }
  return {
    scope: scope === '' ? 'convention' : `convention ${scope}`,
    text: lines.join('\n'),
    facts: {
      kind: 'convention',
      files: files.map(file => conventionFileFact(file)),
      blocks: blocksOfScope,
      edges: [],
      issues: issues.map(issue => conventionIssueFact(issue)),
      rules: CONVENTION_RULES.map(rule => ({ id: rule.id, title: rule.title, text: rule.text })),
    },
  }
}

/**
 * The path a scope points at.
 *
 * A file scope names its path in `rel`; an area scope names its key there
 * too, and takes `name` as a second spelling of the same thing.
 *
 * @param {{ level?: string, rel?: string, name?: string }} scope - the scope.
 * @returns {string} the path or area key.
 */
function scaffoldScopePath(scope) {
  const level = scope?.level ?? 'project'
  if (level === 'area') return scope.rel ?? scope.name ?? ''
  return scope.rel ?? scope.file ?? ''
}

/**
 * The name of the block a block scope points at.
 *
 * @param {{ level?: string, name?: string, block?: string }} scope - the scope.
 * @returns {string} the block name.
 */
function scaffoldScopeBlock(scope) {
  return scope?.name ?? scope?.block ?? ''
}

/**
 * The scope a request really means.
 *
 * A path that names a file is a file; a path that names a directory is an
 * area. Resolving that here keeps one answer for both readings, whatever
 * shape the request came in.
 *
 * @param {object} project - the project model.
 * @param {{ level?: string, rel?: string, name?: string }} scope - the scope.
 * @returns {{ level: string, path: string, block: string }} the resolved scope.
 */
function scaffoldResolveScope(project, scope) {
  const level = scope?.level ?? 'project'
  const path = scaffoldScopePath(scope)
  if (level === 'project') return { level: 'project', path: '', block: '' }
  if (level === 'area') return { level: 'area', path, block: '' }
  const files = project?.files ?? []
  const exact = files.find(file => file.rel === path)
  if (exact !== undefined) {
    return { level: level === 'block' ? 'block' : 'file', path, block: scaffoldScopeBlock(scope) }
  }
  // A path that names no file names an area.
  if (files.some(file => file.rel.startsWith(`${path}/`))) return { level: 'area', path, block: '' }
  return { level: level === 'block' ? 'block' : 'file', path, block: scaffoldScopeBlock(scope) }
}

/**
 * The files an area holds.
 *
 * @param {object} project - the project model.
 * @param {string} path - the area key or path.
 * @returns {object[]} the files.
 */
function scaffoldAreaFiles(project, path) {
  const files = project?.files ?? []
  const group = projectAreas(project).get(path)
  if (group !== undefined) return group
  return files.filter(file => file.rel.startsWith(`${path}/`))
}

/**
 * The files a scaffold scope covers.
 *
 * @param {object} project - the project model.
 * @param {{ level: string, path: string, block: string }} resolved - the scope.
 * @returns {object[]} the files.
 */
function scaffoldTargetFiles(project, resolved) {
  const files = project?.files ?? []
  if (resolved.level === 'file' || resolved.level === 'block') {
    return files.filter(file => file.rel === resolved.path)
  }
  if (resolved.level === 'area') return scaffoldAreaFiles(project, resolved.path)
  return files
}

/**
 * The name a scope calls itself in a heading.
 *
 * @param {object} project - the project model.
 * @param {{ level: string, path: string, block: string }} resolved - the scope.
 * @returns {string} the description.
 */
function scaffoldScopeLabel(project, resolved) {
  if (resolved.level === 'area') return resolved.path
  if (resolved.level === 'file') return resolved.path
  if (resolved.level === 'block') return `${resolved.path} ${resolved.block}`.trim()
  return conventionProjectName(project)
}

/**
 * The scope string of a scaffold answer.
 *
 * @param {{ level: string, path: string, block: string }} resolved - the scope.
 * @returns {string} the scope string.
 */
function scaffoldScopeString(resolved) {
  if (resolved.level === 'area') return `scaffold area ${resolved.path}`.trim()
  if (resolved.level === 'file') return `scaffold file ${resolved.path}`.trim()
  if (resolved.level === 'block') return `scaffold block ${resolved.path} ${resolved.block}`.trim()
  return 'scaffold'
}

/**
 * What a block is for, in one line.
 *
 * A block that carries a description says what it does with it; a block
 * without one says what it does with its calls and its return value, so the
 * reader still learns something.
 *
 * @param {object} node - the block.
 * @returns {string} the purpose.
 */
function scaffoldPurpose(node) {
  if (node.doc !== undefined && node.doc.length > 0) return node.doc
  const outputs = node.outputs ?? []
  if (outputs.length > 0) return `returns ${outputs.join(', ')}`
  const calls = (node.calls ?? []).map(call => call.name)
  if (calls.length > 0) return `calls ${calls.join(', ')}`
  return 'no description'
}

/**
 * What a block is in the layout: an entry, a helper, or a plain block.
 *
 * @param {object} project - the project model.
 * @param {object} file - the block's file.
 * @param {object} node - the block.
 * @returns {string} the role.
 */
function scaffoldRole(project, file, node) {
  if (node.entry === true) return 'entry'
  const called = conventionCallers(project, file, node)
  if (node.exported !== true && called.length === 0 && (node.projectCalls ?? 0) === 0) return 'helper'
  return 'block'
}

/**
 * The edges that touch a scope.
 *
 * An edge counts when one of its two ends lies in the scope: a file scope
 * sees the calls that leave it, an area scope sees the data that crosses its
 * boundary. Every edge keeps the file each end lives in, so a module can
 * tell an inner edge from a crossing one.
 *
 * @param {object} project - the project model.
 * @param {object[]} files - the scope's files.
 * @returns {object[]} the edges.
 */
function scaffoldScopeEdges(project, files) {
  const inside = new Set(files.map(file => file.rel))
  const edges = []
  const seen = new Set()
  const push = (from, to, kind, label, fromFile, toFile) => {
    const key = `${from}|${to}|${kind}|${label ?? ''}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from, to, kind, ...(label === undefined ? {} : { label }), fromFile, toFile })
  }
  for (const file of files) {
    for (const edge of file.edges ?? []) {
      const from = String(edge.from).replace(/^fn:/, '')
      const to = String(edge.to).replace(/^fn:/, '')
      push(from, to, edge.kind, edge.label, file.rel, file.rel)
    }
  }
  for (const edge of project?.crossEdges ?? []) {
    if (!inside.has(edge.fromFile) && !inside.has(edge.toFile)) continue
    push(`${edge.fromFile}#${edge.fromNode}`, `${edge.toFile}#${edge.toNode}`, edge.kind, edge.label, edge.fromFile, edge.toFile)
  }
  return edges
}

/**
 * The modules of a scope: the areas, the files in them, the blocks in those
 * files, and the data that flows through each module.
 *
 * @param {object} project - the project model.
 * @param {object[]} files - the scope's files.
 * @param {{ level: string, path: string, block: string }} resolved - the scope.
 * @param {object[]} edges - the scope's edges.
 * @returns {object[]} the modules.
 */
function scaffoldModules(project, files, resolved, edges) {
  const level = resolved.level
  const groups = new Map()
  for (const file of files) {
    const key = dirName(file.rel)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [file])
    else group.push(file)
  }
  const modules = []
  for (const [key, group] of groups) {
    const blocks = []
    for (const file of group) {
      for (const node of file.nodes ?? []) {
        if (level === 'block' && node.name !== resolved.block) continue
        blocks.push({
          name: node.name,
          file: file.rel,
          signature: signatureOf(node),
          params: (node.params ?? []).map(param => param.name),
          outputs: node.outputs ?? [],
          role: scaffoldRole(project, file, node),
          purpose: scaffoldPurpose(node),
        })
      }
    }
    const inside = new Set(group.map(file => file.rel))
    const flow = edges
      .filter(edge => edge.kind === 'data')
      .filter(edge => inside.has(edge.fromFile) || inside.has(edge.toFile))
      .map(edge => ({ from: edge.from, to: edge.to, ...(edge.label === undefined ? {} : { label: edge.label }) }))
    const purpose = areaPurpose(group)
    modules.push({
      key: key === '' ? conventionProjectName(project) : key,
      ...(purpose === undefined ? {} : { purpose }),
      files: group.map(file => file.rel),
      blocks,
      flow,
    })
  }
  return modules
}

/**
 * Where a new block goes, one line per rule.
 *
 * @returns {string[]} the lines.
 */
function scaffoldPlacementLines() {
  return [
    '  named-block: put the new work in a new named function, never in an anonymous callback',
    '  doc-line: give the new function a one-line description directly above it',
    '  explicit-io: take what it needs as parameters and hand the result back as a return value',
    '  orchestrator-entry: let an entry function only call named blocks, in order',
    '  small-block: keep the new block under 80 lines and 6 parameters',
    '  static-import: reach another file through a static import, never a dynamic one',
    '  one-responsibility: put the new block in the file whose area owns that responsibility',
    '  pure-core: keep reading, writing and requests in the IO blocks, and let the new block compute',
  ]
}

/**
 * The shape a new block follows.
 *
 * @returns {string[]} the lines.
 */
function scaffoldTemplateLines() {
  return [
    '  /** one line: what this block does */',
    '  export function <name>(<input>) -> <output> { ... }',
  ]
}

/**
 * How the framework of a scope should be built, module by module.
 *
 * The answer names the areas of the scope, the files in them, the blocks in
 * those files and the role each block plays, the data that flows between
 * them, where new code goes, and the template a new block follows.
 *
 * @param {object} project - the project model.
 * @param {{ level?: string, rel?: string, name?: string }} [scope] - the scope.
 * @param {{ translate?: (key: string, values?: object) => string }} [options]
 * @returns {{ scope: string, text: string, facts: object }} the report.
 */
export function scaffoldReport(project, scope = {}, options = {}) {
  const translate = conventionTranslator(options)
  const resolved = scaffoldResolveScope(project, scope)
  const level = resolved.level
  const files = scaffoldTargetFiles(project, resolved)
  const edges = scaffoldScopeEdges(project, files)
  const modules = scaffoldModules(project, files, resolved, edges)
  const blocks = []
  for (const file of files) {
    for (const node of file.nodes ?? []) {
      if (level === 'block' && node.name !== resolved.block) continue
      blocks.push(conventionBlockFact(project, file, node))
    }
  }
  const lines = []
  lines.push(`SCAFFOLD ${scaffoldScopeLabel(project, resolved)}`)
  lines.push('RULES')
  lines.push(...conventionRuleLines())
  lines.push('MODULE LAYOUT')
  if (modules.length === 0) lines.push('  (nothing in this scope)')
  for (const module of modules) {
    const purpose = module.purpose === undefined ? '' : ` — ${module.purpose}`
    lines.push(`  ${module.key}${purpose}`)
    for (const rel of module.files) {
      const file = files.find(candidate => candidate.rel === rel)
      const count = (file?.nodes ?? []).length
      lines.push(`    ${rel} (${count} blocks)`)
      for (const block of module.blocks) {
        if (block.file !== rel) continue
        lines.push(`      ${block.signature}  [${block.role}]  ${block.purpose}`)
      }
    }
  }
  const flow = edges.filter(edge => edge.kind === 'data').slice(0, conventionMaxFlow)
  lines.push('DATA FLOW')
  if (flow.length === 0) lines.push('  (no data edges in this scope)')
  for (const edge of flow) {
    lines.push(edge.label === undefined ? `  ${edge.from} -> ${edge.to}` : `  ${edge.from} -> ${edge.to}  (${edge.label})`)
  }
  lines.push('WHERE NEW CODE GOES')
  lines.push(...scaffoldPlacementLines())
  lines.push('TEMPLATE FOR A NEW BLOCK')
  lines.push(...scaffoldTemplateLines())
  return {
    scope: scaffoldScopeString(resolved),
    text: lines.join('\n'),
    facts: {
      kind: 'scaffold',
      files: files.map(file => conventionFileFact(file)),
      blocks,
      edges: edges.map(edge => ({
        from: edge.from,
        to: edge.to,
        kind: edge.kind,
        ...(edge.label === undefined ? {} : { label: edge.label }),
      })),
      issues: conventionViolationsFor(project, files, translate).map(issue => conventionIssueFact(issue)),
      modules: modules.map(module => ({
        key: module.key,
        ...(module.purpose === undefined ? {} : { purpose: module.purpose }),
        files: module.files,
        blocks: module.blocks,
        flow: module.flow,
      })),
    },
  }
}
