/**
 * The Host's model service: what it reads, and when it may keep what it read.
 *
 * The model is the agent's picture of the project. It is only allowed to be
 * reused when the files behind it did not change, and a file is only allowed
 * to be skipped when that file's own text is the same text.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { createModelService } from '../src/host/analyze.js'

/** A filesystem that reads a fixed set of files, with changeable versions. */
function fakeFs(files) {
  return {
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
      const file = files.find(candidate => candidate.path === target.displayPath)
      if (file === undefined) throw new Error('no such file')
      return file.text
    },
  }
}

/** A context with the two services the service needs. */
function fakeContext(fs, root) {
  return {
    get: (name) => (name === 'fs' ? fs : name === 'workingDirectory' ? {
      // A Session with no directory of its own has no working directory.
      get: (session) => (session?.header?.cwd === undefined ? undefined : root),
      ensure: async () => root,
    } : undefined),
  }
}

const SAMPLE = 'export function load(id) {\n  return read(id)\n}\n'

test('the model is built from the files the backend lists', async () => {
  const files = [{ dir: 'D:/p', name: 'a.ts', path: 'D:/p/a.ts', text: SAMPLE, version: 'v1' }]
  const service = createModelService(fakeContext(fakeFs(files), 'D:/p'))
  const session = { id: 's1', header: { cwd: 'D:/p' } }

  const model = await service.get(session)
  assert.equal(model.stats.files, 1)
  assert.equal(model.stats.blocks, 1)
})

test('a file that did not change is not read again', async () => {
  const files = [{ dir: 'D:/p', name: 'a.ts', path: 'D:/p/a.ts', text: SAMPLE, version: 'v1' }]
  const fs = fakeFs(files)
  let reads = 0
  const counted = {
    ...fs,
    readText: async (target) => {
      reads++
      return fs.readText(target)
    },
  }
  const service = createModelService(fakeContext(counted, 'D:/p'))
  const session = { id: 's1', header: { cwd: 'D:/p' } }

  await service.get(session, { force: true })
  const afterFirst = reads
  await service.get(session, { force: true })
  // The second scan reuses the file: the text is read once, not twice.
  assert.equal(reads, afterFirst, 'the file was read again although it did not change')
})

test('a file that changed in place is read again', async () => {
  const files = [{ dir: 'D:/p', name: 'a.ts', path: 'D:/p/a.ts', text: SAMPLE, version: 'v1' }]
  const fs = fakeFs(files)
  let reads = 0
  const counted = {
    ...fs,
    readText: async (target) => {
      reads++
      return fs.readText(target)
    },
  }
  const service = createModelService(fakeContext(counted, 'D:/p'))
  const session = { id: 's1', header: { cwd: 'D:/p' } }

  await service.get(session, { force: true })
  const afterFirst = reads
  // The backend gives no new version, but the file's text is different.
  files[0].text = 'export function load(id) {\n  return read2(id)\n}\n'
  files[0].version = undefined
  const model = await service.get(session, { force: true })

  assert.ok(reads > afterFirst, 'the changed file was not read again')
  // The model shows the new text, not the old one.
  assert.equal(model.files[0].nodes[0].calls[0].name, 'read2')
})

test('the working directory of the session decides what is scanned', async () => {
  const service = createModelService(fakeContext(fakeFs([]), 'D:/work'))

  const model = await service.get({ id: 's1', header: { cwd: 'D:/work' } })
  assert.equal(model.root, 'D:/work')
  // A session with no directory of its own has nothing to scan.
  const empty = await service.get({ id: 's2', header: {} })
  assert.equal(empty.stats.files, 0)
})
