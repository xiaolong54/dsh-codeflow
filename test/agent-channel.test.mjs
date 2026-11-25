/**
 * The agent's half of the plugin: the map written out for the model.
 *
 * The panel draws a picture for the person; the tool writes the same model
 * out as text and as data. These tests check that the two halves agree, that
 * the text carries what the model needs — the blocks, the values that move
 * between them, the source, the problems — and that the declared output
 * schema still describes what the tool actually returns.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProject } from '../src/project.js'
import {
  reportOverview, reportArea, reportFile, reportBlock, reportFlow, reportContracts, reportDiagnostics,
} from '../src/host/report.js'
import { answerFor, PARAMETERS, OUTPUT } from '../src/host/tool.js'

/** A project with two areas and a value that crosses between them. */
function sampleProject() {
  return buildProject({
    root: 'D:/p',
    name: 'p',
    files: [
      {
        path: 'D:/p/src/api/user.ts',
        rel: 'src/api/user.ts',
        text: [
          '/** Loads one user from the store. */',
          'export function loadUser(id: string) {',
          '  const rows = readStore()',
          '  return pick(rows, id)',
          '}',
          '',
        ].join('\n'),
      },
      {
        path: 'D:/p/src/api/order.ts',
        rel: 'src/api/order.ts',
        text: 'export function loadOrder() {\n  return readStore()\n}\n',
      },
      {
        path: 'D:/p/src/store/db.ts',
        rel: 'src/store/db.ts',
        text: 'export function readStore() {\n  return []\n}\n',
      },
    ],
  })
}

/**
 * A small validator for the JSON Schema subset the tool declares, so the
 * declared shape and the returned shape cannot drift apart.
 *
 * @param {object} schema - the schema node.
 * @param {unknown} value - the value to check.
 * @param {string} at - the path of the value, for the report.
 * @returns {string[]} the problems found.
 */
function validate(schema, value, at = 'value') {
  const problems = []
  const walk = (node, val, where) => {
    if (node.type === undefined) return
    if (node.type === 'object') {
      if (typeof val !== 'object' || val === null || Array.isArray(val)) {
        problems.push(`${where} must be an object`)
        return
      }
      for (const key of node.required ?? []) {
        if (!Object.hasOwn(val, key) || val[key] === undefined) problems.push(`${where}.${key} is required`)
      }
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        if (!Object.hasOwn(val, key) || val[key] === undefined) continue
        walk(child, val[key], `${where}.${key}`)
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(val)) {
          if (!Object.hasOwn(node.properties ?? {}, key)) problems.push(`${where}.${key} is not declared`)
        }
      }
      return
    }
    if (node.type === 'array') {
      if (!Array.isArray(val)) {
        problems.push(`${where} must be an array`)
        return
      }
      if (node.items !== undefined) val.forEach((item, index) => walk(node.items, item, `${where}[${index}]`))
      return
    }
    if (node.type === 'string' && typeof val !== 'string') problems.push(`${where} must be a string`)
    if (node.type === 'integer' && !Number.isInteger(val)) problems.push(`${where} must be an integer`)
    if (node.type === 'number' && typeof val !== 'number') problems.push(`${where} must be a number`)
    if (node.type === 'boolean' && typeof val !== 'boolean') problems.push(`${where} must be a boolean`)
  }
  walk(schema, value, at)
  return problems
}

test('the file report carries the blocks, the values, the issues and the source', () => {
  const report = reportFile(sampleProject(), 'src/api/user.ts')

  assert.match(report.text, /FILE src\/api\/user\.ts/)
  assert.match(report.text, /loadUser\(id: string\)/)
  // The value that travels with the call is named, not just the call.
  assert.match(report.text, /readStore/)
  assert.match(report.text, /data=rows/)
  // The source is there: the model reads code, not only a description.
  assert.match(report.text, /export function loadUser/)
  assert.equal(report.facts.blocks.length, 1)
  assert.equal(report.facts.blocks[0].name, 'loadUser')
  assert.deepEqual(report.facts.blocks[0].params, ['id'])
})

test('the block report carries the code and who calls it', () => {
  const report = reportBlock(sampleProject(), 'src/api/user.ts', 'loadUser')

  assert.match(report.text, /BLOCK loadUser/)
  assert.match(report.text, /Loads one user from the store/)
  assert.match(report.text, /export function loadUser/)
  // A block that is called from another file says so.
  const project = sampleProject()
  const callers = reportBlock(project, 'src/store/db.ts', 'readStore')
  assert.match(callers.text, /called by: src\/api\/user\.ts#loadUser/)
})

test('the flow report names the value that moves through a block', () => {
  const report = reportFlow(sampleProject(), 'src/api/user.ts', 'loadUser')

  assert.match(report.text, /FLOW loadUser/)
  assert.match(report.text, /values it passes on:/)
  assert.match(report.text, /rows/)
  assert.match(report.text, /inputs: id: string/)
})

test('the contracts report lists the exported blocks and their callers', () => {
  const report = reportContracts(sampleProject())

  assert.match(report.text, /CONTRACTS/)
  assert.match(report.text, /readStore\(\)/)
  assert.match(report.text, /called by: src\/api\/user\.ts#loadUser/)
})

test('the overview names the areas, the entries and the next step', () => {
  const report = reportOverview(sampleProject())

  assert.match(report.text, /AREAS/)
  assert.match(report.text, /src\/api/)
  assert.match(report.text, /ENTRIES/)
  assert.match(report.text, /action=file/)
  assert.equal(report.facts.areas.length, 2)
})

test('the area report holds the blocks of the area and the flow between them', () => {
  const report = reportArea(sampleProject(), 'src/api')

  assert.match(report.text, /AREA src\/api/)
  assert.match(report.text, /loadUser/)
  assert.match(report.text, /loadOrder/)
})

test('a call that could reach several blocks is reported as an issue', () => {
  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [
      { path: 'D:/p/a.ts', rel: 'a.ts', text: 'export function run() {\n  return helper()\n}\n' },
      { path: 'D:/p/b.ts', rel: 'b.ts', text: 'export function helper() {\n  return 1\n}\n' },
      { path: 'D:/p/c.ts', rel: 'c.ts', text: 'export function helper() {\n  return 2\n}\n' },
    ],
  })

  const report = reportDiagnostics(project)
  assert.match(report.text, /ambiguous-call/)
  assert.match(report.text, /helper/)
  const issue = report.facts.issues.find(item => item.code === 'ambiguous-call')
  assert.ok(issue !== undefined)
  assert.equal(issue.file, 'a.ts')
  assert.equal(issue.node, 'run')
})

test('the tool routes every action it offers', () => {
  const project = sampleProject()

  assert.equal(answerFor(project, 'overview').scope, 'overview')
  assert.equal(answerFor(project, 'area', 'src/api').scope, 'area src/api')
  assert.equal(answerFor(project, 'file', 'src/api/user.ts').scope, 'file src/api/user.ts')
  assert.equal(answerFor(project, 'block', 'src/api/user.ts', 'loadUser').scope, 'block src/api/user.ts loadUser')
  assert.equal(answerFor(project, 'flow', 'src/api/user.ts', 'loadUser').scope, 'flow src/api/user.ts loadUser')
  assert.equal(answerFor(project, 'contracts').scope, 'contracts')
  assert.equal(answerFor(project, 'diagnostics').scope, 'diagnostics')
  // The blueprint of a scope, and the rules a project holds to.
  assert.equal(answerFor(project, 'scaffold', 'src/api/user.ts').scope, 'scaffold file src/api/user.ts')
  assert.equal(answerFor(project, 'convention').scope, 'convention')
  // An unknown action says what the tool can do instead of failing.
  assert.match(answerFor(project, 'nonsense').text, /Unknown action/)
})

test('the scaffold tells the model how the scope should be built', () => {
  const answer = answerFor(sampleProject(), 'scaffold', 'src/api/user.ts')

  assert.match(answer.text, /SCAFFOLD/)
  assert.match(answer.text, /MODULE LAYOUT/)
  assert.match(answer.text, /loadUser/)
  // The template is what the model copies when it adds a block.
  assert.match(answer.text, /TEMPLATE FOR A NEW BLOCK/)
  assert.equal(answer.facts.kind, 'scaffold')
  assert.equal(answer.facts.modules.length, 1)
})

test('the convention report lists the rules and the violations', () => {
  const answer = answerFor(sampleProject(), 'convention')

  assert.match(answer.text, /CONVENTION/)
  assert.match(answer.text, /RULES/)
  assert.equal(answer.facts.kind, 'convention')
  assert.equal(answer.facts.rules.length, 8)
  // The problems carry their kind, so the model can tell a broken flow from
  // a broken shape.
  for (const issue of answer.facts.issues) {
    assert.ok(issue.kind === 'flow' || issue.kind === 'convention', `${issue.code} has no kind`)
  }
})

test('what the tool returns fits the schema it declares', () => {
  const project = sampleProject()
  const answers = [
    answerFor(project, 'overview'),
    answerFor(project, 'area', 'src/api'),
    answerFor(project, 'file', 'src/api/user.ts'),
    answerFor(project, 'block', 'src/api/user.ts', 'loadUser'),
    answerFor(project, 'flow', 'src/api/user.ts', 'loadUser'),
    answerFor(project, 'contracts'),
    answerFor(project, 'diagnostics'),
    answerFor(project, 'scaffold', 'src/api/user.ts'),
    answerFor(project, 'convention'),
  ]

  for (const answer of answers) {
    const problems = validate(OUTPUT.schema, { scope: answer.scope, text: answer.text, facts: answer.facts })
    assert.deepEqual(problems, [], `${answer.scope}: ${problems.join(', ')}`)
  }
})

test('the parameters the model chooses from are a JSON Schema object', () => {
  assert.equal(PARAMETERS.type, 'object')
  assert.deepEqual(PARAMETERS.required, ['action'])
  assert.ok(Object.hasOwn(PARAMETERS.properties, 'path'))
  assert.ok(Object.hasOwn(PARAMETERS.properties, 'name'))
})
