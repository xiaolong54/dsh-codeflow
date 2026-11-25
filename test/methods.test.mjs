/**
 * A class's methods are blocks, and the calls between them are data flow.
 *
 * These cases lock in the resolution that was missing: a method is named
 * `Class.method`, but inside the class it is called by its bare name, so the
 * call has to resolve to the same block.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseFile } from '../src/parser.js'
import { buildProject } from '../src/project.js'

test('a method called by its bare name resolves to its own class block', () => {
  const code = [
    'class Reader {',
    '  read() {',
    '    return this.parse()',
    '  }',
    '  parse() {',
    '    return 1',
    '  }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'typescript')

  const read = graph.nodes.find(node => node.name === 'Reader.read')
  const parse = graph.nodes.find(node => node.name === 'Reader.parse')
  assert.ok(read !== undefined, 'the method is a block')
  assert.ok(parse !== undefined, 'the sibling method is a block')

  // The call inside the class is drawn between the two blocks.
  const edge = graph.edges.find(item => item.from === read.id && item.to === parse.id)
  assert.ok(edge !== undefined, 'the method-to-method call is an edge')
})

test('a method called through this resolves to its own class block', () => {
  const code = [
    'class Reader {',
    '  read() {',
    '    return this.parse()',
    '  }',
    '  parse() {',
    '    return 1',
    '  }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'typescript')
  const read = graph.nodes.find(node => node.name === 'Reader.read')
  const parse = graph.nodes.find(node => node.name === 'Reader.parse')
  assert.ok(
    graph.edges.some(item => item.from === read.id && item.to === parse.id),
    'this.method() reaches the sibling method',
  )
})

test('another object\'s method is not a project call', () => {
  const code = [
    'function helper() { return 1 }',
    'function run() {',
    '  return other.helper()',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'typescript')
  const run = graph.nodes.find(node => node.name === 'run')
  assert.equal(run.calls.length, 0, 'a property call on another object is not a block call')
})

test('a private helper is not reported as an unused block', () => {
  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [{
      path: 'D:/p/a.ts',
      rel: 'a.ts',
      text: 'export function used() {\n  return helper()\n}\nfunction helper() {\n  return 1\n}\n',
    }],
  })
  const unused = project.diagnostics.filter(item => item.code === 'unused-block')
  assert.equal(unused.length, 0, 'a called private helper is not unused')
})

test('dead code is not reported, because reachability cannot be proven', () => {
  // A private helper may be reached through a callback, a reflection, or an
  // interface, so "nobody calls it" is not something static analysis can
  // claim. The check therefore stays quiet instead of crying wolf.
  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [{
      path: 'D:/p/a.ts',
      rel: 'a.ts',
      text: 'export function used() {\n  return 1\n}\nfunction orphan() {\n  return 2\n}\n',
    }],
  })
  const unused = project.diagnostics.filter(item => item.code === 'unused-block')
  assert.equal(unused.length, 0, 'an unreachable helper is not reported as a problem')
})

test('a block that returns something it never received is reported', () => {
  // This one is provable: the block returns a value it did not take in, so
  // where the data came from is invisible in the map.
  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [{
      path: 'D:/p/a.ts',
      rel: 'a.ts',
      text: 'let cache = 0\nexport function read() {\n  return cache\n}\n',
    }],
  })
  const hidden = project.diagnostics.filter(item => item.code === 'hidden-data-flow')
  assert.equal(hidden.length, 1, 'the hidden data flow is reported')
  assert.equal(hidden[0].node, 'read')
})

test('an exported function nobody calls is not dead code', () => {
  // It is public API: whoever imports the package calls it, not this project.
  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [{
      path: 'D:/p/a.ts',
      rel: 'a.ts',
      text: 'export function orphan() {\n  return 1\n}\n',
    }],
  })
  const unused = project.diagnostics.filter(item => item.code === 'unused-block')
  assert.equal(unused.length, 0, 'public API is not reported as unused')
})
