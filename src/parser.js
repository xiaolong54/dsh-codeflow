/**
 * Code → data-flow graph parser.
 *
 * JavaScript/TypeScript use a token scan (arrow functions and expression bodies
 * need it), Python uses an indentation scan, and every other language goes
 * through the generic extractor in `extract.js`. All three produce the same
 * node/edge shape, so the canvas and the project layer do not care which one
 * ran.
 *
 * The module is dependency-free plain JavaScript so it can run both in the
 * browser (inlined into the Client bundle) and under Node for tests.
 */

import { trimLabel, lineAt } from './text.js'
import { extractFile } from './extract.js'
import { LANGUAGES } from './langs.js'

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'do',
  'else', 'try', 'finally', 'with', 'case', 'default', 'delete', 'in', 'of', 'instanceof',
  'void', 'throw', 'yield', 'await', 'async', 'class', 'const', 'let', 'var',
  // A dynamic `import(...)` loads a module; it calls no block of the project.
  'import',
])

/**
 * Tokenize JavaScript / TypeScript.
 * Every token records the brace depth it starts at, so a body can be matched
 * by comparing depths.
 */
function tokenizeJs(code) {
  const tokens = []
  const n = code.length
  let i = 0
  let depth = 0
  // The last token that is not a comment: it decides whether a `/` opens a
  // regular expression or divides.
  let previous
  while (i < n) {
    const c = code[i]
    const next = code[i + 1]
    if (c === '/' && next === '/') {
      const s = i
      while (i < n && code[i] !== '\n') i++
      tokens.push({ t: 'comment', v: code.slice(s, i), s, e: i, d: depth })
      continue
    }
    if (c === '/' && next === '*') {
      const s = i
      i += 2
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++
      i = Math.min(n, i + 2)
      tokens.push({ t: 'comment', v: code.slice(s, i), s, e: i, d: depth })
      continue
    }
    // A regular expression is one token: its brackets and parentheses are
    // part of the pattern, and a tokenizer that reads them as code ends the
    // wrong function body — and then every call after it belongs to the
    // wrong block.
    if (c === '/' && opensRegex(previous)) {
      const s = i
      i++
      let inClass = false
      while (i < n) {
        const ch = code[i]
        if (ch === '\\') {
          i += 2
          continue
        }
        if (ch === '[') inClass = true
        else if (ch === ']') inClass = false
        else if (ch === '/' && !inClass) {
          i++
          break
        } else if (ch === '\n') break
        i++
      }
      const token = { t: 'regex', v: code.slice(s, i), s, e: i, d: depth }
      tokens.push(token)
      previous = token
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const s = i
      i = skipString(code, i)
      const token = { t: 'str', v: code.slice(s, i), s, e: i, d: depth }
      tokens.push(token)
      previous = token
      continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      const s = i
      while (i < n && /[A-Za-z0-9_$]/.test(code[i])) i++
      const token = { t: 'id', v: code.slice(s, i), s, e: i, d: depth }
      tokens.push(token)
      previous = token
      continue
    }
    if (/[0-9]/.test(c)) {
      const s = i
      while (i < n && /[0-9A-Za-z_.]/.test(code[i])) i++
      const token = { t: 'num', v: code.slice(s, i), s, e: i, d: depth }
      tokens.push(token)
      previous = token
      continue
    }
    if (c === '{') {
      const token = { t: 'punc', v: '{', s: i, e: i + 1, d: depth }
      tokens.push(token)
      previous = token
      depth++
      i++
      continue
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1)
      const token = { t: 'punc', v: '}', s: i, e: i + 1, d: depth }
      tokens.push(token)
      previous = token
      i++
      continue
    }
    if (c === '=' && next === '>') {
      const token = { t: 'punc', v: '=>', s: i, e: i + 2, d: depth }
      tokens.push(token)
      previous = token
      i += 2
      continue
    }
    if (/\s/.test(c)) {
      i++
      continue
    }
    const token = { t: 'punc', v: c, s: i, e: i + 1, d: depth }
    tokens.push(token)
    previous = token
    i++
  }
  return tokens
}

/**
 * Whether a `/` at this point opens a regular expression.
 *
 * A regular expression may follow an operator, an opening bracket, a comma or
 * a keyword; it may not follow a value, because there the `/` divides. The
 * distinction is the only thing that keeps a pattern's brackets from
 * unbalancing the code around it.
 *
 * @param {object | undefined} previous - the last token that was not a comment.
 * @returns {boolean} whether the `/` opens a regular expression.
 */
function opensRegex(previous) {
  if (previous === undefined) return true
  if (previous.t === 'id') return KEYWORDS.has(previous.v)
  if (previous.t === 'num' || previous.t === 'str' || previous.t === 'regex') return false
  if (previous.t === 'punc') return ![')', ']', '}', '++', '--'].includes(previous.v)
  return true
}

/** Skip one string literal starting at `from`; returns the index just past it. */
function skipString(code, from) {
  const quote = code[from]
  const n = code.length
  let i = from + 1
  if (quote === '`') {
    while (i < n) {
      const c = code[i]
      if (c === '\\') { i += 2; continue }
      if (c === '`') return i + 1
      if (c === '$' && code[i + 1] === '{') {
        let level = 1
        i += 2
        while (i < n && level > 0) {
          if (code[i] === '\\') { i += 2; continue }
          if (code[i] === '{') level++
          else if (code[i] === '}') level--
          else if (code[i] === '"' || code[i] === "'" || code[i] === '`') { i = skipString(code, i); continue }
          i++
        }
        continue
      }
      i++
    }
    return n
  }
  while (i < n) {
    const c = code[i]
    if (c === '\\') { i += 2; continue }
    if (c === quote) return i + 1
    if (c === '\n' && quote !== '`') return i
    i++
  }
  return n
}

/** Index of the token that closes the group opened at `open`. */
function matchGroup(tokens, open) {
  const openText = tokens[open].v
  const closeText = openText === '(' ? ')' : openText === '[' ? ']' : '}'
  let level = 0
  for (let k = open; k < tokens.length; k++) {
    if (tokens[k].v === openText) level++
    else if (tokens[k].v === closeText) {
      level--
      if (level === 0) return k
    }
  }
  return tokens.length - 1
}

/** Split the tokens of a parameter or argument list on top-level commas. */
function splitTopLevel(tokens, from, to) {
  const parts = []
  let start = from
  let level = 0
  for (let k = from; k <= to; k++) {
    const token = tokens[k]
    if (k === to) {
      if (to > from) parts.push([start, to])
      break
    }
    if (token.v === '(' || token.v === '[' || token.v === '{') level++
    else if (token.v === ')' || token.v === ']' || token.v === '}') level--
    else if (token.v === ',' && level === 0) {
      parts.push([start, k])
      start = k + 1
    }
  }
  return parts
}

/** Read `name` / `name?: Type` / `name: Type = value` from one parameter slice. */
function paramOf(tokens, from, to) {
  for (let k = from; k < to; k++) {
    const token = tokens[k]
    if (token.t !== 'id' || KEYWORDS.has(token.v)) continue
    let type
    for (let m = k + 1; m < to; m++) {
      if (tokens[m].v === ':') {
        type = tokens.slice(m + 1, to).map(t => t.v).join('').replace(/=$/, '').trim()
        break
      }
      if (tokens[m].v === '=') break
    }
    return { name: token.v, type: type && type.length > 0 ? trimLabel(type) : undefined }
  }
  return undefined
}

/** Text of a token slice, normalizing punctuation spacing. */
function sliceText(tokens, from, to) {
  let out = ''
  for (let k = from; k < to; k++) {
    const token = tokens[k]
    if (token.t === 'comment') continue
    if (token.v === ',' || token.v === ')') out = out.replace(/\s+$/, '')
    out += token.v
    if (token.t === 'id' || token.t === 'num') out += ' '
    if (token.v === ',') out += ' '
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Words that may sit between a doc comment and the declaration it describes.
 *
 * `export function`, `public async function` and friends put a comment
 * before the modifiers, so the search walks past them to reach it.
 */
const MODIFIERS = new Set([
  'export', 'default', 'async', 'static', 'public', 'private', 'protected',
  'abstract', 'override', 'readonly', 'declare', 'function', 'get', 'set',
])

/**
 * The comment block just before `start`, as one description.
 *
 * A description is what a reader needs to know what a block is for, so the
 * whole leading paragraph is kept — not just its first line — and JSDoc tags
 * (`@param`, `@returns`, …) are dropped because they describe the shape, not
 * the purpose.
 *
 * @param {object[]} tokens - the token stream.
 * @param {number} tokenIndex - the declaration's first token.
 * @returns {string | undefined} the description.
 */
function docBefore(tokens, tokenIndex) {
  for (let k = tokenIndex - 1; k >= 0; k--) {
    const token = tokens[k]
    if (token.t === 'comment') {
      const lines = token.v
        .replace(/^\/\*+/, '')
        .replace(/\*+\/$/, '')
        .replace(/^\s*\/\/+/, '')
        .split('\n')
        .map(line => line.replace(/^\s*\*?\s?/, '').trim())
      const kept = []
      for (const line of lines) {
        // A tag starts the structured part of a doc comment.
        if (line.startsWith('@')) break
        // A blank line ends the leading paragraph.
        if (line.length === 0 && kept.length > 0) break
        if (line.length > 0) kept.push(line)
      }
      const text = kept.join(' ').trim()
      return text.length > 0 ? trimLabel(text, 160) : undefined
    }
    if (token.t === 'id') {
      // A modifier still belongs to the declaration; keep looking.
      if (MODIFIERS.has(token.v)) continue
      return undefined
    }
    if (token.t === 'punc' || token.t === 'str' || token.t === 'num') return undefined
  }
  return undefined
}

/**
 * One call site found inside a body.
 * Without `knownNames` every call is reported, which is what cross-file
 * resolution needs; with it, only calls to that set are reported.
 */
function callSiteAt(tokens, at, knownNames) {
  const nameToken = tokens[at]
  if (nameToken.t !== 'id' || KEYWORDS.has(nameToken.v)) return undefined
  if (knownNames !== undefined && !knownNames.has(nameToken.v)) return undefined
  const open = at + 1
  if (!tokens[open] || tokens[open].v !== '(') return undefined
  const previous = tokens[at - 1]
  // `obj.method()` and `new Type()` are not project function calls — except
  // `this.method()`, which is the class calling one of its own methods.
  let own = false
  if (previous !== undefined && (previous.v === '.' || previous.v === '?.' || previous.v === 'new')) {
    const owner = tokens[at - 2]
    if (owner === undefined || owner.v !== 'this') return undefined
    own = true
  }
  const close = matchGroup(tokens, open)
  // `get(value) { … }` is a method in an object literal, not a call.
  const after = tokens[close + 1]
  if (after !== undefined && after.v === '{') return undefined
  return { name: nameToken.v, open, close, own, args: splitTopLevel(tokens, open + 1, close) }
}

/**
 * The names a body binds itself.
 *
 * A `const dispatch = () => { … }` inside a method is a local function: a
 * call to `dispatch` reaches it, not a method of the same name elsewhere.
 */
function localBindings(tokens, from, to) {
  const names = new Set()
  for (let k = from; k < to; k++) {
    const token = tokens[k]
    if (token.t !== 'id') continue
    if (token.v !== 'const' && token.v !== 'let' && token.v !== 'var') continue
    const name = tokens[k + 1]
    if (name === undefined || name.t !== 'id') continue
    names.add(name.v)
  }
  return names
}
/**
 * Analyze one function body: its calls, its assignment producers, and its
 * returned values.
 *
 * Every call is recorded, whether or not this file declares the callee: only
 * the project knows which file a method in another file belongs to.
 */
function analyzeBody(code, tokens, from, to) {
  const calls = []
  const producers = new Map()
  const returns = []

  for (let k = from; k < to; k++) {
    const token = tokens[k]
    if (token.v === 'return') {
      let end = k + 1
      let level = 0
      while (end < to) {
        const t = tokens[end]
        if (t.v === '(' || t.v === '[' || t.v === '{') level++
        else if (t.v === ')' || t.v === ']' || t.v === '}') {
          if (level === 0) break
          level--
        } else if (t.v === ';' && level === 0) break
        end++
      }
      const text = sliceText(tokens, k + 1, end)
      if (text.length > 0) returns.push(text)
      continue
    }
    if (token.t === 'id' && token.v === 'new') {
      // `new Foo(...)` builds an instance: the constructor is the block that
      // receives the arguments, so the call belongs to it.
      const nameToken = tokens[k + 1]
      if (nameToken && nameToken.t === 'id' && tokens[k + 2] && tokens[k + 2].v === '(') {
        const close = matchGroup(tokens, k + 2)
        calls.push({
          name: nameToken.v,
          construction: true,
          args: splitTopLevel(tokens, k + 3, close),
          line: lineAt(code, token.s),
        })
      }
      continue
    }
    if (token.t !== 'id') continue
    const call = callSiteAt(tokens, k)
    if (call === undefined) continue
    const line = lineAt(code, token.s)
    calls.push({ ...call, line })
    const previous = tokens[k - 1]
    if (previous && previous.v === '=') {
      const before = tokens[k - 2]
      if (before && before.t === 'id' && !KEYWORDS.has(before.v)) producers.set(before.v, call.name)
    }
  }

  /**
   * The producer of the value an argument carries, if any.
   *
   * A call inside a nested function is *not* the producer of the argument: a
   * callback is not a value the callee receives, and the calls in its body
   * belong to the block that owns it. `foo(() => bar())` therefore carries no
   * data, and keeps the plain call edge `foo` — reading it as `bar` producing
   * a value for `foo` would both invent a data edge and lose the call.
   */
  const dataFor = (argFrom, argTo) => {
    let nestedFrom = argTo
    for (let k = argFrom; k < argTo; k++) {
      const token = tokens[k]
      if (token.v === '=>' || (token.t === 'id' && token.v === 'function')) { nestedFrom = k; break }
    }
    for (let k = argFrom; k < argTo && k < nestedFrom; k++) {
      if (tokens[k].t !== 'id') continue
      const call = callSiteAt(tokens, k)
      if (call !== undefined) return call.name
    }
    for (let k = argFrom; k < argTo; k++) {
      const token = tokens[k]
      if (token.t !== 'id' || KEYWORDS.has(token.v)) continue
      const producer = producers.get(token.v)
      if (producer !== undefined) return producer
    }
    return undefined
  }

  return { calls, returns, derived: deriveOutputs(tokens, returns), dataFor }
}

/** Best-effort output port names from return expressions. */
function deriveOutputs(tokens, returns) {
  const names = []
  for (const text of returns.slice(0, 2)) {
    if (/^[A-Za-z_$][\w$]*$/.test(text)) names.push(text)
    else if (/^[A-Za-z_$][\w$]*\s*\(/.test(text)) names.push('result')
    else if (/^[[{]/.test(text)) names.push('object')
    else if (/^(undefined|null|void)$/.test(text)) continue
    else names.push('value')
  }
  return [...new Set(names)]
}

/**
 * Declarations at module level: `function`, arrow/function consts, and class
 * methods of top-level classes.
 */
function jsDeclarations(code, tokens) {
  const decls = []
  const known = new Set()
  const seen = new Set()
  // Names a module-level binding takes away from the project's blocks: a
  // `const evaluate = new Function(…)` is not a block, but it *is* the thing
  // a call to `evaluate` reaches. Without this, the call would be drawn to a
  // method of the same name in another class.
  const shadows = new Set()
  // The base class of every class that extends another.
  const bases = new Map()

  const push = (declaration) => {
    if (seen.has(declaration.name)) return
    seen.add(declaration.name)
    known.add(declaration.name)
    decls.push(declaration)
  }

  const readFunction = (startIndex, nameIndex, keywordIndex) => {
    let cursor = nameIndex + 1
    if (tokens[cursor] && tokens[cursor].v === '<') cursor = skipTypeParams(tokens, cursor)
    if (!tokens[cursor] || tokens[cursor].v !== '(') return
    const paramsClose = matchGroup(tokens, cursor)
    const params = splitTopLevel(tokens, cursor + 1, paramsClose).map(([a, b]) => paramOf(tokens, a, b)).filter(Boolean)
    let bodyOpen = paramsClose + 1
    while (bodyOpen < tokens.length && tokens[bodyOpen].v !== '{' && tokens[bodyOpen].v !== ';') bodyOpen++
    if (!tokens[bodyOpen] || tokens[bodyOpen].v !== '{') return
    const bodyClose = matchGroup(tokens, bodyOpen)
    push({
      name: tokens[nameIndex].v,
      kind: 'function',
      params,
      start: tokens[startIndex].s,
      end: tokens[bodyClose].e,
      bodyFrom: bodyOpen + 1,
      bodyTo: bodyClose,
      doc: docBefore(tokens, startIndex),
    })
  }

  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k]
    if (token.d !== 0) continue
    if (token.t === 'id' && token.v === 'function') {
      let nameIndex = k + 1
      if (tokens[nameIndex] && tokens[nameIndex].v === '*') nameIndex++
      if (!tokens[nameIndex] || tokens[nameIndex].t !== 'id') continue
      readFunction(k, nameIndex, k)
      continue
    }
    if (token.t === 'id' && (token.v === 'const' || token.v === 'let' || token.v === 'var')) {
      const nameToken = tokens[k + 1]
      if (!nameToken || nameToken.t !== 'id') continue
      let cursor = k + 2
      if (!tokens[cursor] || tokens[cursor].v !== '=') continue
      cursor++
      if (tokens[cursor] && tokens[cursor].v === 'async') cursor++
      if (tokens[cursor] && tokens[cursor].v === 'function') {
        let nameIndex = cursor + 1
        if (tokens[nameIndex] && tokens[nameIndex].v === '*') nameIndex++
        if (tokens[nameIndex] && tokens[nameIndex].t === 'id') { readFunction(k, nameIndex, cursor); continue }
        cursor++
      }
      if (!tokens[cursor]) continue
      if (tokens[cursor].v === '<') cursor = skipTypeParams(tokens, cursor)
      if (!tokens[cursor] || tokens[cursor].v !== '(') {
        // The value is not a function: the name is a binding, not a block.
        shadows.add(nameToken.v)
        continue
      }
      const paramsClose = matchGroup(tokens, cursor)
      let arrow = paramsClose + 1
      while (arrow < tokens.length && tokens[arrow].v !== '=>' && tokens[arrow].v !== ';') arrow++
      if (!tokens[arrow] || tokens[arrow].v !== '=>') continue
      const params = splitTopLevel(tokens, cursor + 1, paramsClose).map(([a, b]) => paramOf(tokens, a, b)).filter(Boolean)
      let bodyOpen = arrow + 1
      if (!tokens[bodyOpen]) continue
      let bodyClose = bodyOpen
      if (tokens[bodyOpen].v === '{') bodyClose = matchGroup(tokens, bodyOpen)
      else {
        while (bodyClose < tokens.length && tokens[bodyClose].v !== ';' && !(tokens[bodyClose].v === '}' && tokens[bodyClose].d < 1)) bodyClose++
      }
      if (bodyClose >= tokens.length) bodyClose = tokens.length - 1
      push({
        name: nameToken.v,
        kind: 'function',
        params,
        start: tokens[k].s,
        end: tokens[bodyClose].e,
        bodyFrom: bodyOpen + 1,
        bodyTo: bodyClose,
        doc: docBefore(tokens, k),
      })
      continue
    }
    if (token.t === 'id' && token.v === 'class') {
      const nameToken = tokens[k + 1]
      // `class { … }` and `class extends Base { … }` are class expressions:
      // their name is the variable they are assigned to.
      let className
      if (nameToken !== undefined && nameToken.t === 'id' && nameToken.v !== 'extends') {
        className = nameToken.v
        const assigned = assignedNameOf(tokens, k)
        if (assigned !== undefined) className = assigned
      } else {
        const assigned = assignedNameOf(tokens, k)
        if (assigned === undefined) continue
        className = assigned
      }
      let cursor = k + 2
      // `class Group extends EntryGroup { … }` — the base class owns the
      // methods the subclass inherits, so a call inside the subclass may
      // reach them.
      let base
      if (tokens[cursor] && tokens[cursor].v === 'extends') {
        const baseToken = tokens[cursor + 1]
        if (baseToken !== undefined && baseToken.t === 'id') base = baseToken.v
        cursor++
      }
      // `class { … }` — the body opens right after the keyword.
      if (tokens[k + 1] !== undefined && tokens[k + 1].v === '{') cursor = k + 1
      while (cursor < tokens.length && tokens[cursor].v !== '{') cursor++
      if (cursor >= tokens.length) continue
      const bodyClose = matchGroup(tokens, cursor)
      if (base !== undefined) bases.set(className, base)
      for (let m = cursor + 1; m < bodyClose; m++) {
        const member = tokens[m]
        if (member.t !== 'id' || KEYWORDS.has(member.v)) continue
        // Only a member of the class body itself is a method. A call or an
        // object literal nested in a method is not a declaration.
        if (member.d !== 1) continue
        if (!tokens[m + 1] || tokens[m + 1].v !== '(') continue
        // A member of another object is not a method of this class.
        if (tokens[m - 1] && (tokens[m - 1].v === '.' || tokens[m - 1].v === '#')) continue
        // `constructor(...)` is the class's own body, not a method someone
        // calls by name — but its code still belongs to the class, so it is
        // scanned for calls. `new Foo(...)` and `super(...)` are expressions.
        if (member.v === 'super' || member.v === 'new') continue
        const before = tokens[m - 1]
        if (before !== undefined && before.t === 'id' && before.v === 'new') continue
        const paramsClose = matchGroup(tokens, m + 1)
        let bodyOpen = paramsClose + 1
        while (bodyOpen < bodyClose && tokens[bodyOpen].v !== '{' && tokens[bodyOpen].v !== ';') bodyOpen++
        if (bodyOpen >= bodyClose || tokens[bodyOpen].v !== '{') continue
        const methodClose = matchGroup(tokens, bodyOpen)
        if (methodClose > bodyClose) continue
        const name = `${className}.${member.v}`
        if (seen.has(name)) continue
        seen.add(name)
        known.add(name)
        // A method is also called by its bare name inside the class, so the
        // bare name must count as known for the body scan to see the call.
        if (!known.has(member.v)) known.add(member.v)
        decls.push({
          name,
          // The constructor is the class's own body: it is a block, but it is
          // not a method someone renames.
          kind: member.v === 'constructor' ? 'entry' : 'method',
          params: splitTopLevel(tokens, m + 2, paramsClose).map(([a, b]) => paramOf(tokens, a, b)).filter(Boolean),
          start: member.s,
          end: tokens[methodClose].e,
          bodyFrom: bodyOpen + 1,
          bodyTo: methodClose,
          doc: docBefore(tokens, m),
        })
      }
    }
  }

  return { decls, known, shadows, bases }
}

/**
 * The name a class expression is assigned to.
 *
 * `var Group = class extends Base { … }` gives the class the name `Group`,
 * and `var EntryGroup = class { … }` gives it `EntryGroup`. Without this,
 * the class would be called `extends`, which is the keyword, not a name.
 *
 * @param {object[]} tokens - the token stream.
 * @param {number} classIndex - the `class` token.
 * @returns {string | undefined} the name.
 */
function assignedNameOf(tokens, classIndex) {
  // The class is assigned when the token right before `class` is `=`:
  // `var EntryGroup = class { … }`. A class that is only preceded by
  // `export` or a modifier has its own name and is not assigned.
  if (tokens[classIndex - 1] === undefined || tokens[classIndex - 1].v !== '=') return undefined
  const name = tokens[classIndex - 2]
  if (name === undefined || name.t !== 'id') return undefined
  return name.v
}

/** Skip `<T, U>` type parameters starting at `from`; returns the index past them. */
function skipTypeParams(tokens, from) {
  let level = 0
  for (let k = from; k < tokens.length; k++) {
    if (tokens[k].v === '<') level++
    else if (tokens[k].v === '>') {
      level--
      if (level === 0) return k + 1
    }
  }
  return from
}

/** Build the graph for JavaScript / TypeScript source. */
function parseJs(code) {
  const tokens = tokenizeJs(code)
  const { decls, known, shadows, bases } = jsDeclarations(code, tokens)
  const nodes = []
  const edges = []
  const nodeIds = new Map()
  const edgeKeys = new Set()
  const callCounts = new Map()
  const pushNode = (node) => {
    nodes.push(node)
    nodeIds.set(node.name, node.id)
  }
  const pushEdge = (from, to, kind, label, via) => {
    if (from === to) return
    const key = `${from}|${to}|${kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ from, to, kind, label: label ?? undefined, via })
  }

  for (let index = 0; index < decls.length; index++) {
    const decl = decls[index]
    pushNode({
      id: `fn:${decl.name}`,
      name: decl.name,
      kind: decl.kind,
      line: lineAt(code, decl.start),
      params: decl.params,
      outputs: [],
      doc: decl.doc,
      start: decl.start,
      end: decl.end,
      calls: [],
      openCalls: [],
      externalCalls: [],
      exported: /\bexport\b/.test(code.slice(Math.max(0, decl.start - 24), decl.start + 8)),
    })
  }

  for (let index = 0; index < decls.length; index++) {
    const decl = decls[index]
    const body = analyzeBody(code, tokens, decl.bodyFrom, decl.bodyTo)
    const node = nodes[index]
    node.outputs = body.derived
    // The names this body binds itself: a call to one of them reaches the
    // local binding, not a block of the same name elsewhere.
    const locals = localBindings(tokens, decl.bodyFrom, decl.bodyTo)
    // A method of a class is called by its bare name inside that class
    // (`this.dispose()` or a plain `dispose()`), while its block is named
    // `Class.dispose`. The call must resolve to that same block, or the method
    // looks uncalled and its data flow is missing.
    const owner = decl.kind !== 'function' && decl.name.includes('.')
      ? decl.name.slice(0, decl.name.indexOf('.'))
      : undefined
    for (const call of body.calls) {
      if (call.name === decl.name) continue
      let targetId
      // The names the callee may be known by, most precise first.
      const candidates = []
      if (call.construction === true) {
        candidates.push(`${call.name}.constructor`, call.name)
        // The block that builds the instance is the class's constructor.
        targetId = nodeIds.get(`${call.name}.constructor`) ?? nodeIds.get(call.name)
      } else if (call.own === true) {
        // `this.method()` reaches a method of the class the call sits in —
        // or of a class it inherits from.
        if (owner !== undefined) candidates.push(`${owner}.${call.name}`)
        targetId = owner === undefined ? undefined : nodeIds.get(`${owner}.${call.name}`)
        if (targetId === undefined && owner !== undefined) {
          // Walk the inheritance chain: `class Group extends EntryGroup` may
          // call a method `EntryGroup` declares.
          let base = bases.get(owner)
          while (base !== undefined && targetId === undefined) {
            candidates.push(`${base}.${call.name}`)
            targetId = nodeIds.get(`${base}.${call.name}`)
            base = bases.get(base)
          }
        }
      } else {
        // A bare call reaches the module scope, never a sibling method: in
        // JavaScript only `this.method()` reaches a method of the class.
        // A name the body or the module binds itself reaches nothing the map
        // can draw.
        if (shadows.has(call.name) || locals.has(call.name)) {
          node.calls.push({
            name: call.name,
            line: call.line,
            payload: undefined,
            resolved: false,
            shadowed: true,
            construction: false,
          })
          if (!node.externalCalls.includes(call.name)) node.externalCalls.push(call.name)
          continue
        }
        candidates.push(call.name)
        targetId = nodeIds.get(call.name)
      }
      let payload
      for (const [argFrom, argTo] of call.args) {
        const producer = body.dataFor(argFrom, argTo)
        if (producer !== undefined && producer !== call.name) {
          payload = { producer, label: sliceText(tokens, argFrom, argTo) }
          break
        }
      }
      if (targetId === undefined) {
        node.calls.push({
          name: call.name,
          candidates,
          line: call.line,
          payload,
          resolved: false,
          construction: call.construction === true,
        })
        if (call.construction === true) {
          // A constructor of another file is still a block of this project, so
          // the project level may find it. It is not an external call.
          node.openCalls.push({ name: call.name, candidates, line: call.line, payload })
          continue
        }
        if (!node.externalCalls.includes(call.name)) node.externalCalls.push(call.name)
        // The callee may live in another file: the project level resolves it.
        node.openCalls.push({ name: call.name, candidates, line: call.line, payload })
        continue
      }
      node.calls.push({
        name: call.name,
        candidates,
        line: call.line,
        payload,
        resolved: true,
        construction: call.construction === true,
      })      // One edge per call site: a traced value turns the call into a data edge
      // between producer and consumer; without one it stays a plain call edge.
      if (payload !== undefined) {
        const producerId = nodeIds.get(payload.producer)
          ?? (owner === undefined ? undefined : nodeIds.get(`${owner}.${payload.producer}`))
        if (producerId !== undefined) {
          pushEdge(producerId, targetId, 'data', trimLabel(payload.label), payload.producer)
        } else {
          pushEdge(node.id, targetId, 'call')
        }
      } else {
        pushEdge(node.id, targetId, 'call')
      }
      callCounts.set(targetId, (callCounts.get(targetId) ?? 0) + 1)
    }
  }

  // Module-level statements become an entry node when they call a known function.
  const entryCalls = []
  for (let k = 0; k < tokens.length; k++) {
    if (tokens[k].d !== 0 || tokens[k].t !== 'id') continue
    if (decls.some(decl => tokens[k].s >= decl.start && tokens[k].s < decl.end)) continue
    const call = callSiteAt(tokens, k, known)
    if (call === undefined) continue
    entryCalls.push(call)
  }
  if (entryCalls.length > 0) {
    const id = 'entry:main'
    pushNode({ id, name: 'main', kind: 'entry', line: 1, params: [], outputs: [], calls: [], externalCalls: [], exported: false })
    const seenEdges = new Set()
    for (const call of entryCalls) {
      const targetId = nodeIds.get(call.name)
      if (targetId === undefined) continue
      callCounts.set(targetId, (callCounts.get(targetId) ?? 0) + 1)
      const key = `${id}->${targetId}`
      if (seenEdges.has(key)) continue
      seenEdges.add(key)
      pushEdge(id, targetId, 'call')
    }
  }

  attachRefCounts(nodes, callCounts)
  return { nodes, edges, shadows: [...shadows] }
}

/**
 * Parse one top-level function's parameters from a Python `def` header.
 */
function pythonParams(header) {
  const open = header.indexOf('(')
  if (open < 0) return []
  let depth = 0
  let close = header.length - 1
  for (let i = open; i < header.length; i++) {
    if (header[i] === '(') depth++
    else if (header[i] === ')') {
      depth--
      if (depth === 0) { close = i; break }
    }
  }
  const inner = header.slice(open + 1, close)
  const parts = []
  let level = 0
  let start = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '(' || c === '[' || c === '{') level++
    else if (c === ')' || c === ']' || c === '}') level--
    else if (c === ',' && level === 0) { parts.push(inner.slice(start, i)); start = i + 1 }
  }
  if (inner.trim().length > 0) parts.push(inner.slice(start))
  return parts
    .map(part => part.trim())
    .filter(part => part.length > 0 && part !== 'self' && part !== 'cls' && !part.startsWith('*'))
    .map(part => {
      const match = /^([A-Za-z_]\w*)\s*(?::\s*([^=]+?))?\s*(?:=.*)?$/.exec(part)
      if (match === null) return undefined
      return { name: match[1], type: match[2] ? trimLabel(match[2].trim()) : undefined }
    })
    .filter(Boolean)
}

/** Python words that can precede `(` without being a call. */
const PY_KEYWORDS = new Set([
  'if', 'elif', 'for', 'while', 'def', 'class', 'return', 'yield', 'lambda', 'with', 'as',
  'except', 'assert', 'del', 'global', 'nonlocal', 'import', 'from', 'raise', 'print', 'not',
  'and', 'or', 'in', 'is', 'not', 'await', 'async',
])

/**
 * Extract call sites from a Python body.
 *
 * A call through an object (`service.run()`) is reported with the whole path
 * it goes through, so the caller can look up the receiver's type and know
 * which class the method belongs to.
 */
function pythonCalls(text) {
  const calls = []
  const pattern = /((?:[A-Za-z_]\w*\s*\.\s*)*)([A-Za-z_]\w*)\s*\(/g
  let match
  while ((match = pattern.exec(text)) !== null) {
    const name = match[2]
    if (PY_KEYWORDS.has(name)) continue
    const path = match[1].split('.').map(part => part.trim()).filter(part => part.length > 0)
    const open = match.index + match[0].length - 1
    let depth = 0
    let close = text.length
    for (let i = open; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') {
        depth--
        if (depth === 0) { close = i; break }
      }
    }
    const args = splitPythonArgs(text.slice(open + 1, close))
    calls.push({ name, path, args, line: text.slice(0, match.index).split('\n').length })
  }
  return calls
}

/** Split Python call arguments on top-level commas. */
function splitPythonArgs(inner) {
  const parts = []
  let level = 0
  let start = 0
  let quote = null
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (quote !== null) {
      if (c === '\\') { i++; continue }
      if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'") { quote = c; continue }
    if (c === '(' || c === '[' || c === '{') level++
    else if (c === ')' || c === ']' || c === '}') level--
    else if (c === ',' && level === 0) { parts.push(inner.slice(start, i)); start = i + 1 }
  }
  if (inner.trim().length > 0) parts.push(inner.slice(start))
  return parts.map(part => part.trim()).filter(part => part.length > 0)
}

/** Build the graph for Python source. */
function parsePython(code) {
  const lines = code.split('\n')
  const decls = []
  const classes = new Set()
  // The classes this file declares: `service = Service("ord")` builds an
  // instance, so `service` holds a `Service`.
  for (const match of code.matchAll(/^class\s+([A-Za-z_]\w*)/gm)) classes.add(match[1])
  let classPrefix
  let classIndent = -1
  let k = 0
  while (k < lines.length) {
    const line = lines[k]
    const indent = line.length - line.trimStart().length
    const trimmed = line.trim()
    const classMatch = /^class\s+([A-Za-z_]\w*)/.exec(trimmed)
    if (classMatch !== null && indent === 0) {
      classPrefix = classMatch[1]
      classIndent = -1
      classes.add(classMatch[1])
      k++
      continue
    }
    const defMatch = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(trimmed)
    if (defMatch !== null && (indent === 0 || indent > 0)) {
      // A `def` belongs to the class whose body holds it. A `def` inside a
      // function is a local function, not a method of the class above it.
      if (indent === 0) {
        classPrefix = undefined
        classIndent = -1
      } else if (classPrefix !== undefined && classIndent < 0) {
        classIndent = indent
      }
      const owner = classPrefix !== undefined && indent === classIndent ? classPrefix : undefined
      const name = owner === undefined ? defMatch[1] : `${owner}.${defMatch[1]}`
      let endLine = k
      let j = k + 1
      for (; j < lines.length; j++) {
        const bodyLine = lines[j]
        if (bodyLine.trim().length === 0) continue
        const bodyIndent = bodyLine.length - bodyLine.trimStart().length
        if (bodyIndent <= indent) break
        endLine = j
      }
      const body = lines.slice(k + 1, endLine + 1).join('\n')
      const docMatch = /^\s*(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(body)
      const doc = docMatch !== null
        ? trimLabel(docMatch[1].split('\n').map(item => item.trim()).filter(line => line.length > 0 && !line.startsWith('@')).join(' '), 160)
        : undefined
      const returns = [...body.matchAll(/^\s*return\s+(.+)$/gm)].map(item => item[1].trim()).slice(0, 2)
      const outputs = []
      for (const value of returns) {
        if (/^[A-Za-z_]\w*$/.test(value)) outputs.push(value)
        else if (/^[A-Za-z_]\w*\s*\(/.test(value)) outputs.push('result')
        else if (/^[[{(]/.test(value)) outputs.push('object')
        else outputs.push('value')
      }
      decls.push({
        name,
        owner,
        // The constructor is the class's own body: it is a block, but it is
        // not a method someone renames.
        kind: owner === undefined ? 'function' : (defMatch[1] === '__init__' ? 'entry' : 'method'),
        params: pythonParams(trimmed),
        body,
        startLine: k,
        endLine,
        doc: doc && doc.length > 0 ? doc : undefined,
        outputs: [...new Set(outputs)],
        start: offsetOfLine(lines, k),
        end: offsetOfLine(lines, endLine) + lines[endLine].length,
      })
      k = endLine + 1
      continue
    }
    if (indent === 0 && classPrefix !== undefined && trimmed.length > 0) classPrefix = undefined
    k++
  }

  const nodes = decls.map((decl, index) => ({
    id: `fn:${decl.name}`,
    name: decl.name,
    kind: decl.kind,
    line: decl.startLine + 1,
    params: decl.params,
    outputs: decl.outputs,
    doc: decl.doc,
    start: decl.start,
    end: decl.end,
    calls: [],
    openCalls: [],
    externalCalls: [],
    exported: true,
    index,
  }))
  const nodeIds = new Map(nodes.map(node => [node.name, node.id]))
  const edges = []
  const edgeKeys = new Set()
  const pushEdge = (from, to, kind, label, via) => {
    if (from === to) return
    const key = `${from}|${to}|${kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ from, to, kind, label: label ?? undefined, via })
  }
  const callCounts = new Map()
  for (const decl of decls) {
    const node = nodes.find(item => item.name === decl.name)
    const owner = decl.owner
    const producers = new Map()
    for (const match of decl.body.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)\s*\(/gm)) producers.set(match[1], match[2])
    // The classes a local variable holds: `service = Service("ord")` builds
    // an instance, so `service` holds a `Service`.
    const varTypes = new Map()
    for (const match of decl.body.matchAll(/^\s*([a-z_][A-Za-z0-9_]*)\s*=\s*([A-Z][A-Za-z0-9_]*)\s*\(/gm)) {
      if (!varTypes.has(match[1])) varTypes.set(match[1], match[2])
    }
    for (const call of pythonCalls(decl.body)) {
      if (call.name === decl.name) continue
      const callee = call.name
      // The name the callee is known by: a plain call keeps its own name, a
      // method keeps `Class.method`, because that is how its block is named.
      let lookup = callee
      let targetId
      let construction = false
      const path = call.path ?? []
      if (path.length === 0) {
        // `Service(...)` builds an instance: the constructor is the block that
        // receives the arguments.
        const constructorId = nodeIds.get(`${callee}.__init__`)
        if (constructorId !== undefined) {
          targetId = constructorId
          construction = true
          lookup = `${callee}.__init__`
        } else {
          targetId = nodeIds.get(callee)
          if (targetId === undefined && /^[A-Z]/.test(callee)) {
            // A name that starts with a capital is a class: its constructor is
            // the block that receives the arguments, even when the class is
            // declared in another file.
            lookup = `${callee}.__init__`
            construction = true
          }
        }
      } else if (path[0] === 'self' || path[0] === 'cls') {
        // A method of the class that owns this block. `self.repo.store()` goes
        // through another object, so only a direct call belongs to the class.
        if (path.length === 1 && owner !== undefined) {
          lookup = `${owner}.${callee}`
          targetId = nodeIds.get(lookup)
        }
        if (targetId === undefined && path.length === 1) targetId = nodeIds.get(callee)
      } else {
        // `service.run()` — the receiver's type decides the class. Without a
        // known type the call cannot be placed, so it is left undrawn rather
        // than guessed: `x.get()` is not necessarily the project's `get`.
        const receiverType = varTypes.get(path[0])
        if (receiverType === undefined) continue
        lookup = `${receiverType}.${callee}`
        targetId = nodeIds.get(lookup)
      }      let payload
      for (const arg of call.args) {
        const inner = /^(?:[A-Za-z_]\w*\s*=\s*)?(.+)$/.exec(arg)
        const value = inner === null ? arg : inner[1].trim()
        if (/^[A-Za-z_]\w*$/.test(value)) {
          const producer = producers.get(value)
          if (producer !== undefined && producer !== call.name) { payload = { producer, label: value }; break }
        }
        const nested = /^([A-Za-z_]\w*)\s*\(/.exec(value)
        if (nested !== null && nested[1] !== call.name) { payload = { producer: nested[1], label: value }; break }
      }
      node.calls.push({ name: lookup, line: call.line, payload, resolved: targetId !== undefined, construction })
      if (targetId === undefined) {
        // A qualified name names a block of this project, so it is not an
        // external call; the project level may still find it in another file.
        if (!lookup.includes('.')) {
          if (!node.externalCalls.includes(callee)) node.externalCalls.push(callee)
        }
        node.openCalls.push({ name: lookup, line: call.line, payload })
        continue
      }
      // One edge per call site: a traced value turns the call into a data edge
      // between producer and consumer; without one it stays a plain call edge.
      if (payload !== undefined) {
        const producerId = nodeIds.get(payload.producer)
          ?? (owner === undefined ? undefined : nodeIds.get(`${owner}.${payload.producer}`))
        if (producerId !== undefined) {
          pushEdge(producerId, targetId, 'data', trimLabel(payload.label), payload.producer)
        } else {
          pushEdge(node.id, targetId, 'call')
        }
      } else {
        pushEdge(node.id, targetId, 'call')
      }
      callCounts.set(targetId, (callCounts.get(targetId) ?? 0) + 1)
    }
  }
  attachRefCounts(nodes, callCounts)
  return { nodes, edges }
}

/** Record how many call sites point at each node (delete warnings need it). */
function attachRefCounts(nodes, callCounts) {
  for (const node of nodes) node.refCount = callCounts.get(node.id) ?? 0
}

/** Character offset where a zero-based line starts. */
function offsetOfLine(lines, index) {
  let offset = 0
  for (let i = 0; i < index; i++) offset += lines[i].length + 1
  return offset
}

/**
 * Parse one source file into a block graph, choosing the precise parser where
 * one exists and the generic extractor otherwise.
 *
 * @param {string} code - file text.
 * @param {string} lang - language id, extension, or path.
 * @returns {{ lang: string, nodes: object[], edges: object[], imports?: Map<string, object>, externals?: string[] }}
 */
export function parseFile(code, lang) {
  const language = normalizeLanguage(lang)
  if (language === 'python') return { lang: 'python', ...parsePython(code) }
  if (language === 'javascript' || language === 'typescript') return { lang: language, ...parseJs(code) }
  if (LANGUAGES[language] === undefined) {
    // Unknown extension: still offer the generic structural view.
    const extracted = extractFile(code, 'generic')
    return { lang: 'generic', nodes: extracted.nodes, edges: extracted.edges, imports: extracted.imports, externals: extracted.externals }
  }
  const extracted = extractFile(code, language)
  return { lang: language, nodes: extracted.nodes, edges: extracted.edges, imports: extracted.imports, externals: extracted.externals }
}

/** Branch on the declared language; returns an empty graph for other languages. */
/**
 * Normalize a fence or file extension to the language id the extractor uses.
 * TypeScript keeps its own id; the JS tokenizer serves both.
 */
function normalizeLanguage(lang) {
  const value = (lang ?? '').toLowerCase().replace(/^\./, '')
  if (value === 'py' || value === 'python' || value === 'python3' || value === 'pyw') return 'python'
  if (['js', 'jsx', 'mjs', 'cjs', 'javascript', 'node', 'esm'].includes(value)) return 'javascript'
  if (['ts', 'tsx', 'mts', 'cts', 'typescript'].includes(value)) return 'typescript'
  if (value === 'cs' || value === 'c#') return 'csharp'
  if (value === 'kt' || value === 'kts' || value === 'kotlin') return 'kotlin'
  if (value === 'rs' || value === 'rust') return 'rust'
  return value
}

/** Whether a language is a code language the extractor can draw blocks for. */
