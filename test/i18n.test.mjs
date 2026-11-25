/**
 * The words the model reads about a problem.
 *
 * The plugin has one reader — the model — so the dictionary is one language
 * and it holds one kind of thing: the name of every problem the map can find.
 * A missing name would show the model a raw key instead of a diagnosis.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { en, bindTranslator } from '../src/i18n.js'

/** Every problem the scanner can report. */
const CODES = [
  'ambiguous-call',
  'block-too-large',
  'too-many-params',
  'dynamic-dispatch',
  'module-mutable-state',
  'hidden-data-flow',
  'missing-doc',
  'explicit-io',
  'orchestrator-entry',
  'inline-callback',
  'nested-definition',
]

test('every problem the map can find has a name', () => {
  for (const code of CODES) {
    const text = en[`diag.${code}`]
    assert.ok(typeof text === 'string' && text.length > 0, `diag.${code} has no name`)
  }
})

test('the dictionary holds nothing but problem names', () => {
  for (const key of Object.keys(en)) {
    assert.ok(key.startsWith('diag.'), `${key} is not a problem name`)
  }
})

test('the translator fills the placeholders of a problem', () => {
  const translate = bindTranslator('en')

  assert.equal(
    translate('diag.too-many-params', { name: 'load', params: 8 }),
    'load takes 8 parameters; pass one parameter object',
  )
  // A placeholder without a value stays as it is: the model sees what is
  // missing rather than "undefined".
  assert.match(translate('diag.block-too-large', { name: 'load' }), /\{lines\}/)
})

test('an unknown key is answered with the key itself', () => {
  const translate = bindTranslator('en')

  assert.equal(translate('diag.nothing-like-this'), 'diag.nothing-like-this')
})
