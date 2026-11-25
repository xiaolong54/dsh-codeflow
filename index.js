/**
 * Host half of the code-flow bundle.
 *
 * The plugin has no interface: there is no panel, no page, nothing a person
 * clicks. It is one tool the model calls — `codeflow_map` — plus the prompt
 * that tells the model how the code is shaped and how to follow a value when
 * something misbehaves.
 *
 * The model is built here, on the Host, because that is where the agent lives
 * and where the filesystem is. One scan, one model, one answer per question.
 */

import { apply as applyMapTool } from './src/host/tool.js'
import { createModelService } from './src/host/analyze.js'

/** The services the plugin needs: the tool, the prompt, the files, the directory. */
export const inject = ['tools', 'systemPrompt', 'fs', 'workingDirectory']

/**
 * Host plugin body.
 *
 * @param {object} ctx - the Host plugin context.
 */
export function apply(ctx) {
  // One model service, shared: every answer the tool gives comes from the
  // same scan of the same files.
  const service = createModelService(ctx)
  applyMapTool(ctx, service)
}
