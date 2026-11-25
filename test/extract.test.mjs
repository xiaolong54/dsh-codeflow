import { parseFile } from '../src/parser.js'
import { extractFile } from '../src/extract.js'
import { languageOfPath, isCodePath } from '../src/langs.js'

let failures = 0

/** Assert one condition. */
function check(label, condition, detail) {
  if (condition) return
  failures++
  console.log(`  ! ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

/** Names of the block graph. */
function namesOf(graph) {
  return graph.nodes.map(node => node.name)
}

/** Whether an edge of this kind connects two names. */
function hasEdge(graph, kind, from, to) {
  return graph.edges.some(edge => edge.kind === kind
    && edge.from === `fn:${from}`
    && edge.to === `fn:${to}`)
}

const samples = {}

samples.go = `package pipeline

import "fmt"

// tokenize splits the raw text.
func tokenize(source string) []string {
	return strings.Split(source, " ")
}

func buildAst(tokens []string) *Ast {
	return &Ast{tokens: tokens}
}

func evaluate(ast *Ast) int {
	value := run(ast)
	return value
}

func run(ast *Ast) int {
	return len(ast.tokens)
}

func main() {
	tokens := tokenize("a b")
	ast := buildAst(tokens)
	fmt.Println(evaluate(ast))
}
`

samples.java = `package pipeline;

public class Pipeline {
    private int cached;

    public Ast buildAst(List<String> tokens) {
        return new Ast(tokens);
    }

    private int run(Ast ast) {
        return ast.size();
    }

    public int evaluate(Ast ast) {
        int value = run(ast);
        return value;
    }
}
`

samples.csharp = `namespace Pipeline
{
    public sealed class Pipeline
    {
        public Ast BuildAst(IReadOnlyList<string> tokens)
        {
            return new Ast(tokens);
        }

        public int Evaluate(Ast ast)
        {
            var value = Run(ast);
            return value;
        }

        private int Run(Ast ast) => ast.Size;
    }
}
`

samples.rust = `pub fn tokenize(source: &str) -> Vec<String> {
    source.split(' ').map(|part| part.to_string()).collect()
}

pub fn build_ast(tokens: Vec<String>) -> Ast {
    Ast { tokens }
}

fn run(ast: &Ast) -> usize {
    ast.tokens.len()
}

pub fn evaluate(ast: &Ast) -> usize {
    let value = run(ast);
    value
}
`

samples.kotlin = `class Pipeline {
    fun buildAst(tokens: List<String>): Ast {
        return Ast(tokens)
    }

    fun evaluate(ast: Ast): Int {
        val value = run(ast)
        return value
    }

    private fun run(ast: Ast): Int = ast.size
}
`

samples.swift = `struct Pipeline {
    func buildAst(tokens: [String]) -> Ast {
        return Ast(tokens: tokens)
    }

    func evaluate(ast: Ast) -> Int {
        let value = run(ast: ast)
        return value
    }

    private func run(ast: Ast) -> Int {
        return ast.count
    }
}
`

const expectations = {
  go: {
    nodes: ['tokenize', 'buildAst', 'evaluate', 'run', 'main'],
    data: [['buildAst', 'evaluate']],
    calls: [['evaluate', 'run']],
  },
  java: {
    nodes: ['Pipeline.buildAst', 'Pipeline.run', 'Pipeline.evaluate'],
    data: [],
    calls: [['Pipeline.evaluate', 'Pipeline.run']],
  },
  csharp: {
    nodes: ['Pipeline.BuildAst', 'Pipeline.Evaluate', 'Pipeline.Run'],
    data: [],
    calls: [['Pipeline.Evaluate', 'Pipeline.Run']],
  },
  rust: {
    nodes: ['tokenize', 'build_ast', 'run', 'evaluate'],
    data: [],
    calls: [['evaluate', 'run']],
  },
  kotlin: {
    nodes: ['Pipeline.buildAst', 'Pipeline.evaluate', 'Pipeline.run'],
    data: [],
    calls: [['Pipeline.evaluate', 'Pipeline.run']],
  },
  swift: {
    nodes: ['Pipeline.buildAst', 'Pipeline.evaluate', 'Pipeline.run'],
    data: [],
    calls: [['Pipeline.evaluate', 'Pipeline.run']],
  },
}

for (const [lang, code] of Object.entries(samples)) {
  const graph = parseFile(code, lang)
  const names = namesOf(graph)
  const expected = expectations[lang]
  console.log(`\n=== ${lang}: ${names.join(', ')}`)
  for (const name of expected.nodes) check(`${lang} has ${name}`, names.includes(name), names.join(','))
  for (const [from, to] of expected.data) check(`${lang} data ${from}→${to}`, hasEdge(graph, 'data', from, to))
  for (const [from, to] of expected.calls) check(`${lang} call ${from}→${to}`, hasEdge(graph, 'call', from, to))
  for (const node of graph.nodes) {
    check(`${lang} ${node.name} has params array`, Array.isArray(node.params))
    check(`${lang} ${node.name} has calls`, Array.isArray(node.calls))
  }
  console.log(`  edges: ${graph.edges.map(edge => `${edge.from.replace('fn:', '')}-[${edge.kind}]->${edge.to.replace('fn:', '')}`).join('  ')}`)
}

console.log('\n=== parameters and kinds')
const goGraph = parseFile(samples.go, 'go')
const tokenize = goGraph.nodes.find(node => node.name === 'tokenize')
check('go param name', tokenize.params[0]?.name === 'source', JSON.stringify(tokenize.params))
const javaGraph = parseFile(samples.java, 'java')
check('java method kind', javaGraph.nodes.every(node => node.kind === 'method'))
check('java params', javaGraph.nodes[0].params.map(param => param.name).join(',') === 'tokens')
const rustGraph = parseFile(samples.rust, 'rust')
check('rust param colon', rustGraph.nodes.find(node => node.name === 'tokenize').params[0].name === 'source')
check('rust exported', rustGraph.nodes.find(node => node.name === 'tokenize').exported === true)
check('rust private', rustGraph.nodes.find(node => node.name === 'run').exported === false)

console.log('\n=== masking keeps strings and comments out of the graph')
// The masked text is what the graph is read from: a declaration inside a
// comment or inside a string is not a block.
const maskedGraph = parseFile('func real(a string) {\n\t// func fake(b string) {\n\treturn a + "func alsoFake("\n}\n', 'go')
check('only real block', namesOf(maskedGraph).join(',') === 'real', namesOf(maskedGraph).join(','))

console.log('\n=== fallback for an unknown language')
const fallback = parseFile('def handler(input) {\n  value = parseInput(input)\n  return value\n}\n', 'custom')
check('generic block found', namesOf(fallback).includes('handler'))
check('generic external recorded', fallback.nodes[0].externalCalls.includes('parseInput'))

console.log('\n=== path helpers')
check('ts path', languageOfPath('src/app.ts') === 'typescript')
check('go path', languageOfPath('a/b.go') === 'go')
check('cs path', languageOfPath('x.cs') === 'csharp')
check('md skipped', isCodePath('README.md') === false)
check('tsx kept', isCodePath('App.tsx') === true)

console.log('\n=== nested declarations are skipped')
const nested = parseFile('func outer(a int) int {\n\tinner := func(b int) int { return b }\n\treturn inner(a)\n}\n', 'go')
check('nested not a block', namesOf(nested).join(',') === 'outer', namesOf(nested).join(','))

console.log('\n=== a method belongs to its class')
const javaOwner = parseFile(`public class Service {
    private int count;

    public Service() {
        this.count = 0;
    }

    public int load(int id) {
        return fetch(id);
    }

    private int fetch(int id) {
        return id;
    }
}
`, 'java')
check('java constructor is a block', namesOf(javaOwner).includes('Service.constructor'), namesOf(javaOwner).join(','))
check('java constructor kind', javaOwner.nodes.find(node => node.name === 'Service.constructor')?.kind === 'entry')
check('java method is owned', namesOf(javaOwner).includes('Service.load'), namesOf(javaOwner).join(','))
check('java this-call resolves', hasEdge(javaOwner, 'call', 'Service.load', 'Service.fetch'))
check('java new-call resolves', javaOwner.nodes.find(node => node.name === 'Service.constructor')?.externalCalls.length === 0)

console.log('\n=== a go method belongs to its receiver')
const goOwner = parseFile(`package pipeline

type Service struct {
	count int
}

// Save stores the value.
func (s *Service) Save(value int) error {
	s.validate(value)
	return nil
}

func (s *Service) validate(value int) {
}

type Cache struct {
}

// Save stores the value.
func (c *Cache) Save(value int) error {
	return nil
}
`, 'go')
check('go receiver names the owner', namesOf(goOwner).includes('Service.Save'), namesOf(goOwner).join(','))
check('go second receiver kept', namesOf(goOwner).includes('Cache.Save'), namesOf(goOwner).join(','))
check('go receiver call resolves', hasEdge(goOwner, 'call', 'Service.Save', 'Service.validate'))

console.log('\n=== a rust method belongs to its impl')
const rustOwner = parseFile(`pub struct Service {
    count: u32,
}

impl Service {
    /// Saves the value.
    pub fn save(&self, value: u32) -> u32 {
        self.validate(value)
    }

    fn validate(&self, value: u32) -> u32 {
        value
    }
}
`, 'rust')
check('rust impl names the owner', namesOf(rustOwner).includes('Service.save'), namesOf(rustOwner).join(','))
check('rust self-call resolves', hasEdge(rustOwner, 'call', 'Service.save', 'Service.validate'))

console.log('\n=== a callback is not a value')
const callback = parseFile(`function outer() {
    return register(function () {
        return inner();
    });
}

function inner() {
    return 1;
}

function register(fn) {
    return fn;
}
`, 'javascript')
check('callback keeps the call edge', hasEdge(callback, 'call', 'outer', 'register'))
check('callback invents no data edge', !hasEdge(callback, 'data', 'inner', 'register'))

console.log('\n=== a constructor is reached by its class name')
const construction = parseFile(`class Service {
    constructor(id) {
        this.id = id;
    }
}

function make() {
    return new Service(1);
}
`, 'javascript')
check('constructor is a block', namesOf(construction).includes('Service.constructor'), namesOf(construction).join(','))
check('new reaches the constructor', hasEdge(construction, 'call', 'make', 'Service.constructor'))

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exitCode = failures === 0 ? 0 : 1
