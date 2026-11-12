/**
 * Puts the landing page's HTML into dist/index.html after the build.
 *
 * Vite builds the page as an empty <div id="root">, so crawlers that don't run JavaScript see
 * nothing. This script renders the page once with the server build (dist-ssr/), pastes the
 * result into the root div, and deletes dist-ssr/. The browser then hydrates it.
 * Fails loudly if the root div is missing, so a template change can't silently skip this.
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const emptyRoot = '<div id="root"></div>'
const indexPath = resolve('dist/index.html')
const serverEntry = resolve('dist-ssr/entry-server.js')

const { renderLandingPageHtml } = await import(pathToFileURL(serverEntry).href)
const template = await readFile(indexPath, 'utf8')
if (!template.includes(emptyRoot)) throw new Error(`Expected ${emptyRoot} in dist/index.html`)

await writeFile(indexPath, template.replace(emptyRoot, () => `<div id="root">${renderLandingPageHtml()}</div>`))
await rm(resolve('dist-ssr'), { recursive: true, force: true })
