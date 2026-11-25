/**
 * The agent's half of the plugin.
 *
 * The plugin has no interface: it is a tool the model calls, and a prompt that
 * tells the model how to use it. The tool answers questions about the code,
 * it does not act: nothing here writes a file. The model decides what to change.
 *
 * The model is on the Host, so the tool is here too, and it reads the model
 * the Host built — one scan, one answer, the same blocks the code is made of.
 */

import { createModelService } from './analyze.js'
import {
  reportOverview, reportArea, reportFile, reportBlock, reportDiagnostics, reportFlow, reportContracts,
} from './report.js'
import { scaffoldReport, conventionReport } from '../convention.js'

/** The tool's name in the model's tool list. */
const TOOL_NAME = 'codeflow_map'

/**
 * The project's own words for the map, so the model reads the same
 * explanations every time it asks.
 */
const DESCRIPTION = 'Read this project as function blocks joined by data flow: the blocks of a file, the calls ' +
  'between them, the values that move with those calls, the source behind them, and the places where the ' +
  'data flow is already broken. Use it before you change code — to write the next block in the shape the ' +
  'project already uses, and to follow a value back to the block that produced it when something misbehaves.'

/**
 * The arguments the model chooses from.
 *
 * One argument names what to read, so the model picks a scope instead of
 * receiving the whole project at once.
 */
export const PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'What to read: "file" for the blocks of one file and the calls between them, "block" for one ' +
        'block with its inputs, its returns and its callers, "flow" for the values that move through one block, ' +
        '"area" for every block of one functional area, "overview" for the areas, the entry points and the ' +
        'problems of the project, "contracts" for the exported blocks and who depends on them, "diagnostics" for ' +
        'the places where the data flow is broken, "scaffold" for the blueprint a scope should be built in, and ' +
        '"convention" for how well the project holds to the modular writing rules.',
    },
    path: {
      type: 'string',
      description: 'The area or file to read, relative to the project root (for example "src/api" or ' +
        '"src/api/server.ts"). Not needed for "overview" or "contracts".',
    },
    name: {
      type: 'string',
      description: 'The block to read, for the "block" and "flow" actions (for example "Server.listen").',
    },
  },
  required: ['action'],
}

/** The canonical value the tool returns. */
export const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['scope', 'text', 'facts'],
    properties: {
      scope: { type: 'string', description: 'What was read.' },
      text: { type: 'string', description: 'The map, written out.' },
      facts: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'files', 'blocks', 'edges', 'issues'],
        properties: {
          kind: { type: 'string', description: 'The kind of answer this is.' },
          files: {
            type: 'array',
            description: 'The files the answer covers.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['rel', 'lang', 'blocks', 'lines'],
              properties: {
                rel: { type: 'string' },
                lang: { type: 'string' },
                blocks: { type: 'integer' },
                lines: { type: 'integer' },
              },
            },
          },
          blocks: {
            type: 'array',
            description: 'The blocks the answer covers.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'file', 'line', 'kind', 'signature', 'params', 'outputs', 'exported', 'entry', 'calls', 'calledBy'],
              properties: {
                name: { type: 'string' },
                file: { type: 'string' },
                line: { type: 'integer' },
                kind: { type: 'string' },
                signature: { type: 'string' },
                params: { type: 'array', items: { type: 'string' } },
                outputs: { type: 'array', items: { type: 'string' } },
                doc: { type: 'string' },
                exported: { type: 'boolean' },
                entry: { type: 'boolean' },
                calls: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'resolved'],
                    properties: {
                      name: { type: 'string' },
                      resolved: { type: 'boolean' },
                      line: { type: 'integer' },
                      data: { type: 'string' },
                      producer: { type: 'string' },
                    },
                  },
                },
                calledBy: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          edges: {
            type: 'array',
            description: 'The calls and the data edges between the blocks.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['from', 'to', 'kind'],
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                kind: { type: 'string' },
                label: { type: 'string' },
              },
            },
          },
          issues: {
            type: 'array',
            description: 'The structure problems the map found.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['code', 'severity', 'file', 'message'],
              properties: {
                code: { type: 'string' },
                severity: { type: 'string' },
                kind: {
                  type: 'string',
                  description: '"flow" when the data flow itself is broken, "convention" when the code does not ' +
                    'hold to the modular writing rules.',
                },
                file: { type: 'string' },
                line: { type: 'integer' },
                node: { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
          modules: {
            type: 'array',
            description: 'The modules of a blueprint: the area, its files, its blocks and the data between them.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'files', 'blocks', 'flow'],
              properties: {
                key: { type: 'string' },
                purpose: { type: 'string' },
                files: { type: 'array', items: { type: 'string' } },
                blocks: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['name', 'file', 'signature', 'params', 'outputs', 'role', 'purpose'],
                    properties: {
                      name: { type: 'string' },
                      file: { type: 'string' },
                      signature: { type: 'string' },
                      params: { type: 'array', items: { type: 'string' } },
                      outputs: { type: 'array', items: { type: 'string' } },
                      role: { type: 'string' },
                      purpose: { type: 'string' },
                    },
                  },
                },
                flow: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['from', 'to'],
                    properties: {
                      from: { type: 'string' },
                      to: { type: 'string' },
                      label: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          rules: {
            type: 'array',
            description: 'The modular writing rules the project is held to.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'title', 'text'],
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                text: { type: 'string' },
              },
            },
          },
          areas: {
            type: 'array',
            description: 'The functional areas of the project.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'files', 'blocks', 'entries'],
              properties: {
                key: { type: 'string' },
                files: { type: 'integer' },
                blocks: { type: 'integer' },
                entries: { type: 'integer' },
                summary: { type: 'string' },
              },
            },
          },
          entries: {
            type: 'array',
            description: 'The exported blocks nothing in the project calls.',
            items: { type: 'string' },
          },
        },
      },
    },
  },
  render: (args, value) => [{ type: 'text', text: value.text }],
}

/**
 * What the model is told about the map.
 *
 * The plugin has one reader: the model that writes and fixes the code. So the
 * prompt says two things — how the code is shaped and how to keep it shaped
 * that way, and how to follow a value when something misbehaves. Everything
 * else the plugin used to show a person is gone.
 */
const PROMPT = `This project is written as function blocks: every function or method is one block, and the edges
between the blocks are the calls and the values that travel with them. The codeflow_map tool reads that map, and
it is the map of the code you are about to change. Read it before you write.

The map has two jobs.

1. Write code that is modular and composable, so the next change lands in one place:
- one feature per named function or method; business logic never hides in an anonymous callback;
- an entry function only orchestrates: it calls named blocks in order, and the work itself lives in a named block;
- data goes in through parameters and comes out through return values; no module-level mutable state, and no
  writing to something you were not given;
- every function carries a one-line description directly above it, saying what that block does;
- a block stays small (at most 80 lines, at most 6 parameters) and side effects live in a few IO blocks;
- cross-file access through explicit static imports, never dynamic import or reflection.

2. Find a bug by following the data, not by guessing at the symptom:
- "flow" shows the values that reach a block and the values it passes on; "block" shows one block with its
  inputs, its returns and who calls it;
- start at the block where the symptom appears, walk back along the value to the block that produced it, and
  change the producer or the boundary there — not the place where the symptom shows up;
- "diagnostics" lists the places where the flow is already broken: a call that reaches no block, a value that
  appears from nowhere, a write to something that was not given.

Which action to use:
- "file" with path=<file> — the blocks of that file, the calls between them, the value each call carries, and
  the source. Read this before editing that file.
- "block" with path=<file> name=<block> — one block in full.
- "flow" with path=<file> name=<block> — only the values moving through one block.
- "area" with path=<area> — every block of one functional area and the data between them.
- "overview" — the areas of the project, its entry points, and the problems found.
- "contracts" — the exported blocks and who depends on them.
- "scaffold" with path=<area or file> — the blueprint that scope should be built in.
- "convention" — how well the project holds to the rules above.

The map checks what you wrote: the blocks you add must appear as blocks with their data flow, and the problems
must go down rather than up. When you change code, say which block you changed and what now flows where.`

/**
 * Register the map tool and the prompt section that tells the model it
 * exists.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {object} [service] - the model service the tool reads through.
 */
export function apply(ctx, service) {
  // The service is the plugin's one model: the tool reads it, so every answer
  // comes from the same scan.
  const modelService = service ?? createModelService(ctx)

  ctx.tools.register({
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: OUTPUT,
    async execute(args, exec) {
      const action = typeof args?.action === 'string' ? args.action : 'overview'
      const path = typeof args?.path === 'string' ? args.path : undefined
      const name = typeof args?.name === 'string' ? args.name : undefined
      const session = exec.agent?.session
      if (session === undefined) {
        return emptyAnswer('no session', 'The map needs a session with a working directory.')
      }
      const model = await modelService.get(session, { signal: exec.signal })
      if (model.stats.files === 0) {
        return emptyAnswer('overview', `No analyzable code files were found in ${model.root || 'the working directory'}.`)
      }
      const answer = answerFor(model, action, path, name)
      return { scope: answer.scope, text: answer.text, facts: answer.facts }
    },
  })

  ctx.systemPrompt.section({
    name: 'tool:codeflow',
    order: ctx.systemPrompt.getSectionOrder('TOOL_LSP'),
    text: ({ scope }) => ctx.tools.get(TOOL_NAME, scope) === undefined ? '' : PROMPT,
  })
}

/** An answer with nothing in it: the request named nothing the map holds. */
function emptyAnswer(scope, text) {
  return {
    scope,
    text,
    facts: { kind: 'empty', files: [], blocks: [], edges: [], issues: [] },
  }
}

/**
 * Answer one question about the map.
 *
 * @param {object} model - the project model.
 * @param {string} action - what to read.
 * @param {string} [path] - the area or file to read.
 * @param {string} [name] - the block to read.
 * @returns {{ scope: string, text: string, facts: object }} the answer.
 */
export function answerFor(model, action, path, name) {
  switch (action) {
    case 'area':
      return reportArea(model, path ?? '')
    case 'file':
      return reportFile(model, path ?? '')
    case 'block':
      return reportBlock(model, path ?? '', name ?? '')
    case 'flow':
      return reportFlow(model, path ?? '', name ?? '')
    case 'contracts':
      return reportContracts(model)
    case 'diagnostics':
      return reportDiagnostics(model, path)
    case 'scaffold':
      return scaffoldReport(model, scopeOf(path))
    case 'convention':
      return conventionReport(model)
    case 'overview':
      return reportOverview(model)
    default:
      return emptyAnswer('overview', `Unknown action "${action}". Read the project with "overview", one area with ` +
        '"area", one file with "file", one block with "block", the values through a block with "flow", the public ' +
        'surface with "contracts", the structure problems with "diagnostics", the framework blueprint with ' +
        '"scaffold", or the writing rules with "convention".')
  }
}

/**
 * The scope a "scaffold" request names.
 *
 * A path is a file when it names one, an area otherwise: the blueprint of a
 * file is about its blocks, the blueprint of an area is about its modules.
 *
 * @param {string | undefined} path - the path the request named.
 * @returns {{ level: string, rel: string | undefined, name: string | undefined }} the scope.
 */
function scopeOf(path) {
  if (path === undefined || path === '') return { level: 'project', rel: undefined, name: undefined }
  return { level: 'file', rel: path, name: undefined }
}
