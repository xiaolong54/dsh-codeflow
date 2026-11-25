/**
 * The parser must not draw an edge it cannot justify.
 *
 * Every case here was a wrong edge or a missing edge found by measuring the
 * parser over 500 real files of TypeScript and a fixture corpus of seven
 * languages. A wrong edge is worse than a missing one: the map is a promise
 * about where data flows.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { parseFile } from '../src/parser.js'
import { buildProject } from '../src/project.js'

/** Whether an edge of this kind connects two names. */
function hasEdge(graph, kind, from, to) {
  return graph.edges.some(edge => edge.kind === kind
    && edge.from === `fn:${from}`
    && edge.to === `fn:${to}`)
}

test('a class expression is named after the variable it is assigned to', () => {
  // `class extends Base { … }` is an anonymous class: the keyword is not its
  // name, and the variable is.
  const code = [
    'var EntryGroup = class {',
    '  create() { return 1 }',
    '}',
    'var Group = class extends EntryGroup {',
    '  constructor() { super() }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('EntryGroup.create'), names.join(', '))
  assert.ok(names.includes('Group.constructor'), names.join(', '))
  assert.ok(!names.some(name => name.startsWith('extends.')), names.join(', '))
})

test('a class with a name keeps that name', () => {
  // A class that only has a modifier before it is not assigned, so the
  // constant on the line above must not steal its name.
  const code = [
    'const TIMEOUT = 30',
    'export class Controller {',
    '  read() { return 1 }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'typescript')
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('Controller.read'), names.join(', '))
  assert.ok(!names.some(name => name.startsWith('TIMEOUT.')), names.join(', '))
})

test('a method inherited from a base class is reachable through this', () => {
  const code = [
    'class Base {',
    '  save() { return 1 }',
    '}',
    'class Child extends Base {',
    '  run() { return this.save() }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  assert.ok(
    hasEdge(graph, 'call', 'Child.run', 'Base.save'),
    'the inherited method is reached',
  )
})

test('a bare call does not reach a sibling method', () => {
  // In JavaScript only `this.method()` reaches a method of the class. A bare
  // call reaches the module scope, so drawing it to the sibling would be a
  // wrong edge.
  const code = [
    'class Service {',
    '  run() { return evaluate() }',
    '  evaluate() { return 1 }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  assert.ok(!hasEdge(graph, 'call', 'Service.run', 'Service.evaluate'))
})

test('a name the module binds itself reaches no block', () => {
  // `const evaluate = new Function(…)` is a value, not a block: a call to it
  // reaches nothing the map can draw.
  const code = [
    'const evaluate = new Function("ctx", "expr", "return expr")',
    'class Service {',
    '  evaluate(expr) { return evaluate(this.ctx, expr) }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  const service = graph.nodes.find(node => node.name === 'Service.evaluate')
  const call = service.calls.find(item => item.name === 'evaluate')
  assert.ok(call !== undefined, 'the call is recorded')
  assert.equal(call.shadowed, true, 'the call is marked as reaching no block')
})

test('a local binding reaches no other block', () => {
  // `const dispatch = () => { … }` inside a method is a local function.
  const code = [
    'class Service {',
    '  run() {',
    '    const dispatch = () => 1',
    '    return dispatch()',
    '  }',
    '  dispatch() { return 2 }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  assert.ok(!hasEdge(graph, 'call', 'Service.run', 'Service.dispatch'))
})

test('a callback is not a value the callee receives', () => {
  // `register(function () { … })` passes a function, not a value: the call
  // edge to `register` must stay, and no data edge may appear.
  const code = [
    'function outer() {',
    '  return register(function () {',
    '    return inner()',
    '  })',
    '}',
    'function inner() { return 1 }',
    'function register(fn) { return fn }',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  assert.ok(hasEdge(graph, 'call', 'outer', 'register'))
  assert.ok(!hasEdge(graph, 'data', 'inner', 'register'))
})

test('building an instance reaches the constructor', () => {
  const code = [
    'class Service {',
    '  constructor(id) { this.id = id }',
    '}',
    'function make() { return new Service(1) }',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  assert.ok(hasEdge(graph, 'call', 'make', 'Service.constructor'))
})

test('a dynamic import calls no block of the project', () => {
  const code = [
    'async function load() {',
    '  const module = await import("./other.js")',
    '  return module',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  const load = graph.nodes.find(node => node.name === 'load')
  assert.ok(!load.calls.some(call => call.name === 'import'))
})

test('a method in an object literal is not a call', () => {
  const code = [
    'function make() {',
    '  return {',
    '    get(value) { return value }',
    '  }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'javascript')
  const make = graph.nodes.find(node => node.name === 'make')
  assert.ok(!make.calls.some(call => call.name === 'get'))
})

test('a go method belongs to its receiver type', () => {
  const code = [
    'package p',
    '',
    'type Service struct {',
    '\tcount int',
    '}',
    '',
    '// Save stores the value.',
    'func (s *Service) Save(value int) error {',
    '\ts.validate(value)',
    '\treturn nil',
    '}',
    '',
    'func (s *Service) validate(value int) {',
    '}',
    '',
    '// Cache is another type with the same method name.',
    'type Cache struct {',
    '}',
    '',
    '// Save stores the value.',
    'func (c *Cache) Save(value int) error {',
    '\treturn nil',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'go')
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('Service.Save'), names.join(', '))
  assert.ok(names.includes('Cache.Save'), names.join(', '))
  assert.ok(hasEdge(graph, 'call', 'Service.Save', 'Service.validate'))
})

test('a go parameter named record does not hide a declaration', () => {
  // `record string` looks like a `record` type declaration; a loose pattern
  // would swallow the function that carries it.
  const code = [
    'package p',
    '',
    '// Save keeps the record.',
    'func Save(record string) string {',
    '\treturn record',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'go')
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('Save'), names.join(', '))
})

test('a rust method belongs to its impl block', () => {
  const code = [
    'pub struct Service {',
    '    count: u32,',
    '}',
    '',
    'impl Service {',
    '    /// Saves the value.',
    '    pub fn save(&self, value: u32) -> u32 {',
    '        self.validate(value)',
    '    }',
    '',
    '    fn validate(&self, value: u32) -> u32 {',
    '        value',
    '    }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'rust')
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('Service.save'), names.join(', '))
  assert.ok(hasEdge(graph, 'call', 'Service.save', 'Service.validate'))
})

test('a kotlin or swift constructor is the class body', () => {
  const kotlin = [
    'class Service {',
    '    constructor(prefix: String) {',
    '        this.prefix = prefix',
    '    }',
    '}',
  ].join('\n')
  const kotlinGraph = parseFile(kotlin, 'kotlin')
  const kotlinNames = kotlinGraph.nodes.map(node => node.name)
  assert.ok(kotlinNames.includes('Service.constructor'), kotlinNames.join(', '))
  assert.equal(
    kotlinGraph.nodes.find(node => node.name === 'Service.constructor').kind,
    'entry',
  )

  const swift = [
    'class Service {',
    '    init(prefix: String) {',
    '        self.prefix = prefix',
    '    }',
    '}',
  ].join('\n')
  const swiftGraph = parseFile(swift, 'swift')
  const swiftNames = swiftGraph.nodes.map(node => node.name)
  assert.ok(swiftNames.includes('Service.constructor'), swiftNames.join(', '))
})

test('a call through an object of a known type reaches that type', () => {
  const code = [
    'public class Service {',
    '    public int load(int id) { return fetch(id); }',
    '    private int fetch(int id) { return id; }',
    '}',
  ].join('\n')
  const graph = parseFile(code, 'java')
  const names = graph.nodes.map(node => node.name)
  assert.ok(names.includes('Service.load'), names.join(', '))
  assert.ok(hasEdge(graph, 'call', 'Service.load', 'Service.fetch'))
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

test('a name the file binds itself is not resolved to a method elsewhere', () => {
  const a = 'export function helper() { return 1 }\n'
  const b = 'import { helper } from "./a.js"\nexport function run() { return helper() }\n'
  const project = buildProject({
    root: 'p',
    name: 'p',
    files: [
      { path: 'p/a.ts', rel: 'a.ts', text: a },
      { path: 'p/b.ts', rel: 'b.ts', text: b },
    ],
  })
  // The import names the module, so the edge is drawn — but to the file the
  // import says, not to a namesake in an unrelated class.
  const cross = project.crossEdges.find(edge => edge.toFile === 'a.ts' && edge.toNode === 'helper')
  assert.ok(cross !== undefined, JSON.stringify(project.crossEdges))
})
