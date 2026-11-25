/**
 * The words the model reads about a problem.
 *
 * The plugin has one reader — the model — and it reads English, so there is
 * one dictionary. Every problem the map finds is named here in one line, so
 * the model is told the same diagnosis every time it asks about the same
 * place.
 */

/** The English dictionary. */
export const en = {
  'diag.ambiguous-call': '{name} is defined in {n} files; the call target is ambiguous',
  'diag.block-too-large': '{name} has {lines} lines; split it so the data flow stays visible',
  'diag.too-many-params': '{name} takes {params} parameters; pass one parameter object',
  'diag.dynamic-dispatch': '{token} in {name} makes the call target statically undecidable',
  'diag.module-mutable-state': 'Module-level mutable state hides data flow; pass values instead',
  'diag.hidden-data-flow': '{name} writes {token} directly, so where the data came from is invisible; pass it in and return it',
  'diag.missing-doc': '{name} has no one-line description; on the map it is a name without a purpose',
  'diag.explicit-io': '{name} writes {token}, which is not one of its parameters; where the value came from is invisible',
  'diag.orchestrator-entry': '{name} is {lines} lines long and calls fewer than two named blocks; it implements instead of orchestrating',
  'diag.inline-callback': '{name} holds a {lines}-line anonymous callback; the logic hides there and the map cannot show it',
  'diag.nested-definition': '{name} defines a named function inside itself; the map cannot draw that level',
}

/**
 * Bind a locale id to the dictionary.
 *
 * The model reads English; the locale is accepted so the call sites do not
 * have to know that.
 *
 * @param {string | undefined} locale - the host's active locale id.
 * @returns a translate function with `{name}` placeholder interpolation.
 */
export function bindTranslator(locale) {
  return (key, values) => {
    const template = en[key] ?? key
    if (values === undefined) return template
    return template.replace(/\{(\w+)\}/g, (match, name) => (
      values[name] === undefined ? match : String(values[name])
    ))
  }
}
