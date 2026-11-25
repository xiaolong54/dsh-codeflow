This plugin has no interface. It gives the agent two things.

**One tool, `codeflow_map`.** It reads the project as function blocks joined by data flow, in nine actions:

- `file` path=file — the blocks of that file, the calls between them, the value each call carries, and the source. Read it before editing that file.
- `block` path=file name=block — one block in full: inputs, returns, who calls it, the source.
- `flow` path=file name=block — only the values that reach a block and the values it passes on. The one used most when hunting a bug.
- `area` path=area — every block of one functional area and the data between them.
- `overview` — the areas of the project, its entry points, the problems found.
- `contracts` — the exported blocks and who depends on them.
- `diagnostics` — the places where the data flow is already broken: a call that reaches nothing, a value that appears from nowhere, a write to something that was not given.
- `scaffold` path=scope — how that scope should be built.
- `convention` — how well the project holds to the modular writing rules.

Every answer comes as the text the model reads (`text`) and as the same facts as data (`facts`).

**One prompt.** It tells the model two things:

- Write code that is modular and composable: one feature per named function, with no logic hidden in an anonymous callback; an entry function that only orchestrates while the work lives in named blocks; data in through parameters and out through return values, with no module-level mutable state and no writing to something you were not given; one description line above every function; a block of at most 80 lines and 6 parameters; static imports only across files.
- Fix a bug by following the data, not by guessing at the symptom: start at the block where the symptom appears, walk back along the value to the block that produced it, and change the producer or the boundary there.

Those six rules are also machine-checkable items (`diagnostics`), so the model can check whether it kept them.

The plugin only reads: whether to change something, and how, is the agent's decision. The design is in `docs/DESIGN.md`.
