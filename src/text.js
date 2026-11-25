/** Small text helpers shared by the extractor and the parsers. */

/** Collapse whitespace and cut a label to a readable length. */
export function trimLabel(value, max = 32) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** 1-based line number of a character offset. */
export function lineAt(text, offset) {
  let line = 1
  for (let index = 0; index < offset && index < text.length; index++) {
    if (text[index] === '\n') line++
  }
  return line
}

/** Whether an identifier is a plain ASCII-ish identifier. */
/**
 * A block's shape: `name(a, b) -> Result`.
 *
 * The picture and the text the model reads must call a block the same way, so
 * both use this one function.
 *
 * @param {object} node - a block node.
 * @returns {string} the signature.
 */
export function signatureOf(node) {
  const params = (node.params ?? [])
    .map(param => (param.type === undefined ? param.name : `${param.name}: ${param.type}`))
    .join(', ')
  const outputs = (node.outputs ?? []).join(', ')
  return outputs.length > 0 ? `${node.name}(${params}) -> ${outputs}` : `${node.name}(${params})`
}
