import { parseFile } from '../src/parser.js'

const cases = []

/** A small pipeline with a data chain and an entry. */
const jsSample = `
import { readFile } from 'node:fs'

/** Split the raw text into tokens. */
export function tokenize(source) {
  const parts = source.split(/\\s+/)
  return parts
}

/** Build an AST from tokens. */
export function buildAst(tokens) {
  return { kind: 'program', tokens }
}

export function evaluate(ast) {
  const value = run(ast)
  return value
}

function run(node) {
  return node
}

async function report(text) {
  const tokens = tokenize(text)
  const ast = buildAst(tokens)
  return evaluate(ast)
}

const tokens = tokenize('1 + 2')
const ast = buildAst(tokens)
report(evaluate(ast))
`

const pySample = `
import json

class Pipeline:
    def load(self, path):
        data = read(path)
        return data

def read(path):
    with open(path) as handle:
        return handle.read()

def parse(raw):
    return json.loads(raw)

def summarize(records):
    total = 0
    for record in records:
        total += record
    return total

def run(path):
    raw = read(path)
    data = parse(raw)
    return summarize(data)
`

const tsSample = `
type Row = { id: number }

const fetchRows = async (url: string): Promise<Row[]> => {
  const response = await request(url)
  return response.json()
}

function request(path: string) {
  return fetch(path)
}

const summarize = <T,>(rows: T[]) => {
  const total = count(rows)
  return total
}

function count(rows: any[]) {
  return rows.length
}

export default function main() {
  const rows = fetchRows('/rows')
  return summarize(rows)
}
`

cases.push({
  name: 'javascript pipeline',
  code: jsSample,
  lang: 'js',
  expect: {
    nodes: ['tokenize', 'buildAst', 'evaluate', 'run', 'report', 'main'],
    dataEdges: [
      ['tokenize', 'buildAst'],
      ['buildAst', 'evaluate'],
    ],
  },
})

cases.push({
  name: 'python pipeline',
  code: pySample,
  lang: 'python',
  expect: {
    nodes: ['Pipeline.load', 'read', 'parse', 'summarize', 'run'],
    dataEdges: [
      ['read', 'parse'],
      ['parse', 'summarize'],
    ],
  },
})

cases.push({
  name: 'typescript arrows',
  code: tsSample,
  lang: 'ts',
  expect: {
    nodes: ['fetchRows', 'request', 'summarize', 'count', 'main'],
    dataEdges: [],
  },
})

cases.push({ name: 'empty', code: '', lang: 'js', expect: { nodes: [], dataEdges: [] } })
cases.push({ name: 'comments only', code: '// nothing\n/* here */\n', lang: 'js', expect: { nodes: [], dataEdges: [] } })
cases.push({
  name: 'nested helper is not top level',
  code: 'export function outer(a) {\n  function inner(b) { return b }\n  return inner(a)\n}\n',
  lang: 'js',
  expect: { nodes: ['outer'], dataEdges: [] },
})

let failures = 0
for (const testCase of cases) {
  const graph = parseFile(testCase.code, testCase.lang)
  const names = graph.nodes.map(node => node.name)
  const dataEdges = graph.edges
    .filter(edge => edge.kind === 'data')
    .map(edge => [edge.from.replace(/^fn:/, ''), edge.to.replace(/^fn:/, '')])

  const problems = []
  for (const expected of testCase.expect.nodes) {
    if (!names.includes(expected)) problems.push(`missing node ${expected}`)
  }
  for (const [from, to] of testCase.expect.dataEdges) {
    if (!dataEdges.some(([a, b]) => a === from && b === to)) problems.push(`missing data edge ${from} -> ${to}`)
  }
  if (testCase.expect.nodes.length === 0 && graph.nodes.length !== 0) problems.push(`expected no nodes, got ${names.join(',')}`)
  if (testCase.expect.nodes.length > 0 && graph.nodes.length < testCase.expect.nodes.length) {
    problems.push(`expected at least ${testCase.expect.nodes.length} nodes, got ${graph.nodes.length}`)
  }
  for (const [from, to] of testCase.expect.dataEdges) {
    const matching = graph.edges.filter(edge => edge.from === `fn:${from}` && edge.to === `fn:${to}`)
    if (matching.length > 1) problems.push(`${from}→${to} has ${matching.length} edges; one call site must yield one edge`)
  }

  const status = problems.length === 0 ? 'ok' : 'FAIL'
  console.log(`\n=== ${testCase.name}: ${status}`)
  console.log(`nodes: ${names.map(name => `${name}(${graph.nodes.find(node => node.name === name).params.map(p => p.name).join(',')})`).join('  ')}`)
  console.log(`edges: ${graph.edges.map(edge => `${edge.from.replace(/^fn:/, '')}-[${edge.kind}${edge.label ? `:${edge.label}` : ''}]->${edge.to.replace(/^fn:/, '')}`).join('  ')}`)
  if (problems.length > 0) {
    failures++
    for (const problem of problems) console.log(`  ! ${problem}`)
  }
}

// A language the extractor does not know is still read as a generic text
// file: the model sees its structure rather than nothing at all.
const yaml = parseFile('key: value\nlist:\n  - one\n', 'yaml')
if (yaml.lang !== 'generic') {
  failures++
  console.log(`FAIL an unknown language is not generic: ${yaml.lang}`)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`)
process.exitCode = failures === 0 ? 0 : 1
