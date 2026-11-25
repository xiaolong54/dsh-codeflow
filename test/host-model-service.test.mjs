/**
 * The Host's model service, and the tool and the prompt that read it.
 *
 * There is one model in the plugin, and it lives on the Host. These checks
 * hold that promise: the service keeps one model for a moment so two
 * questions are answered from one scan, and the tool and the prompt are
 * registered together on that same model.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createModelService } from '../src/host/analyze.js'
import { apply as applyMapTool } from '../src/host/tool.js'
import { apply as applyPlugin } from '../index.js'

/** A file the backend lists, whose text can change under the reader. */
function fakeFile(name, text) {
  return { dir: 'D:/p', name, path: `D:/p/${name}`, text, version: undefined }
}

/**
 * A filesystem that lists the given files and counts every read.
 *
 * The files carry no version token, so every scan reads them again: a count
 * that did not move therefore means the tree was not scanned at all.
 */
function fakeFs(files) {
  const fs = {
    reads: 0,
    resolve: async (path) => ({ targetKey: path, displayPath: path }),
    contains: (parent, child) => String(child.displayPath).startsWith(String(parent.displayPath)),
    listDir: async (target) => files
      .filter(file => file.dir === target.displayPath)
      .map(file => ({
        name: file.name,
        type: 'file',
        target: { targetKey: file.path, displayPath: file.path },
        version: file.version,
        size: file.text.length,
      })),
    readText: async (target) => {
      fs.reads += 1
      const file = files.find(candidate => candidate.path === target.displayPath)
      if (file === undefined) throw new Error('no such file')
      return file.text
    },
  }
  return fs
}

/**
 * A context with the services the model service needs.
 *
 * @param {object} fs - the fake filesystem.
 * @param {object[]} sessions - the sessions the host knows.
 * @returns {object} the context.
 */
function fakeContext(fs, sessions) {
  return {
    fs,
    sessions: { get: (id) => sessions.find(session => session.id === id) },
    get: (name) => (name === 'fs' ? fs : name === 'workingDirectory' ? {
      get: (session) => (session?.header?.cwd === undefined ? undefined : 'D:/p'),
      ensure: async () => 'D:/p',
    } : undefined),
  }
}

/** One file with a block that calls something the project does not define. */
const SAMPLE = 'export function load(id) {\n  return read(id)\n}\n'

/** The session the fake host knows. */
const SESSION = { id: 's1', header: { cwd: 'D:/p' } }

/**
 * A context that records what the plugin registers.
 *
 * @param {object} ctx - the context to complete.
 * @returns {{ definition: object, sections: object[] }} what was registered.
 */
function withRegistry(ctx) {
  const registered = { definition: undefined, sections: [] }
  ctx.tools = { register: (value) => { registered.definition = value }, get: () => registered.definition }
  ctx.systemPrompt = {
    section: (value) => { registered.sections.push(value) },
    getSectionOrder: () => 0,
  }
  ctx.effect = (fn) => fn()
  return registered
}

test('the service serves the same model twice within the TTL', async () => {
  const fs = fakeFs([fakeFile('a.ts', SAMPLE)])
  const ctx = fakeContext(fs, [SESSION])
  const service = createModelService(ctx)
  const session = { id: 's1', header: { cwd: 'D:/p' } }

  const first = await service.get(session)
  const afterFirst = fs.reads
  const second = await service.get(session)

  assert.equal(afterFirst, 1, 'the first read did not scan the tree')
  assert.equal(fs.reads, afterFirst, 'the tree was scanned again although the model was young')
  assert.equal(second, first, 'the second read did not serve the very same model')
})

test('a forced read rescans and picks up a changed file', async () => {
  const file = fakeFile('a.ts', SAMPLE)
  const fs = fakeFs([file])
  const ctx = fakeContext(fs, [SESSION])
  const service = createModelService(ctx)
  const session = { id: 's1', header: { cwd: 'D:/p' } }

  const first = await service.get(session)
  const afterFirst = fs.reads
  file.text = 'export function load(id) {\n  return read2(id)\n}\n'
  const second = await service.get(session, { force: true })

  assert.ok(fs.reads > afterFirst, 'the forced read did not scan the tree again')
  assert.notEqual(second, first, 'the forced read served the old model')
  assert.equal(second.files[0].nodes[0].calls[0].name, 'read2', 'the model still shows the old text')
})

test('invalidating a session forces the next read to rescan', async () => {
  const fs = fakeFs([fakeFile('a.ts', SAMPLE)])
  const ctx = fakeContext(fs, [SESSION])
  const service = createModelService(ctx)
  const session = { id: 's1', header: { cwd: 'D:/p' } }

  await service.get(session)
  const afterFirst = fs.reads
  service.invalidate(session.id)
  await service.get(session)

  assert.ok(fs.reads > afterFirst, 'the invalidated model was still served')
})

test('the tool answers from the model of the session', async () => {
  const fs = fakeFs([fakeFile('a.ts', SAMPLE)])
  const ctx = fakeContext(fs, [SESSION])
  const registered = withRegistry(ctx)
  const service = createModelService(ctx)

  applyMapTool(ctx, service)
  const answer = await registered.definition.execute(
    { action: 'file', path: 'a.ts' },
    { agent: { session: SESSION }, signal: new AbortController().signal },
  )

  assert.equal(answer.scope, 'file a.ts')
  assert.equal(answer.facts.files.length, 1)
  assert.equal(answer.facts.blocks.length, 1)
  assert.ok(answer.text.includes('FILE a.ts'), 'the answer is not the file report')
})

test('the plugin registers the tool and the prompt section together', () => {
  const fs = fakeFs([fakeFile('a.ts', SAMPLE)])
  const ctx = fakeContext(fs, [SESSION])
  const registered = withRegistry(ctx)

  applyPlugin(ctx)

  assert.ok(registered.definition !== undefined, 'the plugin did not register the map tool')
  assert.equal(registered.definition.name, 'codeflow_map')
  assert.equal(registered.sections.length, 1, 'the plugin did not register the prompt section')
  assert.equal(registered.sections[0].name, 'tool:codeflow')
})

test('the prompt says how to write modular code and how to follow a value', () => {
  const fs = fakeFs([fakeFile('a.ts', SAMPLE)])
  const ctx = fakeContext(fs, [SESSION])
  const registered = withRegistry(ctx)

  applyPlugin(ctx)
  const text = registered.sections[0].text({ scope: undefined })

  // The writing rules the code is held to.
  assert.match(text, /one feature per named function or method/)
  assert.match(text, /data goes in through parameters and comes out through return values/)
  assert.match(text, /one-line description directly above it/)
  assert.match(text, /at most 80 lines, at most 6 parameters/)
  assert.match(text, /explicit static imports/)

  // The job the map serves when something is broken: follow the value.
  assert.match(text, /by following the data, not by guessing at the symptom/)
  assert.match(text, /walk back along the value to the block that produced it/)

  // The actions the model picks from.
  for (const action of ['file', 'block', 'flow', 'area', 'overview', 'contracts', 'scaffold', 'convention']) {
    assert.ok(text.includes(`"${action}"`), `the prompt does not mention the ${action} action`)
  }
})

test('the prompt stays out of the way when the tool is not registered', () => {
  const fs = fakeFs([fakeFile('a.ts', SAMPLE)])
  const ctx = fakeContext(fs, [SESSION])
  const registered = withRegistry(ctx)

  applyPlugin(ctx)
  ctx.tools.get = () => undefined

  assert.equal(registered.sections[0].text({ scope: undefined }), '')
})
