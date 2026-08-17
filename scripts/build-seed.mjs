#!/usr/bin/env node
/**
 * Build the embedded seed index (lib/seed-registry.json) from a community
 * registry build — the same data shape as bradeGithub/DSH-Plugins-Marketplace
 * registry.json (fields: full_name, name, description, html_url,
 * stargazers_count, updated_at). Used as the offline first-run fallback.
 *
 * Usage:
 *   node scripts/build-seed.mjs <registry.json|registry.json.gz|http(s)://url> [topN]
 *
 * The registry itself can be refreshed from the community CI artifact:
 *   node scripts/build-seed.mjs https://cdn.jsdelivr.net/gh/bradeGithub/DSH-Plugins-Marketplace@main/registry.json.gz 200
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'lib', 'seed-registry.json')

const source = process.argv[2]
if (!source) {
  console.error('usage: node scripts/build-seed.mjs <registry.json|.gz|url> [topN]')
  process.exit(1)
}
const topN = Math.max(1, Number(process.argv[3]) || 200)

let raw
if (/^https?:\/\//i.test(source)) {
  const res = await fetch(source, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + source)
  raw = Buffer.from(await res.arrayBuffer())
} else {
  raw = await readFile(source)
}
if (source.endsWith('.gz')) raw = gunzipSync(raw)
const data = JSON.parse(raw.toString('utf8'))
const repos = Array.isArray(data) ? data : data.repos
if (!Array.isArray(repos)) throw new Error('registry has no repos array')

const items = repos
  .map((r) => ({
    fullName: String(r.full_name || ''),
    name: String(r.name || ''),
    url: String(r.html_url || ''),
    description: String(r.description || ''),
    stars: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
    language: String(r.language || ''),
    updatedAt: String(r.updated_at || ''),
    homepage: String(r.homepage || ''),
  }))
  .filter((r) => r.fullName)
  .sort((a, b) => b.stars - a.stars)
  .slice(0, topN)

await mkdir(dirname(OUT), { recursive: true })
await writeFile(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: items.length,
  source: typeof data.source === 'string' ? data.source : source,
  items,
}, null, 2) + '\n', 'utf8')
console.log('seed written: ' + OUT + ' (' + items.length + ' items, top star ' + (items[0]?.stars ?? 0) + ')')
