#!/usr/bin/env node
/**
 * Language coverage measurement for the code-flow parser.
 *
 * The parser understands non-JavaScript languages through one generic text
 * engine, so every language is a guess. This script measures the guess: it
 * parses the fixture corpus under `test/fixtures/langs` and reports, per
 * language, the blocks it found, the edges it linked, the calls it lost and
 * the call sites it never saw at all.
 *
 * Usage:
 *   node tools/measure-langs.mjs             # measure the live parser in src/
 *   node tools/measure-langs.mjs .baseline   # measure the snapshot in .baseline/src
 *
 * The exit code is always 0: this is a measurement, not a test.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'langs')
const LANGS = ['python', 'go', 'java', 'csharp', 'rust', 'kotlin', 'swift']

/** Words that look like a call but never are one. */
const CONTROL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'throw', 'do', 'else',
  'try', 'finally', 'case', 'match', 'when', 'guard', 'await', 'yield', 'assert',
  'defer', 'select', 'lock', 'using', 'fixed', 'synchronized', 'with', 'unless',
  'repeat', 'foreach', 'in', 'is', 'not', 'and', 'or', 'super', 'self', 'this',
])

/** A call site in source text. */
const CALL_PATTERN = /([A-Za-z_]\w*)\s*\(/g

const parserRoot = path.resolve(process.cwd(), process.argv[2] ?? ROOT)
const srcDir = path.join(parserRoot, 'src')
const { parseFile } = await import(pathToFileURL(path.join(srcDir, 'parser.js')).href)
const { buildProject } = await import(pathToFileURL(path.join(srcDir, 'project.js')).href)

/** The bare part of a qualified block name: `Service.describe` -> `describe`. */
function bareOf(name) {
  const index = String(name).indexOf('.')
  return index === -1 ? String(name) : String(name).slice(index + 1)
}

/** The owner part of a qualified block name. */
function ownerOf(name) {
  const index = String(name).indexOf('.')
  return index === -1 ? undefined : String(name).slice(0, index)
}

/** The body of one block, with its offset in the file. */
function bodyOf(file, node) {
  if (node.bodyStart !== undefined && node.bodyEnd !== undefined) {
    return { text: file.text.slice(node.bodyStart, node.bodyEnd), offset: node.bodyStart }
  }
  const start = node.start ?? 0
  const text = file.text.slice(start, node.end ?? start)
  const newline = text.indexOf('\n')
  if (newline === -1) return { text: '', offset: start }
  return { text: text.slice(newline + 1), offset: start + newline + 1 }
}

/** Read the fixture files of one language. */
function readFixture(lang) {
  const dir = path.join(FIXTURES, lang)
  const names = fs.readdirSync(dir).filter(name => !name.startsWith('.')).sort()
  return {
    dir,
    files: names.map(name => {
      const full = path.join(dir, name)
      return { path: full, rel: name.split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') }
    }),
  }
}

/**
 * The calls the parser did not link, in four flavours.
 *
 * - `lost`: the parser recorded the call and the callee is declared in the
 *   same file, but no edge of that file connects the caller to the callee.
 * - `missed`: the call site is in the source, but the parser never recorded
 *   it, so no edge can exist.
 * - `ghost`: the parser recorded an owner-qualified call (`Owner.method`)
 *   that no block of the project answers.
 * - `unresolved`: the callee lives in another file of the project, but no
 *   project edge connects the two.
 */
function findUnlinked(project) {
  const lost = []
  const missed = []
  const ghost = []
  const unresolved = []
  const projectByBare = new Map()
  for (const file of project.files) {
    for (const node of file.nodes) {
      const bare = bareOf(node.name)
      if (!projectByBare.has(bare)) projectByBare.set(bare, [])
      projectByBare.get(bare).push({ rel: file.rel, node })
    }
  }
  const exactNames = new Set(project.files.flatMap(file => file.nodes.map(node => node.name)))
  for (const file of project.files) {
    const byName = new Map(file.nodes.map(node => [node.name, node]))
    const byBare = new Map()
    for (const node of file.nodes) {
      const bare = bareOf(node.name)
      if (!byBare.has(bare)) byBare.set(bare, node)
    }
    const lookup = (name, owner) => {
      const exact = byName.get(name)
      if (exact !== undefined) return exact
      const bare = byBare.get(name)
      if (bare === undefined) return undefined
      if (owner !== undefined && ownerOf(bare.name) !== owner) return undefined
      return bare
    }
    for (const node of file.nodes) {
      const owner = ownerOf(node.name)
      const recorded = [...(node.calls ?? []), ...(node.openCalls ?? [])]
      const recordedNames = new Set(recorded.map(call => bareOf(call.name)))
      for (const call of recorded) {
        const target = lookup(call.name, owner)
        if (target === undefined) {
          // A qualified call to a block that does not exist anywhere.
          if (call.name.includes('.') && !exactNames.has(call.name)) {
            ghost.push({ file: file.rel, line: call.line ?? node.line, caller: node.name, callee: call.name })
          }
        } else {
          const producer = call.payload?.producer === undefined
            ? undefined
            : lookup(call.payload.producer, owner)
          const linked = file.edges.some(edge => edge.to === target.id
            && (edge.from === node.id || (producer !== undefined && edge.from === producer.id)))
          if (!linked) {
            lost.push({ file: file.rel, line: call.line ?? node.line, caller: node.name, callee: call.name })
          }
        }
        // A callee in another file of the project that no project edge reaches.
        const elsewhere = (projectByBare.get(bareOf(call.name)) ?? []).filter(item => item.rel !== file.rel)
        if (elsewhere.length === 0) continue
        const reached = project.crossEdges.some(edge => edge.fromFile === file.rel
          && elsewhere.some(item => item.rel === edge.toFile && item.node.name === edge.toNode))
        if (!reached) {
          unresolved.push({ file: file.rel, line: call.line ?? node.line, caller: node.name, callee: call.name })
        }
      }
      // Call sites the parser never recorded at all.
      const body = bodyOf(file, node)
      const own = new Set([node.name, bareOf(node.name)])
      for (const match of body.text.matchAll(CALL_PATTERN)) {
        const name = match[1]
        if (CONTROL.has(name) || own.has(name) || recordedNames.has(name)) continue
        if (lookup(name, owner) === undefined) continue
        const line = file.text.slice(0, body.offset + match.index).split('\n').length
        missed.push({ file: file.rel, line, caller: node.name, callee: name })
      }
    }
  }
  return { lost, missed, ghost, unresolved }
}

/** All metrics of one language. */
function measure(lang, project) {
  const blocks = []
  for (const file of project.files) for (const node of file.nodes) blocks.push({ file, node })
  const kinds = { method: 0, entry: 0, function: 0 }
  let documented = 0
  for (const { node } of blocks) {
    kinds[node.kind] = (kinds[node.kind] ?? 0) + 1
    if (typeof node.doc === 'string' && node.doc.trim().length > 0) documented += 1
  }
  const intra = { call: 0, data: 0 }
  for (const file of project.files) {
    const ids = new Set(file.nodes.map(node => node.id))
    for (const edge of file.edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) continue
      if (edge.kind === 'data') intra.data += 1
      else intra.call += 1
    }
  }
  const cross = { call: 0, data: 0, sameFile: 0 }
  for (const edge of project.crossEdges) {
    if (edge.fromFile === edge.toFile) { cross.sameFile += 1; continue }
    if (edge.kind === 'data') cross.data += 1
    else cross.call += 1
  }
  const unlinked = findUnlinked(project)
  const orphans = []
  const uncalled = []
  for (const file of project.files) {
    for (const node of file.nodes) {
      if ((node.projectCalls ?? 0) !== 0) continue
      const item = { file: file.rel, name: node.name, kind: node.kind }
      if (node.kind === 'method' || node.kind === 'entry') orphans.push(item)
      else uncalled.push(item)
    }
  }
  const diagnostics = new Map()
  for (const diagnostic of project.diagnostics) {
    diagnostics.set(diagnostic.code, (diagnostics.get(diagnostic.code) ?? 0) + 1)
  }
  return {
    lang,
    files: project.files.length,
    blocks: blocks.length,
    methods: kinds.method ?? 0,
    entries: kinds.entry ?? 0,
    functions: kinds.function ?? 0,
    docPct: blocks.length === 0 ? 0 : Math.round((documented / blocks.length) * 100),
    intra,
    cross,
    ...unlinked,
    orphans,
    uncalled,
    diagnostics,
    project,
  }
}

/** One plain-language sentence about the worst problem of a language. */
function noteFor(row) {
  const problems = []
  if (row.lost.length > 0) problems.push(`${row.lost.length} recorded calls are not linked`)
  if (row.missed.length > 0) problems.push(`${row.missed.length} call sites were never recorded`)
  if (row.ghost.length > 0) problems.push(`${row.ghost.length} calls name a block that does not exist`)
  if (row.unresolved.length > 0) problems.push(`${row.unresolved.length} cross-file calls stay unlinked`)
  if (problems.length === 0) return 'no lost calls'
  if (row.orphans.length > 0) problems.push(`${row.orphans.length} method(s) look uncalled`)
  return problems.join('; ')
}

/** Shorten a doc string for the report. */
function shortDoc(doc) {
  if (typeof doc !== 'string') return ''
  const text = doc.replace(/\s+/g, ' ').trim()
  return text.length > 46 ? `${text.slice(0, 45)}…` : text
}

const COLUMNS = [
  ['lang', 9], ['files', 5], ['blocks', 6], ['meth', 4], ['entr', 4], ['doc%', 5],
  ['intra c/d', 9], ['cross c/d', 9], ['lost', 4], ['miss', 4], ['ghost', 5],
  ['unres', 5], ['orph', 4], ['diag', 4],
]

function cell(value, width) {
  return String(value).padEnd(width)
}

function row(cells) {
  return cells.map((value, index) => cell(value, COLUMNS[index][1])).join(' ').trimEnd()
}

function sum(rows, pick) {
  return rows.reduce((total, item) => total + pick(item), 0)
}

function totalOf(rows) {
  const blocks = sum(rows, item => item.blocks)
  const documented = sum(rows, item => Math.round(item.docPct * item.blocks / 100))
  return {
    lang: 'TOTAL',
    files: sum(rows, item => item.files),
    blocks,
    methods: sum(rows, item => item.methods),
    entries: sum(rows, item => item.entries),
    docPct: blocks === 0 ? 0 : Math.round(documented / blocks * 100),
    intra: { call: sum(rows, item => item.intra.call), data: sum(rows, item => item.intra.data) },
    cross: { call: sum(rows, item => item.cross.call), data: sum(rows, item => item.cross.data) },
    lost: sum(rows, item => item.lost.length),
    missed: sum(rows, item => item.missed.length),
    ghost: sum(rows, item => item.ghost.length),
    unresolved: sum(rows, item => item.unresolved.length),
    orphans: sum(rows, item => item.orphans.length),
    diagnostics: sum(rows, item => [...item.diagnostics.values()].reduce((a, b) => a + b, 0)),
  }
}

const rows = []
for (const lang of LANGS) {
  const fixture = readFixture(lang)
  const project = buildProject({ root: fixture.dir, name: lang, files: fixture.files })
  rows.push(measure(lang, project))
}

console.log(`parser:   ${srcDir}`)
console.log(`fixtures: ${FIXTURES}`)
console.log('')
console.log(row(COLUMNS.map(([title]) => title)))
for (const item of rows) {
  console.log(row([
    item.lang,
    item.files,
    item.blocks,
    item.methods,
    item.entries,
    `${item.docPct}%`,
    `${item.intra.call}/${item.intra.data}`,
    `${item.cross.call}/${item.cross.data}`,
    item.lost.length,
    item.missed.length,
    item.ghost.length,
    item.unresolved.length,
    item.orphans.length,
    [...item.diagnostics.values()].reduce((a, b) => a + b, 0),
  ]))
}
const total = totalOf(rows)
console.log(row([
  total.lang, total.files, total.blocks, total.methods, total.entries, `${total.docPct}%`,
  `${total.intra.call}/${total.intra.data}`, `${total.cross.call}/${total.cross.data}`,
  total.lost, total.missed, total.ghost, total.unresolved, total.orphans, total.diagnostics,
]))
console.log('')
console.log('intra = edges inside one file, cross = edges between two files (call/data).')
console.log('lost = call recorded but not linked, miss = call site never recorded.')
console.log('ghost = call to a block that does not exist, unres = cross-file call without an edge.')
console.log('')

for (const item of rows) {
  console.log(`── ${item.lang} ${'─'.repeat(Math.max(0, 62 - item.lang.length))}`)
  console.log(`  files ${item.files}  blocks ${item.blocks}  methods ${item.methods}  entries ${item.entries}  functions ${item.functions}  doc ${item.docPct}%`)
  console.log(`  intra edges ${item.intra.call + item.intra.data} (call ${item.intra.call}, data ${item.intra.data})`)
  console.log(`  cross edges ${item.cross.call + item.cross.data} (call ${item.cross.call}, data ${item.cross.data})  project edges inside one file: ${item.cross.sameFile}`)
  console.log(`  lost ${item.lost.length}  missed ${item.missed.length}  ghost ${item.ghost.length}  unresolved ${item.unresolved.length}`)
  for (const sample of item.lost.slice(0, 5)) {
    console.log(`    lost:       ${sample.file}:${sample.line} ${sample.caller} -> ${sample.callee}`)
  }
  for (const sample of item.missed.slice(0, 5)) {
    console.log(`    missed:     ${sample.file}:${sample.line} ${sample.caller} -> ${sample.callee}`)
  }
  for (const sample of item.ghost.slice(0, 5)) {
    console.log(`    ghost:      ${sample.file}:${sample.line} ${sample.caller} -> ${sample.callee}`)
  }
  for (const sample of item.unresolved.slice(0, 5)) {
    console.log(`    unresolved: ${sample.file}:${sample.line} ${sample.caller} -> ${sample.callee}`)
  }
  console.log(`  orphans (method/entry with no caller): ${item.orphans.length === 0 ? 'none' : ''}`)
  for (const orphan of item.orphans) console.log(`    ${orphan.file}  ${orphan.name}`)
  console.log(`  uncalled functions: ${item.uncalled.length === 0 ? 'none' : ''}`)
  for (const entry of item.uncalled) console.log(`    ${entry.file}  ${entry.name}`)
  console.log(`  diagnostics: ${item.diagnostics.size === 0 ? 'none' : ''}`)
  for (const [code, count] of item.diagnostics) console.log(`    ${code}: ${count}`)
  console.log('  blocks:')
  for (const file of item.project.files) {
    console.log(`    ${file.rel}`)
    for (const node of file.nodes) {
      const calls = (node.calls ?? []).map(call => call.name).join(', ')
      console.log(`      ${cell(node.name, 22)} ${cell(node.kind, 9)} L${cell(node.line, 4)} refs ${cell(node.projectCalls ?? 0, 3)} calls: ${calls === '' ? '-' : calls}`)
      console.log(`        doc: ${shortDoc(node.doc)}`)
    }
  }
  console.log(`  note: ${noteFor(item)}`)
  console.log('')
}
