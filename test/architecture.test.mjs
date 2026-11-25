/**
 * The architecture the model reads: the project's functional areas, and the
 * blocks and the data flow inside one of them.
 *
 * The areas are the top of the map: what part of the system does this file
 * belong to, and what crosses between the parts.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProject, projectAreas, areaGraph, areaBlockGraph } from '../src/project.js'

/** A project with two areas and a cross-area call. */
function sampleProject() {
  return buildProject({
    root: 'D:/p',
    name: 'p',
    files: [
      {
        path: 'D:/p/src/api/user.ts',
        rel: 'src/api/user.ts',
        text: 'export function loadUser() {\n  return readStore()\n}\n',
      },
      {
        path: 'D:/p/src/api/order.ts',
        rel: 'src/api/order.ts',
        text: 'export function loadOrder() {\n  return 1\n}\n',
      },
      {
        path: 'D:/p/src/store/db.ts',
        rel: 'src/store/db.ts',
        text: 'export function readStore() {\n  return 2\n}\n',
      },
    ],
  })
}

test('files group into functional areas by directory', () => {
  const project = sampleProject()
  const areas = projectAreas(project)
  assert.equal(areas.size, 2)
  assert.deepEqual([...areas.keys()].sort(), ['src/api', 'src/store'])
  assert.equal(areas.get('src/api').length, 2)
  assert.equal(areas.get('src/store').length, 1)
})

test('the architecture view shows one block per area with edges between them', () => {
  const project = sampleProject()
  const graph = areaGraph(project)

  assert.equal(graph.nodes.length, 2)
  const api = graph.nodes.find(node => node.id === 'area:src/api')
  assert.equal(api.name, 'api')
  assert.equal(api.subtitle, 'src/api')
  assert.equal(api.files, 2)
  assert.equal(api.blocks, 2)
  assert.equal(api.kind, 'area')

  // The call from loadUser to readStore crosses an area boundary.
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].from, 'area:src/api')
  assert.equal(graph.edges[0].to, 'area:src/store')
})

test('an area opens as the small logic it contains', () => {
  const project = sampleProject()
  const graph = areaBlockGraph(project, 'src/api')

  // Every block of every file in the area.
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('loadUser'))
  assert.ok(names.includes('loadOrder'))
  // The block it calls in another area shows up as a stub.
  assert.ok(graph.nodes.some(node => node.kind === 'external'))
  // The call that leaves the area is drawn.
  assert.ok(graph.edges.some(edge => edge.from.endsWith('#loadUser')))
  assert.ok(graph.edges.some(edge => edge.to.startsWith('ext:')))
})

test('an area carries a description of what it is for', () => {
  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [{
      path: 'D:/p/src/api/user.ts',
      rel: 'src/api/user.ts',
      text: '/**\n * Loads a user from the store.\n * @param id the id\n */\nexport function loadUser() {\n  return 1\n}\n',
    }],
  })
  const graph = areaGraph(project)
  const area = graph.nodes.find(node => node.id === 'area:src/api')
  assert.ok(area.summary.includes('Loads a user from the store.'))
  // The tag line describes the shape, not the purpose, so it is dropped.
  assert.ok(!area.summary.includes('@param'))
})
