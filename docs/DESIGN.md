# Design: a map for the agent

codeflow has exactly one reader: the model that writes code and fixes bugs. It has no interface — no Sidebar tab, no canvas, no conversation of its own. It has two things:

1. **One tool**, `codeflow_map`: it reads the project as function blocks joined by data flow.
2. **One prompt**: it tells the model what shape the code should have, and how to follow a value when something misbehaves.

## Why these two

What the user wants is "the agent writes good code, and the agent can fix mistakes". Both need the same thing: **knowing where the data comes from and where it goes**.

- Writing good code → the next feature has to be readable on its own and replaceable on its own. The model must see what the existing blocks look like before it can write the next one in the same shape.
- Fixing a bug → the place where the symptom shows up is usually not the place where the problem is. The model has to be able to walk back along a value to the block that produced it.

So the map has to be **structural** (who calls whom) rather than textual (grep a snippet), and it has to carry **values** (which value moves along an edge), not just call relations.

## One model, on the Host

The Host scans the project, parses the function blocks, the calls between them, the values that travel with those calls, and the structure problems. There is one model: every answer the tool gives comes from the same scan (`src/host/analyze.js`), and a second question within the TTL does not scan again.

The tool only answers questions; it never acts: there is not one line in `src/host/tool.js` that writes a file. Whether to change something, and how, is the model's decision.

## How the prompt is written

The prompt has three parts, in this order on purpose (the `PROMPT` constant in `src/host/tool.js`):

1. **What the map is**: the code is function blocks, the edges between them are calls and values, and `codeflow_map` reads the very code you are about to change.
2. **The two jobs**:
   - Write modular, composable code — the six rules (one feature per named function, an entry point that only orchestrates, data in through parameters and out through return values, one description line per function, small blocks, static imports only).
   - Fix a bug by following the data, not by guessing at the symptom — start at the block where the symptom appears, walk back along the value to the block that produced it, and change the producer or the boundary there.
3. **When to use each action**: `file` before editing a file, `flow` for the values in and out of one block, `block` for one block in full, and `area` / `overview` / `contracts` / `scaffold` / `convention` for the wider views.

The rules are not only advice: they are also *machine-checkable items*, so the model can check whether it kept them (`action=diagnostics`).

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

Every problem carries a `kind`: `flow` (the data flow is broken) or `convention` (the code is not modular enough).

## The nine actions

| Action | What it answers |
| --- | --- |
| `file` path=file | the blocks of that file, the calls between them, the value each call carries, and the source |
| `block` path=file name=block | one block in full: inputs, returns, who calls it, what it calls, the source |
| `flow` path=file name=block | only the values that reach a block and the values it passes on — the one used most when hunting a bug |
| `area` path=area | every block of one functional area and the data between them |
| `overview` | the areas of the project, its entry points, the problems found |
| `contracts` | the exported blocks and who depends on them |
| `diagnostics` | the places where the data flow is already broken |
| `scaffold` path=scope | how that scope should be built (the module blueprint) |
| `convention` | how well the project holds to the modular writing rules |

Every answer comes in two shapes: `text`, which the model reads, and `facts`, the same facts as data.

## What is not done

- **No interface**: no Sidebar tab, no drawing, no conversation of its own. What the user sees is the code the agent wrote.
- **No writes**: the plugin only reads; the changes are made by the model's own tools.
- **No second model**: the model lives on the Host, and there is one.
- **No deciding the modules for the person**: the plugin gives "the state of things + the rules + the blueprint"; the split is confirmed by the model and the user.

## References

- [Aider's repo map](https://aider.chat/docs/repomap.html): the model gets a short map of the repository with every request — the key symbols and their call signatures.
- [Zed's agent panel](https://zed.dev/docs/ai/agent-panel): the context is attached explicitly instead of guessed at. This plugin builds no panel, but it hands the context to the model just as explicitly.
