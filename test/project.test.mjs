/**
 * The project model: what one scan of a tree says about the code in it.
 *
 * The model is what the model reads: the blocks, the calls between them, the
 * value that travels with a call, and the places where the flow is broken.
 * These checks hold that the model never guesses and never hides a gap.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProject } from '../src/project.js'

/** Three files that call into each other, with one value crossing. */
function threeFiles() {
  return [
    {
      path: 'A/src/parse.ts',
      rel: 'src/parse.ts',
      text: `export function parseInput(text) {
  return text.trim()
}

export function parseTokens(text) {
  const clean = parseInput(text)
  return clean.split(' ')
}
`,
    },
    {
      path: 'A/src/render.ts',
      rel: 'src/render.ts',
      text: `export function render(tokens) {
  return tokens.join(' ')
}

export function renderAll(tokens) {
  const out = render(tokens)
  return out
}
`,
    },
    {
      path: 'A/src/main.ts',
      rel: 'src/main.ts',
      text: `import { parseTokens } from './parse'
import { renderAll } from './render'

export function main(input) {
  const tokens = parseTokens(input)
  const out = renderAll(tokens)
  return out
}
`,
    },
  ]
}

test('the model counts the files and the blocks it found', () => {
  const project = buildProject({ root: 'A', name: 'A', files: threeFiles() })

  assert.equal(project.stats.files, 3)
  assert.equal(project.stats.blocks, 5)
  assert.equal(project.name, 'A')
})

test('a value that crosses a file boundary is a data edge', () => {
  const project = buildProject({ root: 'A', name: 'A', files: threeFiles() })

  // The value `clean` is produced in parse.ts and consumed in render.ts, so
  // the edge points from the producer to the consumer.
  assert.ok(project.crossEdges.some(edge =>
    edge.fromFile === 'src/parse.ts' && edge.toFile === 'src/render.ts' && edge.kind === 'data'))
  // A call without a value is a plain call edge.
  assert.ok(project.crossEdges.some(edge =>
    edge.fromFile === 'src/main.ts' && edge.toFile === 'src/parse.ts' && edge.kind === 'call'))
  // One call site yields one edge: the value edge replaces the call edge.
  assert.ok(!project.crossEdges.some(edge =>
    edge.fromFile === 'src/main.ts' && edge.toFile === 'src/render.ts' && edge.kind === 'call'))
})

test('the file edges aggregate the calls between two files', () => {
  const project = buildProject({ root: 'A', name: 'A', files: threeFiles() })

  assert.ok(project.fileEdges.some(edge =>
    edge.from === 'src/parse.ts' && edge.to === 'src/render.ts' && edge.kind === 'data'))
  assert.ok(project.fileEdges.some(edge =>
    edge.from === 'src/main.ts' && edge.to === 'src/parse.ts' && edge.kind === 'call'))
  assert.ok(!project.fileEdges.some(edge =>
    edge.from === 'src/main.ts' && edge.to === 'src/render.ts'))
})

test('a block nobody calls is an entry point', () => {
  const project = buildProject({ root: 'A', name: 'A', files: threeFiles() })
  const main = project.files.find(file => file.rel === 'src/main.ts').nodes.find(node => node.name === 'main')
  const parseTokens = project.files.find(file => file.rel === 'src/parse.ts').nodes.find(node => node.name === 'parseTokens')

  assert.equal(main.entry, true)
  assert.equal(main.projectCalls, 0)
  assert.ok(parseTokens.projectCalls > 0)
})

test('an ambiguous name is never guessed', () => {
  const project = buildProject({
    root: 'B',
    name: 'B',
    files: [
      { path: 'B/a.ts', rel: 'a.ts', text: 'export function shared(x) { return x }\n' },
      { path: 'B/b.ts', rel: 'b.ts', text: 'export function shared(x) { return x }\n' },
      { path: 'B/c.ts', rel: 'c.ts', text: 'export function useIt(x) { return shared(x) }\n' },
    ],
  })

  // The call could reach either `shared`, so no edge is drawn. The ambiguity
  // itself is reported: whoever changes that file has to decide which
  // `shared` it means, so it cannot stay a silent gap.
  assert.ok(!project.crossEdges.some(edge => edge.toNode === 'shared'))
  assert.ok(project.diagnostics.some(item => item.code === 'ambiguous-call'))
  assert.ok(project.diagnostics.some(item => item.code === 'ambiguous-call' && item.node === 'useIt'))
})

test('the structure problems are found in the code', () => {
  const project = buildProject({
    root: 'C',
    name: 'C',
    files: [{
      path: 'C/bad.py',
      rel: 'bad.py',
      text: `counter = 0

def bump(value, a, b, c, d, e, f):
    global counter
    counter += value
    return counter
`,
    }],
  })

  const codes = project.diagnostics.map(item => item.code)
  assert.ok(codes.includes('module-mutable-state'))
  assert.ok(codes.includes('too-many-params'))
})
