# @xiaolong54/dsh-codeflow

A dsh bundle that has **no interface**. It gives the agent that writes and
fixes your code two things: one tool that reads the project as function blocks
joined by data flow, and one prompt that says how the code is shaped and how to
follow a value when something misbehaves.

There is no panel, no graph, no conversation of its own. What you see is the
code the agent wrote.

## Why

Two things you want from an agent: **good code**, and **bugs it can actually
fix**. Both need the same thing — knowing where the data comes from and where
it goes.

- Good code means the next feature is readable on its own and replaceable on
  its own. The agent has to see what the existing blocks look like before it
  can write the next one in the same shape.
- Fixing a bug means the place where the symptom shows up is usually not the
  place where the problem is. The agent has to walk back along a value to the
  block that produced it.

So the map has to be *structural* (who calls whom) rather than textual (grep a
snippet), and it has to carry *values* (which value moves along an edge), not
just call relations.

## The tool: `codeflow_map`

Nine actions. One argument names what to read, so the model picks a scope
instead of receiving the whole project at once.

| Action | What it answers |
| --- | --- |
| `file` path=file | the blocks of that file, the calls between them, the value each call carries, and the source — **read this before editing that file** |
| `block` path=file name=block | one block in full: inputs, returns, who calls it, what it calls, the source |
| `flow` path=file name=block | only the values that reach a block and the values it passes on — the one used most when hunting a bug |
| `area` path=area | every block of one functional area and the data between them |
| `overview` | the areas of the project, its entry points, the problems found |
| `contracts` | the exported blocks and who depends on them |
| `diagnostics` | the places where the data flow is already broken |
| `scaffold` path=scope | the blueprint that scope should be built in |
| `convention` | how well the project holds to the modular writing rules |

Every answer comes in two shapes: `text`, which the model reads, and `facts`,
the same facts as data.

### The edges carry values, not just calls

```ts
export function loadUser(id: string) {
  const rows = readStore(id)   // rows is produced here
  return pick(rows, id)         // rows travels on this edge
}
```

The edge the map draws is `readStore --rows--> pick`, not `loadUser → pick`.
That is what lets the agent follow a value back to the block that produced it.
Cross-file, the edge reaches into the other file's block.

### It never guesses

A call that could reach two blocks is **not** connected — the ambiguity is
reported instead (`ambiguous-call`). A wrong edge is worse than a missing one,
because the agent would then reason about a flow that the code does not have.

## The prompt

The system prompt the plugin registers has three parts, in this order:

1. **What the map is** — the code is function blocks, the edges between them are
   calls and values, and `codeflow_map` reads the very code you are about to
   change.
2. **The two jobs** —
   - *Write modular, composable code*, so the next change lands in one place:
     one feature per named function, an entry point that only orchestrates, data
     in through parameters and out through return values, one description line
     above every function, a block of at most 80 lines and 6 parameters, static
     imports only.
   - *Fix a bug by following the data, not by guessing at the symptom*: start at
     the block where the symptom appears, walk back along the value to the
     block that produced it, and change the producer or the boundary there.
3. **When to use each action.**

Those rules are also *machine-checkable items*, so the agent can check whether
it kept them (`action=diagnostics`):

| Item | Test | Severity |
| --- | --- | --- |
| `missing-doc` | no one-line description above the function or method | hint |
| `orchestrator-entry` | an entry block over 12 lines that reaches fewer than two named blocks | hint |
| `inline-callback` | an anonymous callback body over 10 lines with a return | hint |
| `nested-definition` | a named function defined inside a block | hint |
| `block-too-large` | over 80 lines | warning |
| `too-many-params` | over 6 parameters | warning |
| `module-mutable-state` | module-level mutable state | warning |
| `hidden-data-flow` | writing a variable that is not a parameter | warning |
| `explicit-io` | writing something that is not a parameter | warning |
| `ambiguous-call` | one name defined in several files | warning |
| `dynamic-dispatch` | reflection or a dynamic import makes the call target undecidable | warning |

Every problem carries a `kind`: `flow` (the data flow is broken) or `convention`
(the code is not modular enough).

## It only reads

The plugin writes no file. It observes; the model decides. The model lives on
the Host, so the model of the project is built there too: one scan, cached per
session, and a file that did not change is not parsed again.

## Layout

| Path | Role |
| --- | --- |
| `index.js` | Host half: the tool and the prompt |
| `src/host/tool.js` | the tool definition, its schema, and the prompt |
| `src/host/analyze.js` | the model service: scan, cache, freshness |
| `src/host/report.js` | the answers, written out as text and as data |
| `src/project.js` | the project model: blocks, calls, values, problems |
| `src/parser.js` | the JavaScript/TypeScript and Python parsers |
| `src/extract.js` | the generic multi-language extractor |
| `src/langs.js` | the language table: one row per language |
| `src/convention.js` | the rules and the blueprint of a scope |
| `src/outline.js` | what a part of the project is for, in one line |
| `src/i18n.js` | the words the model reads about a problem |
| `src/text.js` | small shared text helpers |
| `tools/measure-langs.mjs` | measures how well the parser covers a language |
| `tools/build-market-index.mjs` | builds the plugin market index |
| `tools/github-repo.mjs` | creates the GitHub repository |
| `tools/github-pages.mjs` | enables GitHub Pages for the market index |
| `tools/github-whoami.mjs` | reports which GitHub account the credential is |
| `docs/HOST-API.md` | a verified reference of the DSH Host plugin API |

## Languages

TypeScript, JavaScript, Python, Go, Java, C#, Rust, Kotlin, Swift — each with
its own parser where one exists, and a generic text extractor for everything
else. A new language is a row in `src/langs.js`, not a new parser.

## Test

```bash
node --test "test/*.test.mjs"
```

## Install

### From the plugin market

The bundle is listed in a plugin market index that installs this repository at
a pinned commit:

```
https://xiaolong54.github.io/dsh-codeflow/market/index.json
```

In dsh, open **Plugins → Discover → Add index source**, paste that URL, then
install **Code data-flow map**.

A Git install fetches sources, so the bundle is installed from the exact commit
the index pins. This package has no client half and no build step, so nothing
runs at install time and no build permission is needed.

### From the command line

```sh
dsh plugin --profile desktop add github:xiaolong54/dsh-codeflow
```

### From npm

```sh
npm add @xiaolong54/dsh-codeflow
```

### As a local bundle

```sh
git clone https://github.com/xiaolong54/dsh-codeflow.git
cd dsh-codeflow
npm link
dsh plugin --profile desktop add file:<this directory>
```

## Publish a new version

```sh
git commit -am "…"
node tools/build-market-index.mjs   # rewrites docs/market/index.json with the new commit
git push
```

The index pins the commit it was built from, so a new commit is installed only
after the index is rebuilt and pushed.

## License

MIT
