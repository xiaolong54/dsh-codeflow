/**
 * Project layer: fold many parsed files into one model, resolve calls across
 * file boundaries, and build the three views the UI drills through
 * (project → file → function body).
 *
 * Resolution is conservative. A cross-file edge needs either exactly one
 * definition of that name in the project or an import that names the target
 * module; anything else becomes a diagnostic instead of a guessed edge, so the
 * map never invents data flow that the code does not have.
 */

import { parseFile } from './parser.js'
import { languageOfPath, isCodePath, languageRow } from './langs.js'
import { trimLabel } from './text.js'

/** Directories never scanned for project blocks. */
export const IGNORED_DIRECTORIES = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'vendor',
  '.venv', 'venv', 'env', '__pycache__', '.next', '.nuxt', 'coverage', '.idea', '.vscode',
  'bin', 'obj', 'Pods', '.dart_tool', '.gradle', '.cache', 'tmp', 'temp', 'logs',
])

/** Scan limits: a project map is worth a bounded read, not the whole disk. */
export const DEFAULT_LIMITS = {
  maxFiles: 300,
  maxDepth: 6,
  maxFileBytes: 512 * 1024,
  /** Directories that are scanned even though their name is ignored. */
  forceInclude: [],
}

const BRACE_LANGS = new Set(['go', 'java', 'csharp', 'rust', 'kotlin', 'swift', 'javascript', 'typescript', 'generic'])

/** Last path segment. */
function baseName(path) {
  const parts = String(path).split(/[\\/]/).filter(part => part.length > 0)
  return parts.length === 0 ? String(path) : parts[parts.length - 1]
}

/** Directory of a relative path, `''` at the root. */
export function dirName(relPath) {
  const normalized = String(relPath).replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? '' : normalized.slice(0, index)
}

/** Remove a trailing extension. */
function stripExtension(path) {
  return String(path).replace(/\.[A-Za-z0-9]+$/, '')
}

/** Whether `spec` (an import) most likely names the module at `rel`. */
function importTargets(spec, rel) {
  if (typeof spec !== 'string' || !spec.startsWith('.')) return false
  const specBase = stripExtension(baseName(spec))
  const relBase = stripExtension(baseName(rel))
  if (specBase.length === 0) return false
  if (specBase === relBase) return true
  // `./dir` may resolve to `dir/index.*`.
  const relDir = baseName(dirName(rel))
  return specBase === relDir
}

/**
 * The namespace a language's blocks live in.
 *
 * TypeScript and JavaScript share one namespace: a TypeScript file calls the
 * JavaScript library next to it all the time. Every other language is its own
 * namespace: a Go function and a C# function that happen to share a name are
 * two different functions.
 *
 * @param {string} lang - the language id.
 * @returns {string} the namespace.
 */
function languageFamily(lang) {
  if (lang === 'javascript' || lang === 'typescript') return 'js'
  return lang
}

/**
 * Whether a block may be the target of a call in a file of this language.
 *
 * @param {string} lang - the calling file's language.
 * @param {string} targetLang - the candidate block's language.
 * @returns {boolean} whether the two share a namespace.
 */
function sameLanguage(lang, targetLang) {
  if (targetLang === undefined) return true
  return languageFamily(lang) === languageFamily(targetLang)
}

/** Build the project model from parsed files. */
export function buildProject(input) {
  const files = []
  for (const file of input.files) {
    if (!isCodePath(file.rel)) continue
    const lang = languageOfPath(file.rel)
    // A caller that already parsed the file may hand the graph over, so a
    // project that did not change is not parsed a second time.
    const graph = file.graph ?? parseFile(file.text, lang)
    files.push({
      path: file.path,
      rel: file.rel.replace(/\\/g, '/'),
      lang: graph.lang,
      text: file.text,
      nodes: graph.nodes,
      edges: graph.edges,
      imports: graph.imports ?? new Map(),
      externals: graph.externals ?? [],
      // Names a module-level binding takes away from the project's blocks.
      shadows: new Set(graph.shadows ?? []),
    })
  }

  const index = new Map()
  // Methods are named `Class.method` but called by their bare name, so the
  // bare name is indexed too: that is how a cross-file call finds a method.
  const methodIndex = new Map()
  for (const file of files) {
    for (const node of file.nodes) {
      const entries = index.get(node.name) ?? []
      entries.push({ rel: file.rel, node, lang: file.lang })
      index.set(node.name, entries)
      if (node.kind === 'method' && node.name.includes('.')) {
        const bare = node.name.slice(node.name.indexOf('.') + 1)
        const methods = methodIndex.get(bare) ?? []
        methods.push({ rel: file.rel, node, lang: file.lang })
        methodIndex.set(bare, methods)
      }
      if (node.kind === 'entry' && node.name.includes('.')) {
        // A constructor is reached by the name of its class: `new Service()`.
        const prefix = node.name.slice(0, node.name.indexOf('.'))
        const entries = methodIndex.get(prefix) ?? []
        entries.push({ rel: file.rel, node, lang: file.lang })
        methodIndex.set(prefix, entries)
      }
    }
  }

  const crossEdges = []
  const crossKeys = new Set()
  const pushCross = (fromFile, fromNode, toFile, toNode, kind, label) => {
    if (fromFile === toFile && fromNode === toNode) return
    const key = `${fromFile}#${fromNode}->${toFile}#${toNode}|${kind}`
    if (crossKeys.has(key)) return
    crossKeys.add(key)
    crossEdges.push({ fromFile, fromNode, toFile, toNode, kind, label })
  }
  const diagnostics = []
  const seenDiagnostics = new Set()
  /**
   * Record one problem.
   *
   * A problem has a kind, because the two audiences read different lists: a
   * `flow` problem is a place where the data flow itself is broken (a call
   * nobody can resolve, a value that appears from nowhere), and a `convention`
   * problem is a place where the code does not hold to the modular shape the
   * map is drawn in (a block too large, a function without a description).
   * The person reads the first list as errors; the agent reads both.
   *
   * @param {object} diagnostic - the problem; `kind` defaults to `flow`.
   */
  const report = (diagnostic) => {
    const key = `${diagnostic.code}|${diagnostic.file}|${diagnostic.line ?? ''}|${diagnostic.message}`
    if (seenDiagnostics.has(key)) return
    seenDiagnostics.add(key)
    diagnostics.push({ kind: 'flow', ...diagnostic })
  }

  const resolve = (file, name) => {
    // The same candidates a call may reach: a value can come from a method
    // that is called by its bare name, and that method is indexed under both
    // names.
    const candidates = candidatesFor(file, name)
    if (candidates.length === 1) return { target: candidates[0], via: 'unique' }
    if (candidates.length === 0) return undefined
    const spec = file.imports.get(name)?.spec
    if (typeof spec === 'string' && spec.length > 0) {
      const matched = candidates.filter(candidate => importTargets(spec, candidate.rel))
      if (matched.length === 1) return { target: matched[0], via: 'import' }
    }
    return { ambiguous: candidates }
  }

  /**
   * The blocks a call could reach.
   *
   * A method is named `Class.method` but is called by its bare name, so a
   * call to `method` can reach any class's method of that name. The candidates
   * are therefore the exact name first, then every method with that bare
   * name — a call that could reach two of them is reported as ambiguous
   * rather than guessed.
   *
   * Only blocks of the caller's own language are candidates: a Go function
   * and a C# function that share a name live in different namespaces, and
   * connecting them would draw a call the code does not make.
   */
  const candidatesFor = (file, name) => {
    const exact = index.get(name)
    if (exact !== undefined && exact.length > 0) {
      const same = exact.filter(candidate => sameLanguage(file.lang, candidate.lang))
      if (same.length > 0) return same
    }
    const methods = methodIndex.get(name)
    return (methods ?? []).filter(candidate => sameLanguage(file.lang, candidate.lang))
  }

  /**
   * The blocks a call could reach, given the names it may be known by.
   *
   * A call carries every name it may have: `Service.process`, `process`. The
   * names are tried in order, and the first one that leads to a single block
   * decides the call. A name that leads to several blocks is ambiguous and
   * resolves to nothing — the map does not draw a guessed edge.
   */
  const resolveCandidates = (file, names) => {
    // The first name that leads to several blocks is remembered: the call
    // site cannot say which one it meant, and the map reports that instead
    // of drawing a guessed edge.
    let ambiguous
    for (const name of names) {
      // A name the file binds itself is not a method of another class.
      if (file.shadows !== undefined && file.shadows.has(name)) continue
      const candidates = candidatesFor(file, name)
      if (candidates.length === 0) continue
      if (candidates.length === 1) return { target: candidates[0], via: 'unique' }
      // An import that names the module decides it: the call site knows
      // which file it meant.
      const spec = file.imports.get(name)?.spec
      const matched = typeof spec === 'string' && spec.length > 0
        ? candidates.filter(candidate => importTargets(spec, candidate.rel))
        : []
      if (matched.length === 1) return { target: matched[0], via: 'import' }
      if (ambiguous === undefined) ambiguous = { name, candidates }
    }
    if (ambiguous === undefined) return undefined
    return { ambiguous: ambiguous.candidates, name: ambiguous.name }
  }

  for (const file of files) {
    const localNames = new Set(file.nodes.map(node => node.name))
    for (const node of file.nodes) {
      // `openCalls` are the calls this file could not resolve on its own; they
      // may name a method of a class in another file.
      const callSites = [...node.calls, ...(node.openCalls ?? [])]
      for (const call of callSites) {
        // A call that already links two blocks of this file needs no second,
        // cross-file edge: linking it again could attach it to a namesake in
        // another file.
        if (call.resolved === true) continue
        // A name the file binds itself reaches no block of the project.
        if (call.shadowed === true) continue
        if (localNames.has(call.name)) continue
        // The names the callee may be known by, most precise first.
        const names = call.candidates === undefined
          ? [call.name]
          : [...call.candidates, call.name]
        const resolved = resolveCandidates(file, names)
        if (resolved === undefined) continue
        if (resolved.ambiguous !== undefined) {
          // The call could reach several blocks: the map says so instead of
          // picking one, so the reader and the model both see the gap.
          const places = new Set(resolved.ambiguous.map(candidate => candidate.rel))
          report({
            code: 'ambiguous-call',
            severity: 'warn',
            file: file.rel,
            line: node.line,
            node: node.name,
            values: { name: resolved.name, n: places.size },
          })
          continue
        }
        const target = resolved.target
        if (target.rel === file.rel) continue
        const producer = call.payload === undefined
          ? undefined
          : (localNames.has(call.payload.producer)
            ? { rel: file.rel, node: file.nodes.find(candidate => candidate.name === call.payload.producer) }
            : resolve(file, call.payload.producer)?.target)
        if (producer !== undefined && producer.node !== undefined) {
          // One edge per call site: the traced value is the data edge between
          // producer and consumer; no second caller→callee edge is added. The
          // caller's own file view fills in the missing call stub (fileGraph).
          pushCross(producer.rel, producer.node.name, target.rel, target.node.name, 'data', trimLabel(call.payload.label))
        } else {
          pushCross(file.rel, node.name, target.rel, target.node.name, 'call')
        }
      }
      checkNodeRules(file, node, report)
    }
    checkFileRules(file, report)
  }

  // Project-level call counts decide entry points and dead code.
  const callCounts = new Map()
  for (const file of files) {
    for (const node of file.nodes) {
      const id = `${file.rel}#${node.name}`
      if (!callCounts.has(id)) callCounts.set(id, 0)
    }
  }
  for (const file of files) {
    for (const edge of file.edges) {
      const targetName = edge.to.replace(/^fn:/, '')
      const id = `${file.rel}#${targetName}`
      callCounts.set(id, (callCounts.get(id) ?? 0) + 1)
    }
  }
  for (const edge of crossEdges) {
    const id = `${edge.toFile}#${edge.toNode}`
    callCounts.set(id, (callCounts.get(id) ?? 0) + 1)
  }
  for (const file of files) {
    for (const node of file.nodes) {
      node.projectCalls = callCounts.get(`${file.rel}#${node.name}`) ?? 0
      node.entry = node.exported === true && node.projectCalls === 0
    }
  }

  // The convention rules run last: whether a block is an entry point is only
  // known after the call counts are in, and the entry point is exactly the
  // block that has to orchestrate rather than implement.
  for (const file of files) {
    for (const node of file.nodes) checkConventionRules(file, node, report)
  }

  const fileEdges = aggregateFileEdges(crossEdges)
  // The problems, counted per file and per block, so the picture can show
  // where the map found something wrong instead of only listing it below.
  const byFile = new Map()
  const byNode = new Map()
  for (const item of diagnostics) {
    byFile.set(item.file, (byFile.get(item.file) ?? 0) + 1)
    if (item.node === undefined) continue
    const key = `${item.file}#${item.node}`
    byNode.set(key, (byNode.get(key) ?? 0) + 1)
  }
  return {
    root: input.root,
    name: input.name ?? baseName(input.root),
    files,
    index,
    crossEdges,
    fileEdges,
    diagnostics,
    issues: { byFile, byNode },
    stats: {
      files: files.length,
      blocks: files.reduce((total, file) => total + file.nodes.length, 0),
      crossEdges: crossEdges.length,
      diagnostics: diagnostics.length,
    },
  }
}

/** Per-node structure rules. */
function checkNodeRules(file, node, report) {
  const row = languageRow(file.lang)
  const body = bodyTextOf(file, node)
  const lines = body.split('\n').length
  if (lines > 80) {
    report({ code: 'block-too-large', severity: 'warn', kind: 'convention', file: file.rel, line: node.line, node: node.name, values: { name: node.name, lines } })
  }
  if ((node.params ?? []).length > 6) {
    report({ code: 'too-many-params', severity: 'warn', kind: 'convention', file: file.rel, line: node.line, node: node.name, values: { name: node.name, params: node.params.length } })
  }
  if (BRACE_LANGS.has(row.id) || row.id === 'python') {
    const dynamic = /\b(eval|getattr|setattr|importlib|globals|locals|Reflection|Activator|dlsym|loadstring)\b|\bimport\s*\(|\bSystem\.getenv\(/.exec(body)
    if (dynamic !== null) {
      report({ code: 'dynamic-dispatch', severity: 'warn', file: file.rel, line: node.line, node: node.name, values: { name: node.name, token: dynamic[0] } })
    }
  }
  // A block that returns something it did not receive as a parameter, and
  // takes nothing, hides where its data came from. The parser already knows
  // both facts, so this needs no guessing — and it is the one thing that
  // makes a data-flow map lie.
  if (node.kind === 'function' && (node.params ?? []).length === 0 && (node.outputs ?? []).length > 0) {
    report({
      code: 'hidden-data-flow',
      severity: 'warn',
      file: file.rel,
      line: node.line,
      node: node.name,
      values: { name: node.name, token: node.outputs[0] },
    })
  }
}

/** Per-file structure rules. */
function checkFileRules(file, report) {
  const row = languageRow(file.lang)
  const topLevel = file.text.split('\n')
  if (row.id === 'javascript' || row.id === 'typescript') {
    const mutable = topLevel.findIndex(line => /^(let|var)\s+[A-Za-z_$]/.test(line))
    if (mutable >= 0) {
      report({ code: 'module-mutable-state', severity: 'warn', kind: 'convention', file: file.rel, line: mutable + 1, values: {} })
    }
  }
  if (row.id === 'python') {
    const globalDecl = topLevel.findIndex(line => /^\s*global\s+/.test(line))
    if (globalDecl >= 0) {
      report({ code: 'module-mutable-state', severity: 'warn', kind: 'convention', file: file.rel, line: globalDecl + 1, values: {} })
    }
  }
}

/**
 * The convention rules, checked once the entry points are known.
 *
 * These are not errors: the code still runs. They are the places where the
 * project does not hold to the modular shape the map is drawn in, and they
 * are what the agent is asked to fix when it writes the next block.
 *
 * @param {object} file - the file the block lives in.
 * @param {object} node - the block.
 * @param {(diagnostic: object) => void} report - where a problem is recorded.
 */
function checkConventionRules(file, node, report) {
  const row = languageRow(file.lang)
  const body = bodyTextOf(file, node)
  const lines = body.split('\n').length
  // A block without a description has no name on the map: the reader sees a
  // label, not a purpose.
  if ((node.kind === 'function' || node.kind === 'method')
    && (node.doc === undefined || node.doc.trim().length === 0)) {
    report({
      code: 'missing-doc',
      severity: 'info',
      kind: 'convention',
      file: file.rel,
      line: node.line,
      node: node.name,
      values: { name: node.name },
    })
  }
  // An entry point that does the work itself is not an orchestrator: the
  // steps it runs cannot be read, checked, or replaced one by one.
  if (node.entry === true && lines > 12 && (node.calls ?? []).length < 2) {
    report({
      code: 'orchestrator-entry',
      severity: 'info',
      kind: 'convention',
      file: file.rel,
      line: node.line,
      node: node.name,
      values: { name: node.name, lines },
    })
  }
  // Business logic inside an anonymous callback cannot be a block of its
  // own, so it never shows up on the map.
  const callback = longestAnonymousBody(body)
  if (callback >= 10) {
    report({
      code: 'inline-callback',
      severity: 'info',
      kind: 'convention',
      file: file.rel,
      line: node.line,
      node: node.name,
      values: { name: node.name, lines: callback },
    })
  }
  // A named function defined inside another one is a block the map cannot
  // show either.
  if (nestedDefinitionLines(body, row.id) >= 3) {
    report({
      code: 'nested-definition',
      severity: 'info',
      kind: 'convention',
      file: file.rel,
      line: node.line,
      node: node.name,
      values: { name: node.name },
    })
  }
  // A block that writes to something it was not given hides where the value
  // came from: the data flow breaks between the writer and the reader.
  for (const token of hiddenWriteNames(file, node)) {
    report({
      code: 'explicit-io',
      severity: 'warn',
      kind: 'convention',
      file: file.rel,
      line: node.line,
      node: node.name,
      values: { name: node.name, token },
    })
  }
}

/**
 * The range of a block's body: the inside of its braces, or the whole block
 * when the language has none.
 *
 * The extractor records the braces for the languages it understands, but the
 * body is found here as well, so a block that only carries its declaration
 * range is still measured by its statements.
 *
 * @param {object} file - the file the block lives in.
 * @param {object} node - the block.
 * @returns {{ start: number, end: number, braces: boolean }} the range.
 */
function bodyRangeOf(file, node) {
  const text = file.text
  if (typeof node.bodyStart === 'number' && typeof node.bodyEnd === 'number') {
    return { start: node.bodyStart, end: node.bodyEnd, braces: true }
  }
  const open = text.indexOf('{', node.start)
  if (open >= 0 && open < node.end) {
    const close = closingBrace(text, open)
    if (close >= 0) return { start: open + 1, end: close, braces: true }
  }
  return { start: node.start, end: node.end, braces: false }
}

/**
 * The text of a block's body.
 *
 * @param {object} file - the file the block lives in.
 * @param {object} node - the block.
 * @returns {string} the body.
 */
function bodyTextOf(file, node) {
  const range = bodyRangeOf(file, node)
  return file.text.slice(range.start, range.end)
}

/**
 * The names a block writes to that it did not receive.
 *
 * The check is deliberately conservative: a write counts only when it sits at
 * the level of the block's own statements, when the name is neither a
 * parameter nor declared in the same body, and when the name is used
 * elsewhere in the file. A block that only touches its own locals is clean.
 *
 * @param {object} file - the file the block lives in.
 * @param {object} node - the block.
 * @returns {string[]} the names written without being given.
 */
function hiddenWriteNames(file, node) {
  const range = bodyRangeOf(file, node)
  const body = file.text.slice(range.start, range.end)
  if (body.length === 0) return []
  const params = new Set((node.params ?? []).map(param => param.name))
  const declared = declaredNames(body)
  const outside = `${file.text.slice(0, range.start)}\n${file.text.slice(range.end)}`
  const lines = body.split('\n')
  // The statement level: the first line of the body that is not the
  // declaration itself. Without braces the body starts with the declaration.
  const skip = range.braces ? 0 : 1
  const level = statementIndent(lines, skip)
  if (level < 0) return []
  const found = []
  for (const line of lines) {
    if (line.trim().length === 0) continue
    if (line.length - line.trimStart().length !== level) continue
    const match = /^([A-Za-z_$][\w$]*)\s*(?:=|\+=|-=|\*=|\/=)(?!=)/.exec(line.trim())
    if (match === null) continue
    const name = match[1]
    if (params.has(name) || declared.has(name)) continue
    if (!usesName(outside, name)) continue
    if (!found.includes(name)) found.push(name)
  }
  return found
}

/**
 * The indentation of a block's own statements.
 *
 * @param {string[]} lines - the lines of the body.
 * @param {number} skip - how many lines to leave out at the top.
 * @returns {number} the indentation, or -1 when there is none.
 */
function statementIndent(lines, skip) {
  for (let index = skip; index < lines.length; index++) {
    const line = lines[index]
    if (line.trim().length === 0) continue
    return line.length - line.trimStart().length
  }
  return -1
}

/**
 * The names a body declares for itself.
 *
 * @param {string} body - the body text.
 * @returns {Set<string>} the declared names.
 */
function declaredNames(body) {
  const names = new Set()
  const pattern = /\b(?:const|let|var|function|class|def|func|fn|struct|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g
  for (const match of body.matchAll(pattern)) names.add(match[1])
  return names
}

/**
 * Whether a name appears in some text.
 *
 * @param {string} text - the text to look in.
 * @param {string} name - the name.
 * @returns {boolean} whether it appears.
 */
function usesName(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`).test(text)
}

/**
 * The longest anonymous function body in a block, in lines.
 *
 * Only a body that returns something counts: a long callback that only
 * forwards a value is formatting, not logic.
 *
 * @param {string} body - the block's text.
 * @returns {number} the longest body in lines, 0 when there is none.
 */
function longestAnonymousBody(body) {
  const pattern = /(?:=>\s*\{|\bfunction\s*(?:<[^>]*>)?\s*\([^)]*\)\s*\{)/g
  let longest = 0
  for (const match of body.matchAll(pattern)) {
    const start = body.indexOf('{', match.index)
    if (start < 0) continue
    const end = closingBrace(body, start)
    if (end < 0) continue
    const text = body.slice(start, end + 1)
    if (!/\breturn\b/.test(text)) continue
    const lines = text.split('\n').length
    if (lines > longest) longest = lines
  }
  return longest
}

/**
 * The end of the brace that opens at `start`, or -1 when the braces do not
 * balance.
 *
 * @param {string} text - the text to scan.
 * @param {number} start - the index of the opening brace.
 * @returns {number} the index of the matching brace.
 */
function closingBrace(text, start) {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (character === '{') depth++
    else if (character === '}') {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Whether a block holds a named function of its own.
 *
 * @param {string} body - the block's text.
 * @param {string} langId - the language id.
 * @returns {number} 1 when there is one, 0 otherwise.
 */
function nestedDefinitionLines(body, langId) {
  if (langId === 'python') return /^\s+(?:async\s+)?def\s+\w+/m.test(body) ? 1 : 0
  if (langId === 'javascript' || langId === 'typescript') {
    return /^\s+(?:async\s+)?function\s+\w+/m.test(body) ? 1 : 0
  }
  return 0
}

/** Aggregate function-level cross edges into file-to-file edges. */
function aggregateFileEdges(crossEdges) {
  const byPair = new Map()
  for (const edge of crossEdges) {
    const key = `${edge.fromFile}->${edge.toFile}|${edge.kind}`
    const existing = byPair.get(key)
    if (existing === undefined) {
      byPair.set(key, { from: edge.fromFile, to: edge.toFile, kind: edge.kind, count: 1 })
    } else {
      existing.count++
    }
  }
  return [...byPair.values()]
}

/** One file's block, as the project level shows it. */
/** The project-level graph: one block per file, edges aggregated. */
/** Group files by a key into a map of key → files. */
function groupBy(files, keyOf) {
  const groups = new Map()
  for (const file of files) {
    const key = keyOf(file)
    const group = groups.get(key)
    if (group === undefined) groups.set(key, [file])
    else group.push(file)
  }
  return groups
}

/** The first segment of a directory path. */
function topSegment(dir) {
  const index = dir.indexOf('/')
  return index < 0 ? dir : dir.slice(0, index)
}

/** How many areas keep the architecture map readable. */
const AREA_LIMIT = 24

/**
 * The project's functional areas.
 *
 * An area is a directory inside the project: the honest reading of "which
 * part of the system does this file belong to". A project with many small
 * folders is regrouped one level up so the map stays a map.
 *
 * @param {object} project - the project model.
 * @returns {Map<string, object[]>} area key → its files.
 */
export function projectAreas(project) {
  let groups = groupBy(project.files, file => dirName(file.rel))
  if (groups.size > AREA_LIMIT) {
    groups = groupBy(project.files, file => topSegment(dirName(file.rel)))
  }
  return groups
}

/** Display name of one area. */
function areaName(key, projectName) {
  if (key === '') return projectName
  const parts = key.split('/')
  return parts[parts.length - 1]
}

/**
 * What one functional area is for.
 *
 * An area has no comment of its own, so the description is taken from the
 * code inside it: the documented blocks it owns, then the names of its
 * blocks. A reader learns what the part does from what the part contains.
 *
 * @param {object[]} files - the area's files.
 * @returns {string | undefined} the description.
 */
function areaSummary(files) {
  const documented = []
  for (const file of files) {
    for (const node of file.nodes) {
      if (node.doc === undefined || node.doc.length === 0) continue
      if (!documented.includes(node.doc)) documented.push(node.doc)
    }
  }
  if (documented.length > 0) {
    return trimLabel(documented.join(' '), 160)
  }
  const names = []
  for (const file of files) {
    for (const node of file.nodes) {
      if (node.exported !== true && node.kind !== 'entry') continue
      if (!names.includes(node.name)) names.push(node.name)
    }
  }
  if (names.length === 0) return undefined
  return trimLabel(names.join('、'), 120)
}

/**
 * The architecture view: one block per functional area, edges between areas.
 *
 * @param {object} project - the project model.
 * @returns {{ nodes: object[], edges: object[] }} the area graph.
 */
export function areaGraph(project) {
  const groups = projectAreas(project)
  const nodes = []
  const areaOf = new Map()
  for (const [key, files] of groups) {
    const id = `area:${key}`
    for (const file of files) areaOf.set(file.rel, id)
    const blocks = files.reduce((total, file) => total + file.nodes.length, 0)
    const entries = files.reduce((total, file) => total + file.nodes.filter(node => node.entry === true).length, 0)
    const issues = files.reduce((total, file) => total + (project.issues?.byFile.get(file.rel) ?? 0), 0)
    nodes.push({
      id,
      name: areaName(key, project.name),
      subtitle: key === '' ? project.name : key,
      summary: areaSummary(files),
      kind: 'area',
      line: 0,
      params: [],
      outputs: [],
      blocks,
      entries,
      files: files.length,
      issues,
      drillable: files.length > 0,
    })
  }
  const counts = new Map()
  for (const edge of project.crossEdges) {
    const from = areaOf.get(edge.fromFile)
    const to = areaOf.get(edge.toFile)
    if (from === undefined || to === undefined || from === to) continue
    const key = `${from}|${to}|${edge.kind}`
    const existing = counts.get(key)
    if (existing === undefined) counts.set(key, { from, to, kind: edge.kind, count: 1 })
    else existing.count++
  }
  const edges = [...counts.values()].map(edge => ({
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    label: edge.count > 1 ? `×${edge.count}` : undefined,
  }))
  return { nodes, edges }
}

/**
 * The small logic inside one functional area: its blocks and the data that
 * moves between them.
 *
 * This is what an area contains when a reader opens it: every block of every
 * file in the area, the calls between them, and the value each call carries.
 * Blocks of other files the area calls are shown as stubs, so the boundary of
 * the area is visible rather than implied.
 *
 * @param {object} project - the project model.
 * @param {string} key - the area key.
 * @returns {{ nodes: object[], edges: object[] }} the area's block graph.
 */
export function areaBlockGraph(project, key) {
  const files = projectAreas(project).get(key) ?? []
  const inside = new Set(files.map(file => file.rel))
  const nodes = []
  const ids = new Set()
  for (const file of files) {
    for (const node of file.nodes) {
      const id = `fn:${file.rel}#${node.name}`
      ids.add(id)
      nodes.push({
        id,
        name: node.name,
        subtitle: node.doc,
        summary: node.doc,
        kind: node.kind,
        line: node.line,
        params: node.params ?? [],
        outputs: node.outputs ?? [],
        file: file.rel,
        blocks: node.calls?.length ?? 0,
        refCount: node.projectCalls ?? 0,
        issues: project.issues?.byNode.get(`${file.rel}#${node.name}`) ?? 0,
        drillable: (node.calls?.length ?? 0) > 0,
      })
    }
  }
  const edges = []
  const seen = new Set()
  const push = (from, to, kind, label) => {
    if (from === to || !ids.has(from)) return
    if (!ids.has(to)) return
    const edgeKey = `${from}|${to}|${kind}`
    if (seen.has(edgeKey)) return
    seen.add(edgeKey)
    edges.push({ from, to, kind, label })
  }
  for (const file of files) {
    for (const edge of file.edges) {
      const from = edge.from.replace(/^fn:/, '')
      const to = edge.to.replace(/^fn:/, '')
      push(`fn:${file.rel}#${from}`, `fn:${file.rel}#${to}`, edge.kind, edge.label)
    }
  }
  // Calls that leave the area are shown as a stub, so the reader sees where
  // the area depends on the rest of the project.
  for (const file of files) {
    for (const node of file.nodes) {
      for (const call of node.calls ?? []) {
        const candidates = project.index.get(call.name) ?? []
        const target = candidates.find(candidate => candidate.rel === file.rel) ?? candidates[0]
        if (target === undefined || inside.has(target.rel)) continue
        const stubId = `ext:${target.rel}#${target.node.name}`
        if (!ids.has(stubId)) {
          ids.add(stubId)
          nodes.push({
            id: stubId,
            name: target.node.name,
            subtitle: target.rel,
            kind: 'external',
            line: 0,
            params: [],
            outputs: [],
            refCount: 0,
            drillable: true,
          })
        }
        const kind = call.payload === undefined ? 'call' : 'data'
        const label = call.payload === undefined ? undefined : trimLabel(call.payload.label)
        push(`fn:${file.rel}#${node.name}`, stubId, kind, label)
      }
    }
  }
  return { nodes, edges }
}

/** One file's function graph, with stubs for cross-file calls. */
/** Human label for one block in a breadcrumb. */
/** Path of `child` relative to `root`, with forward slashes. */