/**
 * End-to-end check of the Host's pipeline against a real directory tree.
 *
 * The Host lists the working directory, reads the files, parses them and folds
 * them into one project model. The adapters here mimic the Host `fs` contract,
 * so the whole path is exercised exactly as the plugin runs it — against the
 * plugin's own source.
 */

import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

import { createModelService } from '../src/host/analyze.js'

const root = path.resolve(import.meta.dirname, '..')

/** A filesystem adapter over the real disk, in the Host's shape. */
function realFs() {
  const target = (path_) => ({ targetKey: path_, displayPath: path_ })
  const pathOf = (entry) => entry?.displayPath ?? entry
  return {
    resolve: async (path_) => target(path_),
    contains: (parent, child) => String(pathOf(child)).startsWith(String(pathOf(parent))),
    listDir: async (directory) => fs.readdirSync(pathOf(directory), { withFileTypes: true }).map(entry => {
      const full = path.join(pathOf(directory), entry.name)
      const stat = fs.statSync(full)
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
        target: target(full),
        version: String(stat.mtimeMs),
        size: stat.size,
      }
    }),
    readText: async (file) => fs.readFileSync(pathOf(file), 'utf8'),
  }
}

/** A context with the services the model service needs. */
function fakeContext() {
  const filesystem = realFs()
  return {
    fs: filesystem,
    get: (name) => (name === 'fs' ? filesystem : name === 'workingDirectory' ? {
      get: () => root,
    } : undefined),
  }
}

test('the plugin package itself scans into a project model', async () => {
  const service = createModelService(fakeContext())
  const model = await service.get({ id: 's1', header: { cwd: root } })

  assert.ok(model.stats.files > 5, `expected files, got ${model.stats.files}`)
  assert.ok(model.stats.blocks > 5, `expected blocks, got ${model.stats.blocks}`)
  assert.equal(model.name, path.basename(root))
  // Every file of the model is a real file of the package.
  for (const file of model.files) {
    assert.ok(fs.existsSync(path.join(root, file.rel)), `${file.rel} is not on disk`)
  }
  // The blocks of a file carry the blocks the parser found.
  const tool = model.files.find(file => file.rel.endsWith('host/tool.js'))
  assert.ok(tool !== undefined, 'the tool module is missing from the model')
  assert.ok(tool.nodes.some(node => node.name === 'apply'), 'the tool module has no blocks')
})

test('a second scan of the same tree reuses the files it already parsed', async () => {
  const filesystem = realFs()
  let reads = 0
  const counted = {
    ...filesystem,
    readText: async (file) => {
      reads++
      return filesystem.readText(file)
    },
  }
  const ctx = {
    fs: counted,
    get: (name) => (name === 'fs' ? counted : name === 'workingDirectory' ? { get: () => root } : undefined),
  }
  const service = createModelService(ctx)
  const session = { id: 's1', header: { cwd: root } }

  await service.get(session, { force: true })
  const afterFirst = reads
  await service.get(session, { force: true })

  // The tree is listed again, but no file is read again: none of them moved.
  assert.equal(reads, afterFirst, 'the files were read again although none changed')
})
