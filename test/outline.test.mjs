/**
 * The readable outline: what a part of the project is for, in one line.
 *
 * The blueprint the model is given describes the parts of the code in one
 * line each, so it has to be short, and it has to come from the code rather
 * than from a guess.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { areaPurpose } from '../src/outline.js'

test('an area says what it is for, in one line', () => {
  const purpose = areaPurpose([
    { nodes: [{ name: 'loadUser', kind: 'function', doc: 'Loads one user from the store.' }] },
  ])

  assert.equal(purpose, 'Loads one user from the store.')
  assert.ok(!purpose.includes('\n'))
})

test('an area without a description falls back to its exported names', () => {
  const purpose = areaPurpose([{ nodes: [{ name: 'run', kind: 'function', exported: true }] }])

  assert.equal(purpose, 'run')
})

test('an area without blocks says nothing', () => {
  assert.equal(areaPurpose([{ nodes: [] }]), undefined)
})
