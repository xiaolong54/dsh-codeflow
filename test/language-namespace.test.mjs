/**
 * Two languages are two namespaces.
 *
 * A Go function and a C# function that happen to share a name are two
 * different functions. When the map resolved a call by its bare name alone, a
 * C# call reached a Go function — and the map drew a call the code does not
 * make, with a value flowing across a language boundary that does not exist.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { buildProject } from '../src/project.js'

/** The project's files, each with its language. */
function sampleProject() {
  return buildProject({
    root: 'D:/p',
    name: 'p',
    files: [
      {
        path: 'D:/p/go/service.go',
        rel: 'go/service.go',
        text: [
          'package main',
          '',
          'func Process(order string) string {',
          '  record := BuildRecord(order)',
          '  return PublishRecord(record)',
          '}',
          '',
          'func BuildRecord(order string) string {',
          '  return order',
          '}',
        ].join('\n'),
      },
      {
        path: 'D:/p/go/helpers.go',
        rel: 'go/helpers.go',
        text: [
          'package main',
          '',
          'func PublishRecord(record string) string {',
          '  return record',
          '}',
        ].join('\n'),
      },
      {
        path: 'D:/p/csharp/Service.cs',
        rel: 'csharp/Service.cs',
        text: [
          'public class Service',
          '{',
          '  public static string Process(string order)',
          '  {',
          '    string record = BuildRecord(order);',
          '    return Helpers.PublishRecord(record);',
          '  }',
          '}',
        ].join('\n'),
      },
      {
        path: 'D:/p/csharp/Helpers.cs',
        rel: 'csharp/Helpers.cs',
        text: [
          'public class Helpers',
          '{',
          '  public static string BuildRecord(string order)',
          '  {',
          '    return order;',
          '  }',
          '',
          '  public static string PublishRecord(string record)',
          '  {',
          '    return record;',
          '  }',
          '}',
        ].join('\n'),
      },
    ],
  })
}

test('a call never reaches a block of another language', () => {
  const project = sampleProject()

  for (const edge of project.crossEdges) {
    const from = project.files.find(file => file.rel === edge.fromFile)
    const to = project.files.find(file => file.rel === edge.toFile)
    assert.ok(from !== undefined && to !== undefined)
    const same = from.lang === to.lang
      || (from.lang === 'javascript' && to.lang === 'typescript')
      || (from.lang === 'typescript' && to.lang === 'javascript')
    assert.ok(same, `edge ${edge.fromFile} -> ${edge.toFile} joins two languages`)
  }
})

test('the Go call reaches the Go function, not the C# one', () => {
  const project = sampleProject()
  const edge = project.crossEdges.find(candidate => candidate.fromFile === 'go/service.go'
    && candidate.fromNode === 'BuildRecord' && candidate.kind === 'data')
  assert.ok(edge !== undefined, 'the value built in Go flows to the Go publisher')
  assert.equal(edge.toFile, 'go/helpers.go')
  assert.equal(edge.toNode, 'PublishRecord')
})

test('the C# call reaches the C# publisher', () => {
  const project = sampleProject()
  // The record is built by the C# builder and published by the C# publisher:
  // the value moves between two C# blocks.
  const edge = project.crossEdges.find(candidate => candidate.kind === 'data'
    && candidate.fromNode === 'Helpers.BuildRecord'
    && candidate.toNode === 'Helpers.PublishRecord')
  assert.ok(edge !== undefined, 'the C# value flows to the C# publisher')
  assert.equal(edge.fromFile, 'csharp/Helpers.cs')
  assert.equal(edge.toFile, 'csharp/Helpers.cs')
  assert.equal(edge.label, 'record')
})

test('TypeScript and JavaScript still share one namespace', () => {
  const project = buildProject({
    root: 'D:/p',
    name: 'p',
    files: [
      {
        path: 'D:/p/src/a.ts',
        rel: 'src/a.ts',
        text: 'export function run() {\n  return helper()\n}\n',
      },
      {
        path: 'D:/p/src/b.js',
        rel: 'src/b.js',
        text: 'export function helper() {\n  return 1\n}\n',
      },
    ],
  })
  const edge = project.crossEdges.find(candidate => candidate.kind === 'call')
  assert.ok(edge !== undefined, 'a TypeScript file reaches the JavaScript file next to it')
  assert.equal(edge.fromFile, 'src/a.ts')
  assert.equal(edge.toFile, 'src/b.js')
})
