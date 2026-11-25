/**
 * Python blocks: a class is a set of blocks, and its methods call each other.
 *
 * A Python method is named `Class.method`, but inside the class it is called
 * as `self.method()`, and an instance is built with `Class(...)`. These cases
 * lock in that the call reaches the same block, and that a call whose
 * receiver type is unknown is left undrawn rather than guessed.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseFile } from '../src/parser.js'
import { buildProject } from '../src/project.js'

const SERVICE = [
  'class UserService:',
  '    """Stores and validates users."""',
  '',
  '    def __init__(self, repo):',
  '        """Holds the repository."""',
  '        self.repo = repo',
  '',
  '    def save_user(self, user):',
  '        """Validates a user and stores it."""',
  '        checked = self.validate(user)',
  '        return self.repo.store(checked)',
  '',
  '    def validate(self, user):',
  '        """Checks one user."""',
  '        return user',
].join('\n')

test('a python class is a set of blocks', () => {
  const graph = parseFile(SERVICE, 'python')
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('UserService.save_user'), names.join(', '))
  assert.ok(names.includes('UserService.validate'), names.join(', '))
  assert.ok(names.includes('UserService.__init__'), names.join(', '))
})

test('the constructor is the class body, not a method', () => {
  const graph = parseFile(SERVICE, 'python')
  const constructor = graph.nodes.find(node => node.name === 'UserService.__init__')
  assert.equal(constructor.kind, 'entry')
})

test('a method called through self reaches its own class block', () => {
  const graph = parseFile(SERVICE, 'python')
  const save = graph.nodes.find(node => node.name === 'UserService.save_user')
  const validate = graph.nodes.find(node => node.name === 'UserService.validate')
  assert.ok(save !== undefined && validate !== undefined)
  const edge = graph.edges.find(item => item.from === save.id && item.to === validate.id)
  assert.ok(edge !== undefined, 'the call to the sibling method is an edge')
})

test('a call whose receiver type is unknown is left undrawn', () => {
  const code = [
    'def run(payload):',
    '    """Runs a payload."""',
    '    return payload.get("id")',
  ].join('\n')
  const graph = parseFile(code, 'python')
  const run = graph.nodes[0]
  const calls = run.calls.map(call => call.name)
  assert.ok(!calls.includes('get'), calls.join(', '))
})

test('building an instance reaches the constructor', () => {
  const code = [
    'class Service:',
    '    def __init__(self, name):',
    '        """Holds the name."""',
    '        self.name = name',
    '',
    'def build():',
    '    """Builds a service."""',
    '    return Service("x")',
  ].join('\n')
  const graph = parseFile(code, 'python')
  const build = graph.nodes.find(node => node.name === 'build')
  const constructor = graph.nodes.find(node => node.name === 'Service.__init__')
  const edge = graph.edges.find(item => item.from === build.id && item.to === constructor.id)
  assert.ok(edge !== undefined, 'the constructor call is an edge')
})

test('a method of another file is reached through the instance type', () => {
  const service = [
    'class Service:',
    '    def run(self, task):',
    '        """Runs a task."""',
    '        return task',
  ].join('\n')
  const app = [
    'def start():',
    '    """Starts the service."""',
    '    service = Service()',
    '    return service.run(1)',
  ].join('\n')
  const project = buildProject({
    root: 'app',
    name: 'app',
    files: [
      { path: 'app/service.py', rel: 'service.py', text: service },
      { path: 'app/app.py', rel: 'app.py', text: app },
    ],
  })
  const cross = project.crossEdges.find(edge => edge.toFile === 'service.py' && edge.toNode === 'Service.run')
  assert.ok(cross !== undefined, JSON.stringify(project.crossEdges))
})

test('a nested function is not a method of the class above it', () => {
  const code = [
    'class Service:',
    '    def run(self):',
    '        """Runs."""',
    '        def helper():',
    '            return 1',
    '        return helper()',
  ].join('\n')
  const graph = parseFile(code, 'python')
  const names = graph.nodes.map(node => node.name)
  assert.ok(!names.some(name => name.endsWith('.helper')), names.join(', '))
})
