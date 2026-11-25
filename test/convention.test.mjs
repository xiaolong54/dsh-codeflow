/**
 * The convention: the rules the AI must hold to, the report that checks a
 * project against them, and the report that says how a scope should be built.
 *
 * The projects here are built by the real project layer, because the
 * convention has exactly one detector: the report reads the problems the
 * project model found. A report with a second detector would be a second
 * truth, and the two would drift apart.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProject } from '../src/project.js'
import { CONVENTION_RULES, conventionReport, scaffoldReport } from '../src/convention.js'

/** A body of `count` short lines. */
function filler(count) {
  let body = ''
  for (let index = 0; index < count; index++) body += `  const step${index} = ${index}\n`
  return body
}

/**
 * Build a project from source files.
 *
 * @param {{ rel: string, text: string }[]} files - the files.
 * @returns {object} the project model.
 */
function makeProject(files) {
  return buildProject({
    root: 'D:/p',
    name: 'p',
    files: files.map(file => ({ path: `D:/p/${file.rel}`, rel: file.rel, text: file.text })),
  })
}

/** A project that breaks the rules the checks can see. */
function dirtyProject() {
  const app = [
    '/** Runs the pipeline. */',
    'export function run() {',
    filler(13),
    '  return step12',
    '}',
    '',
    'export function parseInput(input: string) {',
    "  return input.trim()",
    '}',
    '',
    '/** Formats many rows. */',
    'export function big() {',
    filler(85),
    '  return step84',
    '}',
    '',
    '/** Takes many inputs. */',
    'export function wide(a, b, c, d, e, f, g) {',
    '  return a',
    '}',
    '',
    'let counter = 0',
    '',
    '/** Counts the calls. */',
    'export function mutate() {',
    '  counter = counter + 1',
    '}',
    '',
  ].join('\n')
  const store = [
    '/** Reads the store. */',
    'export function readStore() {',
    '  return []',
    '}',
    '',
  ].join('\n')
  return makeProject([
    { rel: 'src/app/run.ts', text: app },
    { rel: 'src/store/read.ts', text: store },
  ])
}

/** A project that holds to every rule the checks can see. */
function cleanProject() {
  const app = [
    '/** Runs the pipeline. */',
    'export function run(input: string) {',
    '  const rows = parseInput(input)',
    '  const scored = scoreRows(rows)',
    '  return scored',
    '}',
    '',
    '/** Splits the input into rows. */',
    'function parseInput(input: string) {',
    "  return input.split(',')",
    '}',
    '',
    '/** Scores every row. */',
    'function scoreRows(rows: string[]) {',
    '  return rows.map(row => row.length)',
    '}',
    '',
  ].join('\n')
  const store = [
    '/** Reads the store. */',
    'export function readStore() {',
    '  return []',
    '}',
    '',
  ].join('\n')
  return makeProject([
    { rel: 'src/app/run.ts', text: app },
    { rel: 'src/store/read.ts', text: store },
  ])
}

test('the convention holds eight rules, each with a title and a text', () => {
  assert.equal(CONVENTION_RULES.length, 8)
  const ids = CONVENTION_RULES.map(rule => rule.id)
  assert.deepEqual(ids, [
    'named-block',
    'doc-line',
    'explicit-io',
    'orchestrator-entry',
    'small-block',
    'static-import',
    'one-responsibility',
    'pure-core',
  ])
  for (const rule of CONVENTION_RULES) {
    assert.equal(typeof rule.title, 'string')
    assert.ok(rule.title.length > 0, `${rule.id} has no title`)
    assert.equal(typeof rule.text, 'string')
    assert.ok(rule.text.length > 0, `${rule.id} has no text`)
  }
})

test('the report finds a block without a description', () => {
  const report = conventionReport(dirtyProject())
  const issue = report.facts.issues.find(item => item.code === 'missing-doc')

  assert.ok(issue !== undefined, 'the undocumented block is reported')
  assert.equal(issue.file, 'src/app/run.ts')
  assert.equal(issue.node, 'parseInput')
  assert.ok(issue.message.length > 0)
  assert.match(report.text, /missing-doc/)
})

test('the report finds a block that is too long and one that takes too many parameters', () => {
  const report = conventionReport(dirtyProject())
  const big = report.facts.issues.filter(item => item.code === 'block-too-large' && item.node === 'big')
  const wide = report.facts.issues.filter(item => item.code === 'too-many-params' && item.node === 'wide')

  assert.equal(big.length, 1, 'the long block is reported once')
  assert.equal(wide.length, 1, 'the wide block is reported once')
  assert.equal(big[0].file, 'src/app/run.ts')
})

test('the report finds an entry that does the work instead of orchestrating', () => {
  const report = conventionReport(dirtyProject())
  const issue = report.facts.issues.find(item => item.code === 'orchestrator-entry')

  assert.ok(issue !== undefined, 'the implementing entry is reported')
  assert.equal(issue.node, 'run')
  assert.equal(issue.file, 'src/app/run.ts')
})

test('the report finds a write to a name the block never received', () => {
  const report = conventionReport(dirtyProject())
  const issue = report.facts.issues.find(item => item.code === 'explicit-io')

  assert.ok(issue !== undefined, 'the hidden write is reported')
  assert.equal(issue.node, 'mutate')
})

test('a project that holds to the convention reports no violation', () => {
  const report = conventionReport(cleanProject())

  assert.deepEqual(report.facts.issues, [])
  assert.match(report.text, /VIOLATIONS\n  \(none\)/)
  assert.match(report.text, /0 violations/)
  assert.equal(report.scope, 'convention')
})

test('the report names the rules, the files it checked and a summary', () => {
  const report = conventionReport(dirtyProject())

  assert.match(report.text, /^CONVENTION p/m)
  assert.match(report.text, /RULES\n  1\. One feature, one named function/)
  assert.match(report.text, /CHECKED\n {2}src\/app\/run\.ts {2}\d+ blocks/)
  assert.match(report.text, /src\/store\/read\.ts {2}\d+ blocks {2}ok/)
  assert.match(report.text, /SUMMARY\n {2}\d+ blocks, \d+ violations, \d+ files without a description/)
})

test('the report can be limited to one scope', () => {
  const report = conventionReport(dirtyProject(), { scope: 'src/store' })

  assert.equal(report.scope, 'convention src/store')
  assert.match(report.text, /^CONVENTION src\/store/m)
  assert.ok(!report.text.includes('src/app/run.ts'))
})

test('the scaffold of a project lists its areas', () => {
  const report = scaffoldReport(cleanProject(), { level: 'project' })

  assert.equal(report.scope, 'scaffold')
  assert.match(report.text, /^SCAFFOLD p/m)
  assert.match(report.text, /MODULE LAYOUT\n {2}src\/app/)
  assert.match(report.text, / {4}src\/store\/read\.ts \(1 blocks\)/)
  assert.equal(report.facts.modules.length, 2)
  assert.equal(report.facts.modules[0].key, 'src/app')
})

test('the scaffold of a file lists its blocks with their roles', () => {
  const report = scaffoldReport(cleanProject(), { level: 'file', rel: 'src/app/run.ts' })

  assert.equal(report.scope, 'scaffold file src/app/run.ts')
  assert.match(report.text, /src\/app\/run\.ts \(3 blocks\)/)
  assert.match(report.text, /run\(input: string\) -> scored {2}\[entry\] {2}Runs the pipeline\./)
  const blocks = report.facts.modules[0].blocks
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].name, 'run')
  assert.equal(blocks[0].role, 'entry')
  assert.equal(blocks[0].purpose, 'Runs the pipeline.')
  assert.equal(blocks[1].role, 'block')
  assert.equal(blocks[1].purpose, 'Splits the input into rows.')
})

test('the scaffold carries the data edges of the scope', () => {
  const report = scaffoldReport(cleanProject(), { level: 'file', rel: 'src/app/run.ts' })
  const flow = report.facts.modules[0].flow

  assert.ok(flow.length > 0, 'the module carries its data edges')
  const inner = flow.find(edge => edge.from === 'parseInput' && edge.to === 'scoreRows')
  assert.ok(inner !== undefined)
  assert.equal(inner.label, 'rows')
  assert.match(report.text, /DATA FLOW\n {2}parseInput -> scoreRows {2}\(rows\)/)
})

test('a path that names a directory is read as an area', () => {
  const report = scaffoldReport(cleanProject(), { level: 'file', rel: 'src/app' })

  assert.equal(report.scope, 'scaffold area src/app')
  assert.match(report.text, /src\/app\/run\.ts \(3 blocks\)/)
  // The layout holds the area's own files; the store only shows up as the
  // other end of a data edge.
  const layout = report.text.split('DATA FLOW')[0]
  assert.ok(!layout.includes('src/store/read.ts'))
})

test('the scaffold tells where new code goes and what a new block looks like', () => {
  const report = scaffoldReport(cleanProject(), { level: 'project' })

  assert.match(report.text, /WHERE NEW CODE GOES\n {2}named-block:/)
  assert.match(report.text, /TEMPLATE FOR A NEW BLOCK/)
  assert.match(report.text, /\/\*\* one line: what this block does \*\//)
  assert.match(report.text, /export function <name>\(<input>\) -> <output> \{ \.\.\. \}/)
})

test('the convention facts carry the shape the reports promise', () => {
  const facts = conventionReport(dirtyProject()).facts

  assert.equal(facts.kind, 'convention')
  assert.deepEqual(Object.keys(facts).sort(), ['blocks', 'edges', 'files', 'issues', 'kind', 'rules'])
  assert.equal(facts.files[0].rel, 'src/app/run.ts')
  assert.equal(facts.files[0].lang, 'typescript')
  assert.equal(typeof facts.files[0].blocks, 'number')
  assert.equal(typeof facts.files[0].lines, 'number')
  const block = facts.blocks[0]
  for (const key of ['name', 'file', 'line', 'kind', 'signature', 'params', 'outputs', 'exported', 'entry', 'calls', 'calledBy']) {
    assert.ok(key in block, `the block fact has no ${key}`)
  }
  assert.deepEqual(block.params, [])
  assert.equal(facts.rules[0].id, 'named-block')
  assert.equal(facts.edges.length, 0)
})

test('the scaffold facts carry the shape the reports promise', () => {
  const facts = scaffoldReport(cleanProject(), { level: 'project' }).facts

  assert.equal(facts.kind, 'scaffold')
  assert.deepEqual(Object.keys(facts).sort(), ['blocks', 'edges', 'files', 'issues', 'kind', 'modules'])
  const module = facts.modules[0]
  for (const key of ['key', 'files', 'blocks', 'flow']) {
    assert.ok(key in module, `the module fact has no ${key}`)
  }
  assert.deepEqual(module.files, ['src/app/run.ts'])
  assert.ok(facts.edges.every(edge => edge.kind === 'call' || edge.kind === 'data'))
})
