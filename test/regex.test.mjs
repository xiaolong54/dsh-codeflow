/**
 * A regular expression is one token.
 *
 * The tokenizer used to read a pattern's brackets as code, which unbalances
 * the parentheses around it: the function that holds the pattern ends in the
 * wrong place, and every call after it belongs to the wrong block. The map
 * then draws edges that the code does not have — and a map that lies about
 * where data flows is worse than no map.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseFile } from '../src/parser.js'
import { buildProject } from '../src/project.js'

/** The names a block calls. */
function callsOf(code, name) {
  const graph = parseFile(code, 'javascript')
  const node = graph.nodes.find(candidate => candidate.name === name)
  return (node?.calls ?? []).map(call => call.name)
}

test('a pattern with parentheses does not end the function that holds it', () => {
  const code = [
    'function first(value) {',
    '  const pattern = /a(b|c)d/',
    '  return check(value, pattern)',
    '}',
    '',
    'function second(value) {',
    '  return helper(value)',
    '}',
    '',
    'function check(value, pattern) {',
    '  return pattern.test(value)',
    '}',
    '',
    'function helper(value) {',
    '  return value',
    '}',
  ].join('\n')

  // The block after the pattern keeps its own calls: the pattern's brackets
  // did not swallow the rest of the file.
  assert.deepEqual(callsOf(code, 'first'), ['check'])
  assert.deepEqual(callsOf(code, 'second'), ['helper'])
})

test('a pattern with a character class keeps its slash inside it', () => {
  const code = [
    'function match(value) {',
    '  return check(value, /[/]/)',
    '}',
    '',
    'function other(value) {',
    '  return helper(value)',
    '}',
    '',
    'function check(value, pattern) {',
    '  return value',
    '}',
    '',
    'function helper(value) {',
    '  return value',
    '}',
  ].join('\n')

  assert.deepEqual(callsOf(code, 'match'), ['check'])
  assert.deepEqual(callsOf(code, 'other'), ['helper'])
})

test('a division is still a division', () => {
  const code = [
    'function half(value) {',
    '  return value / 2',
    '}',
    '',
    'function other(value) {',
    '  return helper(value)',
    '}',
    '',
    'function helper(value) {',
    '  return value',
    '}',
  ].join('\n')

  assert.deepEqual(callsOf(code, 'other'), ['helper'])
  assert.deepEqual(callsOf(code, 'half'), [])
})

test('a pattern after an assignment is a pattern, not a division', () => {
  const code = [
    'function scan(text) {',
    '  const found = check(text)',
    '  return found',
    '}',
    '',
    'function other(value) {',
    '  return helper(value)',
    '}',
    '',
    'function check(text) {',
    '  return /[0-9]+/.test(text) ? text : text',
    '}',
    '',
    'function helper(value) {',
    '  return value',
    '}',
  ].join('\n')

  assert.deepEqual(callsOf(code, 'other'), ['helper'])
  assert.deepEqual(callsOf(code, 'scan'), ['check'])
})

test('a pattern does not steal the calls of the block after it', () => {
  // The bug in the shape it appeared in: the pattern ends the block early, so
  // the next call belongs to the wrong block and the map draws an edge that
  // the code does not have.
  const code = [
    'function derive(values) {',
    '  const names = []',
    '  for (const value of values) {',
    '    if (/^[a-z]/.test(value)) names.push(value)',
    '  }',
    '  return names',
    '}',
    '',
    'function counts(project) {',
    '  return issueCounts(project)',
    '}',
    '',
    'function issueCounts(project) {',
    '  return project.length',
    '}',
  ].join('\n')

  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [{ path: 'D:/p/a.ts', rel: 'a.ts', text: code }],
  })
  const edges = project.crossEdges.filter(edge => edge.kind === 'data')
  // `issueCounts` returns the project's length: that is a value, not a call
  // from a block that never mentions it.
  const wrong = edges.find(edge => edge.fromNode === 'derive' && edge.toNode === 'issueCounts')
  assert.equal(wrong, undefined, 'no edge may be invented across the pattern')
})
