/**
 * The project model, owned by the Host.
 *
 * The composer panel draws the model and the agent reads it, so it must be
 * built once: two scans of the same tree would drift apart the moment a file
 * changed, and the agent would then argue with the picture.
 *
 * The Host is where the agent lives, so the Host is where the model is built.
 * The browser asks for the picture it draws; the agent asks for the facts it
 * reasons about. Both come from this one model.
 *
 * The engine is the one the browser uses: `src/parser.js` and
 * `src/project.js` are plain JavaScript with no DOM in them, so both sides
 * read the code the same way.
 */

import { buildProject, IGNORED_DIRECTORIES, DEFAULT_LIMITS } from '../project.js'
import { isCodePath, languageOfPath } from '../langs.js'
import { parseFile } from '../parser.js'

/** How many sessions keep a model at the same time. */
const SESSION_LIMIT = 8

/** How long a cached model may be served without a rescan, in milliseconds. */
const MODEL_TTL_MS = 2000

/**
 * The models of the sessions that have asked for one.
 *
 * A scan is expensive — a large project takes a second to parse — so the
 * model is kept until the files it was built from change. Every file names
 * itself with a freshness token that moves when the file is written, so the
 * model is still true exactly when no token moved.
 *
 * @param {object} ctx - the Host plugin context.
 * @returns {object} the store.
 */
function createModelStore(ctx) {
  const sessions = new Map()

  return {
    /**
     * The model of one session's project.
     *
     * @param {object} session - the session asking.
     * @param {AbortSignal} [signal] - cancels the scan.
     * @returns {Promise<object>} the project model.
     */
    async get(session, signal) {
      const root = rootOf(ctx, session)
      if (root === '') return emptyModel()
      const held = sessions.get(session.id)
      // A scan already under way answers both callers with the same model.
      if (held !== undefined && held.pending !== undefined) return held.pending
      // The cache of parsed files lives in the session's own entry, so a
      // second scan reuses the files that did not change instead of parsing
      // the whole project again.
      const entry = entryFor(ctx, session)
      const pending = build(ctx, session, root, entry, signal)
      sessions.set(session.id, { root, pending, model: held?.model })
      try {
        const model = await pending
        const current = sessions.get(session.id)
        if (current !== undefined && current.pending === pending) {
          sessions.set(session.id, { root, pending: undefined, model })
        }
        while (sessions.size > SESSION_LIMIT) {
          const oldest = sessions.keys().next().value
          sessions.delete(oldest)
        }
        return model
      } catch (error) {
        const current = sessions.get(session.id)
        if (current !== undefined && current.pending === pending) sessions.delete(session.id)
        throw error
      }
    },

    /** Forget one session's model. */
    forget(sessionId) {
      sessions.delete(sessionId)
    },
  }
}

/**
 * The one model the plugin reads through.
 *
 * The store builds a model from the files; the service keeps that model for a
 * moment, so the agent and the browser read the very same object instead of
 * two scans that drifted apart the moment a file changed.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {object} [options] - the service's settings.
 * @param {number} [options.ttl] - milliseconds a cached model may be served.
 * @returns {object} the service.
 */
export function createModelService(ctx, options = {}) {
  const store = createModelStore(ctx)
  const ttl = typeof options.ttl === 'number' && options.ttl >= 0 ? options.ttl : MODEL_TTL_MS
  const cached = new Map()

  /**
   * The model of one session, taken from the cache when it is still young.
   *
   * @param {object} session - the session asking.
   * @param {object} [request] - what the caller asks for.
   * @param {boolean} [request.force] - rescan even when the model is young.
   * @param {AbortSignal} [request.signal] - cancels the scan.
   * @returns {Promise<object>} the project model.
   */
  async function get(session, request = {}) {
    const force = request.force === true
    const held = cached.get(session.id)
    if (held !== undefined && force !== true && Date.now() - held.at < ttl) return held.model
    const model = await store.get(session, request.signal)
    cached.set(session.id, { model, at: Date.now() })
    return model
  }

  /**
   * Drop the cached model of one session, so the next read rescans.
   *
   * @param {string} sessionId - the session whose model is dropped.
   */
  function invalidate(sessionId) {
    cached.delete(sessionId)
  }

  /**
   * Drop the cached model of one session and the files it was parsed from.
   *
   * @param {string} sessionId - the session whose model is dropped.
   */
  function forget(sessionId) {
    invalidate(sessionId)
    store.forget(sessionId)
    forgetFiles(ctx, sessionId)
  }

  return { get, invalidate, forget }
}

/**
 * A cheap content key, so a file whose text changed is never served from
 * the cache.
 *
 * The backend's version token moves when the file is written, but a backend
 * may not give one at all. The content's own fingerprint is what makes the
 * model true: without it, a file that changed in place would keep the
 * blocks of its older text.
 *
 * @param {string} text - the file's content.
 * @returns {string} the key.
 */
function contentKey(text) {
  let hash = 5381
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return `${text.length}:${hash}`
}

/**
 * Scan the project and build the model.
 *
 * The files that did not change keep the graph they were parsed into, so
 * editing one file costs one parse rather than a whole project.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {object} session - the session asking.
 * @param {string} root - the project directory.
 * @param {object} [held] - what the last scan of this session produced.
 * @param {AbortSignal} [signal] - cancels the scan.
 * @returns {Promise<object>} the project model.
 */
async function build(ctx, session, root, held, signal) {
  const files = await scan(ctx, root, held, signal)
  const fingerprint = files.map(file => `${file.rel}@${file.version ?? ''}:${contentKey(file.text)}`).join('|')
  if (held !== undefined && held.fingerprint === fingerprint && held.model !== undefined) {
    return held.model
  }  const contents = []
  const cache = new Map()
  for (const file of files) {
    const cached = held?.files?.get(file.rel)
    // A file is reused only when the backend says it did not change and its
    // text is the same text: a backend without a version token must be read
    // again, or the map would keep serving an older file's blocks.
    const fresh = cached !== undefined
      && cached.version === file.version
      && cached.version !== undefined
      && cached.key === contentKey(file.text)
      && cached.graph !== undefined
    const graph = fresh ? cached.graph : parseFile(file.text, languageOfPath(file.rel))
    contents.push({ path: file.path, rel: file.rel, text: file.text, graph })
    cache.set(file.rel, { version: file.version, key: contentKey(file.text), text: file.text, graph })
  }
  const model = buildProject({ root, name: nameOf(root), files: contents })
  model.scan = {
    truncated: false,
    errors: 0,
    partial: 0,
    files: contents.length,
    at: Date.now(),
    source: 'filesystem',
  }
  const entry = entryFor(ctx, session)
  entry.files = cache
  entry.fingerprint = fingerprint
  entry.model = model
  return model
}

/**
 * Where one session's model is kept between calls.
 *
 * The store owns the cache; this handle lets the builder reach it without
 * passing the whole store around. */
const stores = new WeakMap()

/** The cache handle of the store that is building this model. */
function entryFor(ctx, session) {
  let store = stores.get(ctx)
  if (store === undefined) {
    store = new Map()
    stores.set(ctx, store)
  }
  let entry = store.get(session.id)
  if (entry === undefined) {
    entry = {}
    store.set(session.id, entry)
  }
  return entry
}

/**
 * Drop the files one session's model was parsed from.
 *
 * The parsed files live in the store's own cache, so a forgotten session
 * would otherwise keep them and the next scan would reuse them.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {string} sessionId - the session whose files are dropped.
 */
function forgetFiles(ctx, sessionId) {
  const store = stores.get(ctx)
  if (store !== undefined) store.delete(sessionId)
}

/**
 * Read every file of the project.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {string} root - the project directory.
 * @param {object} [held] - what the last scan produced.
 * @param {AbortSignal} [signal] - cancels the scan.
 * @returns {Promise<object[]>} the files, each with its text and freshness token.
 */
async function scan(ctx, root, held, signal) {
  const fs = ctx.get('fs')
  if (fs === undefined) throw new Error('codeflow: no filesystem service is available')
  const limits = DEFAULT_LIMITS
  const rootTarget = await fs.resolve(root, { cwd: root, signal })
  const files = []
  const queue = [{ target: rootTarget, rel: '', depth: 0 }]
  while (queue.length > 0) {
    if (signal?.aborted === true) break
    if (files.length >= limits.maxFiles) break
    const current = queue.shift()
    let entries
    try {
      entries = await fs.listDir(current.target, signal)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files.length >= limits.maxFiles) break
      if (entry.type === 'directory') {
        if (current.depth + 1 > limits.maxDepth) continue
        if (entry.name.startsWith('.')) continue
        if (IGNORED_DIRECTORIES.has(entry.name) && !limits.forceInclude.includes(entry.name)) continue
        // A link may point out of the project; the map stays inside it.
        if (!fs.contains(rootTarget, entry.target)) continue
        queue.push({
          target: entry.target,
          rel: current.rel === '' ? entry.name : `${current.rel}/${entry.name}`,
          depth: current.depth + 1,
        })
        continue
      }
      if (entry.type !== 'file') continue
      if (!isCodePath(entry.name)) continue
      if (entry.size !== undefined && entry.size > limits.maxFileBytes) continue
      if (!fs.contains(rootTarget, entry.target)) continue
      const rel = current.rel === '' ? entry.name : `${current.rel}/${entry.name}`
      const cached = held?.files?.get(rel)
      // Without a version token there is nothing to compare: the file is
      // read again, because a file that changed in place must not keep the
      // text it had before.
      if (cached !== undefined && entry.version !== undefined && cached.version === entry.version) {
        files.push({ path: entry.target.displayPath, rel, text: cached.text, version: entry.version })
        continue
      }
      let text
      try {
        text = await fs.readText(entry.target, signal)
      } catch {
        continue
      }
      if (typeof text !== 'string' || text.length === 0) continue
      files.push({ path: entry.target.displayPath, rel, text, version: entry.version })
    }
  }
  return files
}

/**
 * The directory the session works in.
 *
 * The agent's own file tools resolve relative paths against this directory,
 * so the map has to cover the same ground the agent is about to write in.
 *
 * @param {object} ctx - the Host plugin context.
 * @param {object} session - the session asking.
 * @returns {string} the project directory.
 */
function rootOf(ctx, session) {
  const working = ctx.get('workingDirectory')
  if (working !== undefined) {
    try {
      const dir = working.get(session)
      if (typeof dir === 'string' && dir.length > 0) return dir
    } catch {
      // A session that never had a directory falls back to its header.
    }
  }
  const cwd = session?.header?.cwd
  return typeof cwd === 'string' ? cwd : ''
}

/** The project's name: the directory it lives in. */
function nameOf(root) {
  const parts = String(root).split(/[\\/]/).filter(part => part.length > 0)
  return parts.length === 0 ? 'project' : parts[parts.length - 1]
}

/** The model of a project with nothing in it. */
function emptyModel() {
  const model = buildProject({ root: '', name: 'project', files: [] })
  model.scan = { truncated: false, errors: 0, partial: 0, files: 0, at: Date.now(), source: 'filesystem' }
  return model
}
