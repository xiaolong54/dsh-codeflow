/**
 * Generic multi-language block extractor.
 *
 * The engine is language-agnostic: it masks comments and string bodies (keeping
 * offsets), walks lines, and asks the language row how a declaration looks.
 * Everything after that — parameters, calls, data producers, return values — is
 * shared textual analysis, so a new language is a table edit in `langs.js`
 * rather than a new parser.
 *
 * Accuracy assumption: the code follows the project convention the plugin
 * ships (named functions, explicit parameters, no reflection rewriting call
 * sites). A call the engine cannot resolve is recorded on the caller as an
 * external call instead of being drawn as a wrong edge, so the project layer
 * can resolve it or report it.
 */

import { languageRow, CONTROL_WORDS } from './langs.js'
import { trimLabel } from './text.js'

/**
 * Lines that open a type: the methods inside them belong to that type.
 *
 * The pattern is anchored to the start of the line and allows only modifiers
 * before the keyword. A loose pattern would match Go's `record string`
 * parameter and swallow the declaration that carries it.
 *
 * Go is not here on purpose — a Go method carries its receiver type in its
 * own header, so the receiver decides the owner instead of the block.
 */
const CLASS_PATTERN = /^\s*(?:(?:public|private|protected|internal|open|final|abstract|sealed|static|export|pub|data|@\w+)\s+)*(?:class|interface|record|object|trait|enum|actor|extension|struct)\s+([A-Za-z_]\w*)/
/** Go writes `type Service struct { … }`. */
const GO_TYPE_PATTERN = /^\s*type\s+([A-Za-z_]\w*)\s+struct\b/
/** Rust writes the type in an `impl` block, optionally after a trait. */
const IMPL_PATTERN = /^\s*impl\s+(?:[\w:<>,\s]+\s+for\s+)?([A-Za-z_]\w*)/

/** The names a language gives to a constructor. */
const CONSTRUCTOR_NAMES = new Set(['new', 'init', 'constructor'])

/** Index of the line that holds a character offset. */
function lineOf(lines, offset) {
  for (let index = 0; index < lines.length; index++) {
    if (offset >= lines[index].start && offset <= lines[index].end) return index
  }
  return -1
}

/** The type whose body holds a line, innermost first. */
function ownerAt(typeRanges, lineIndex) {
  let owner
  let from = -1
  for (const range of typeRanges) {
    if (lineIndex < range.from || lineIndex > range.to) continue
    if (range.from > from) {
      from = range.from
      owner = range.name
    }
  }
  return owner
}

/** Blank comments and string bodies while preserving every offset. */
function maskSource(text, row) {
  const chars = [...text]
  const n = text.length
  const blank = (from, to) => {
    for (let index = from; index < to && index < n; index++) {
      if (chars[index] !== '\n') chars[index] = ' '
    }
  }
  const strings = [...row.strings].sort((left, right) => right[0].length - left[0].length)
  let index = 0
  while (index < n) {
    let matched = false
    for (const [open, close] of row.blockComments) {
      if (!text.startsWith(open, index)) continue
      const end = text.indexOf(close, index + open.length)
      const stop = end === -1 ? n : end + close.length
      blank(index, stop)
      index = stop
      matched = true
      break
    }
    if (matched) continue
    for (const open of row.lineComments) {
      if (!text.startsWith(open, index)) continue
      const end = text.indexOf('\n', index)
      const stop = end === -1 ? n : end
      blank(index, stop)
      index = stop
      matched = true
      break
    }
    if (matched) continue
    for (const [open, close, escape] of strings) {
      if (!text.startsWith(open, index)) continue
      const start = index
      let cursor = index + open.length
      while (cursor < n) {
        if (escape.length > 0 && text.startsWith(escape, cursor)) { cursor += escape.length + 1; continue }
        if (text.startsWith(close, cursor)) { cursor += close.length; break }
        cursor++
      }
      blank(start + open.length, Math.max(start + open.length, cursor - close.length))
      index = cursor
      matched = true
      break
    }
    if (matched) continue
    index++
  }
  return chars.join('')
}

/** Index of the bracket that closes the one at `open`, or -1. */
function matchPair(text, open, opener, closer) {
  let depth = 0
  for (let index = open; index < text.length; index++) {
    const char = text[index]
    if (char === opener) depth++
    else if (char === closer) {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

/** Skip whitespace from `from`. */
function skipSpace(text, from) {
  let index = from
  while (index < text.length && /\s/.test(text[index])) index++
  return index
}

/** Index of a whole-word keyword at or after `from`, or -1. */
function wordIndex(text, word, from = 0) {
  const pattern = new RegExp(`\\b${word}\\b`, 'g')
  pattern.lastIndex = from
  const match = pattern.exec(text)
  return match === null ? -1 : match.index
}

/**
 * Split `from..to` on top-level commas.
 *
 * The name says what it works on: this one reads masked text, while the
 * JavaScript tokenizer has its own over a token stream. The browser bundle
 * puts both modules in one scope, so the names must not collide.
 */
function splitMaskedTopLevel(masked, from, to) {
  const parts = []
  let start = from
  let depth = 0
  for (let index = from; index < to; index++) {
    const char = masked[index]
    if (char === '(' || char === '[' || char === '{' || char === '<') depth++
    else if (char === ')' || char === ']' || char === '}' || char === '>') depth = Math.max(0, depth - 1)
    else if (char === ',' && depth === 0) {
      parts.push([start, index])
      start = index + 1
    }
  }
  if (to > from) parts.push([start, to])
  return parts
}

/** One parameter name/type from a masked slice. */
function parseParam(masked, from, to, row) {
  const part = masked.slice(from, to)
  if (part.trim().length === 0) return undefined
  const identifiers = [...part.matchAll(/[A-Za-z_]\w*/g)].map(match => match[0])
  if (identifiers.length === 0) return undefined
  if (identifiers.every(name => CONTROL_WORDS.has(name))) return undefined
  const colon = part.indexOf(':')
  let name
  if (colon >= 0 && row.params !== 'last') name = identifiers[0]
  else if (colon >= 0) name = identifiers[identifiers.length - 1]
  else name = row.params === 'last' ? identifiers[identifiers.length - 1] : identifiers[0]
  if (name === undefined) return undefined
  let type
  if (colon >= 0) type = trimLabel(part.slice(colon + 1).trim())
  return { name, type: type === undefined || type.length === 0 ? undefined : type }
}

/**
 * The comment block just above a declaration, as one description.
 *
 * The whole leading paragraph is kept — it is what the block is *for* — and
 * lines that look like tags are dropped.
 *
 * @param {string} text - the file's source.
 * @param {number} lineStart - the declaration's first line.
 * @returns {string | undefined} the description.
 */
function docBeforeLine(text, lineStart) {
  const lines = []
  let cursor = lineStart
  for (let step = 0; step < 12; step++) {
    const previousEnd = cursor - 1
    if (previousEnd <= 0) break
    const previousStart = text.lastIndexOf('\n', previousEnd - 1) + 1
    const line = text.slice(previousStart, previousEnd).trim()
    if (line.length === 0) {
      // A blank line ends the paragraph, unless nothing was collected yet.
      if (lines.length > 0) break
      cursor = previousStart
      continue
    }
    if (!/^(\/\/|#|\*|\/\*)/.test(line)) break
    const stripped = line.replace(/^(\/\/+|#+|\*+|\/\*+)\s?/, '').replace(/\*+\/$/, '').trim()
    if (stripped.startsWith('@')) break
    if (stripped.length > 0) lines.unshift(stripped)
    cursor = previousStart
  }
  return lines.length === 0 ? undefined : trimLabel(lines.join(' '), 160)
}

/** Detect a keyword-language declaration on one masked line. */
function detectKeywordLine(lineMask, lineOffset, row) {
  const index = wordIndex(lineMask, row.keyword)
  if (index < 0) return undefined
  if (/[.>]$/.test(lineMask.slice(0, index).trimEnd())) return undefined
  let cursor = skipSpace(lineMask, index + row.keyword.length)
  let receiver
  let receiverName
  if (row.receiver === true && lineMask[cursor] === '(') {
    const close = matchPair(lineMask, cursor, '(', ')')
    if (close < 0) return undefined
    // `func (s *Service) Save()` — the receiver's type owns the method, and
    // the receiver's name is the variable the method works on.
    const inside = lineMask.slice(cursor + 1, close).replace(/\[[^\]]*\]/g, '').trim()
    const typeMatch = /([A-Za-z_]\w*)\s*$/.exec(inside)
    receiver = typeMatch === null ? undefined : typeMatch[1]
    const nameMatch = /^\*?\s*([A-Za-z_]\w*)/.exec(inside)
    receiverName = nameMatch === null ? undefined : nameMatch[1]
    cursor = skipSpace(lineMask, close + 1)
  }
  if (lineMask[cursor] === '<') {
    const close = matchPair(lineMask, cursor, '<', '>')
    if (close < 0) return undefined
    cursor = skipSpace(lineMask, close + 1)
  }
  const nameMatch = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*/.exec(lineMask.slice(cursor))
  if (nameMatch === null) return undefined
  const qualified = nameMatch[0]
  const name = qualified.includes('.') ? qualified.split('.').pop() : qualified
  let afterName = skipSpace(lineMask, cursor + qualified.length)
  if (lineMask[afterName] === '<') {
    const close = matchPair(lineMask, afterName, '<', '>')
    if (close < 0) return undefined
    afterName = skipSpace(lineMask, close + 1)
  }
  if (lineMask[afterName] !== '(') return undefined
  return { name, parenOpen: lineOffset + afterName, receiver, receiverName }
}

/** Detect a Java/C#-style declaration on one masked line. */
function detectStructuralLine(lineMask, lineOffset) {
  const trimmed = lineMask.trim()
  if (trimmed.length === 0 || trimmed.startsWith('@')) return undefined
  const head = /^[A-Za-z_]\w*/.exec(trimmed)
  if (head !== null && CONTROL_WORDS.has(head[0])) return undefined
  const openInTrimmed = trimmed.indexOf('(')
  if (openInTrimmed < 0) return undefined
  const before = trimmed.slice(0, openInTrimmed)
  const nameMatch = /([A-Za-z_]\w*)\s*(?:<[^<>()]*>)?\s*$/.exec(before)
  if (nameMatch === null) return undefined
  const name = nameMatch[1]
  if (CONTROL_WORDS.has(name)) return undefined
  const nameStart = openInTrimmed - nameMatch[0].length + nameMatch[0].indexOf(name)
  const prefix = before.slice(0, nameStart).trimEnd()
  if (prefix.length > 0 && /[.>]$/.test(prefix)) return undefined
  if (/(^|\s)(new|return|throw|await|yield|case)$/.test(prefix)) return undefined
  if (prefix.includes('=') && !prefix.includes('=>')) return undefined
  if (prefix.includes('.')) return undefined
  // A `(` in front of the name means the line is a call inside an argument
  // list, not a declaration.
  if (prefix.includes('(')) return undefined
  const indent = lineMask.length - lineMask.trimStart().length
  return { name, parenOpen: lineOffset + indent + openInTrimmed }
}

/**
 * Find the body of a declaration.
 * Returns `{ start, end }` (offsets between which the body text lives) for a
 * block body, an expression body (`=> expr`, C#/Rust-style), or a Kotlin
 * `= expr` body; `undefined` when the declaration has no body.
 */
function findBody(masked, from, row) {
  for (let index = from; index < masked.length && index < from + 600; index++) {
    const char = masked[index]
    if (char === '{') {
      const close = matchPair(masked, index, '{', '}')
      if (close < 0) return undefined
      return { start: index + 1, end: close }
    }
    if (char === ';' || char === '}' || char === '(') return undefined
    if (char === '=' && masked[index + 1] === '>') {
      return { start: index + 2, end: endOfExpression(masked, index + 2) }
    }
    if (row.id === 'kotlin' && char === '=' && !['=', '>', '<', '!'].includes(masked[index - 1])) {
      return { start: index + 1, end: endOfExpression(masked, index + 1) }
    }
  }
  return undefined
}

/** End offset of one expression body: the `;` or the end of its line. */
function endOfExpression(masked, from) {
  let depth = 0
  for (let index = from; index < masked.length; index++) {
    const char = masked[index]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth = Math.max(0, depth - 1)
    else if (char === ';' && depth === 0) return index
    else if (char === '\n' && depth === 0) return index
  }
  return masked.length
}

/** Whether a declaration line marks an exported/public block. */
function isExported(lineMask, name, row) {
  if (row.id === 'rust') return /\bpub\b/.test(lineMask)
  if (row.id === 'java' || row.id === 'csharp') return /\bpublic\b/.test(lineMask)
  if (row.id === 'go') return /^[A-Z]/.test(name)
  if (row.id === 'javascript' || row.id === 'typescript') return /\bexport\b/.test(lineMask)
  return true
}

/**
 * Analyse one function body: calls with the value each call carries, the
 * returned values, and the type of the local variables.
 *
 * The variable types matter because they decide where a call lands:
 * `service.process(...)` is a method of the type of `service`, not a method
 * of the class the call sits in.
 */
function analyzeMaskedBody(masked, text, bodyFrom, bodyTo) {
  const calls = []
  const producers = new Map()
  const bodyMask = masked.slice(bodyFrom, bodyTo)
  for (const match of bodyMask.matchAll(/([A-Za-z_]\w*)\s*(?::=|=)(?!=)\s*([A-Za-z_]\w*)\s*\(/g)) {
    if (match[1] !== match[2]) producers.set(match[1], match[2])
  }
  // The type of every local variable the body declares.
  const varTypes = new Map()
  // `Type name = new Type(...)` — Java, C#, Kotlin, Swift.
  for (const match of bodyMask.matchAll(/\b([A-Z][A-Za-z0-9_]*)\s+([a-z_][A-Za-z0-9_]*)\s*=\s*new\s+([A-Z][A-Za-z0-9_]*)/g)) {
    if (!varTypes.has(match[2])) varTypes.set(match[2], { type: match[3] })
  }
  // `val name: Type = ...` / `let name = Type(...)` — Kotlin, Swift.
  for (const match of bodyMask.matchAll(/\b(?:val|var|let)\s+([a-z_][A-Za-z0-9_]*)\s*(?::\s*([A-Z][A-Za-z0-9_]*))?\s*=\s*(?:new\s+)?([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    const type = match[2] ?? match[3]
    if (type !== undefined && !varTypes.has(match[1])) varTypes.set(match[1], { type })
  }
  // `name := NewType(...)` — Go. The type comes from the constructor's
  // return type, which the project layer knows.
  for (const match of bodyMask.matchAll(/\b([a-z_][A-Za-z0-9_]*)\s*:=\s*([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    if (!varTypes.has(match[1])) varTypes.set(match[1], { constructor: match[2] })
  }
  // `name := &Type{}` — Go.
  for (const match of bodyMask.matchAll(/\b([a-z_][A-Za-z0-9_]*)\s*:=\s*&?([A-Z][A-Za-z0-9_]*)\s*\{/g)) {
    if (!varTypes.has(match[1])) varTypes.set(match[1], { type: match[2] })
  }
  for (const match of bodyMask.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
    const name = match[1]
    // `new` is a keyword in Java and C#, but a call in Rust: `Service::new`.
    if (name !== 'new' && CONTROL_WORDS.has(name)) continue
    const open = bodyFrom + match.index + match[0].length - 1
    const close = matchPair(masked, open, '(', ')')
    if (close < 0) continue
    const lead = bodyMask.slice(Math.max(0, match.index - 40), match.index)
    if (/\b(function|func|fn|fun|def)\s*$/.test(lead)) continue
    // The object a call goes through: `this.run()`, `Service.run()`.
    const receiverMatch = /([A-Za-z_]\w*)\s*(?:\.|::)\s*$/.exec(lead)
    const receiver = receiverMatch === null ? undefined : receiverMatch[1]
    // `new Foo(...)` builds an instance: the constructor is the block that
    // receives the arguments. Kotlin and Swift write `Foo(...)` instead, and
    // their types start with a capital letter.
    const construction = /\bnew\s+$/.test(lead)
      || (receiver === undefined && /^[A-Z][A-Za-z0-9_]*$/.test(name) && /^\s*(?:new\s+)?[A-Z][A-Za-z0-9_]*\s*$/.test(lead))
    const args = splitMaskedTopLevel(masked, open + 1, close)
    let payload
    for (const [from, to] of args) {
      const value = masked.slice(from, to).trim()
      if (value.length === 0) continue
      const single = /^[A-Za-z_]\w*$/.test(value)
      if (single) {
        const producer = producers.get(value)
        if (producer !== undefined && producer !== name) { payload = { producer, label: value }; break }
        continue
      }
      const nested = /^([A-Za-z_]\w*)\s*\(/.exec(value)
      if (nested !== null && nested[1] !== name) { payload = { producer: nested[1], label: value }; break }
    }
    calls.push({
      name,
      receiver,
      construction,
      line: 1 + (text.slice(0, open).match(/\n/g)?.length ?? 0),
      payload,
    })
  }  const returns = [...bodyMask.matchAll(/\breturn\b\s*([^;\n}]*)/g)]
    .map(match => match[1].trim())
    .filter(value => value.length > 0)
    .slice(0, 2)
  const outputs = []
  for (const value of returns) {
    if (/^[A-Za-z_]\w*$/.test(value)) outputs.push(value)
    else if (/^[A-Za-z_]\w*\s*\(/.test(value)) outputs.push('result')
    else if (/^[[{(]/.test(value)) outputs.push('object')
    else if (/^(null|None|nil|undefined|void|\(\)|self)$/.test(value)) continue
    else outputs.push('value')
  }
  return { calls, outputs: [...new Set(outputs)], varTypes }
}

/** Best-effort import table: local name → { imported, spec }. */
function parseImports(masked, row) {
  const imports = new Map()
  const add = (local, imported, spec) => {
    if (typeof local !== 'string' || local.length === 0) return
    imports.set(local, { imported: imported ?? local, spec: spec ?? '' })
  }
  if (row.import === 'js') {
    for (const match of masked.matchAll(/import\s+([^;]+?)\s+from\s+'(?:[^']+)'|import\s+([^;]+?)\s+from\s+"([^"]+)"/g)) {
      const clause = (match[1] ?? match[2] ?? '').trim()
      const spec = match[3] ?? ''
      if (clause.startsWith('{')) {
        for (const part of clause.replace(/[{}]/g, '').split(',')) {
          const [imported, local] = part.trim().split(/\s+as\s+/)
          if (imported !== undefined && imported.length > 0) add((local ?? imported).trim(), imported.trim(), spec)
        }
      } else if (clause.startsWith('*')) {
        const alias = /as\s+([A-Za-z_]\w*)/.exec(clause)
        if (alias !== null) add(alias[1], '*', spec)
      } else {
        add(clause, 'default', spec)
      }
    }
    for (const match of masked.matchAll(/(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]/g)) {
      for (const part of match[1].split(',')) {
        const [imported, local] = part.trim().split(/\s*:\s*/)
        if (imported !== undefined && imported.length > 0) add((local ?? imported).trim(), imported.trim(), match[2])
      }
    }
    for (const match of masked.matchAll(/(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*require\(\s*['"]([^'"]+)['"]/g)) {
      add(match[1], '*', match[2])
    }
    return imports
  }
  if (row.import === 'python') {
    for (const match of masked.matchAll(/from\s+([\w.]+)\s+import\s+([^\n]+)/g)) {
      for (const part of match[2].split(',')) {
        const [imported, local] = part.trim().split(/\s+as\s+/)
        if (imported !== undefined && imported.length > 0) add((local ?? imported).trim(), imported.trim(), match[1])
      }
    }
    for (const match of masked.matchAll(/^import\s+([\w.]+)(?:\s+as\s+([A-Za-z_]\w*))?/gm)) {
      add(match[2] ?? match[1].split('.').pop(), '*', match[1])
    }
    return imports
  }
  if (row.import === 'go') {
    for (const match of masked.matchAll(/import\s+(?:([A-Za-z_]\w*)\s+)?"([^"]+)"/g)) {
      add(match[1] ?? match[2].split('/').pop(), '*', match[2])
    }
    const block = /import\s*\(([\s\S]*?)\)/.exec(masked)
    if (block !== null) {
      for (const match of block[1].matchAll(/(?:([A-Za-z_]\w*)\s+)?"([^"]+)"/g)) {
        add(match[1] ?? match[2].split('/').pop(), '*', match[2])
      }
    }
    return imports
  }
  if (row.import === 'rust') {
    for (const match of masked.matchAll(/use\s+([\w:{}]+)/g)) {
      const path = match[1]
      const leaf = (path.split('::').pop() ?? '').replace(/[{}]/g, '')
      add(leaf, '*', path)
    }
    return imports
  }
  for (const match of masked.matchAll(/(?:import|using)\s+([\w.]+)/g)) {
    const leaf = match[1].split('.').pop() ?? match[1]
    add(leaf, '*', match[1])
  }
  return imports
}

/** Build one file's graph. */
export function extractFile(text, langId) {
  const row = languageRow(langId)
  const masked = maskSource(text, row)
  const lines = []
  let start = 0
  for (let index = 0; index <= text.length; index++) {
    if (index === text.length || text[index] === '\n') {
      lines.push({ start, end: index })
      start = index + 1
    }
  }

  // Brace depth at the start of every line: it says which block a line is in,
  // and therefore which class owns a method.
  const depths = []
  {
    let depth = 0
    for (const line of lines) {
      depths.push(depth)
      for (const char of masked.slice(line.start, line.end)) {
        if (char === '{') depth++
        else if (char === '}') depth = Math.max(0, depth - 1)
      }
    }
  }

  const nodes = []
  const edges = []
  const seenNames = new Set()
  const callCounts = new Map()
  const edgeKeys = new Set()
  const pushEdge = (from, to, kind, label, via) => {
    if (from === to) return
    const key = `${from}|${to}|${kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ from, to, kind, label: label ?? undefined, via })
  }

  // Pass 1: collect every declaration so calls can resolve forwards.
  const declarations = []
  const classes = new Set()
  // The line range each type's body covers: a method belongs to the type
  // whose body holds it.
  const typeRanges = []
  const typeLines = new Set()
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const lineMask = masked.slice(lines[lineIndex].start, lines[lineIndex].end)
    const match = CLASS_PATTERN.exec(lineMask) ?? GO_TYPE_PATTERN.exec(lineMask) ?? IMPL_PATTERN.exec(lineMask)
    if (match === null) continue
    // The body of a type starts at the first brace of its header, which is
    // often on the header's own line.
    const bodyOpen = masked.indexOf('{', lines[lineIndex].start)
    if (bodyOpen < 0) continue
    const bodyClose = matchPair(masked, bodyOpen, '{', '}')
    if (bodyClose < 0) continue
    typeLines.add(lineIndex)
    classes.add(match[1])
    typeRanges.push({ name: match[1], from: lineOf(lines, bodyOpen), to: lineOf(lines, bodyClose) })
  }
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]
    const lineMask = masked.slice(line.start, line.end)
    if (lineMask.trim().length === 0) continue
    if (typeLines.has(lineIndex)) continue
    let declaration = row.braces === 'keyword'
      ? detectKeywordLine(lineMask, line.start, row)
      : detectStructuralLine(lineMask, line.start)
    if (declaration === undefined && row.id === 'swift') {
      // Swift spells the constructor `init(...)`.
      const initMatch = /^\s*(?:(?:public|private|internal|fileprivate|open|override|mutating|convenience|required)\s+)*init\s*[?!]?\s*\(/.exec(lineMask)
      if (initMatch !== null) {
        const open = lineMask.indexOf('(', initMatch.index)
        declaration = { name: 'constructor', parenOpen: line.start + open }
      }
    }
    if (declaration === undefined && row.id === 'kotlin') {
      // Kotlin spells the constructor `constructor(...)`.
      const ctorMatch = /^\s*(?:(?:public|private|protected|internal|open|override)\s+)*constructor\s*\(/.exec(lineMask)
      if (ctorMatch !== null) {
        const open = lineMask.indexOf('(', ctorMatch.index)
        declaration = { name: 'constructor', parenOpen: line.start + open }
      }
    }
    if (declaration === undefined) continue

    // The owner of a method: the receiver's type in Go, the enclosing type
    // elsewhere. A method is named `Owner.method`, because that is how it is
    // called and how it must be told apart from a namesake in another type.
    const scope = declaration.receiver ?? ownerAt(typeRanges, lineIndex)
    // A constructor is the type's own body. Java and C# name it after the
    // type, Rust names it `new`, Swift names it `init`; all three are the
    // block `Owner.constructor`, so the map reads the same everywhere.
    const isConstructor = scope !== undefined && (
      declaration.name === scope
      || declaration.name === 'constructor'
      || (row.id === 'rust' && declaration.name === 'new')
    )
    const methodName = isConstructor ? 'constructor' : declaration.name
    const name = scope === undefined ? declaration.name : `${scope}.${methodName}`
    if (seenNames.has(name)) continue

    const parenClose = matchPair(masked, declaration.parenOpen, '(', ')')
    if (parenClose < 0) continue
    const body = findBody(masked, parenClose + 1, row)
    if (body === undefined) continue

    seenNames.add(name)
    declarations.push({
      name,
      // The constructor is the class's own body: it is a block, but it is not
      // a method someone renames.
      kind: scope === undefined ? 'function' : (isConstructor ? 'entry' : 'method'),
      owner: scope,
      receiverName: declaration.receiverName,
      lineIndex,
      lineStart: line.start,
      lineMask,
      params: splitMaskedTopLevel(masked, declaration.parenOpen + 1, parenClose)
        .map(([from, to]) => parseParam(masked, from, to, row))
        .filter(param => param !== undefined),
      body,
      exported: isExported(lineMask, name, row),
    })

    // Nested declarations are not blocks of this file: skip the body.
    const consumed = text.slice(line.start, body.end + 1).split('\n').length
    lineIndex += Math.max(0, consumed - 1)
  }

  const byName = new Map()
  for (const declaration of declarations) {
    const node = {
      id: `fn:${declaration.name}`,
      name: declaration.name,
      kind: declaration.kind,
      line: declaration.lineIndex + 1,
      params: declaration.params,
      outputs: [],
      doc: docBeforeLine(text, declaration.lineStart),
      start: declaration.lineStart,
      end: declaration.body.end,
      bodyStart: declaration.body.start,
      bodyEnd: declaration.body.end,
      owner: declaration.owner,
      receiverName: declaration.receiverName,
      calls: [],
      openCalls: [],
      externalCalls: [],
      exported: declaration.exported,
    }
    nodes.push(node)
    byName.set(node.name, node)
  }

  // Pass 2: analyse each body now that every name is known.
  for (const node of nodes) {
    const analysed = analyzeMaskedBody(masked, text, node.bodyStart, node.bodyEnd)
    node.outputs = analysed.outputs
    const varTypes = analysed.varTypes ?? new Map()
    // In Go the receiver is a variable of the method's own type, so
    // `s.Describe(...)` inside `func (s *Service) Process` is a method of
    // `Service`.
    const receiverTypes = new Map()
    if (node.receiverName !== undefined && node.owner !== undefined) {
      receiverTypes.set(node.receiverName, { type: node.owner })
    }
    for (const call of analysed.calls) {
      if (call.name === node.name) continue
      // Where the callee lives.
      //
      // - `new Foo(...)` builds an instance: the constructor is the block
      //   that receives the arguments.
      // - `this.run()` is a method of the class the call sits in.
      // The names the callee may be known by, in the order they are tried.
      //
      // - `new Foo(...)` and `Foo(...)` build an instance: the constructor is
      //   the block that receives the arguments.
      // - `this.run()` is a method of the class the call sits in.
      // - `Service.run()` is a method of the named class, whether that class
      //   is in this file or another one.
      // - `service.run()` is a method of the type of `service`, which the
      //   body declares.
      // - a bare `run()` is a free function, unless the class the call sits
      //   in has a method of that name.
      const candidates = []
      if (call.construction === true) {
        candidates.push(`${call.name}.constructor`)
      } else if (call.receiver === 'this' || call.receiver === 'self') {
        if (node.owner !== undefined) candidates.push(`${node.owner}.${call.name}`)
      } else if (call.receiver !== undefined) {
        const variable = varTypes.get(call.receiver) ?? receiverTypes.get(call.receiver)
        if (variable !== undefined && variable.type !== undefined) {
          candidates.push(`${variable.type}.${call.name}`)
        } else if (variable !== undefined && variable.constructor !== undefined) {
          // The type comes from the constructor's return type, which only the
          // project level knows; the name it needs is the class name.
          candidates.push(`${variable.constructor.replace(/^New/, '')}.${call.name}`)
        } else if (classes.has(call.receiver) || /^[A-Z]/.test(call.receiver)) {
          // A type name: `Service.make(...)` is a method of `Service`.
          candidates.push(`${call.receiver}.${call.name}`)
        }
        // `Service::new(...)` in Rust builds an instance too.
        if (CONSTRUCTOR_NAMES.has(call.name)) candidates.push(`${call.receiver}.constructor`)
      } else {
        candidates.push(call.name)
        if (node.owner !== undefined) candidates.push(`${node.owner}.${call.name}`)
        // `Service(...)` in Kotlin and Swift builds an instance.
        if (/^[A-Z]/.test(call.name)) candidates.push(`${call.name}.constructor`)
      }
      let target
      let lookup = call.name
      for (const candidate of candidates) {
        const found = byName.get(candidate)
        if (found === undefined) continue
        target = found
        lookup = candidate
        break
      }
      node.calls.push({
        name: lookup,
        // Every name the callee may be known by, in the order they are
        // tried. The project level needs them: the callee may live in
        // another file, where only its name is known.
        candidates,
        line: call.line,
        payload: call.payload,
        resolved: target !== undefined,
        construction: call.construction === true,
      })
      if (target === undefined) {
        // A call through an object usually reaches a library, not a block of
        // this project, so it is not noise; the project level may still find
        // a block of that name in another file.
        if (call.receiver === undefined && !call.construction) {
          if (!node.externalCalls.includes(call.name)) node.externalCalls.push(call.name)
        }
        node.openCalls.push({
          name: lookup,
          candidates,
          line: call.line,
          payload: call.payload,
        })
        continue
      }
      if (call.payload !== undefined) {
        const producer = byName.get(call.payload.producer)
          ?? (node.owner === undefined ? undefined : byName.get(`${node.owner}.${call.payload.producer}`))
        if (producer === undefined) {
          if (!node.externalCalls.includes(call.payload.producer)) node.externalCalls.push(call.payload.producer)
          pushEdge(node.id, target.id, 'call')
        } else {
          // One edge per call site: a traced value is the data edge; the plain
          // call edge is only for calls that pass no traceable value.
          pushEdge(producer.id, target.id, 'data', trimLabel(call.payload.label), call.payload.producer)
        }
      } else {
        pushEdge(node.id, target.id, 'call')
      }
      callCounts.set(target.id, (callCounts.get(target.id) ?? 0) + 1)
    }
  }

  for (const node of nodes) node.refCount = callCounts.get(node.id) ?? 0
  return { lang: row.id, row, nodes, edges, imports: parseImports(masked, row), externals: collectExternals(nodes) }
}

/** All distinct external call names of a file. */
function collectExternals(nodes) {
  const names = new Set()
  for (const node of nodes) for (const name of node.externalCalls) names.add(name)
  return [...names]
}
