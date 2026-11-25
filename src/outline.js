/**
 * The readable shape of the map: what a part is for, in one line.
 *
 * These builders are pure: a file in, a line out. That is what keeps the
 * blueprint the model is given describing the same parts of the same code.
 */

import { trimLabel } from './text.js'

/**
 * What one functional area is for, in one line.
 *
 * The first documented block in the area says it; without one, the names of
 * the area's exported blocks do.
 *
 * @param {object[]} files - the area's files.
 * @returns {string | undefined} the one-line purpose.
 */
export function areaPurpose(files) {
  for (const file of files) {
    for (const node of file.nodes) {
      if (node.doc === undefined || node.doc.length === 0) continue
      return trimLabel(node.doc, 64)
    }
  }
  const names = []
  for (const file of files) {
    for (const node of file.nodes) {
      if (node.exported !== true && node.kind !== 'entry') continue
      if (!names.includes(node.name)) names.push(node.name)
      if (names.length === 3) return names.join('、')
    }
  }
  return names.length === 0 ? undefined : names.join('、')
}
