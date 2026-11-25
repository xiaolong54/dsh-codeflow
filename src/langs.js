/**
 * Language table for the generic extractor.
 *
 * One row per supported language. The extractor reads these fields instead of
 * knowing any language by heart, so adding a language is a table edit:
 *
 * - `exts`        file extensions that select the row.
 * - `lineComments` / `blockComments` / `strings` drive the masker, which blanks
 *                 comments and string bodies while preserving offsets.
 * - `braces`      the declaration strategy: a keyword scan (`func`, `fn`, `fun`)
 *                 or a structural scan (Java/C# have no keyword).
 * - `params`      where a parameter name sits inside one parameter (`first` when
 *                 the part is `name: Type`, `last` for `Type name`).
 * - `import`      how a file maps a local name to another file's export.
 * - `builtins`    names that are never project functions (stdlib/UI helpers), so
 *                 the graph does not report them as unresolved.
 */

/** Languages whose declarations begin with a keyword. */
const KEYWORD = 'keyword'
/** Languages whose declarations must be recognised structurally. */
const STRUCTURAL = 'structural'

/** Control-flow heads that can never be a declaration. */
const CONTROL = [
  'if', 'for', 'foreach', 'while', 'switch', 'catch', 'when', 'match', 'else', 'do', 'try',
  'finally', 'return', 'new', 'throw', 'assert', 'defer', 'go', 'select', 'lock', 'using',
  'fixed', 'synchronized', 'with', 'unless', 'repeat', 'guard',
  // `this(...)` and `super(...)` are calls to a constructor, not declarations.
  'this', 'super',
]

/** Shared builtin names: platform and standard-library calls that are not project blocks. */
const COMMON_BUILTINS = [
  // JavaScript / TypeScript
  'console', 'JSON', 'Math', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise',
  'require', 'parseInt', 'parseFloat', 'setTimeout', 'setInterval', 'fetch', 'structuredClone',
  // Python
  'print', 'len', 'range', 'int', 'str', 'float', 'list', 'dict', 'set', 'tuple', 'open',
  'isinstance', 'enumerate', 'zip', 'map', 'filter', 'sorted', 'sum', 'min', 'max', 'abs',
  'getattr', 'setattr', 'hasattr', 'super', 'format', 'repr', 'type', 'id',
  // Go
  'fmt', 'strings', 'strconv', 'errors', 'time', 'context', 'os', 'io', 'log', 'json',
  'append', 'make', 'len', 'cap', 'copy', 'panic', 'recover', 'new',
  // Java / Kotlin
  'System', 'Objects', 'Optional', 'List', 'Map', 'Set', 'ArrayList', 'HashMap', 'StringBuilder',
  'Collections', 'Arrays', 'Stream', 'Collectors', 'println', 'printStackTrace', 'builder',
  // C#
  'Console', 'Convert', 'Enumerable', 'Task', 'StringBuilder', 'Exception', 'Debug',
  // Rust
  'vec', 'println', 'format', 'write', 'writeln', 'panic', 'Some', 'Ok', 'Err', 'unwrap',
  'unwrap_or', 'clone', 'iter', 'collect', 'map', 'filter', 'push', 'insert', 'get',
  // Swift
  'print', 'String', 'Int', 'Double', 'Array', 'Dictionary', 'Optional', 'fatalError',
]

/** @type {Record<string, object>} */
export const LANGUAGES = {
  javascript: {
    id: 'javascript',
    label: 'JavaScript',
    exts: ['js', 'mjs', 'cjs', 'jsx'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['`', '`', '\\'], ['"', '"', '\\'], ["'", "'", '\\']],
    braces: KEYWORD,
    keyword: 'function',
    params: 'first',
    import: 'js',
    builtins: COMMON_BUILTINS,
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    exts: ['ts', 'tsx', 'mts', 'cts'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['`', '`', '\\'], ['"', '"', '\\'], ["'", "'", '\\']],
    braces: KEYWORD,
    keyword: 'function',
    params: 'first',
    import: 'js',
    builtins: COMMON_BUILTINS,
  },
  python: {
    id: 'python',
    label: 'Python',
    exts: ['py', 'py3', 'pyw'],
    lineComments: ['#'],
    blockComments: [],
    strings: [['"""', '"""', '\\'], ["'''", "'''", '\\'], ['"', '"', '\\'], ["'", "'", '\\']],
    braces: 'indent',
    params: 'first',
    import: 'python',
    builtins: COMMON_BUILTINS,
  },
  go: {
    id: 'go',
    label: 'Go',
    exts: ['go'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['```', '```', ''], ['`', '`', ''], ['"', '"', '\\']],
    braces: KEYWORD,
    keyword: 'func',
    receiver: true,
    params: 'first',
    import: 'go',
    builtins: COMMON_BUILTINS,
  },
  java: {
    id: 'java',
    label: 'Java',
    exts: ['java'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['"""', '"""', '\\'], ['"', '"', '\\'], ["'", "'", '\\']],
    braces: STRUCTURAL,
    params: 'last',
    import: 'java',
    builtins: COMMON_BUILTINS,
  },
  csharp: {
    id: 'csharp',
    label: 'C#',
    exts: ['cs'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['@"', '"', '""'], ['"', '"', '\\'], ["'", "'", '\\']],
    braces: STRUCTURAL,
    params: 'last',
    import: 'csharp',
    builtins: COMMON_BUILTINS,
  },
  rust: {
    id: 'rust',
    label: 'Rust',
    exts: ['rs'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['r#"', '"#', ''], ['r"', '"', ''], ['"', '"', '\\'], ["'", "'", '\\']],
    braces: KEYWORD,
    keyword: 'fn',
    params: 'first',
    import: 'rust',
    builtins: COMMON_BUILTINS,
  },
  kotlin: {
    id: 'kotlin',
    label: 'Kotlin',
    exts: ['kt', 'kts'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['"""', '"""', ''], ['"', '"', '\\'], ["'", "'", '\\']],
    braces: KEYWORD,
    keyword: 'fun',
    params: 'first',
    import: 'kotlin',
    builtins: COMMON_BUILTINS,
  },
  swift: {
    id: 'swift',
    label: 'Swift',
    exts: ['swift'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    strings: [['"""', '"""', '\\'], ['"', '"', '\\']],
    braces: KEYWORD,
    keyword: 'func',
    params: 'first',
    import: 'swift',
    builtins: COMMON_BUILTINS,
  },
}

/** Row used for files whose language has no dedicated row. */
const GENERIC = {
  id: 'generic',
  label: 'Code',
  exts: [],
  lineComments: ['//', '#'],
  blockComments: [['/*', '*/']],
  strings: [['"""', '"""', '\\'], ["'''", "'''", '\\'], ['`', '`', ''], ['"', '"', '\\'], ["'", "'", '\\']],
  braces: STRUCTURAL,
  params: 'last',
  import: 'none',
  builtins: COMMON_BUILTINS,
}

/** Extension → language id, built once from the table. */
const BY_EXTENSION = new Map()
for (const row of Object.values(LANGUAGES)) {
  for (const ext of row.exts) BY_EXTENSION.set(ext, row.id)
}

/**
 * Language id of a path, or `generic` for an unknown text file extension.
 * @param {string} pathOrExt - file path or bare extension.
 */
export function languageOfPath(pathOrExt) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(pathOrExt))
  const ext = match === null ? String(pathOrExt).replace(/^\./, '').toLowerCase() : match[1].toLowerCase()
  return BY_EXTENSION.get(ext) ?? 'generic'
}

/**
 * Whether a path is a code file the extractor can draw blocks for.
 * @param {string} path - candidate file path.
 */
export function isCodePath(path) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(path))
  if (match === null) return false
  return BY_EXTENSION.has(match[1].toLowerCase())
}

/**
 * Resolve one language row.
 * @param {string} lang - language id, extension, or path.
 */
export function languageRow(lang) {
  const value = String(lang ?? '').toLowerCase()
  if (LANGUAGES[value] !== undefined) return LANGUAGES[value]
  const byPath = languageOfPath(value)
  return LANGUAGES[byPath] ?? GENERIC
}

/** Control-flow words that cannot start a declaration. */
export const CONTROL_WORDS = new Set(CONTROL)
