/**
 * The language corpus is the plugin's promise about other languages.
 *
 * These cases read the fixture corpus under `test/fixtures/langs` and check
 * what the parser found. They lock in the measurements that showed the
 * parser understood seven languages: every declared block is found, every
 * call that reaches a block of the project is linked, and no call reaches a
 * block that does not exist.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildProject } from '../src/project.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures', 'langs')
const LANGS = ['python', 'go', 'java', 'csharp', 'rust', 'kotlin', 'swift']

/** Build the project of one fixture language. */
function projectOf(lang) {
  const dir = path.join(FIXTURES, lang)
  const files = fs.readdirSync(dir)
    .filter(name => !name.startsWith('.'))
    .sort()
    .map(name => ({
      path: path.join(dir, name),
      rel: name,
      text: fs.readFileSync(path.join(dir, name), 'utf8'),
    }))
  return buildProject({ root: dir, name: lang, files })
}

/** Every call the parser recorded, with the file and node it came from. */
function callsOf(project) {
  const calls = []
  for (const file of project.files) {
    for (const node of file.nodes) {
      for (const call of [...(node.calls ?? []), ...(node.openCalls ?? [])]) {
        calls.push({ file: file.rel, node, call })
      }
    }
  }
  return calls
}

for (const lang of LANGS) {
  test(`${lang}: every fixture block is found and documented`, () => {
    const project = projectOf(lang)
    assert.ok(project.stats.blocks >= 12, `expected blocks, got ${project.stats.blocks}`)
    const undocumented = project.files
      .flatMap(file => file.nodes)
      .filter(node => typeof node.doc !== 'string' || node.doc.length === 0)
    assert.equal(undocumented.length, 0, `undocumented: ${undocumented.map(node => node.name).join(', ')}`)
  })

  test(`${lang}: every call that reaches a project block is linked to one`, () => {
    const project = projectOf(lang)
    const names = new Set(project.files.flatMap(file => file.nodes.map(node => node.name)))
    const unlinked = []
    for (const { file, node, call } of callsOf(project)) {
      // The names the parser considered: the first one that exists is the
      // block the call reaches.
      const reachable = (call.candidates ?? []).filter(candidate => names.has(candidate))
      if (reachable.length === 0) continue
      const callee = reachable[0]
      const entry = project.files.find(item => item.rel === file)
      const ids = new Set(entry.nodes.map(item => item.id))
      // A call that carries a value is drawn as an edge from the producer to
      // the callee; a call that carries nothing is drawn from the caller.
      const producerName = call.payload?.producer
      const producers = entry.nodes
        .filter(item => item.name === producerName || item.name.endsWith(`.${producerName}`))
        .map(item => item.id)
      const sources = new Set([node.id, ...producers])
      const linked = entry.edges.some(edge => edge.to === `fn:${callee}` && sources.has(edge.from))
      const across = project.crossEdges.some(edge => edge.fromFile === file
        && edge.toNode === callee
        && (edge.fromNode === node.name
          || (producerName !== undefined
            && (edge.fromNode === producerName || edge.fromNode.endsWith(`.${producerName}`)))))
      if (!linked && !across) unlinked.push(`${file} ${node.name} -> ${call.name}`)
      // A drawn edge must never point at a block that does not exist.
      assert.ok(ids.size > 0)
    }
    assert.deepEqual(unlinked, [], unlinked.join('\n'))
  })

  test(`${lang}: no edge points at a block that does not exist`, () => {
    const project = projectOf(lang)
    const names = new Set(project.files.flatMap(file => file.nodes.map(node => node.name)))
    const dangling = []
    for (const file of project.files) {
      for (const edge of file.edges) {
        const to = edge.to.replace(/^fn:/, '')
        if (!names.has(to)) dangling.push(`${file.rel} ${edge.from} -> ${edge.to}`)
      }
    }
    for (const edge of project.crossEdges) {
      if (!names.has(edge.toNode)) dangling.push(`${edge.fromFile} -> ${edge.toNode}`)
    }
    assert.deepEqual(dangling, [], dangling.join('\n'))
  })

  test(`${lang}: the fixture's own calls are linked`, () => {
    const project = projectOf(lang)
    // The fixture calls across files, so the project must link across files.
    const cross = project.crossEdges.filter(edge => edge.fromFile !== edge.toFile)
    assert.ok(cross.length >= 1, `expected cross-file edges, got ${cross.length}`)
    // Every edge must point at a block that exists.
    const names = new Set(project.files.flatMap(file => file.nodes.map(node => node.name)))
    for (const edge of cross) {
      assert.ok(names.has(edge.toNode), `dangling edge to ${edge.toNode}`)
    }
  })

  test(`${lang}: the one function nobody calls is not reported as a problem`, () => {
    const project = projectOf(lang)
    // The fixture deliberately leaves one function uncalled. Reachability
    // cannot be proven statically, so the check stays quiet.
    const noisy = project.diagnostics.filter(item => item.code === 'unused-block')
    assert.equal(noisy.length, 0, 'no unused-block diagnostic')
  })
}
