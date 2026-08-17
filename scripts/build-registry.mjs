#!/usr/bin/env node
/**
 * Build the static market index (lib/registry.json.gz / lib/skills.json.gz).
 *
 * Two modes:
 *   --from <file|.gz|url>     normalize an existing community registry build
 *                             (registry JSON with a repos array) into our
 *                             item schema + categories.
 *   --crawl <plugin|skill>    fetch the full GitHub topic via the Search API
 *                             with stars segmentation (works around the
 *                             1000-results-per-query cap). GITHUB_TOKEN raises
 *                             the rate limit (30/min vs 10/min unauthenticated).
 *
 * Examples:
 *   node scripts/build-registry.mjs --from <url to registry.json.gz> --kind plugin
 *   node scripts/build-registry.mjs --crawl plugin
 *   node scripts/build-registry.mjs --crawl skill --out lib/skills.json.gz
 *
 * Output JSON (gzipped): { generatedAt, count, source, schema_version, items }
 * Each item: fullName,name,url,description,stars,language,updatedAt,homepage,
 * topics,license,hasSkill,category. Category comes from lib/categories.json
 * rules (first regex match over name+description+topics wins, else misc).
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { gzipSync, gunzipSync } from 'node:zlib'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const CATEGORIES = JSON.parse(await readFile(join(ROOT, 'lib', 'categories.json'), 'utf8')).categories

const argv = process.argv.slice(2)
const fromIdx = argv.indexOf('--from')
const crawlIdx = argv.indexOf('--crawl')
const outIdx = argv.indexOf('--out')
const kindIdx = argv.indexOf('--kind')
const topIdx = argv.indexOf('--top')
const KIND = kindIdx >= 0 ? argv[kindIdx + 1] : (crawlIdx >= 0 ? argv[crawlIdx + 1] : 'plugin')
const TOP_N = topIdx >= 0 ? Math.max(1, Number(argv[topIdx + 1]) || 0) : 0
const VERIFY = argv.includes('--verify')
const OUT = outIdx >= 0 ? argv[outIdx + 1] : join(ROOT, 'lib', (KIND === 'skill' ? 'skills' : 'registry') + '.json.gz')

const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''
const DELAY_MS = TOKEN ? 2200 : 6500
const PER_PAGE = 100
const MAX_PAGES_PER_SEGMENT = 10

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ghHeaders = () => ({
  'User-Agent': 'dsh-whale-market-registry',
  Accept: 'application/vnd.github+json',
  ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
})

function categorize(entry) {
  const hay = [entry.name, entry.description, (entry.topics ?? []).join(' ')].join(' ').toLowerCase()
  for (const cat of CATEGORIES) {
    if (!cat.match || cat.match.length === 0) continue
    for (const m of cat.match) {
      if (m && hay.includes(m.toLowerCase())) return cat.id
    }
  }
  return 'misc'
}

function normalizeRepo(r) {
  const entry = {
    fullName: String(r.full_name || ''),
    name: String(r.name || ''),
    url: String(r.html_url || ''),
    description: String(r.description || ''),
    stars: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
    language: String(r.language || ''),
    updatedAt: String(r.updated_at || ''),
    homepage: String(r.homepage || ''),
    topics: Array.isArray(r.topics) ? r.topics : [],
    license: typeof r.license === 'string' ? r.license : (r.license?.spdx_id ?? null),
    hasSkill: typeof r.has_skill === 'boolean' ? r.has_skill : null,
    defaultBranch: String(r.default_branch || r.defaultBranch || ''),
    verified: typeof r.verified === 'boolean' ? r.verified : null,
    verifiedAt: typeof r.verifiedAt === 'string' ? r.verifiedAt : null,
  }
  entry.category = categorize(entry)
  return entry
}

async function loadSource(source) {
  let raw
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { signal: AbortSignal.timeout(120000) })
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + source)
    raw = Buffer.from(await res.arrayBuffer())
  } else {
    raw = await readFile(source)
  }
  if (source.endsWith('.gz')) raw = gunzipSync(raw)
  const data = JSON.parse(raw.toString('utf8'))
  const repos = Array.isArray(data) ? data : data.repos
  if (!Array.isArray(repos)) throw new Error('source has no repos array')
  return { repos, generatedAt: data.generated_at ?? null, source: typeof data.source === 'string' ? data.source : source }
}

const SEGMENTS = [
  { min: 1000, max: null }, { min: 100, max: 999 }, { min: 10, max: 99 },
  { min: 1, max: 9 }, { min: 0, max: 0 },
]

async function fetchPage(query, page) {
  const url = 'https://api.github.com/search/repositories?q=' + encodeURIComponent(query)
    + '&sort=stars&order=desc&per_page=' + PER_PAGE + '&page=' + page
  const res = await fetch(url, { headers: ghHeaders(), signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error('GitHub API ' + res.status)
  return await res.json()
}

async function crawlTopic(topic, existingMap) {
  const found = new Map()
  for (const seg of SEGMENTS) {
    const starQ = seg.max === null ? 'stars:>=' + seg.min : 'stars:' + seg.min + '..' + seg.max
    const query = topic + ' ' + starQ
    for (let page = 1; page <= MAX_PAGES_PER_SEGMENT; page++) {
      let data
      try {
        data = await fetchPage(query, page)
      } catch (e) {
        console.error('[crawl] ' + starQ + ' page ' + page + ' failed: ' + e.message)
        break
      }
      const items = data.items ?? []
      let fresh = 0
      for (const it of items) {
        const key = String(it.full_name).toLowerCase()
        if (!found.has(key) && !existingMap.has(key)) fresh++
        found.set(key, it)
      }
      console.log('[crawl] ' + starQ + ' page ' + page + ': +' + items.length + ' (' + fresh + ' new), unique ' + found.size)
      if (items.length < PER_PAGE) break
      await sleep(DELAY_MS)
    }
    await sleep(DELAY_MS)
  }
  return found
}

/**
 * Probe each repo's root package.json via the raw CDN (no API quota) and mark
 * verified=true only when it actually declares a dsh plugin capability.
 * 第三方体检反馈（P0-2）：把验证下沉到索引构建期，而不是列表期硬编码。
 */
async function verifyItems(items) {
  let ok = 0, notPlugin = 0, unknown = 0
  const out = []
  const queue = [...items]
  let cursor = 0
  async function worker() {
    while (cursor < queue.length) {
      const it = queue[cursor++]
      if (!it.fullName) { out.push(it); continue }
      try {
        const branch = it.defaultBranch || 'main'
        let res = await fetch('https://raw.githubusercontent.com/' + it.fullName + '/' + branch + '/package.json', {
          signal: AbortSignal.timeout(20000),
        })
        // --from 导入的行没有 default_branch：main 404 时补试 master。
        if (!res.ok && res.status === 404 && branch === 'main') {
          res = await fetch('https://raw.githubusercontent.com/' + it.fullName + '/master/package.json', {
            signal: AbortSignal.timeout(20000),
          })
        }
        if (res.ok) {
          const pkg = await res.json()
          it.verified = !!(pkg && typeof pkg === 'object' && pkg.dsh && typeof pkg.dsh === 'object')
          it.verified ? ok++ : notPlugin++
        } else {
          it.verified = false
          notPlugin++
        }
        it.verifiedAt = new Date().toISOString()
      } catch {
        it.verified = null // 网络抖动 — 保持未知
        unknown++
      }
      out.push(it)
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  console.log('[verify] 插件 ' + ok + ' / 非插件 ' + notPlugin + ' / 未知 ' + unknown + '（共 ' + items.length + '）')
  return out
}

const existingMap = new Map()
if (existsSync(OUT)) {
  try {
    const prev = JSON.parse(gunzipSync(await readFile(OUT)).toString('utf8'))
    for (const it of prev.items ?? []) existingMap.set(String(it.fullName).toLowerCase(), it)
  } catch { /* fresh build */ }
}

let rawMap = new Map()
let sourceLabel
if (fromIdx >= 0) {
  const src = argv[fromIdx + 1]
  if (!src) { console.error('--from needs a file/url'); process.exit(1) }
  const loaded = await loadSource(src)
  sourceLabel = loaded.source
  for (const r of loaded.repos) rawMap.set(String(r.full_name).toLowerCase(), r)
  console.log('[import] ' + rawMap.size + ' repos from ' + src)
} else if (crawlIdx >= 0) {
  const topic = KIND === 'skill' ? 'topic:agent-skills' : 'topic:dsh-plugin'
  sourceLabel = 'github-search:' + topic
  rawMap = await crawlTopic(topic, existingMap)
} else {
  console.error('usage: build-registry.mjs --from <file|url> [--kind plugin|skill] [--out f.gz] | --crawl <plugin|skill> [--out f.gz]')
  process.exit(1)
}

const merged = new Map()
for (const [key, oldItem] of existingMap) merged.set(key, oldItem)
for (const [key, raw] of rawMap) merged.set(key, normalizeRepo(raw))

let items = [...merged.values()].sort((a, b) => b.stars - a.stars)
if (TOP_N > 0) items = items.slice(0, TOP_N)
if (VERIFY) items = await verifyItems(items)
await mkdir(dirname(OUT), { recursive: true })
const payload = JSON.stringify({
  generatedAt: new Date().toISOString(),
  count: items.length,
  source: sourceLabel,
  schema_version: 1,
  items,
})
await writeFile(OUT, gzipSync(payload, { level: 9 }))
console.log('written: ' + OUT + ' (' + items.length + ' items)')
