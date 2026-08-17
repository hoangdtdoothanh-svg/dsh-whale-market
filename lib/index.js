/**
 * dsh-whale-market — host half (鲸鱼插件市场).
 *
 * A permanent (bundle) plugin that turns the GitHub dsh-plugin topic into a
 * live, searchable plugin market, installable into ANY dsh profile.
 *
 * Design (own implementation, informed by the open-source marketplace
 * ecosystem — bradeGithub/DSH-Plugins-Marketplace, AwesomeHou/dsh-plugin-marketplace,
 * Noob-stupid/dsh-plugin-hub):
 *
 * 1. PROFILE AUTO-DETECTION. The market installs into the profile it is
 *    mounted in: it scans profiles/* for the manifest whose bundles /
 *    dependencies contain "dsh-whale-market", then falls back to its own
 *    module path, then desktop → web. (The references hardcode the web
 *    profile; this one works for DSH Desktop users.)
 *
 * 2. DATA. GitHub Search API topic:dsh-plugin sorted by stars, paginated
 *    on demand with an in-memory cache (10 min) and a disk snapshot fallback
 *    so the market still opens when GitHub is unreachable / rate-limited.
 *    Per-repo validity probing (package.json declares a dsh plugin) is lazy,
 *    on the /info endpoint, and cached.
 *
 * 3. INSTALL. "dsh plugin --profile <name> add <spec>" (the official CLI
 *    mechanism — it forwards to pnpm and reconciles dsh.profile.bundles).
 *    Runs as a serialized async job with streamed output, poll/cancel
 *    endpoints, a tree-kill watchdog, sensitive-env scrubbing, and a
 *    self-heal pass that re-adds the bundle row if an older CLI skipped it.
 *    pnpm's "ignored build scripts" failure is auto-retried once by adding
 *    the package to allowBuilds in the profile's pnpm-workspace.yaml.
 *
 * 4. AGENT TOOLS. market_search / market_install / market_installed /
 *    market_update through ctx.tools, so the agent itself can browse and
 *    install plugins.
 *
 * HTTP surface (same-origin, loopback host headers only, CSRF header on
 * mutating requests):
 *   GET  /plugins/dsh-whale-market/status
 *   GET  /plugins/dsh-whale-market/list?q=&page=&perPage=&force=
 *   GET  /plugins/dsh-whale-market/info?repo=owner/name
 *   GET  /plugins/dsh-whale-market/installed
 *   POST /plugins/dsh-whale-market/install            { spec }
 *   GET  /plugins/dsh-whale-market/install/status?job=<id>
 *   POST /plugins/dsh-whale-market/install/cancel     { job }
 *   POST /plugins/dsh-whale-market/set-enabled        { name, enabled }
 *   POST /plugins/dsh-whale-market/update             { name }
 *   POST /plugins/dsh-whale-market/uninstall          { name }
 *
 * Zero runtime dependencies: Node built-ins only, so it installs under every
 * layout (junction, plain copy, pnpm, link:).
 * @module dsh-whale-market
 */
import { readFile, writeFile, mkdir, readdir, rename, stat, rm } from 'node:fs/promises'
import { existsSync, statSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

// ---------------------------------------------------------------- constants

export const name = 'whale-market'
export const inject = []

/** This package's npm name — used for profile detection and self-update. */
const PKG_NAME = 'dsh-whale-market'
/** Web-server service key candidates, newest first (defensive ctx.get). */
const WEB_SERVER_KEYS = ['webServer', 'httpServer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILES_DIR = join(DSH_HOME, 'profiles')
/** Our state dir (market-owned install records + list snapshot). */
const MARKET_DIR = join(DSH_HOME, 'market')
const INSTALLED_FILE = join(MARKET_DIR, 'installed.json')
const LIST_CACHE_FILE = join(MARKET_DIR, 'list-cache.json')

const TOPIC_QUERY = 'topic:dsh-plugin'
const GITHUB_SEARCH = 'https://api.github.com/search/repositories'
const DEFAULT_PER_PAGE = 50
const MAX_PER_PAGE = 100
const FETCH_TIMEOUT_MS = 20000
/** Memory cache TTL for list pages. */
const LIST_TTL_MS = 10 * 60 * 1000
/** Repo-info cache TTLs (positive / negative). */
const INFO_TTL_MS = 30 * 60 * 1000
const INFO_NEGATIVE_TTL_MS = 10 * 60 * 1000
/** npm latest-version cache TTL. */
const LATEST_TTL_MS = 15 * 60 * 1000
/** Remote static-index disk cache TTL. */
const STATIC_TTL_MS = 60 * 60 * 1000
/** Install/update/uninstall job watchdog. */
const JOB_TIMEOUT_MS = 10 * 60 * 1000
/** Request body cap. */
const MAX_BODY_BYTES = 64 * 1024
/** CSRF header required on mutating requests (custom headers force preflight). */
const CSRF_HEADER = 'x-dsh-market'
/** Module-load timestamp: installs after this moment need a harness restart. */
const HARNESS_BOOT_MS = Date.now()
/** Repo that receives auto-filed install-feedback issues. */
const FEEDBACK_REPO = 'QiFeng/dsh-whale-market'

/** Official in-box packages — never shown as user-installed market plugins. */
const OFFICIAL_FALLBACK = new Set([
  '@deepseek-ai/cordis', '@deepseek-ai/cosmokit', '@deepseek-ai/schemastery',
  '@deepseek-ai/dsh', '@deepseek-ai/dsh-settings', '@deepseek-ai/dsh-settings-file',
  '@deepseek-ai/dsh-client-runtime', '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-connection', '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-conversation', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-web',
])

/**
 * Environment keys that must never reach a spawned installer (tokens, keys,
 * secrets). Uppercase and camelCase forms both covered.
 */
const ENV_SENSITIVE_PATTERN = /(?<![A-Za-z0-9])(TOKEN|KEY|SECRET|PASSWORD|PASS|CREDENTIALS?)(?![A-Za-z0-9])/i

// ---------------------------------------------------------------- seed index

/**
 * Embedded first-run index snapshot (built by scripts/build-seed.mjs from a
 * community registry build). Served when GitHub is unreachable AND no fresher
 * disk snapshot exists — the market still opens, searches and installs work,
 * just against a stale-but-complete-enough list.
 */
const SEED_FILE = join(dirname(fileURLToPath(import.meta.url)), 'seed-registry.json')
let seedItems = null
let seedMeta = null
try {
  const seedData = JSON.parse(readFileSync(SEED_FILE, 'utf8'))
  if (Array.isArray(seedData?.items)) {
    seedItems = seedData.items
    seedMeta = {
      generatedAt: typeof seedData.generatedAt === 'string' ? seedData.generatedAt : null,
      count: typeof seedData.count === 'number' ? seedData.count : seedItems.length,
      source: typeof seedData.source === 'string' ? seedData.source : 'seed',
    }
  }
} catch { /* no seed shipped with this build */ }

/** Slice the seed index like a search page (client-agnostic filtering). */
function seedPage(q, page, perPage) {
  const kw = String(q ?? '').trim().toLowerCase()
  // 审计反馈：种子索引同样走适配层，剔除误标仓库（如 reactive-resume）。
  const base = applyAdaptor(seedItems ?? [])
  const pool = kw
    ? base.filter((it) =>
        String(it.fullName ?? '').toLowerCase().includes(kw)
        || String(it.name ?? '').toLowerCase().includes(kw)
        || String(it.description ?? '').toLowerCase().includes(kw)
        || String(it.language ?? '').toLowerCase().includes(kw))
    : base
  const start = (page - 1) * perPage
  return {
    items: pool.slice(start, start + perPage),
    total: pool.length,
    fetchedAt: 0,
    fromCache: true,
    error: null,
  }
}

// ---------------------------------------------------------------- helpers

const pathExists = (p) => stat(p).then(() => true).catch(() => false)

async function readJson(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { return fallback }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + Date.now() + '-' + process.pid
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  await rename(tmp, file)
}

/** Loopback-only Host header — the same reachability posture as the GUI. */
function loopbackHost(req) {
  const host = String(req.headers.host || '').toLowerCase()
  return host === '127.0.0.1' || host === 'localhost' || host === '[::1]'
    || host.startsWith('127.0.0.1:') || host.startsWith('localhost:') || host.startsWith('[::1]:')
}

function readJsonBody(req, capBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > capBytes) {
        reject(new Error('request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
        resolve(text.length === 0 ? {} : JSON.parse(text))
      } catch {
        reject(new Error('request body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, code, payload) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function isSensitiveEnvKey(key) {
  return ENV_SENSITIVE_PATTERN.test(String(key ?? ''))
}

/** Installer env: full env minus secrets (they are not needed by pnpm). */
function buildFilteredEnv() {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!isSensitiveEnvKey(key)) env[key] = value
  }
  return env
}

/**
 * Normalize any GitHub repo reference (repository field, full_name, spec)
 * to lowercase owner/repo, or null.
 */
function normalizeRepoRef(url) {
  if (typeof url !== 'string') return null
  const s = url.trim()
    .replace(/^git\+/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .split('#')[0]
  return /^[^/]+\/[^/]+$/.test(s) ? s.toLowerCase() : null
}

/** Extract owner/repo from an install spec (github:…, git urls, owner/repo). */
function githubSpec(spec) {
  const s = String(spec ?? '').trim()
  if (!s) return null
  let m = /^github:([^#]+?)(?:#.*)?$/.exec(s)
  if (m) {
    const ref = m[1].trim()
    return /^[^/]+\/[^/]+$/.test(ref) ? ref : null
  }
  m = /^(?:git\+)?(?:https?|ssh|git):\/\/(?:www\.)?github\.com\/([^/]+\/[^/.]+?)(?:\.git)?(?:[#/].*)?$/i.exec(s)
  if (m) return m[1]
  m = /^git@github\.com:([^/]+\/[^/.]+?)(?:\.git)?$/.exec(s)
  if (m) return m[1]
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s)) return s
  return null
}

/** Local path / link spec, not resolvable by the market's update logic. */
function isLocalSpec(spec) {
  const s = String(spec ?? '').trim()
  return /^(link|file):/i.test(s) || /^[.]{1,2}[\\/]/.test(s)
    || /^[A-Za-z]:[\\/]/.test(s) || /^[\\/]/.test(s)
}

/**
 * Install-spec validation: no shell metacharacters, no newlines, no spaces
 * (the spec is interpolated into a shell command line on Windows). npm names,
 * owner/repo, github:/git+https URLs and tarball URLs all pass.
 */
function validateSpec(raw) {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s || s.length > 500) return null
  if (/[^A-Za-z0-9@._~:/#+=-]/.test(s)) return null
  return s
}

/**
 * DSH plugin eligibility from a package.json (pure):
 * true = declares dsh / depends on dsh core; false = declared but not a
 * plugin; null = cannot judge. Borrowed heuristic, shared with the ecosystem.
 */
export function looksLikeDshPlugin(pkg) {
  if (!pkg || typeof pkg !== 'object') return null
  if (pkg.dsh && typeof pkg.dsh === 'object') return true
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) }
  const names = Object.keys(deps)
  if (names.includes('@deepseek-ai/cordis') || names.includes('@deepseek-ai/dsh')) return true
  return names.some((n) => n.startsWith('@deepseek-ai/dsh-')) ? true : false
}

// ---------------------------------------------------------------- profile layer

/** Resolved profile name + dir, set once by ensureInit(). */
let profile = null
let profileDir = null
let initPromise = null

function ensureInit() {
  if (!initPromise) initPromise = init()
  return initPromise
}

/**
 * Detect the profile this market is mounted in:
 * 1. config.profile override; 2. the manifest whose bundles/dependencies
 *    contain this package; 3. our module path under profiles/<name>;
 *    4. first existing of desktop → web.
 */
async function resolveProfile(cfgProfile) {
  const wanted = typeof cfgProfile === 'string' && cfgProfile.trim() ? cfgProfile.trim() : null
  if (wanted && await pathExists(join(PROFILES_DIR, wanted, 'package.json'))) return wanted
  try {
    const entries = await readdir(PROFILES_DIR, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const pkg = await readJson(join(PROFILES_DIR, e.name, 'package.json'), null)
      if (!pkg) continue
      const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
      const deps = Object.keys(pkg?.dependencies ?? {})
      if (bundles.includes(PKG_NAME) || deps.includes(PKG_NAME)) return e.name
    }
    const here = fileURLToPath(import.meta.url)
    const m = /[\\/]profiles[\\/]([^\\/]+)[\\/]/.exec(here)
    if (m && await pathExists(join(PROFILES_DIR, m[1], 'package.json'))) return m[1]
    for (const candidate of ['desktop', 'web']) {
      if (await pathExists(join(PROFILES_DIR, candidate, 'package.json'))) return candidate
    }
    return wanted ?? 'web'
  } catch {
    return wanted ?? 'web'
  }
}

async function init() {
  profile = await resolveProfile(config.profile ?? null)
  profileDir = join(PROFILES_DIR, profile)
  await loadInstalledRecords()
  await loadSideState()
}

async function profileManifest() {
  return readJson(join(profileDir, 'package.json'), null)
}

/** Serialize manifest read-modify-write (enable/disable, bundle self-heal). */
let manifestLock = Promise.resolve()
function withManifestLock(task) {
  const run = manifestLock.then(task, task)
  manifestLock = run.catch(() => {})
  return run
}

async function writeProfileManifest(manifest) {
  await writeJsonAtomic(join(profileDir, 'package.json'), manifest)
}

async function installedPackageJson(name) {
  return readJson(join(profileDir, 'node_modules', ...String(name).split('/'), 'package.json'), null)
}

/** Preflight errors for the install target profile, or null when usable. */
async function profileInstallableError() {
  if (!await pathExists(join(profileDir, 'package.json'))) {
    return 'profile ' + profile + ' 不存在（' + profileDir + '）。请先启动过 dsh（会自动初始化 profile），或运行 dsh plugin --profile ' + profile + ' 初始化后再试。'
  }
  if (!await pathExists(join(profileDir, 'pnpm-workspace.yaml'))) {
    return 'profile ' + profile + ' 缺少 pnpm-workspace.yaml（不是有效的 pnpm workspace）。请在 ' + profileDir + ' 下创建：\npackages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false'
  }
  return null
}

// ---------------------------------------------------------------- installed records

/** Market-owned install records: repo (or spec) -> { name, spec, installedAt }. */
const installedMap = new Map()
let installedQueue = Promise.resolve()

async function loadInstalledRecords() {
  try {
    const data = JSON.parse(await readFile(INSTALLED_FILE, 'utf8'))
    if (data && typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) installedMap.set(String(key).toLowerCase(), value)
    }
  } catch { /* first run */ }
}

async function saveInstalledRecords() {
  const task = (async () => {
    const data = {}
    for (const [key, value] of installedMap) data[key] = value
    await writeJsonAtomic(INSTALLED_FILE, data)
  })()
  installedQueue = installedQueue.catch(() => {}).then(() => task)
  return installedQueue
}

async function recordInstall(spec, realName, type = 'plugin', destDir = null) {
  const key = (normalizeRepoRef(spec) ?? githubSpec(spec) ?? String(spec)).toLowerCase()
  installedMap.set(key, {
    name: realName,
    spec,
    type,
    destDir,
    installedAt: new Date().toISOString(),
  })
  await saveInstalledRecords()
  await appendHistory({ action: 'install', name: realName, repo: key, type })
  if (type === 'plugin' && normalizeRepoRef(spec)) {
    await queueFeedback({ repo: key, name: realName, installedAt: new Date().toISOString() })
  }
}

/** Find a market record by installed name or by record key. */
function findMarketRecord(name) {
  const key = String(name ?? '').toLowerCase()
  for (const [k, v] of installedMap) {
    if (v?.name === name || k === key) return { key: k, record: v }
  }
  return null
}

async function recordUninstall(name) {
  let touched = false
  for (const [key, value] of installedMap) {
    if (value?.name === name || key === String(name).toLowerCase()) {
      installedMap.delete(key)
      touched = true
    }
  }
  if (touched) await saveInstalledRecords()
  if (touched) await appendHistory({ action: 'uninstall', name })
}

// ---------------------------------------------------------------- favorites / history / env / feedback

const FAVORITES_FILE = join(MARKET_DIR, 'favorites.json')
const HISTORY_FILE = join(MARKET_DIR, 'history.json')
const ENVS_FILE = join(MARKET_DIR, 'envs.json')
const FEEDBACK_FILE = join(MARKET_DIR, 'feedback.json')
const DOTENV_FILE = join(DSH_HOME, '.env')

let favorites = new Set()
let history = []
let envStore = {}
let feedbackPending = []
let historyQueue = Promise.resolve()
let envQueue = Promise.resolve()
let feedbackQueue = Promise.resolve()

async function loadSideState() {
  try {
    const f = JSON.parse(await readFile(FAVORITES_FILE, 'utf8'))
    if (Array.isArray(f?.repos)) favorites = new Set(f.repos.map((x) => String(x).toLowerCase()))
  } catch { /* first run */ }
  try {
    const h = JSON.parse(await readFile(HISTORY_FILE, 'utf8'))
    if (Array.isArray(h?.events)) history = h.events
  } catch { /* first run */ }
  try {
    const e = JSON.parse(await readFile(ENVS_FILE, 'utf8'))
    if (e && typeof e === 'object') envStore = e
  } catch { /* first run */ }
  try {
    const fb = JSON.parse(await readFile(FEEDBACK_FILE, 'utf8'))
    if (Array.isArray(fb?.pending)) feedbackPending = fb.pending
  } catch { /* first run */ }
}

/** Append one audit entry to the history ring (max 300, oldest dropped). */
function appendHistory(entry) {
  history.push({ ...entry, at: new Date().toISOString() })
  if (history.length > 300) history = history.slice(-300)
  const task = writeJsonAtomic(HISTORY_FILE, { events: history })
  historyQueue = historyQueue.catch(() => {}).then(() => task)
  return historyQueue
}

// ---- favorites ----

async function setFavorite(repo, fav) {
  const key = String(repo ?? '').trim().toLowerCase()
  if (!/^[^/]+\/[^/]+$/.test(key)) return { ok: false, error: 'repo 应为 owner/name' }
  if (fav) favorites.add(key); else favorites.delete(key)
  await writeJsonAtomic(FAVORITES_FILE, { repos: [...favorites] })
  return { ok: true, favorite: !!fav }
}

function favoriteState() {
  return { repos: [...favorites] }
}

// ---- env management ----

function isValidEnvKey(key) {
  if (typeof key !== 'string' || !key) return false
  if (/^DSH_[A-Z0-9_]+$/.test(key)) return false
  return /^[A-Z][A-Z0-9_]{1,}$/.test(key) || /^[a-z][A-Za-z0-9]*(?:ApiKey|Token|Secret|Password)$/.test(key)
}

/** Merge entries into DSH_HOME/.env (dsh user layer), preserving other lines. */
async function writeDotEnv(entries) {
  let lines = []
  try { lines = (await readFile(DOTENV_FILE, 'utf8')).split(/\r?\n/) } catch { /* first write */ }
  const keyPattern = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/
  for (const [key, rawValue] of Object.entries(entries)) {
    if (!isValidEnvKey(key)) continue
    const cleaned = String(rawValue ?? '').replace(/[\r\n]+/g, ' ')
    const line = key + '=' + (/[\s"'#]/.test(cleaned) ? '"' + cleaned.replace(/"/g, '\\"') + '"' : cleaned)
    let replaced = false
    for (let i = 0; i < lines.length; i++) {
      const m = keyPattern.exec(lines[i])
      if (m && m[1] === key) { lines[i] = line; replaced = true; break }
    }
    if (!replaced) lines.push(line)
  }
  await mkdir(DSH_HOME, { recursive: true })
  await writeFile(DOTENV_FILE, lines.join('\n') + '\n', 'utf8')
}

async function envOp(name, values) {
  const key = String(name ?? '').trim()
  if (!key) return { ok: false, error: '需要插件名' }
  const current = { ...(envStore[key] ?? {}) }
  const applied = []
  for (const [k, raw] of Object.entries(values ?? {})) {
    if (!isValidEnvKey(k)) continue
    const v = String(raw ?? '').trim().slice(0, 4000)
    if (v === '') delete current[k]; else current[k] = v
    applied.push(k)
  }
  if (applied.length === 0) return { ok: false, error: '没有合法的环境变量名（UPPER_SNAKE；DSH_ 前缀为保留字）' }
  envStore = { ...envStore, [key]: current }
  const task = (async () => {
    await writeJsonAtomic(ENVS_FILE, envStore)
    await writeDotEnv(current)
  })()
  envQueue = envQueue.catch(() => {}).then(() => task)
  await envQueue
  await appendHistory({ action: 'env', name: key, keys: applied })
  return { ok: true, applied }
}

/** Env-key candidates scanned from the installed package's README. */
async function envCandidates(name) {
  const pkgDir = join(profileDir, 'node_modules', ...String(name).split('/'))
  const candidates = []
  const seen = new Set()
  try {
    const readme = await readFile(join(pkgDir, 'README.md'), 'utf8').catch(() => '')
    const re = /([A-Z][A-Z0-9_]{2,})/g
    let m
    while ((m = re.exec(readme)) !== null && candidates.length < 20) {
      const k = m[1]
      if (seen.has(k) || /DSH_/.test(k)) continue
      if (/(API|KEY|TOKEN|SECRET|PASSWORD|PASS|MODEL|BASE_URL|HOST|PORT|PROXY|REGION|ENDPOINT|APP_ID|CLIENT)/.test(k)) {
        seen.add(k)
        candidates.push(k)
      }
    }
  } catch { /* no readme */ }
  return { saved: envStore[name] ?? {}, candidates }
}

// ---- install feedback (GitHub issue) ----

async function queueFeedback(entry) {
  feedbackPending = feedbackPending.filter((f) => f.repo !== entry.repo)
  feedbackPending.push(entry)
  const task = writeJsonAtomic(FEEDBACK_FILE, { pending: feedbackPending })
  feedbackQueue = feedbackQueue.catch(() => {}).then(() => task)
  await feedbackQueue
}

async function feedbackOp(body) {
  const repo = String(body?.repo ?? '').trim()
  const ok = body?.ok === true
  const note = String(body?.note ?? '').slice(0, 1000)
  if (!repo) return { ok: false, error: 'repo required' }
  feedbackPending = feedbackPending.filter((f) => f.repo !== repo)
  const task = writeJsonAtomic(FEEDBACK_FILE, { pending: feedbackPending })
  feedbackQueue = feedbackQueue.catch(() => {}).then(() => task)
  await feedbackQueue
  const title = '[安装反馈] ' + (ok ? '✅ 正常' : '❌ 异常') + ': ' + repo
  const bodyText = '**插件**: ' + repo + '\n**结果**: ' + (ok ? '正常安装并运行' : '安装/运行异常') + (note ? '\n**备注**: ' + note : '') + '\n\n_(由 DSH 插件市场自动提交)_'
  const manualUrl = 'https://github.com/' + FEEDBACK_REPO + '/issues/new?' + new URLSearchParams({ title, body: bodyText }).toString()
  const token = typeof config.githubToken === 'string' ? config.githubToken.trim() : ''
  if (!token) return { ok: true, manualUrl }
  const create = (withLabel) => fetch('https://api.github.com/repos/' + FEEDBACK_REPO + '/issues', {
    method: 'POST',
    headers: {
      'User-Agent': 'dsh-whale-market',
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body: bodyText, ...(withLabel ? { labels: ['install-feedback'] } : {}) }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  try {
    let res = await create(true)
    if (res.status === 422) res = await create(false) // label not created yet
    if (!res.ok) return { ok: true, manualUrl, error: 'GitHub API ' + res.status }
    const issue = await res.json()
    return { ok: true, issueUrl: issue.html_url }
  } catch (error) {
    return { ok: true, manualUrl, error: String(error?.message ?? error) }
  }
}

// ---- backup / restore ----

let restoreState = null

async function restoreOp(records) {
  if (restoreState?.running) return { ok: false, error: '已有恢复任务进行中' }
  const list = Object.entries(records ?? {}).map(([repo, rec]) => ({ repo, ...(rec ?? {}) }))
  const targets = list.filter((t) => !installedMap.has(String(t.repo).toLowerCase()))
  if (targets.length === 0) return { ok: true, restoring: 0, skipped: list.length, note: '备份中的项目已全部安装' }
  restoreState = { running: true, total: targets.length, done: [], failed: [], current: null, finished: false }
  ;(async () => {
    for (const t of targets) {
      restoreState.current = t.repo
      let spec = typeof t.spec === 'string' && t.spec ? t.spec : (t.type && t.type !== 'plugin' ? t.repo : 'github:' + t.repo)
      let r
      if (t.type === 'script') {
        restoreState.failed.push({ repo: t.repo, error: '脚本类型安装需人工确认，已跳过' })
        continue
      }
      try {
        r = t.type === 'skill' ? await installOp(spec, true)
          : t.type === 'preset' ? await installOp(spec, true)
          : await installOp(spec, true)
      } catch (error) {
        r = { ok: false, error: String(error?.message ?? error) }
      }
      if (r?.ok) restoreState.done.push(t.repo)
      else restoreState.failed.push({ repo: t.repo, error: r?.error ?? 'failed' })
    }
    restoreState.running = false
    restoreState.finished = true
    restoreState.current = null
  })().catch((error) => {
    restoreState.running = false
    restoreState.finished = true
    restoreState.failed.push({ repo: restoreState.current, error: String(error?.message ?? error) })
  })
  return { ok: true, restoring: targets.length }
}


/** repo -> { name, needsRestart } for everything the profile actually has. */
async function installedInfo() {
  const info = new Map()
  const manifest = await profileManifest()
  if (manifest) {
    for (const [depName, spec] of Object.entries(manifest.dependencies ?? {})) {
      const gh = githubSpec(spec)
      const inst = await installedPackageJson(depName)
      const repo = (gh || normalizeRepoRef(inst?.repository?.url ?? inst?.repository ?? '') || '').toLowerCase()
      if (repo) info.set(repo, { name: depName, needsRestart: needsRestart(depName) })
    }
  }
  for (const [repo, record] of installedMap) {
    if (!info.has(repo)) info.set(repo, { name: record?.name ?? null, needsRestart: false })
  }
  return info
}

/** Whether the package dir was created after this harness booted. */
function needsRestart(name) {
  try {
    const file = join(profileDir, 'node_modules', ...String(name).split('/'), 'package.json')
    if (!existsSync(file)) return false
    return statSync(file).mtimeMs > HARNESS_BOOT_MS
  } catch {
    return false
  }
}

// ---------------------------------------------------------------- adaptor / categories / static index

/** adaptor.json: hard-coded fixes for mislabeled repos (redirect on install). */
let adaptorRedirects = []
const adaptorFrom = new Set()
let adaptorAdditions = []
try {
  const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'adaptor.json'), 'utf8'))
  for (const r of raw?.redirects ?? []) {
    if (typeof r?.from !== 'string' || typeof r?.to !== 'string') continue
    adaptorRedirects.push(r)
    adaptorFrom.add(r.from.toLowerCase())
    if (r.meta && typeof r.meta?.full_name === 'string') adaptorAdditions.push(r)
  }
} catch { /* adaptor.json absent — layer idles */ }

/** Filter mislabeled entries and inject the real plugin rows into a list. */
function applyAdaptor(items) {
  if (adaptorRedirects.length === 0 || !Array.isArray(items)) return items
  const out = items.filter((it) => !adaptorFrom.has(String(it?.fullName ?? '').toLowerCase()))
  for (const r of adaptorAdditions) {
    if (!out.some((it) => String(it?.fullName ?? '').toLowerCase() === r.meta.full_name.toLowerCase())) {
      out.push(normalizeStaticItem(r.meta))
    }
  }
  return out
}

/** Install-time redirect: mislabeled repo -> real plugin repo. */
function adaptorTarget(repoFull) {
  const hit = adaptorRedirects.find((r) => r.from.toLowerCase() === String(repoFull ?? '').toLowerCase())
  return hit ? hit.to : null
}

/** lib/categories.json — community-maintained category rules (first match wins). */
let categories = []
try {
  const raw = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'categories.json'), 'utf8'))
  categories = Array.isArray(raw?.categories) ? raw.categories : []
} catch { /* no categories shipped */ }

function categorizeItem(it) {
  const hay = [it.name, it.description, (it.topics ?? []).join(' ')].join(' ').toLowerCase()
  for (const cat of categories) {
    for (const m of cat.match ?? []) {
      if (m && hay.includes(String(m).toLowerCase())) return cat.id
    }
  }
  return 'misc'
}

function categoryLabel(id) {
  const cat = categories.find((x) => x.id === id)
  return cat?.label ?? String(id)
}

/** Normalize a registry/skills index row into the market item schema. */
function normalizeStaticItem(r) {
  const entry = {
    fullName: String(r.full_name || r.fullName || ''),
    name: String(r.name || ''),
    url: String(r.html_url || r.url || ''),
    description: String(r.description || ''),
    stars: typeof (r.stargazers_count ?? r.stars) === 'number' ? (r.stargazers_count ?? r.stars) : 0,
    language: String(r.language || ''),
    updatedAt: String(r.updated_at || r.updatedAt || ''),
    homepage: String(r.homepage || ''),
    topics: Array.isArray(r.topics) ? r.topics : [],
    license: typeof r.license === 'string' ? r.license : (r.license?.spdx_id ?? null),
    hasSkill: typeof (r.has_skill ?? r.hasSkill) === 'boolean' ? (r.has_skill ?? r.hasSkill) : null,
    verified: typeof r.verified === 'boolean' ? r.verified : null,
    verifiedAt: typeof r.verifiedAt === 'string' ? r.verifiedAt : null,
  }
  entry.category = categorizeItem(entry)
  return entry
}

/** Static indexes: bundled .json.gz, optionally replaced by remote CI-built
 *  registryUrl / skillsUrl (disk-cached 1h). Loaded lazily on first need. */
let staticPlugins = null
let staticSkills = null
let staticLoader = null

function ensureStatic() {
  if (!staticLoader) staticLoader = loadStaticIndexes()
  return staticLoader
}

async function loadStaticIndexes() {
  const pluginsUrl = typeof config.registryUrl === 'string' && config.registryUrl.trim() ? config.registryUrl.trim() : null
  const skillsUrl = typeof config.skillsUrl === 'string' && config.skillsUrl.trim() ? config.skillsUrl.trim() : null
  const [plugins, skills] = await Promise.all([
    loadStaticKind(pluginsUrl, 'registry'),
    loadStaticKind(skillsUrl, 'skills'),
  ])
  staticPlugins = plugins
  staticSkills = skills
  return { plugins, skills }
}

async function loadStaticKind(remoteUrl, kindName) {
  if (remoteUrl) {
    const cacheFile = join(MARKET_DIR, 'static-' + kindName + '.json')
    const cached = await readJson(cacheFile, null)
    if (cached && Array.isArray(cached.items) && Date.now() - (cached.fetchedAt ?? 0) < STATIC_TTL_MS) {
      return { ...cached, source: 'remote-cache' }
    }
    try {
      const res = await fetch(remoteUrl, { signal: AbortSignal.timeout(60000) })
      if (res.ok) {
        const text = await res.text()
        const json = JSON.parse(text)
        const rawItems = Array.isArray(json) ? json : (json.repos ?? json.items ?? [])
        const items = applyAdaptor(rawItems.map(normalizeStaticItem))
        const record = { items, generatedAt: json.generatedAt ?? new Date().toISOString(), count: items.length, source: 'remote', fetchedAt: Date.now() }
        await writeJsonAtomic(cacheFile, record)
        return record
      }
    } catch { /* fall through to stale cache / bundled */ }
    if (cached && Array.isArray(cached.items)) return { ...cached, source: 'remote-cache' }
  }
  try {
    const gz = readFileSync(join(dirname(fileURLToPath(import.meta.url)), kindName + '.json.gz'))
    const json = JSON.parse(gunzipSync(gz).toString('utf8'))
    const rawItems = Array.isArray(json) ? json : (json.items ?? [])
    const items = applyAdaptor(rawItems.map(normalizeStaticItem))
    return { items, generatedAt: json.generatedAt ?? null, count: items.length, source: 'bundled', fetchedAt: 0 }
  } catch {
    return null
  }
}

/** Serve a filtered + paged slice of a static index. */
// ---------------------------------------------------------------- function-word search

/**
 * Functional-word aliases: Chinese functional queries (看图 / 记忆 / 皮肤 ...)
 * expand to a set of English/synonym keywords, so searching by capability
 * works on both the live GitHub query and the static index.
 */
const FUNCTION_ALIASES = {
  "看图": ["vision","image","ocr","screen","screenshot","图片","视觉"],
  "图片": ["vision","image","ocr","图片","视觉"],
  "视觉": ["vision","image","ocr","visual","视觉"],
  "记忆": ["memory","hindsight","remember","knowledge","记忆"],
  "皮肤": ["skin","theme","appearance","皮肤","主题"],
  "主题": ["skin","theme","appearance","主题"],
  "美化": ["skin","theme","beautify","美化"],
  "浏览器": ["browser","chrome","edge","浏览器"],
  "网页": ["web","browser","scrape","crawl","网页"],
  "抓取": ["scrape","crawler","fetch","爬虫"],
  "自动化": ["workflow","automation","pipeline","自动化"],
  "工作流": ["workflow","automation","pipeline","工作流"],
  "翻译": ["translate","translation","翻译"],
  "语音": ["voice","speech","audio","语音"],
  "视频": ["video","视频"],
  "音乐": ["music","audio","音乐"],
  "表格": ["excel","csv","spreadsheet","表格"],
  "文档": ["pdf","doc","document","文档","word"],
  "工具": ["tool","utility","utils","工具"],
  "团队": ["teams","multi-agent","subagent","团队"],
  "预设": ["preset","presets","预设"],
  "技能": ["skill","skills","技能"],
  "数据": ["data","database","csv","数据"],
  "开发": ["code","coding","dev","developer","开发","编程"],
  "编程": ["code","coding","dev","编程"],
  "邮件": ["email","mail","邮件"],
  "通知": ["notify","notification","提醒"],
  "游戏": ["game","games","游戏"],
  "mcp": ["mcp"],
  "键盘": ["keyboard","hotkey","shortcut","快捷键"],
  "终端": ["terminal","tui","cli","终端"],
  "文本": ["text","txt","markdown","文本"],
  "代码": ["code","snippet","代码"],
  "效率": ["productivity","efficiency","效率"],
  "聊天": ["chat","conversation","对话"],
  "任务": ["task","todo","任务"],
  "笔记": ["note","notes","笔记"],
}

/** Expand a query into search keywords: exact alias hits map to their
 *  synonym set; otherwise the raw term is kept (plus its lowercase form). */
function expandFunctionQuery(q) {
  const raw = String(q ?? "").trim()
  if (!raw) return []
  const lower = raw.toLowerCase()
  const aliasHit = FUNCTION_ALIASES[raw] || FUNCTION_ALIASES[lower]
  if (aliasHit) return aliasHit
  return [raw]
}

/** Build a GitHub search query fragment: `(a OR b OR c)` when expanded,
 *  plain term otherwise — used inside the topic query. */
function functionQueryFragment(q) {
  const terms = [...new Set(expandFunctionQuery(q))].filter(Boolean)
  if (terms.length <= 1) return (terms[0] || "").trim()
  return "(" + terms.join(" OR ") + ")"
}

/** Multi-term OR matcher for the static index (any keyword hits). */
function matchFunctionTerms(it, terms) {
  const hay = [it.fullName, it.name, it.description, (it.topics ?? []).join(" "), it.language]
    .join(" ").toLowerCase()
  return terms.some((t) => hay.includes(String(t).toLowerCase()))
}

function staticPage(items, q, page, perPage, category, language, sort, verifiedOnly = false) {
  let pool = items
  const kw = String(q ?? "").trim()
  if (kw) {
    const terms = expandFunctionQuery(kw)
    pool = pool.filter((it) => matchFunctionTerms(it, terms))
  }
  if (category && category !== 'all') pool = pool.filter((it) => (it.category ?? 'misc') === category)
  if (language && language !== 'all') pool = pool.filter((it) => String(it.language ?? '').toLowerCase() === String(language).toLowerCase())
  // 第三方体检反馈（P0-2）：只看索引构建期验证（声明 dsh 能力）的仓库。
  if (verifiedOnly) pool = pool.filter((it) => it.verified === true)
  pool = (sort === 'updated' || sort === 'trending')
    ? [...pool].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    : [...pool].sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0))
  const start = (page - 1) * perPage
  return { items: pool.slice(start, start + perPage), total: pool.length }
}

// ---------------------------------------------------------------- GitHub list
const listCache = new Map() // key -> { items, total, fetchedAt }
const listInflight = new Map() // key -> Promise

async function fetchGithubSearch(q, page, perPage, sort) {
  const params = new URLSearchParams({
    q, per_page: String(perPage), page: String(page),
    sort: (sort === 'updated' || sort === 'trending') ? 'updated' : 'stars', order: 'desc',
  })
  const res = await fetch(GITHUB_SEARCH + '?' + params.toString(), {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-whale-market',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error('GitHub API ' + res.status)
  const data = await res.json()
  const items = (Array.isArray(data.items) ? data.items : []).map((it) => {
    const entry = {
      fullName: String(it.full_name || ''),
      name: String(it.name || ''),
      url: String(it.html_url || ''),
      description: String(it.description || ''),
      stars: typeof it.stargazers_count === 'number' ? it.stargazers_count : 0,
      language: String(it.language || ''),
      updatedAt: String(it.updated_at || ''),
      homepage: String(it.homepage || ''),
      topics: Array.isArray(it.topics) ? it.topics : [],
      license: it.license?.spdx_id ?? null,
    }
    entry.category = categorizeItem(entry)
    return entry
  })
  return {
    items: applyAdaptor(items),
    total: typeof data.total_count === 'number' ? data.total_count : 0,
  }
}

/** Write / read the top-page disk snapshot (offline + rate-limit fallback). */
async function saveListSnapshot(record) {
  try {
    await writeJsonAtomic(LIST_CACHE_FILE, {
      items: record.items, total: record.total, fetchedAt: Date.now(),
    })
  } catch { /* cache dir failure is non-fatal */ }
}

async function loadListSnapshot() {
  try {
    const data = JSON.parse(await readFile(LIST_CACHE_FILE, 'utf8'))
    if (Array.isArray(data?.items)) return data
  } catch { /* no snapshot yet */ }
  return null
}

/**
 * One live-vs-fallback market page. Live = GitHub Search per kind topic;
 * fallback chain = same-page stale cache -> static index (bundled/remote) ->
 * disk snapshot -> embedded seed. kind: plugin | skill.
 */
async function ensurePage(kind, q, page, perPage, force = false, sort = 'stars') {
  if (sort === 'trending') sort = 'updated'
  const topic = kind === 'skill' ? 'topic:agent-skills' : TOPIC_QUERY
  const query = q ? topic + ' ' + functionQueryFragment(q) : topic
  const key = [kind, query, page, perPage, sort].join('|')
  const cached = listCache.get(key)
  if (!force && cached && Date.now() - cached.fetchedAt < LIST_TTL_MS) return cached
  if (listInflight.has(key)) return listInflight.get(key)
  const task = (async () => {
    try {
      const fetched = await fetchGithubSearch(query, page, perPage, sort)
      const record = { ...fetched, fetchedAt: Date.now(), fromCache: false, error: null }
      listCache.set(key, record)
      if (kind === 'plugin' && !q && page === 1) await saveListSnapshot(record)
      return record
    } catch (error) {
      // Same-page cache even when stale.
      if (cached) return { ...cached, error: String(error?.message ?? error), fromCache: true }
      // Static index for this kind (complete, searchable offline).
      const st = await ensureStatic()
      const idx = kind === 'skill' ? st.skills : st.plugins
      if (idx && idx.items?.length) {
        const when = idx.generatedAt ? new Date(idx.generatedAt).toLocaleDateString() : '未知日期'
        return {
          ...staticPage(idx.items, q, page, perPage, null, null, sort),
          fetchedAt: 0,
          fromCache: true,
          error: 'GitHub 不可达（' + String(error?.message ?? error) + '），显示静态索引（' + idx.count + ' 条 · 生成于 ' + when + ' · 源 ' + idx.source + '）',
        }
      }
      // Disk snapshot for the plugin root page.
      if (kind === 'plugin' && !q && page === 1) {
        const snapshot = await loadListSnapshot()
        if (snapshot) {
          const when = snapshot.fetchedAt ? new Date(snapshot.fetchedAt).toLocaleString() : '上次'
          return { ...snapshot, fromCache: true, error: '网络不可用，显示 ' + when + ' 的快照：' + String(error?.message ?? error) }
        }
      }
      // Last resort: the embedded seed index.
      if (kind === 'plugin' && seedItems) {
        const when = seedMeta.generatedAt ? new Date(seedMeta.generatedAt).toLocaleDateString() : '未知日期'
        return {
          ...seedPage(q, page, perPage),
          error: 'GitHub 不可达（' + String(error?.message ?? error) + '），显示内置索引快照（' + seedMeta.count + ' 条 · 生成于 ' + when + '）',
        }
      }
      throw error
    } finally {
      listInflight.delete(key)
    }
  })()
  listInflight.set(key, task)
  return task
}

// ---------------------------------------------------------------- repo info

const infoCache = new Map() // repo -> { at, value }

async function repoInfo(repoFull) {
  const repo = String(repoFull ?? '').trim()
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    return { repo, valid: null, error: 'repo 参数应为 owner/name' }
  }
  const key = repo.toLowerCase()
  const hit = infoCache.get(key)
  if (hit && Date.now() - hit.at < (hit.value.error ? INFO_NEGATIVE_TTL_MS : INFO_TTL_MS)) return hit.value
  const value = await fetchRepoInfo(repo)
  infoCache.set(key, { at: Date.now(), value })
  return value
}

/** Fetch a repo's file list: GitHub git/trees first, jsDelivr flat listing fallback. */
async function repoTree(repo, branch) {
  try {
    const res = await fetch('https://api.github.com/repos/' + repo + '/git/trees/' + branch + '?recursive=1', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-whale-market' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.ok) {
      const json = await res.json()
      if (Array.isArray(json.tree)) return json.tree.map((t) => String(t.path ?? '')).filter(Boolean)
    }
  } catch { /* jsDelivr fallback */ }
  try {
    const meta = await fetch('https://data.jsdelivr.com/v1/packages/gh/' + repo, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (meta.ok) {
      const j = await meta.json()
      const version = typeof j?.tags?.latest === 'string' ? j.tags.latest : null
      if (version) {
        const files = await fetch('https://data.jsdelivr.com/v1/packages/gh/' + repo + '@' + version + '?structure=flat', {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        })
        if (files.ok) {
          const fj = await files.json()
          return (fj.files ?? []).map((f) => String(f.name ?? '')).filter(Boolean)
        }
      }
    }
  } catch { /* unreachable */ }
  return null
}

/** Compatibility score from manifest facts + repo tree. */
function computeScore(files, pkg) {
  const reasons = []
  let level = 'ok'
  if (!pkg || typeof pkg !== 'object') {
    return { level: 'unknown', reasons: ['无 package.json'] }
  }
  const hasDsh = !!(pkg.dsh && typeof pkg.dsh === 'object')
  if (!hasDsh) {
    level = 'bad'
    reasons.push('未声明 dsh 字段（非 DSH 插件）')
    return { level, reasons }
  }
  const patch = pkg.dsh?.bundle?.patch
  if (patch && files && !files.includes(String(patch).replace(/^\.\//, ''))) {
    level = 'warn'
    reasons.push('声明的 bundle patch 文件在仓库中不存在')
  }
  const main = pkg.main ?? (typeof pkg.exports === 'object' && typeof pkg.exports['.'] === 'string' ? pkg.exports['.'] : null)
  if (main && files && !files.includes(String(main).replace(/^\.\//, ''))) {
    level = level === 'ok' ? 'warn' : level
    reasons.push('main 入口文件在仓库中不存在（可能未构建）')
  }
  if (pkg.dsh?.client && !pkg.peerDependencies?.react) {
    level = level === 'ok' ? 'warn' : level
    reasons.push('声明了 client 半侧但缺少 react peer 依赖')
  }
  return { level, reasons }
}

/** Classify a repo from its root files + package.json facts.
 *  Order: declared cordis plugin > agent preset > skill > install script >
 *  package-only (unverified) > manual. */
function detectType(files, pkg) {
  const hasPkg = files ? files.includes('package.json') : (pkg ? true : null)
  const dshDeclared = !!(pkg && typeof pkg === 'object' && pkg.dsh && typeof pkg.dsh === 'object')
  if (hasPkg && dshDeclared) return { type: 'plugin', reason: 'package.json 声明了 dsh 插件能力（dsh 字段）' }
  if (files && files.includes('preset.yml') && files.includes('agent.cordis.yml')) {
    return { type: 'preset', reason: '根目录 preset.yml + agent.cordis.yml（完整 agent 预设）' }
  }
  if (files && files.includes('SKILL.md')) return { type: 'skill', reason: '根目录 SKILL.md（技能注册器热加载）' }
  if (files && (files.includes('install.sh') || files.includes('install.ps1'))) {
    return { type: 'script', reason: '根目录安装脚本 install.sh / install.ps1（执行需确认）' }
  }
  if (hasPkg) return { type: 'plugin', reason: '根 package.json 存在但未声明 dsh 能力 — 可能不是 DSH 插件' }
  return { type: 'manual', reason: '无可自动安装的内容（SKILL.md / 预设 / 安装脚本 / 插件清单均缺失）' }
}

/**
 * Static danger-pattern scan of install.sh / install.ps1 (script repos only).
 * Pure text classifier — exported so the host smoke test can cover it
 * without network.
 */
export function scanScriptText(text) {
  const hazards = []
  // 审计修复：原正则 \|(sh|...) 要求管道后紧跟 sh，而真实场景多为 " | sh"（管道后带空格），
  // 即使补上 res.text() 也永不命中——允许管道后空白。
  if (/(curl|wget|Invoke-WebRequest)[^\n|]*\|\s*(sh|bash|cmd|powershell)/i.test(text)) hazards.push('downloadExec: 下载并直接执行（管道直通 shell）')
  if (/(PATH|Startup|启动项|开机启动|RegisterStartupTask|schtasks)/i.test(text)) hazards.push('pathStartup: 写 PATH / 启动项 / 持久化')
  if (/(.env|.ssh|.aws|credentials.yaml|settings.yaml|.credentials)/i.test(text)) hazards.push('credRead: 读取凭据文件')
  if (/(bashrc|zshrc|profile|Microsoft.PowerShell_profile)/i.test(text)) hazards.push('rcModify: 修改 shell 启动配置')
  return hazards
}

/** Fetch install.sh / install.ps1 and run the danger scan. */
async function scanScriptHazards(repo, branch) {
  const hazards = []
  for (const name of ['install.sh', 'install.ps1']) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + name, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) continue
      // 审计修复（2026-08-16）：此前缺少 res.text()，正则抛 ReferenceError
      // 被空 catch 吞掉，危险扫描恒为空数组——安全功能静默失效。
      const text = await res.text()
      for (const h of scanScriptText(text)) hazards.push(h)
    } catch { /* script unreachable */ }
  }
  return hazards
}

async function fetchRepoInfo(repo) {
  let meta = null
  try {
    const res = await fetch('https://api.github.com/repos/' + repo, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-whale-market' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (res.ok) meta = await res.json()
  } catch { /* fall through to jsDelivr */ }
  const branch = typeof meta?.default_branch === 'string' ? meta.default_branch : null
  let pkg = null
  let pkgFrom = null
  if (branch) {
    try {
      const res = await fetch('https://raw.githubusercontent.com/' + repo + '/' + branch + '/package.json', {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok) { pkg = await res.json(); pkgFrom = 'raw' }
    } catch { /* next attempt */ }
  }
  if (!pkg) {
    // jsDelivr fallback (usually reachable when GitHub raw/API are not).
    try {
      const data = await fetch('https://data.jsdelivr.com/v1/packages/gh/' + repo, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (data.ok) {
        const json = await data.json()
        const version = typeof json?.tags?.latest === 'string' ? json.tags.latest : null
        if (version) {
          const pkgRes = await fetch('https://cdn.jsdelivr.net/gh/' + repo + '@' + version + '/package.json', {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          })
          if (pkgRes.ok) { pkg = await pkgRes.json(); pkgFrom = 'jsdelivr' }
        }
      }
    } catch { /* last resort exhausted */ }
  }
  const files = await repoTree(repo, branch)
  const detected = detectType(files, pkg)
  const valid = looksLikeDshPlugin(pkg) === true
  const info = {
    repo,
    valid,
    dshDeclared: !!(pkg && typeof pkg === 'object' && pkg.dsh && typeof pkg.dsh === 'object'),
    name: typeof pkg?.name === 'string' ? pkg.name : null,
    version: typeof pkg?.version === 'string' ? pkg.version : null,
    defaultBranch: branch,
    type: detected.type,
    typeReason: detected.reason,
    score: computeScore(files, pkg),
    rootFiles: files ? files.filter((f) => !f.includes('/')).slice(0, 60) : null,
    hazards: [],
    pkgFrom,
    error: pkg || files ? null : '无法获取仓库信息（GitHub 不可达）',
  }
  if (detected.type === 'script' && branch) {
    info.hazards = await scanScriptHazards(repo, branch)
  }
  return info
}

// ---------------------------------------------------------------- latest versions

const latestCache = new Map() // name -> { at, version }
const latestInflight = new Map()

async function npmLatest(name) {
  const key = String(name ?? '')
  if (!key) return null
  const hit = latestCache.get(key)
  if (hit && Date.now() - hit.at < LATEST_TTL_MS) return hit.version
  if (latestInflight.has(key)) return latestInflight.get(key)
  const task = (async () => {
    let version = null
    try {
      const res = await fetch('https://registry.npmjs.org/' + encodeURIComponent(key) + '/latest', {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (res.ok) {
        const json = await res.json()
        if (typeof json?.version === 'string') version = json.version
      }
    } catch { /* unreachable — treat as unknown, not "newer" */ }
    latestCache.set(key, { at: Date.now(), version })
    return version
  })()
  latestInflight.set(key, task)
  try { return await task } finally { latestInflight.delete(key) }
}

/** Minimal semver compare: a > b. null for non-semver (caller treats as unknown). */
function parseVersion(v) {
  const s = String(v ?? '').trim().replace(/^v/i, '')
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(s)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : null }
}

function versionGt(a, b) {
  const A = parseVersion(a)
  const B = parseVersion(b)
  if (!A || !B) return null
  if (A.major !== B.major) return A.major > B.major
  if (A.minor !== B.minor) return A.minor > B.minor
  if (A.patch !== B.patch) return A.patch > B.patch
  if (!A.pre && !B.pre) return false
  if (!A.pre) return true
  if (!B.pre) return false
  const n = Math.max(A.pre.length, B.pre.length)
  for (let i = 0; i < n; i++) {
    const x = A.pre[i]
    const y = B.pre[i]
    if (x === undefined) return false
    if (y === undefined) return true
    if (x !== y) {
      const xn = Number.isFinite(+x)
      const yn = Number.isFinite(+y)
      if (xn && yn) return +x > +y
      if (xn) return false
      if (yn) return true
      return x > y
    }
  }
  return false
}

// ---------------------------------------------------------------- installed inventory

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length)
  let i = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
  return results
}

async function buildInstalledList() {
  const manifest = await profileManifest()
  if (!manifest) return { plugins: [], self: null, profile, profileDir, error: 'profile manifest not found' }
  const deps = manifest.dependencies ?? {}
  const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
  const names = [...new Set([...Object.keys(deps), ...bundles])]
  const entries = []
  for (const n of names) {
    const inst = await installedPackageJson(n)
    const isOfficial = String(n).startsWith('@deepseek-ai/') || OFFICIAL_FALLBACK.has(String(n).toLowerCase())
    const isBundle = bundles.includes(n)
    const isPlugin = isBundle || !!(inst && (inst.dsh?.bundle?.patch !== undefined || inst.dsh?.client !== undefined))
    if (!isPlugin) continue
    entries.push({
      name: n,
      spec: Object.prototype.hasOwnProperty.call(deps, n) ? deps[n] : null,
      kind: Object.prototype.hasOwnProperty.call(deps, n) && !isOfficial ? 'installed' : 'builtin',
      official: isOfficial,
      enabled: isBundle,
      version: inst && typeof inst.version === 'string' ? inst.version : null,
      description: inst && typeof inst.description === 'string' ? inst.description : null,
      repository: normalizeRepoRef(inst?.repository?.url ?? inst?.repository ?? ''),
      latestVersion: null,
      updateAvailable: false,
    })
  }
  await mapLimit(entries, 4, async (entry) => {
    if (entry.kind !== 'installed' || !entry.spec || isLocalSpec(entry.spec)) return
    const latest = await npmLatest(entry.name)
    entry.latestVersion = latest
    const gt = latest && entry.version ? versionGt(latest, entry.version) : null
    entry.updateAvailable = gt === true
  })
  // Self status (this market) — drives the "market updates itself" line.
  const own = await readJson(new URL('../package.json', import.meta.url), {})
  const selfLatest = await npmLatest(PKG_NAME)
  const self = {
    name: PKG_NAME,
    version: typeof own?.version === 'string' ? own.version : '0.0.0',
    latestVersion: selfLatest,
    updateAvailable: selfLatest && own?.version ? versionGt(selfLatest, own.version) === true : false,
  }
  const contents = []
  for (const [repo, rec] of installedMap) {
    if (rec?.type && rec.type !== 'plugin') {
      contents.push({ name: rec.name, repo, type: rec.type, installedAt: rec.installedAt ?? null, location: rec.destDir ?? null })
    }
  }
  return {
    plugins: entries,
    contents,
    self,
    profile,
    profileDir,
    bootedAt: HARNESS_BOOT_MS,
    error: null,
  }
}

// ---------------------------------------------------------------- CLI + jobs

let cliCache = null

/** Locate a binary on PATH (fast probe; spawnSync timeout guarded). */
function findOnPath(bin) {
  try {
    const r = process.platform === 'win32'
      ? spawnSync('where.exe', [bin], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
      : spawnSync('sh', ['-c', 'command -v ' + JSON.stringify(bin)], { encoding: 'utf8', timeout: 10000 })
    if (r.status === 0 && r.stdout) {
      const first = String(r.stdout).split(/\r?\n/)[0].trim()
      if (first) return first
    }
  } catch { /* timeout / no sh */ }
  return null
}

async function resolveCli() {
  if (cliCache) return cliCache
  const configured = typeof config.cli === 'string' && config.cli.trim() ? config.cli.trim() : null
  const candidates = configured ? [configured] : ['dsh', 'whale']
  for (const candidate of candidates) {
    const path = findOnPath(candidate)
    if (path) {
      cliCache = { name: candidate, path, ok: true }
      return cliCache
    }
  }
  cliCache = {
    name: candidates[0], path: null, ok: false,
    error: '未找到 ' + candidates.join(' / ') + ' CLI。请安装 DSH 命令行（npm i -g @deepseek-ai/dsh）后重试。',
  }
  return cliCache
}

let jobSeq = 0
const jobs = new Map() // id -> job
let jobQueue = Promise.resolve()

function killTree(child) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
    } else {
      try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
    }
  } catch { /* already gone */ }
}

/**
 * Start a serialized install/update/uninstall job. Returns the job handle;
 * status is polled through /install/status.
 */
function startJob(kind, spec, realName = null) {
  const id = kind + '-' + (++jobSeq)
  const job = {
    id, kind, spec, name: realName,
    status: 'queued', phase: 'queued',
    startedAt: null, finishedAt: null,
    output: [], result: null, error: null,
    canceled: false, timedOut: false,
    child: null, allowBuildRetried: false,
    branch: null, repo: null,
  }
  jobs.set(id, job)
  if (jobs.size > 50) jobs.delete(jobs.keys().next().value)
  const run = () => runJob(job).catch((error) => {
    job.result = { ok: false, installed: null, output: tailOutput(job), requiresRestart: false, error: String(error?.message ?? error) }
  }).finally(() => {
    job.finishedAt = Date.now()
    job.status = job.canceled ? 'canceled' : (job.error || !job.result?.ok ? 'failed' : 'done')
  })
  jobQueue = jobQueue.then(run, run)
  return job
}

function tailOutput(job, n = 40) {
  return job.output.slice(-n).join('\n')
}

async function runJob(job) {
  if (job.kind === 'install-skill' || job.kind === 'install-preset' || job.kind === 'install-script') {
    job.status = 'running'
    job.startedAt = Date.now()
    await runContentJob(job)
    return
  }
  job.status = 'running'
  job.phase = 'resolving'
  job.startedAt = Date.now()
  const cli = await resolveCli()
  if (!cli.ok) {
    job.error = cli.error
    return
  }
  const profErr = await profileInstallableError()
  if (profErr) {
    job.error = profErr
    return
  }
  const before = await profileManifest()
  const beforeDeps = new Set(Object.keys(before?.dependencies ?? {}))
  const args = job.kind === 'uninstall' ? ['remove', job.name] : ['add', job.spec]
  await spawnCli(job, cli, args)
  if (!job.error) {
    job.phase = 'reconciling'
    if (job.kind === 'uninstall') {
      await recordUninstall(job.name)
      job.phase = 'done'
      job.result = { ok: true, installed: null, spec: job.spec, output: tailOutput(job), requiresRestart: true, error: null }
      return
    }
    const after = await profileManifest()
    const added = Object.keys(after?.dependencies ?? {}).filter((n) => !beforeDeps.has(n))
    const installed = added[0] ?? job.spec
    await ensureBundlesReconciled(added)
    await recordInstall(job.spec, installed)
    if (job.kind === 'update') await appendHistory({ action: 'update', name: installed })
    job.phase = 'done'
    job.result = {
      ok: true, installed, spec: job.spec, output: tailOutput(job),
      requiresRestart: true, error: null,
    }
  } else {
    // One auto-retry: pnpm blocks git deps' build scripts until allowlisted.
    if (job.kind !== 'uninstall' && !job.allowBuildRetried && await allowBuildsRetry(job)) return
    job.result = { ok: false, installed: null, spec: job.spec, output: tailOutput(job), requiresRestart: false, error: job.error }
  }
}

function spawnCli(job, cli, args) {
  return new Promise((resolve) => {
    // Windows: build one quoted command string (no args array) — Node 22
    // deprecates spawn(args, { shell: true }); specs are pre-validated and
    // profiles come from directory names, so double-quoting is safe here.
    const isWin = process.platform === 'win32'
    const quotedArgs = args.map((a) => '"' + String(a).replace(/"/g, '') + '"').join(' ')
    const child = isWin
      ? spawn('"' + cli.name + '" plugin --profile "' + profile + '" ' + quotedArgs, [], {
          cwd: profileDir, shell: true, env: buildFilteredEnv(),
          stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        })
      : spawn(cli.name, ['plugin', '--profile', profile, ...args], {
          cwd: profileDir, env: buildFilteredEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
    job.child = child
    job.phase = 'running'
    const note = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const s = line.trimEnd()
        if (!s) continue
        job.output.push(s)
        if (job.output.length > 300) job.output.shift()
      }
    }
    child.stdout?.on('data', note)
    child.stderr?.on('data', note)
    const timer = setTimeout(() => {
      job.timedOut = true
      job.error = '执行超时（' + (JOB_TIMEOUT_MS / 60000) + ' 分钟），已终止进程树'
      killTree(child)
    }, JOB_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      job.error = error?.code === 'ENOENT'
        ? 'CLI ' + JSON.stringify(cli.name) + ' 启动失败：' + String(error?.message ?? error)
        : String(error?.message ?? error)
      resolve()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!job.timedOut && !job.canceled && code !== 0) job.error = cli.name + ' 退出码 ' + code + '（详情见输出日志）'
      resolve()
    })
  })
}

// ---------------------------------------------------------------- content installs (skill / preset / script)

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'repo'
}

let gitAvailable = null
function probeGit() {
  if (gitAvailable !== null) return gitAvailable
  try {
    const r = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
    gitAvailable = r.status === 0
  } catch { gitAvailable = false }
  return gitAvailable
}

/** Direct spawn (no shell) for git / powershell / tar — output streamed to the job. */
function spawnSimple(job, cmd, args, cwd, envExtra, timeoutMs = JOB_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...buildFilteredEnv(), ...(envExtra ?? {}) },
        stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, shell: false,
      })
    } catch (error) {
      job.error = 'spawn failed: ' + String(error?.message ?? error)
      resolve()
      return
    }
    job.child = child
    const note = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const s = line.trimEnd()
        if (!s) continue
        job.output.push(s)
        if (job.output.length > 300) job.output.shift()
      }
    }
    child.stdout?.on('data', note)
    child.stderr?.on('data', note)
    const timer = setTimeout(() => {
      job.timedOut = true
      job.error = '执行超时（' + Math.round(timeoutMs / 60000) + ' 分钟），已终止进程树'
      killTree(child)
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      job.error = error?.code === 'ENOENT'
        ? '命令不可用（' + cmd + ' 未安装）：' + String(error?.message ?? error)
        : String(error?.message ?? error)
      resolve()
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (!job.timedOut && !job.canceled && code !== 0) job.error = cmd + ' 退出码 ' + code + '（详情见输出日志）'
      resolve()
    })
  })
}

/** codeload tarball + bsdtar fallback when git is unavailable. */
async function downloadExtract(repo, destDir, job) {
  const branch = job.branch || 'main'
  const url = 'https://codeload.github.com/' + repo + '/tar.gz/refs/heads/' + branch
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(180000) })
  } catch (error) {
    job.error = '下载失败：' + String(error?.message ?? error)
    return
  }
  if (!res.ok) {
    job.error = '下载失败 HTTP ' + res.status + '（尝试改用 git 安装：dsh 插件市场需 git 或 codeload 可达）'
    return
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const tgz = join(MARKET_DIR, 'tmp-' + Date.now() + '-' + process.pid + '.tgz')
  await mkdir(MARKET_DIR, { recursive: true })
  await writeFile(tgz, buf)
  try {
    await mkdir(destDir, { recursive: true })
    await spawnSimple(job, 'tar', ['-xzf', tgz, '-C', destDir, '--strip-components=1'], MARKET_DIR)
  } finally {
    rm(tgz, { force: true }).catch(() => {})
  }
}

/** Empty git config file used to isolate clones from global proxy rewrites. */
const GIT_EMPTY_CONFIG = join(MARKET_DIR, 'git-empty-config')

async function isolatedGitEnv() {
  try {
    await mkdir(MARKET_DIR, { recursive: true })
    await writeFile(GIT_EMPTY_CONFIG, '', 'utf8')
  } catch { /* best effort */ }
  return {
    GIT_CONFIG_GLOBAL: GIT_EMPTY_CONFIG,
    GIT_CONFIG_SYSTEM: GIT_EMPTY_CONFIG,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  }
}

/**
 * Content-type install: clone the repo to its home and (for scripts) run the
 * installer after the user confirmed. skill -> ~/.dsh/skills/<slug> (hot-load),
 * preset -> ~/.dsh/.agent-presets/<slug>, script -> ~/.dsh/market/cache/<owner>__<slug>.
 */
async function runContentJob(job) {
  const repo = job.repo || githubSpec(job.spec)
  if (!repo) {
    job.error = '内容安装需要 GitHub 仓库地址'
    return
  }
  const slug = slugify(String(repo).split('/')[1])
  const ownerSlug = slugify(String(repo).split('/')[0])
  const destBase = job.kind === 'install-skill' ? join(DSH_HOME, 'skills')
    : job.kind === 'install-preset' ? join(DSH_HOME, '.agent-presets')
    : join(MARKET_DIR, 'cache')
  const destDir = job.kind === 'install-script' ? join(destBase, ownerSlug + '__' + slug) : join(destBase, slug)
  job.phase = 'pulling'
  job.output.push('[1/4] 拉取 https://github.com/' + repo + ' ...')
  await rm(destDir, { recursive: true, force: true })
  await mkdir(dirname(destDir), { recursive: true })
  const gitEnv = isolatedGitEnv()
  if (probeGit()) {
    // Isolated git config: the user's global insteadOf proxy rewrites
    // (ghfast.top etc.) are often down and hang the clone — bypass them for
    // this invocation and fall back to the codeload tarball on failure.
    await spawnSimple(job, 'git', ['clone', '--depth', '1', 'https://github.com/' + repo + '.git', destDir], dirname(destDir), gitEnv, 180000)
    if (job.error) {
      job.output.push('[1/4] git 直连失败（' + job.error + '），改从 codeload 下载 tarball')
      job.error = null
      job.timedOut = false
      await downloadExtract(repo, destDir, job)
    }
  } else {
    job.output.push('[1/4] git 不可用，改从 codeload 下载 tarball')
    await downloadExtract(repo, destDir, job)
  }
  if (job.error) return
  job.output.push('[2/4] 拉取完成')
  if (job.kind === 'install-script') {
    job.phase = 'installing'
    job.output.push('[3/4] 执行安装脚本（已确认）...')
    const scriptFile = existsSync(join(destDir, 'install.ps1')) ? 'install.ps1' : 'install.sh'
    if (scriptFile === 'install.ps1') {
      await spawnSimple(job, 'powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile], destDir)
    } else {
      await spawnSimple(job, 'bash', [scriptFile], destDir)
    }
    if (job.error) return
    job.output.push('[4/4] 脚本执行完成。仓库保留在 ' + destDir + '（卸载会清理）')
  } else {
    job.phase = 'registering'
    job.output.push('[3/4] 已就位：' + destDir)
    job.output.push('[4/4] 完成。' + (job.kind === 'install-skill' ? '技能注册器会自动热加载。' : '预设对新会话生效。'))
  }
  await recordInstall(repo, slug, job.kind === 'install-skill' ? 'skill' : job.kind === 'install-preset' ? 'preset' : 'script', destDir)
  job.phase = 'done'
  job.result = {
    ok: true,
    installed: slug,
    spec: job.spec,
    output: tailOutput(job),
    requiresRestart: job.kind !== 'install-skill',
    error: null,
  }
}
/**
 * pnpm ≥10 refuses build scripts of dependencies until allowlisted in the
 * profile's pnpm-workspace.yaml. Parse the package names from the failure,
 * allowlist them, and retry the SAME job once.
 */
async function allowBuildsRetry(job) {
  const joined = job.output.join('\n')
  const m = /ignored build scripts[:\s]+([^\n]+)/i.exec(joined)
  if (!m) return false
  const names = []
  for (const token of m[1].split(/[,\s]+/)) {
    const nm = token.replace(/@[^@/]*$/, '').trim() // strip version, keep scope
    if (/^@?[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(nm)) names.push(nm)
  }
  if (names.length === 0) return false
  job.allowBuildRetried = true
  job.error = null
  job.phase = 'allow-builds'
  job.output.push('[market] pnpm 拦截了构建脚本：' + names.join(', ') + ' — 已加入 allowBuilds 并重试（请确认仓库可信）')
  try {
    const yamlFile = join(profileDir, 'pnpm-workspace.yaml')
    let text = await readFile(yamlFile, 'utf8')
    const lines = text.split(/\r?\n/)
    const keyIdx = lines.findIndex((l) => /^allowBuilds\s*:\s*$/.test(l.trim()))
    const fresh = names.filter((n) => !text.includes('  - ' + n + '\n'))
    if (fresh.length === 0) return false
    const rows = fresh.map((n) => '  - ' + n)
    if (keyIdx >= 0) {
      lines.splice(keyIdx + 1, 0, ...rows)
    } else {
      if (lines.length > 0 && lines[lines.length - 1].trim() !== '') lines.push('')
      lines.push('allowBuilds:', ...rows)
    }
    await writeFile(yamlFile, lines.join('\n') + '\n', 'utf8')
  } catch (error) {
    job.output.push('[market] 写入 allowBuilds 失败：' + String(error?.message ?? error))
    return false
  }
  const cli = await resolveCli()
  job.status = 'running'
  job.phase = 'retrying'
  await spawnCli(job, cli, ['add', job.spec])
  return false // retry also failed — the caller reports the last error
}

/** Safety net: older CLI versions may skip the bundles reconcile. */
async function ensureBundlesReconciled(names) {
  if (!names || names.length === 0) return
  await withManifestLock(async () => {
    const manifest = await profileManifest()
    if (!manifest) return
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? [...manifest.dsh.profile.bundles] : []
    let changed = false
    for (const n of names) {
      const inst = await installedPackageJson(n)
      if (inst?.dsh?.bundle?.patch !== undefined && !bundles.includes(n)) {
        bundles.push(n)
        changed = true
      }
    }
    if (changed) {
      manifest.dsh = { ...manifest.dsh, profile: { ...(manifest.dsh?.profile ?? {}), bundles } }
      await writeProfileManifest(manifest)
    }
  })
}

function waitJob(job) {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (['done', 'failed', 'canceled'].includes(job.status)) {
        clearInterval(timer)
        resolve(job.result ?? { ok: false, installed: null, output: tailOutput(job), requiresRestart: false, error: job.error ?? 'job did not finish' })
      }
    }, 250)
  })
}

// ---------------------------------------------------------------- business ops

/** Whether an install needs explicit user confirmation (risk report). */
async function confirmNeeded(spec) {
  const repo = githubSpec(spec)
  const target = repo ? (adaptorTarget(repo) ?? repo) : null
  if (!target) return { needsConfirm: false, target: null, info: null }
  const info = await repoInfo(target)
  // Risky when: install-script repos, nothing-auto-installable repos,
  // package.json that is not a dsh plugin, or a bundle-declaring package
  // whose loadable entry (main / exports) is missing — the misakanet failure
  // class (declares dsh.bundle but has no main/index.js → boot-time crash).
  const missingEntry = info.type === 'plugin' && info.valid === true && info.score?.level === 'warn'
    && (info.score.reasons ?? []).some((reason) => /main|patch/.test(reason))
  const risky = info.type === 'script' || info.type === 'manual'
    || (info.type === 'plugin' && info.valid === false)
    || missingEntry
  return { needsConfirm: risky, target, info }
}

/** Validate + probe + start the right job kind for an install spec. */
async function dispatchInstall(spec, confirmed) {
  const clean = validateSpec(spec)
  if (!clean) return { error: '非法 spec：仅支持 npm 包名、owner/repo、github:/git 地址或 tarball URL' }
  const probe = await confirmNeeded(clean)
  if (probe.needsConfirm && !confirmed) return { needsConfirm: true, info: probe.info }
  const type = probe.info?.type ?? null
  if (probe.target && type === 'skill') return { job: startJob('install-skill', probe.target) }
  if (probe.target && type === 'preset') return { job: startJob('install-preset', probe.target) }
  if (probe.target && type === 'script') return { job: startJob('install-script', probe.target) }
  if (probe.target && type === 'manual') {
    return { error: '该仓库不含可自动安装的内容（SKILL.md / 预设 / 安装脚本 / 插件清单均缺失），请打开 https://github.com/' + probe.target + ' 按 README 手动安装' }
  }
  const profErr = await profileInstallableError()
  if (profErr) return { error: profErr }
  const finalSpec = probe.target && !/^(github:|git\+|https?:)/.test(clean) ? 'github:' + probe.target : clean
  const job = startJob('install', finalSpec)
  job.branch = probe.info?.defaultBranch ?? null
  job.repo = probe.target
  return { job }
}

async function installOp(spec, confirmed) {
  const r = await dispatchInstall(spec, confirmed === true)
  if (r.job) return waitJob(r.job)
  return {
    ok: false, installed: null, output: '', requiresRestart: false,
    needsConfirm: r.needsConfirm === true, info: r.info ?? null,
    error: r.error ?? '无法安装',
  }
}

async function updateOp(name) {
  const key = String(name ?? '').trim()
  if (!key) return { ok: false, name: key, output: '', requiresRestart: false, error: '需要插件名' }
  const manifest = await profileManifest()
  const deps = manifest?.dependencies ?? {}
  const spec = deps[key]
  if (!spec) return { ok: false, name: key, output: '', requiresRestart: false, error: key + ' 不是后安装的插件，无法更新' }
  if (isLocalSpec(spec)) return { ok: false, name: key, output: '', requiresRestart: false, error: key + ' 是本地链接插件（' + spec + '），请在其源码目录手动更新' }
  const target = githubSpec(spec) ? spec : key + '@latest'
  const job = startJob('update', validateSpec(target) ?? spec, key)
  return waitJob(job)
}

async function uninstallOp(name) {
  const key = String(name ?? '').trim()
  if (!key) return { ok: false, name: key, output: '', requiresRestart: false, error: '需要插件名' }
  // Content installs (skill / preset / script) — remove the directory + record.
  const rec = findMarketRecord(key)
  if (rec?.record?.type && rec.record.type !== 'plugin') {
    if (rec.record.destDir) {
      await rm(rec.record.destDir, { recursive: true, force: true }).catch(() => {})
    }
    await recordUninstall(key)
    return {
      ok: true, name: key, output: '已移除 ' + (rec.record.destDir ?? key),
      requiresRestart: rec.record.type !== 'skill', error: null,
    }
  }
  const manifest = await profileManifest()
  if (!(key in (manifest?.dependencies ?? {}))) {
    return { ok: false, name: key, output: '', requiresRestart: false, error: key + ' 不是后安装的插件；内置插件不能卸载' }
  }
  const job = startJob('uninstall', key, key)
  return waitJob(job)
}

async function setEnabledOp(name, enabled) {
  const key = String(name ?? '').trim()
  const target = !!enabled
  if (!key) return { ok: false, name: key, enabled: target, requiresRestart: false, error: '需要插件名' }
  return withManifestLock(async () => {
    const manifest = await profileManifest()
    if (!manifest) return { ok: false, name: key, enabled: target, requiresRestart: false, error: 'profile manifest not found' }
    if (!(key in (manifest.dependencies ?? {}))) {
      return { ok: false, name: key, enabled: target, requiresRestart: false, error: key + ' 不是后安装的插件；内置插件不能关闭' }
    }
    const bundles = Array.isArray(manifest.dsh?.profile?.bundles) ? [...manifest.dsh.profile.bundles] : []
    const has = bundles.includes(key)
    if (target === has) return { ok: true, name: key, enabled: target, changed: false, requiresRestart: false, error: null }
    if (target) {
      const inst = await installedPackageJson(key)
      const isPlugin = !!(inst && (inst.dsh?.bundle?.patch !== undefined || inst.dsh?.client !== undefined))
      if (!isPlugin) return { ok: false, name: key, enabled: false, requiresRestart: false, error: key + ' 未声明 dsh.bundle/dsh.client，不是可加载的 DSH 插件' }
      bundles.push(key)
    } else {
      bundles.splice(bundles.indexOf(key), 1)
    }
    manifest.dsh = { ...manifest.dsh, profile: { ...(manifest.dsh?.profile ?? {}), bundles } }
    await writeProfileManifest(manifest)
    await appendHistory({ action: 'toggle', name: key, enabled: target })
    return { ok: true, name: key, enabled: target, changed: true, requiresRestart: true, error: null }
  })
}

// ---------------------------------------------------------------- routes

/** Same-origin CSRF gate: GET needs loopback; mutations also need the header. */
function guard(req, res, mutation) {
  if (!loopbackHost(req)) {
    send(res, 403, { error: 'forbidden host' })
    return false
  }
  if (mutation && String(req.headers[CSRF_HEADER] ?? '') !== '1') {
    send(res, 403, { error: 'missing CSRF header' })
    return false
  }
  return true
}

const listHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const qRaw = url.searchParams.get('q') || ''
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const perPageRaw = url.searchParams.get('perPage') ?? url.searchParams.get('per_page')
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(perPageRaw) || DEFAULT_PER_PAGE))
    const force = url.searchParams.get('force') === '1'
    const kind = ['skill', 'skin', 'preset'].includes(url.searchParams.get('kind') ?? '') ? url.searchParams.get('kind') : 'plugin'
    const category = (url.searchParams.get('category') || 'all')
    const language = url.searchParams.get('language') || 'all'
    const rawSort = url.searchParams.get('sort')
    const sort = (rawSort === 'updated' || rawSort === 'trending') ? rawSort : 'stars'
    const verifiedOnly = url.searchParams.get('verified') === '1'
    let record
    if (kind === 'skin' || kind === 'preset') {
      // Skin/preset columns read the complete static plugin index (fresh via CI).
      const st = await ensureStatic()
      if (!st.plugins?.items?.length) throw new Error('静态索引不可用（缺 registry.json.gz）')
      record = {
        ...staticPage(st.plugins.items, qRaw, page, perPage, kind === 'preset' ? 'preset' : 'skin', language, sort, verifiedOnly),
        fetchedAt: st.plugins.fetchedAt ?? 0,
        fromCache: true,
        error: null,
      }
    } else {
      const liveKind = kind === 'skill' ? 'skill' : 'plugin'
      if (verifiedOnly) {
        // 复检修复：verified 标记只存在于索引构建期验证的静态源（CI --verify 产物）；
        // live GitHub 数据没有该字段，直接切静态索引，避免把列表滤空。
        const st = await ensureStatic()
        const idx = liveKind === 'skill' ? st.skills : st.plugins
        if (idx?.items?.length) {
          record = {
            ...staticPage(idx.items, qRaw, page, perPage, category === 'all' ? null : category, language === 'all' ? null : language, sort, true),
            fetchedAt: idx.fetchedAt ?? 0,
            fromCache: true,
            error: idx.generatedAt
              ? 'verified 筛选走静态索引（' + idx.count + ' 条 · 生成于 ' + new Date(idx.generatedAt).toLocaleDateString() + '）'
              : 'verified 筛选走静态索引',
          }
        } else {
          record = { items: [], total: 0, fetchedAt: 0, fromCache: true, error: '静态索引不可用，无法按 verified 筛选' }
        }
      } else {
        record = await ensurePage(liveKind, qRaw, page, perPage, force, sort)
      }
      if (category !== 'all' || language !== 'all' || verifiedOnly) {
        // In-page refinement over the live result (approximate; static mode is exact).
        const items = record.items.filter((it) => {
          const catOk = category === 'all' || (it.category ?? 'misc') === category
          const langOk = language === 'all' || String(it.language ?? '').toLowerCase() === language.toLowerCase()
          const vOk = !verifiedOnly || it.verified === true
          return catOk && langOk && vOk
        })
        record = { ...record, items, total: items.length }
      }
    }
    const info = await installedInfo()
    const onlyFav = url.searchParams.get('favorite') === '1'
    const items = record.items
      .map((it) => {
        const hit = info.get(String(it.fullName).toLowerCase())
        return {
          ...it,
          installed: !!hit,
          needsRestart: hit?.needsRestart ?? false,
          installedName: hit?.name ?? null,
          favorite: favorites.has(String(it.fullName).toLowerCase()),
        }
      })
      .filter((it) => (onlyFav ? it.favorite : true))
    send(res, 200, {
      items,
      total: record.total,
      page,
      perPage,
      hasMore: page * perPage < record.total,
      q: qRaw,
      kind,
      category,
      language,
      sort,
      verifiedOnly,
      fetchedAt: record.fetchedAt ?? Date.now(),
      fromCache: record.fromCache === true,
      error: record.error ?? null,
    })
  } catch (error) {
    send(res, 500, { items: [], total: 0, page: 1, perPage: DEFAULT_PER_PAGE, hasMore: false, q: '', kind: 'plugin', category: 'all', language: 'all', sort: 'stars', fetchedAt: 0, fromCache: false, error: String(error?.message ?? error) })
  }
}

/** Count verified items (index-build-time dsh-manifest probe, P0-2). */
function countVerified(items) {
  if (!Array.isArray(items)) return null
  let n = 0
  for (const it of items) if (it.verified === true) n++
  return n
}

/** Market meta: categories, static-index status, adaptor — feeds the UI chrome. */
const metaHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  try {
    const st = await ensureStatic()
    // Top languages by repo count in the static index (UI filter dropdown),
    // merged with a baseline list (older index builds carry no language field).
    const langCounts = new Map()
    for (const it of st.plugins?.items ?? []) {
      const lang = String(it.language ?? '')
      if (!lang) continue
      langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1)
    }
    const baselineLangs = ['JavaScript', 'TypeScript', 'Python', 'HTML', 'CSS', 'Shell', 'Go', 'Rust', 'Java', 'Vue', 'Kotlin', 'C++', 'C#', 'Svelte', 'MDX']
    for (const lang of baselineLangs) {
      if (!langCounts.has(lang)) langCounts.set(lang, 0)
    }
    const languages = [...langCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([lang]) => lang)
    send(res, 200, {
      categories: categories.map((c) => ({ id: c.id, label: c.label })),
      functionAliases: Object.keys(FUNCTION_ALIASES).slice(0, 40),
      languages,
      static: {
        plugins: st.plugins ? { count: st.plugins.count, verified: countVerified(st.plugins.items), generatedAt: st.plugins.generatedAt ?? null, source: st.plugins.source } : null,
        skills: st.skills ? { count: st.skills.count, verified: countVerified(st.skills.items), generatedAt: st.skills.generatedAt ?? null, source: st.skills.source } : null,
      },
      adaptorRedirects: adaptorRedirects.length,
      error: null,
    })
  } catch (error) {
    send(res, 500, { categories: [], static: null, adaptorRedirects: 0, error: String(error?.message ?? error) })
  }
}

const infoHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  const url = new URL(req.url ?? '/', 'http://localhost')
  send(res, 200, await repoInfo(url.searchParams.get('repo') ?? ''))
}

const installedHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  send(res, 200, await buildInstalledList())
}

const statusHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  const cli = await resolveCli()
  const own = await readJson(new URL('../package.json', import.meta.url), {})
  send(res, 200, {
    name: PKG_NAME,
    version: typeof own?.version === 'string' ? own.version : '0.0.0',
    profile,
    profileDir,
    cli: { name: cli.name, path: cli.path, ok: cli.ok },
    bootedAt: HARNESS_BOOT_MS,
    jobs: jobs.size,
    error: null,
  })
}

const installHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    const r = await dispatchInstall(body.spec, body.confirmed === true)
    if (r.needsConfirm) return send(res, 409, { ok: false, needsConfirm: true, info: r.info })
    if (r.error) {
      const cls = classifyFetchError(r.error)
      return send(res, 400, { ok: false, error: r.error, errorKind: cls.kind, hint: cls.hint })
    }
    send(res, 202, { ok: true, jobId: r.job.id })
  } catch (error) {
    const cls = classifyFetchError(error)
    send(res, 400, { ok: false, error: cls.error, errorKind: cls.kind, hint: cls.hint })
  }
}

const installStatusHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  const url = new URL(req.url ?? '/', 'http://localhost')
  const job = jobs.get(url.searchParams.get('job') ?? '')
  if (!job) return send(res, 404, { error: 'job not found' })
  send(res, 200, {
    id: job.id, kind: job.kind, spec: job.spec, name: job.name,
    status: job.status, phase: job.phase,
    startedAt: job.startedAt, finishedAt: job.finishedAt,
    output: job.output.slice(-80),
    result: job.result ?? null,
    error: job.error,
  })
}

const installCancelHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    const job = jobs.get(String(body.job ?? ''))
    if (!job) return send(res, 404, { ok: false, error: 'job not found' })
    if (['done', 'failed', 'canceled'].includes(job.status)) return send(res, 200, { ok: true, canceled: false })
    job.canceled = true
    if (job.child) killTree(job.child)
    send(res, 200, { ok: true, canceled: true })
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}

const mutationHandler = (op) => async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    send(res, 200, await op(body))
  } catch (error) {
    const cls = classifyFetchError(error)
    send(res, 500, { ok: false, error: cls.error, errorKind: cls.kind, hint: cls.hint })
  }
}

const favoritesHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  send(res, 200, favoriteState())
}

const favoriteHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    send(res, 200, await setFavorite(body.repo, body.favorite !== false))
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}

const historyHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  const url = new URL(req.url ?? '/', 'http://localhost')
  const n = Math.min(100, Math.max(1, Number(url.searchParams.get('n')) || 20))
  send(res, 200, { events: history.slice(-n) })
}

const backupHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  const records = {}
  for (const [k, v] of installedMap) records[k] = v
  send(res, 200, { exportedAt: new Date().toISOString(), records, history })
}

const restoreHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    send(res, 200, await restoreOp(body.records))
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}

const restoreStatusHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  send(res, 200, restoreState ?? { running: false, total: 0, done: [], failed: [], current: null, finished: true })
}

const envHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  const url = new URL(req.url ?? '/', 'http://localhost')
  send(res, 200, await envCandidates(url.searchParams.get('name') ?? ''))
}

const envPostHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    send(res, 200, await envOp(body.name, body.values))
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}

const feedbackGetHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  send(res, 200, { pending: feedbackPending })
}

const feedbackPostHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    send(res, 200, await feedbackOp(body))
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}

const selfUpdateHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const manifest = await profileManifest()
    const spec = manifest?.dependencies?.[PKG_NAME]
    if (!spec) return send(res, 400, { ok: false, error: '市场未安装在当前 profile' })
    if (isLocalSpec(spec)) return send(res, 400, { ok: false, error: '本地开发版（' + spec + '）：请 git pull 后重启 DSH' })
    const latest = await npmLatest(PKG_NAME)
    const own = await readJson(new URL('../package.json', import.meta.url), {})
    if (!latest || !own?.version) return send(res, 400, { ok: false, error: '无法获取最新版本' })
    if (versionGt(latest, own.version) !== true) return send(res, 200, { ok: false, error: '当前已是最新版本 v' + own.version + '（latest v' + latest + '）' })
    const job = startJob('update', PKG_NAME + '@latest', PKG_NAME)
    send(res, 202, { ok: true, jobId: job.id })
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}

// ---------------------------------------------------------------- P2: dashboard / audit / webdav

const NOTIFY_SEEN_FILE = join(MARKET_DIR, 'notify-seen.json')

const dashboardHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  try {
    const st = await ensureStatic()
    const plugins = st.plugins?.items ?? []
    const catCounts = {}
    const langCounts = {}
    const starBuckets = { big: 0, med: 0, small: 0, tiny: 0, zero: 0 }
    for (const it of plugins) {
      catCounts[it.category ?? 'misc'] = (catCounts[it.category ?? 'misc'] ?? 0) + 1
      const lang = String(it.language ?? '')
      if (lang) langCounts[lang] = (langCounts[lang] ?? 0) + 1
      const s = it.stars ?? 0
      if (s >= 1000) starBuckets.big++
      else if (s >= 100) starBuckets.med++
      else if (s >= 10) starBuckets.small++
      else if (s >= 1) starBuckets.tiny++
      else starBuckets.zero++
    }
    const topCats = Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([id, count]) => ({ id, label: categoryLabel(id), count }))
    const topLangs = Object.entries(langCounts).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([lang, count]) => ({ lang, count }))
    send(res, 200, {
      static: {
        plugins: st.plugins ? { count: st.plugins.count, generatedAt: st.plugins.generatedAt ?? null, source: st.plugins.source } : null,
        skills: st.skills ? { count: st.skills.count, generatedAt: st.skills.generatedAt ?? null, source: st.skills.source } : null,
      },
      topCategories: topCats,
      topLanguages: topLangs,
      starBuckets,
      local: {
        installedPlugins: installedMap.size,
        favorites: favorites.size,
        historyEvents: history.length,
      },
      error: null,
    })
  } catch (error) {
    send(res, 500, { static: null, topCategories: [], topLanguages: [], starBuckets: {}, local: {}, error: String(error?.message ?? error) })
  }
}

/** Classify a fetch/network failure into a user-facing error kind + hint. */
function classifyFetchError(error, hostLabel) {
  const raw = String(error?.cause?.code ?? error?.code ?? error?.message ?? error ?? '')
  const lower = raw.toLowerCase()
  const base = hostLabel ? '（' + hostLabel + '）' : ''
  if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('getaddrinfo')) {
    return { kind: 'dns', error: 'DNS 解析失败' + base, hint: '域名无法解析：可能是网络断开或 DNS 异常。检查网络后重试，或运行「网络诊断」查看详情。' }
  }
  if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('socket hang up')) {
    return { kind: 'refused', error: '连接被拒绝/中断' + base, hint: '目标服务拒绝连接：可能是被防火墙拦截、代理失效或服务未启动。运行「网络诊断」定位。' }
  }
  if (lower.includes('timeout') || lower.includes('abort') || lower.includes('timed out')) {
    return { kind: 'timeout', error: '连接超时' + base, hint: '请求超时：网络慢或目标被墙。稍后重试，或检查系统代理（ghfast.top 等镜像代理可能已失效）。' }
  }
  if (lower.includes('cert') || lower.includes('ssl') || lower.includes('tls')) {
    return { kind: 'tls', error: 'TLS/证书错误' + base, hint: '证书验证失败：系统时间可能不准，或代理劫持了证书。检查系统时间与代理设置。' }
  }
  if (lower.includes('fetch failed')) {
    return { kind: 'network', error: '网络请求失败' + base, hint: '底层网络错误（fetch failed）。运行「网络诊断」逐项检查 GitHub / jsDelivr / npm 连通性。' }
  }
  return { kind: 'unknown', error: '请求失败' + base + '：' + raw.slice(0, 120), hint: '未知网络错误。运行「网络诊断」查看各环节状态。' }
}

/**
 * Diagnose every hop the marketplace depends on — the "third-party audit"
 * surface. Each row probes one endpoint (bounded timeout) and reports
 * ok / status / ms, plus the local toolchain (dsh CLI, pnpm, git) and the
 * profile tree health (entry-point presence per bundle).
 */
async function diagnoseOp() {
  const probes = [
    ['GitHub API', 'https://api.github.com/rate_limit', 'GET'],
    ['GitHub raw', 'https://raw.githubusercontent.com/deepseek-ai/DeepSeek-Harness/master/README.md', 'GET'],
    ['GitHub codeload', 'https://codeload.github.com/deepseek-ai/DeepSeek-Harness/tar.gz/refs/heads/master', 'GET'],
    ['jsDelivr data', 'https://data.jsdelivr.com/v1/packages/gh/deepseek-ai/DeepSeek-Harness', 'GET'],
    ['jsDelivr CDN', 'https://cdn.jsdelivr.net/gh/deepseek-ai/DeepSeek-Harness@master/README.md', 'GET'],
    ['npm registry', 'https://registry.npmjs.org/dsh-whale-market/latest', 'GET'],
  ]
  const results = await Promise.all(probes.map(async ([label, url, method]) => {
    const started = Date.now()
    try {
      const res = await fetch(url, {
        method,
        headers: { 'User-Agent': 'dsh-whale-market-diagnose' },
        signal: AbortSignal.timeout(8000),
      })
      return { label, url, ok: res.ok, status: res.status, ms: Date.now() - started, error: null, kind: null }
    } catch (error) {
      const cls = classifyFetchError(error, label)
      return { label, url, ok: false, status: null, ms: Date.now() - started, error: cls.error, kind: cls.kind }
    }
  }))
  const toolchain = []
  for (const [name, args] of [['dsh', ['--version']], ['pnpm', ['--version']], ['git', ['--version']]]) {
    try {
      const r = spawnSync(name, args, { encoding: 'utf8', windowsHide: true, timeout: 10000 })
      toolchain.push({ name, ok: r.status === 0, version: r.status === 0 ? String(r.stdout || '').trim().split('\n')[0] : null, error: r.status === 0 ? null : String(r.stderr || r.stdout || '').slice(0, 100) })
    } catch (error) {
      toolchain.push({ name, ok: false, version: null, error: String(error?.message ?? error).slice(0, 100) })
    }
  }
  let profileHealth = null
  try {
    const manifest = await profileManifest()
    const bundles = Array.isArray(manifest?.dsh?.profile?.bundles) ? manifest.dsh.profile.bundles : []
    const broken = []
    for (const b of bundles) {
      const dir = join(profileDir, 'node_modules', ...String(b).split('/'))
      const pkgOk = await pathExists(join(dir, 'package.json'))
      const entryOk = pkgOk && await pathExists(join(dir, 'index.js'))
      if (!entryOk) broken.push(b)
    }
    profileHealth = { profile, bundles: bundles.length, broken, ok: broken.length === 0 }
  } catch (error) {
    profileHealth = { profile, ok: false, error: String(error?.message ?? error).slice(0, 120) }
  }
  return {
    checkedAt: new Date().toISOString(),
    network: results,
    toolchain,
    profileHealth,
    config: {
      registryUrl: typeof config.registryUrl === 'string' && config.registryUrl ? true : false,
      skillsUrl: typeof config.skillsUrl === 'string' && config.skillsUrl ? true : false,
      webdavUrl: typeof config.webdavUrl === 'string' && config.webdavUrl ? true : false,
      githubToken: typeof config.githubToken === 'string' && config.githubToken ? true : false,
    },
  }
}

const diagnoseHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  send(res, 200, await diagnoseOp())
}

const auditHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  send(res, 200, { sanitized: true, note: '日志不含环境变量值等敏感数据', events: history })
}

async function webdavBackupOp() {
  const url = typeof config.webdavUrl === 'string' ? config.webdavUrl.trim() : ''
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: '未配置 webdavUrl（在插件 config 中设置）' }
  const user = typeof config.webdavUser === 'string' ? config.webdavUser : ''
  const pass = typeof config.webdavPassword === 'string' ? config.webdavPassword : ''
  const records = {}
  for (const [k, v] of installedMap) records[k] = v
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), records, history }, null, 2)
  const target = url.replace(/\/$/, '') + '/dsh-market-backup-' + new Date().toISOString().slice(0, 10) + '.json'
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (user || pass) headers.Authorization = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64')
    const res = await fetch(target, { method: 'PUT', headers, body: payload, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok) return { ok: false, error: 'WebDAV HTTP ' + res.status }
    return { ok: true, url: target }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
}

const webdavHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  send(res, 200, await webdavBackupOp())
}
// ---------------------------------------------------------------- P2: notifications

/** Update notifications for favorite repos (GitHub pushed_at vs last-seen). */
async function notificationsOp() {
  const seen = await readJson(NOTIFY_SEEN_FILE, {})
  const updated = []
  for (const repo of favorites) {
    try {
      const res = await fetch('https://api.github.com/repos/' + repo, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-whale-market' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) continue
      const j = await res.json()
      const latest = String(j.pushed_at ?? j.updated_at ?? '')
      if (!latest) continue
      updated.push({ repo, updatedAt: latest, isNew: seen[repo] !== latest })
    } catch { /* unreachable repo — skip */ }
  }
  return { updated, checkedAt: new Date().toISOString() }
}

const notificationsHandler = async (req, res) => {
  if (!guard(req, res, false)) return
  await ensureInit()
  send(res, 200, await notificationsOp())
}

const notificationsSeenHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  const seen = await readJson(NOTIFY_SEEN_FILE, {})
  const { updated } = await notificationsOp()
  for (const u of updated) seen[u.repo] = u.updatedAt
  await writeJsonAtomic(NOTIFY_SEEN_FILE, seen)
  send(res, 200, { ok: true, marked: updated.length })
}
// ---------------------------------------------------------------- P2: author tools

function scaffoldOp(body) {
  const rawName = String(body?.name ?? '').trim()
  const kind = body?.kind === 'client-only' ? 'client-only' : 'plugin'
  if (!/^[a-z0-9-]{2,40}$/.test(rawName)) return { ok: false, error: '包名需为小写字母/数字/连字符（2-40 字符）' }
  const dir = join(MARKET_DIR, 'scaffolds', rawName)
  const pkg = {
    name: rawName,
    version: '0.1.0',
    description: 'A DSH plugin scaffolded by dsh-whale-market.',
    type: 'module',
    main: 'lib/index.js',
    exports: {
      '.': './lib/index.js',
      './package.json': './package.json',
      './cordis.patch.yml': './cordis.patch.yml',
    },
    files: ['lib', 'cordis.patch.yml', 'README.md'],
    keywords: ['dsh', 'dsh-plugin', 'deepseek-harness'],
    license: 'MIT',
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
    },
  }
  if (kind === 'client-only') pkg.peerDependencies = { react: '^18.0.0' }
  const patch = [
    '# ' + rawName + ' bundle patch to mount the plugin into a dsh host composition.',
    '# Install: dsh plugin --profile <name> add ' + rawName,
    '- insert:',
    '    - id: ' + rawName,
    '      name: ' + rawName,
    '      config: {}',
    '',
  ].join('\n')
  const index = [
    '/** ' + rawName + ' host half (scaffolded by dsh-whale-market). */',
    'export const name = ' + JSON.stringify(rawName),
    'export const inject = []',
    '',
    'export function apply(ctx, config) {',
    '  ctx.logger?.info?.(name + :mounted:)',
    '}',
    '',
  ].join('\n')
  const readme = '# ' + rawName + '\n\nScaffolded by dsh-whale-market.\n'
  const files = [
    ['package.json', JSON.stringify(pkg, null, 2) + '\n'],
    ['cordis.patch.yml', patch],
    ['lib/index.js', index],
    ['README.md', readme],
  ]
  const written = []
  try {
    for (const [rel, content] of files) {
      const p = join(dir, rel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
      written.push(rel)
    }
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
  return { ok: true, path: dir, files: written, hint: 'dsh plugin --profile <name> add ' + dir }
}

async function checkOp(body) {
  const dirPath = String(body?.path ?? '').trim()
  if (!dirPath || dirPath.length > 500) return { ok: false, error: '需要插件目录路径' }
  const results = []
  const pkg = await readJson(join(dirPath, 'package.json'), null)
  if (!pkg) return { ok: false, error: '目录中无 package.json' }
  results.push({ file: 'package.json', ok: !!pkg.name, message: pkg.name ? 'name: ' + pkg.name : '缺少 name' })
  results.push({ file: 'package.json', ok: !!pkg.version, message: pkg.version ? 'version: ' + pkg.version : '缺少 version' })
  results.push({ file: 'package.json', ok: pkg.dsh?.bundle?.patch !== undefined, message: pkg.dsh?.bundle?.patch !== undefined ? 'dsh.bundle.patch: ' + pkg.dsh.bundle.patch : '缺少 dsh.bundle.patch（不是可加载 bundle）' })
  if (pkg.dsh?.bundle?.patch !== undefined) {
    const patchPath = join(dirPath, String(pkg.dsh.bundle.patch).replace(/^\.\//, ''))
    results.push({ file: 'cordis.patch.yml', ok: await pathExists(patchPath), message: await pathExists(patchPath) ? 'patch 文件存在' : 'patch 文件缺失: ' + pkg.dsh.bundle.patch })
  }
  const main = pkg.main ?? (typeof pkg.exports === 'object' && typeof pkg.exports['.'] === 'string' ? pkg.exports['.'] : null)
  if (main) {
    const mainPath = join(dirPath, String(main).replace(/^\.\//, ''))
    results.push({ file: 'main', ok: await pathExists(mainPath), message: await pathExists(mainPath) ? 'main 入口存在' : 'main 入口缺失: ' + main })
  } else {
    results.push({ file: 'main', ok: false, message: '缺少 main / exports 入口' })
  }
  const clientDeclared = pkg.dsh?.client !== undefined
  if (clientDeclared) {
    const hasClientExport = typeof pkg.exports === 'object' && typeof pkg.exports['./client'] === 'string'
    results.push({ file: 'client', ok: hasClientExport, message: hasClientExport ? 'exports ./client 存在' : '声明了 dsh.client 但缺少 exports ./client 子路径' })
    if (hasClientExport) {
      const clientPath = join(dirPath, String(pkg.exports['./client']).replace(/^\.\//, ''))
      results.push({ file: 'client', ok: await pathExists(clientPath), message: await pathExists(clientPath) ? 'client 文件存在' : 'client 文件缺失: ' + pkg.exports['./client'] })
    }
  }
  const keywords = Array.isArray(pkg.keywords) ? pkg.keywords : []
  results.push({ file: 'keywords', ok: keywords.includes('dsh-plugin'), message: keywords.includes('dsh-plugin') ? '已声明 dsh-plugin 关键词（可被市场收录）' : '建议在 keywords 中加入 dsh-plugin 以便市场收录' })
  return { ok: true, results }
}

const authorScaffoldHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    send(res, 200, scaffoldOp(body))
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}

const authorCheckHandler = async (req, res) => {
  if (!guard(req, res, true)) return
  await ensureInit()
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' })
  try {
    const body = await readJsonBody(req)
    send(res, 200, await checkOp(body))
  } catch (error) {
    send(res, 400, { ok: false, error: String(error?.message ?? error) })
  }
}
// ---------------------------------------------------------------- agent tools
function textBlock(text) {
  return [{ type: 'text', text }]
}

let toolsRegistered = false

function defineMarketTools(ctx) {
  const toolsService = ctx.get('tools')
  if (!toolsService || toolsRegistered) return
  // 第三方体检反馈（P0-3）：market_* 与官方 runtime 内置工具同名，注册后本插件
  // 实现会接管同名调用（实测 market_installed 的 self 已指向本插件）。
  // 配置 agentTools: 'off' / false 可让位官方内置工具。
  if (config.agentTools === false || config.agentTools === 'off') {
    ctx.logger?.info?.('whale-market: agentTools=off — 不注册 market_* 工具（保留官方内置同名工具）')
    return
  }
  toolsRegistered = true
  ctx.logger?.info?.('whale-market: 注册 market_* Agent 工具（与官方内置同名工具共存，本插件实现接管同名调用；agentTools=off 可关闭）')

  const searchTool = {
    name: 'market_search',
    description: '搜索 DeepSeek Harness 插件市场（GitHub dsh-plugin 主题）中的可安装插件。返回仓库 JSON 列表：fullName、stars、language、简介、URL。支持关键词与翻页（主题有 1800+ 仓库）。',
    parameters: {
      type: 'object',
      properties: {
        q: { type: 'string', description: '在主题内搜索的关键词（仓库名/简介/语言）。留空返回 star 最高的首页。' },
        kind: { type: 'string', description: '栏目：plugin（插件，默认）或 skill（技能包）。' },
        sort: { type: 'string', description: '排序：stars（默认）或 updated（最近更新）。' },
        page: { type: 'integer', description: '页码（1 起，默认 1）。' },
        perPage: { type: 'integer', description: '每页数量（最大 100，默认 50）。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          total: { type: 'integer' },
          page: { type: 'integer' },
          perPage: { type: 'integer' },
          hasMore: { type: 'boolean' },
        },
        additionalProperties: true,
      },
      render(_args, value) {
        const v = value
        const lines = ['DSH 插件市场：共 ' + v.total + ' 个仓库（第 ' + v.page + ' 页 / 每页 ' + v.perPage + (v.hasMore ? '，还有更多' : '') + '）']
        for (const it of v.items) {
          lines.push('- ' + it.fullName + ' (★' + it.stars + (it.language ? ', ' + it.language : '') + ')' + (it.installed ? ' [已安装]' : '') + ' — ' + (it.description || '无简介'))
        }
        if (v.hasMore) lines.push('提示：用 page/perPage 翻页，或用 q 缩小范围；确认后可用 market_install 安装。')
        return textBlock(lines.join('\n'))
      },
    },
    async execute(args) {
      const q = String(args?.q ?? '').trim()
      const page = Math.max(1, Number(args?.page) || 1)
      const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(args?.perPage) || DEFAULT_PER_PAGE))
      const kind = args?.kind === 'skill' ? 'skill' : 'plugin'
      const sort = (args?.sort === 'updated' || args?.sort === 'trending') ? args.sort : 'stars'
      const record = await ensurePage(kind, q, page, perPage, false, sort)
      const info = await installedInfo()
      const items = record.items.map((it) => {
        const hit = info.get(String(it.fullName).toLowerCase())
        return { ...it, installed: !!hit }
      })
      return {
        items,
        total: record.total,
        page,
        perPage,
        hasMore: page * perPage < record.total,
        installed: Object.fromEntries(info),
      }
    },
  }

  const installTool = {
    name: 'market_install',
    description: '把一个插件从 DSH 插件市场安装进当前 profile。接受 npm 包名、GitHub owner/repo、git URL 或 tarball URL。安装后需要重启 harness 生效。先用 market_search 确认插件。',
    parameters: {
      type: 'object',
      properties: {
        spec: { type: 'string', description: 'npm 包名、owner/repo、github:owner/repo、git+https URL 或 tarball URL。' },
      },
      required: ['spec'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          installed: { type: 'string' },
          output: { type: 'string' },
          requiresRestart: { type: 'boolean' },
          error: { type: 'string' },
        },
        additionalProperties: true,
      },
      render(_args, value) {
        const v = value
        if (v.ok) return textBlock('已安装 ' + v.installed + '。' + (v.requiresRestart ? '需要重启 harness 后生效。' : '') + '\n' + (v.output || ''))
        return textBlock('安装失败：' + v.error + '\n' + (v.output || ''))
      },
    },
    async execute(args) {
      return installOp(args.spec)
    },
  }

  const installedTool = {
    name: 'market_installed',
    description: '列出当前 profile 中已安装的插件及其版本与可更新状态。返回 plugins（name、kind=builtin/installed、enabled、version、latestVersion、updateAvailable）与 self（市场自身更新状态）。更新前先用它查名字。',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: {
        type: 'object',
        properties: {
          plugins: { type: 'array', items: { type: 'object', additionalProperties: true } },
          self: { type: 'object', additionalProperties: true },
          profile: { type: 'string' },
        },
        additionalProperties: true,
      },
      render(_args, value) {
        const v = value
        const lines = ['已安装插件（profile: ' + v.profile + '）：']
        for (const p of v.plugins) {
          lines.push('- ' + p.name + ' (' + (p.kind === 'builtin' ? '内置' : '用户安装') + (p.enabled ? '' : ' · 已关闭') + ') v' + (p.version ?? '?') + (p.updateAvailable ? ' → 可更新 v' + p.latestVersion : ''))
        }
        if (v.self?.updateAvailable) lines.push('插件市场自身可更新：v' + v.self.version + ' → v' + v.self.latestVersion)
        return textBlock(lines.join('\n'))
      },
    },
    async execute() {
      const list = await buildInstalledList()
      return { plugins: list.plugins, self: list.self, profile: list.profile }
    },
  }

  const updateTool = {
    name: 'market_update',
    description: '把当前 profile 中一个已安装插件更新到最新版本（需要重启 harness 生效）。名字来自 market_installed。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '要更新的插件包名（来自 market_installed）。' },
      },
      required: ['name'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          name: { type: 'string' },
          output: { type: 'string' },
          requiresRestart: { type: 'boolean' },
          error: { type: 'string' },
        },
        additionalProperties: true,
      },
      render(_args, value) {
        const v = value
        if (v.ok) return textBlock('已更新 ' + v.name + '。需要重启 harness 后生效。\n' + (v.output || ''))
        return textBlock('更新失败：' + v.error + '\n' + (v.output || ''))
      },
    },
    async execute(args) {
      return updateOp(args.name)
    },
  }

  for (const tool of [searchTool, installTool, installedTool, updateTool]) {
    ctx.effect(() => toolsService.register(tool))
  }
}

// ---------------------------------------------------------------- plugin

let config = {}

export function apply(ctx, pluginConfig) {
  config = pluginConfig ?? {}
  ensureInit().catch((error) => {
    ctx.logger?.warn?.('whale-market: init failed: %s', String(error?.message ?? error))
  })

  let registered = false
  const registerWebSurface = () => {
    if (registered) return
    const webServer = ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1])
    if (webServer === undefined) return
    registered = true
    for (const [path, handler] of [
      ['/plugins/dsh-whale-market/status', statusHandler],
      ['/plugins/dsh-whale-market/list', listHandler],
      ['/plugins/dsh-whale-market/meta', metaHandler],
      ['/plugins/dsh-whale-market/info', infoHandler],
      ['/plugins/dsh-whale-market/installed', installedHandler],
      ['/plugins/dsh-whale-market/install', installHandler],
      ['/plugins/dsh-whale-market/install/status', installStatusHandler],
      ['/plugins/dsh-whale-market/install/cancel', installCancelHandler],
      ['/plugins/dsh-whale-market/set-enabled', mutationHandler((body) => setEnabledOp(body.name, body.enabled))],
      ['/plugins/dsh-whale-market/update', mutationHandler((body) => updateOp(body.name))],
      ['/plugins/dsh-whale-market/uninstall', mutationHandler((body) => uninstallOp(body.name))],
      ['/plugins/dsh-whale-market/favorites', favoritesHandler],
      ['/plugins/dsh-whale-market/favorite', favoriteHandler],
      ['/plugins/dsh-whale-market/history', historyHandler],
      ['/plugins/dsh-whale-market/backup', backupHandler],
      ['/plugins/dsh-whale-market/restore', restoreHandler],
      ['/plugins/dsh-whale-market/restore/status', restoreStatusHandler],
      ['/plugins/dsh-whale-market/env', envHandler],
      ['/plugins/dsh-whale-market/env/save', envPostHandler],
      ['/plugins/dsh-whale-market/feedback', feedbackGetHandler],
      ['/plugins/dsh-whale-market/feedback/submit', feedbackPostHandler],
      ['/plugins/dsh-whale-market/self-update', selfUpdateHandler],
      ['/plugins/dsh-whale-market/dashboard', dashboardHandler],
      ['/plugins/dsh-whale-market/audit', auditHandler],
      ['/plugins/dsh-whale-market/diagnose', diagnoseHandler],
      ['/plugins/dsh-whale-market/backup/webdav', webdavHandler],
      ['/plugins/dsh-whale-market/notifications', notificationsHandler],
      ['/plugins/dsh-whale-market/notifications/seen', notificationsSeenHandler],
      ['/plugins/dsh-whale-market/author/scaffold', authorScaffoldHandler],
      ['/plugins/dsh-whale-market/author/check', authorCheckHandler],
    ]) {
      ctx.effect(() => webServer.register({ kind: 'exact', path, handler }), 'whale-market: ' + path + ' route')
    }
    ctx.logger?.info?.('whale-market: routes mounted at /plugins/dsh-whale-market/*')
  }

  registerWebSurface()
  ctx.on('internal/service', (serviceName) => {
    if (WEB_SERVER_KEYS.includes(serviceName)) registerWebSurface()
    if (serviceName === 'tools') defineMarketTools(ctx)
  })

  defineMarketTools(ctx)
}
