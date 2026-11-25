/**
 * Build the plugin market index for this bundle.
 *
 * The index lists one plugin whose install source is this Git repository at
 * the current commit, so a user who adds the index installs the exact tree
 * that was published. Run it after every commit:
 *
 *   node tools/build-market-index.mjs
 *
 * The result is `docs/market/index.json` with `market/icons/` beside it.
 * GitHub Pages serves the repository's `docs` folder, so publish that folder
 * and point DSH's "Add index source" at the index file.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** The repository's web address. */
const REPOSITORY = 'https://github.com/xiaolong54/dsh-codeflow'

/** The commit the index installs. */
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

/** The publish time of that commit, in Unix seconds. */
const publishedAt = Math.floor(Date.parse(
  execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
) / 1000)

/** The icon file name inside the index's icons folder. */
const iconFile = 'codeflow.svg'

/** The site folder: GitHub Pages serves the repository's `docs` folder. */
const site = join(root, 'docs', 'market')

mkdirSync(join(site, 'icons'), { recursive: true })
copyFileSync(join(root, 'icon.svg'), join(site, 'icons', iconFile))

const index = {
  format: 1,
  title: { en: 'xiaolong54 plugins', zh: 'xiaolong54 的插件' },
  description: {
    en: 'Personal plugin market of xiaolong54.',
    zh: 'xiaolong54 的个人插件市场。',
  },
  metadata: {
    categories: { personal: { title: { en: 'Personal', zh: '个人' } } },
    labels: { personal: { title: { en: 'Personal', zh: '个人' } } },
    sortKeys: {
      published: { title: { en: 'Publish date', zh: '发布日期' }, order: 'desc' },
    },
  },
  plugins: [
    {
      name: manifest.name,
      title: { en: 'Code data-flow map', zh: '代码数据流图' },
      description: {
        en: 'One tool the model calls and one prompt that explains it: the project read as function blocks joined by data flow, so the agent writes modular, composable code and follows a value back to the block that produced it when something breaks.',
        zh: '一个模型会调用的工具，加一段解释它的提示词：把项目读成用数据流连起来的功能块，让 agent 写出模块化、可组装的代码；出问题时顺着值往回找到生产它的那个块。',
      },
      icon: `icons/${iconFile}`,
      author: 'xiaolong54',
      homepage: `${REPOSITORY}#readme`,
      repository: { url: REPOSITORY },
      metadata: {
        category: 'personal',
        labels: ['personal'],
        keywords: ['dsh', 'dsh-plugin', 'deepseek-harness', 'agent', 'data-flow', 'refactoring', 'modularity'],
      },
      versions: [
        {
          version: manifest.version,
          publishTimestamp: publishedAt,
          source: { type: 'git', url: REPOSITORY, commit },
          engines: manifest.engines?.dsh === undefined ? {} : { dsh: manifest.engines.dsh },
        },
      ],
    },
  ],
}

writeFileSync(join(site, 'index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
console.log(`docs/market/index.json written for ${manifest.name}@${manifest.version} at ${commit.slice(0, 12)}`)
