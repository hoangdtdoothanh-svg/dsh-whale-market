/**
 * dsh-whale-market — browser half.
 *
 * Two tabs in the Plugins settings section (settings.plugins.tab):
 * - market (插件市场) — four columns (插件 / Skills / 皮肤 / 预设), search,
 *   category/language/sort filters, one-click install with live progress,
 *   per-repo type probe (详情), risk-confirmation dialog before risky
 *   installs, refresh + offline notice.
 * - installed (已安装) — profile plugin inventory (enable/disable/update/
 *   uninstall) + content installs (skills/presets/scripts) + market self
 *   update status.
 *
 * Hand-written in the web lazy-CJS bundle format (window.__ModuleLoader__.load)
 * so this package ships without a build step. Styling uses --dsw-alias-* tokens.
 */
window.__ModuleLoader__.load({
	id: 'dsh-whale-market',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports

		var React = require('react')
		var h = React.createElement
		var useEffect = React.useEffect
		var useState = React.useState
		var useRef = React.useRef
		var useCallback = React.useCallback

		var inject = ['slots']

		var BASE = '/plugins/dsh-whale-market'
		var CSS = [
			'.wm-root{box-sizing:border-box;display:flex;flex-direction:column;gap:12px;max-width:920px;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif);color:var(--dsw-alias-label-primary)}',
			'.wm-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
			'.wm-title{font-size:18px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary)}',
			'.wm-meta{font-size:12px;color:var(--dsw-alias-label-tertiary)}',
			'.wm-grow{margin-left:auto;display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
			'.wm-input{box-sizing:border-box;min-width:200px;flex:1;background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);transition:border-color .16s}',
			'.wm-input:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.wm-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:transparent}',
			'.wm-input::placeholder{color:var(--dsw-alias-label-tertiary)}',
			'.wm-select{background:var(--dsw-alias-bg-layer-3);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 8px;font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary);cursor:pointer;transition:border-color .16s}',
			'.wm-select:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.wm-select:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.wm-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;font:inherit;font-size:13px;line-height:1.5;cursor:pointer;background:transparent;color:var(--dsw-alias-label-secondary);transition:color .16s,border-color .16s,background .16s,opacity .16s}',
			'.wm-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
			'.wm-btn:disabled{opacity:.4;cursor:default}',
			'.wm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
			'.wm-primary{background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}',
			'.wm-primary:hover:not(:disabled){background:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);opacity:.9}',
			'.wm-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-border-l2)}',
			'.wm-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}',
			'.wm-success{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-bg-layer-3)}',
			'.wm-nav{display:flex;align-items:flex-end;gap:22px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-top:2px;flex-wrap:wrap}',
			'.wm-nav-btn{position:relative;border:0;padding:7px 1px 9px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:20px;cursor:pointer;transition:color .16s}',
			'.wm-nav-btn:hover,.wm-nav-btn-on{color:var(--dsw-alias-label-primary)}',
			'.wm-nav-btn-on::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary);content:""}',
			'.wm-nav-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:2px;color:var(--dsw-alias-label-primary)}',
			'.wm-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);transition:border-color .16s,background .16s;padding:14px 16px;display:flex;flex-direction:column;gap:8px}',
			'.wm-card:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.wm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
			'.wm-name{font-size:15px;font-weight:600;line-height:1.4;color:var(--dsw-alias-label-primary);text-decoration:none;word-break:break-all}',
			'.wm-name:hover{text-decoration:underline}',
			'.wm-desc{font-size:13px;line-height:1.5;color:var(--dsw-alias-label-tertiary);word-break:break-word}',
			'.wm-tags{display:flex;gap:6px;flex-wrap:wrap;font-size:11px;line-height:17px}',
			'.wm-tag{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-module-platform);white-space:nowrap}',
			'.wm-tag-installed{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
			'.wm-tag-warn{color:var(--dsw-static-amber-500,#d29922);border-color:var(--dsw-static-amber-500,#d29922)}',
			'.wm-acts{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}',
			'.wm-note{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
			'.wm-err{color:var(--dsw-alias-state-error-primary);font-size:13px;line-height:1.5}',
			'.wm-banner{border:1px solid var(--dsw-static-amber-500,#d29922);background:var(--dsw-static-amber-100,transparent);border-radius:12px;padding:10px 14px;font-size:13px;line-height:1.5;display:flex;flex-direction:column;gap:8px;color:var(--dsw-alias-label-primary)}',
			'.wm-progress{display:flex;flex-direction:column;gap:6px;margin-top:4px}',
			'.wm-progress-head{display:flex;align-items:center;gap:8px;font-size:13px;flex-wrap:wrap}',
			'.wm-progress-phase{font-weight:600}',
			'.wm-progress-track{height:4px;border-radius:999px;background:var(--dsw-alias-bg-module-platform);overflow:hidden;position:relative}',
			'.wm-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);width:40%;animation:wmSlide 1.2s ease-in-out infinite}',
			'@keyframes wmSlide{0%{margin-left:-40%}100%{margin-left:100%}}',
			'.wm-log{font-size:11px;line-height:1.5;opacity:.7;white-space:pre-wrap;word-break:break-all;font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);max-height:64px;overflow:hidden;color:var(--dsw-alias-label-secondary)}',
			'.wm-info{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:10px 14px;font-size:12.5px;display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-secondary)}',
			'.wm-row{display:flex;align-items:center;gap:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-3);padding:14px 16px;flex-wrap:wrap;transition:border-color .16s}',
			'.wm-row:hover{border-color:var(--dsw-alias-label-dimmed)}',
			'.wm-row-main{display:flex;flex-direction:column;gap:4px;min-width:180px;flex:1}',
			'.wm-row-name{font-size:15px;font-weight:600;line-height:1.4;word-break:break-all}',
			'.wm-row-meta{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}',
			'.wm-switch{width:34px;height:20px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);position:relative;cursor:pointer;padding:0;flex:none;transition:background .16s,border-color .16s}',
			'.wm-switch .wm-knob{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-tertiary);transition:left .16s,background .16s;display:block}',
			'.wm-switch-on{background:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}',
			'.wm-switch-on .wm-knob{left:18px;background:var(--dsw-alias-bg-layer-3)}',
			'.wm-switch:disabled{opacity:.5;cursor:default}',
						'.wm-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,270px),1fr));gap:12px;list-style:none;margin:0;padding:0;align-items:start}',
			'.wm-card-body{display:flex;flex-direction:column;gap:8px;min-height:210px}',
			'.wm-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;min-height:22px}',
			'.wm-card-title{font-size:14px;font-weight:600;line-height:22px;text-overflow:ellipsis;white-space:nowrap;overflow:hidden;min-width:0;color:var(--dsw-alias-label-primary);text-decoration:none;word-break:break-all}',
			'.wm-verified{display:inline-flex;align-items:center;gap:5px;flex:none;color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 28%,transparent);border-radius:999px;padding:2px 7px;font-size:10px;line-height:16px}',
			'.wm-verified-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none}',
			'.wm-author{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:17px;margin:-4px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.wm-card-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px;margin:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-height:40px;word-break:break-word}',
			'.wm-stats{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:20px;margin-top:auto}',
			'.wm-stat{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap}',
			'.wm-growth{color:var(--dsw-alias-state-success-primary);font-size:11px;line-height:18px;white-space:nowrap}',
			'.wm-updated{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:18px;white-space:nowrap}',
			'.wm-chiprow{display:flex;align-items:center;gap:6px;min-height:22px;overflow:hidden}',
			'.wm-chip{display:inline-flex;align-items:center;flex:none;max-width:112px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);padding:2px 8px;font-size:10px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
			'.wm-card-actions{display:flex;align-items:center;gap:10px;min-height:34px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}',
			'.wm-card-actlinks{min-width:0;margin-left:auto;display:flex;align-items:center;justify-content:flex-end;gap:14px}',
			'.wm-github{color:var(--dsw-alias-state-business-primary);font-size:12px;text-decoration:none;white-space:nowrap}',
			'.wm-detail-toggle{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-tertiary);font-size:12px;background:none;border:0;cursor:pointer;padding:0;font:inherit}',
			'.wm-pill{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);padding:2px 12px;font-size:12px;line-height:20px;cursor:pointer;font:inherit;transition:color .16s,border-color .16s}',
			'.wm-pill:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}',
			'.wm-pill-on{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-primary)}',
'.wm-page{display:flex;align-items:center;gap:8px;justify-content:center}',
			'.wm-update{color:var(--dsw-alias-state-success-primary);font-size:12.5px;font-weight:600}',
			'.wm-overlay{position:fixed;inset:0;z-index:60;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.24));display:flex;align-items:center;justify-content:center;padding:24px}',
			'.wm-modal{width:100%;max-width:540px;max-height:85vh;overflow:auto;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,.16);font:inherit;color:var(--dsw-alias-label-primary)}',
			'.wm-modal-head{display:flex;align-items:center;gap:8px}',
			'.wm-modal-title{font-size:15px;font-weight:600;flex:1}',
			'.wm-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}',
			'.wm-hazard{color:var(--dsw-alias-state-error-primary);font-size:12.5px;line-height:1.5}',
			'.wm-files{font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;max-height:120px;overflow:auto}',
		].join('')
		;(function installCss() {
			if (typeof document === 'undefined') return
			var tagId = 'dsh-whale-market/style'
			if (document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
				var tag = document.createElement('style')
				tag.dataset.plugin = 'dsh-whale-market'
				tag.dataset.pluginCss = tagId
				tag.textContent = CSS
				document.head.appendChild(tag)
			}
		})()

		/** Same-origin API helper; mutations carry the CSRF header.
		 *  Network-level failures (fetch failed / Failed to fetch / TypeError)
		 *  are translated into a friendly classified error with a hint. */
		async function api(path, init) {
			var headers = Object.assign({ 'content-type': 'application/json' }, (init && init.headers) || {})
			if (!init || init.method !== 'GET') headers['x-dsh-market'] = '1'
			var res
			try {
				res = await fetch(BASE + path, Object.assign({ headers: headers }, init))
			} catch (e) {
				var msg = String(e && e.message || e)
				var kind = 'network'
				var friendly = '无法连接 DSH 本地服务'
				var hint = 'DSH 服务可能正在重启或端口发生变化。请刷新页面重试；若持续失败，点击「网络诊断」检查各环节连通性。'
				if (/fetch failed|failed to fetch|load failed/i.test(msg)) {
					// keep friendly defaults
				} else if (/timeout|timed out|abort/i.test(msg)) {
					kind = 'timeout'
					friendly = '请求超时'
					hint = '本地服务响应超时：请稍后重试，或刷新页面。'
				}
				throw Object.assign(new Error(friendly + '（' + msg.slice(0, 80) + '）'), { status: 0, kind: kind, hint: hint, data: {} })
			}
			var data = await res.json().catch(function () { return {} })
			if (!res.ok) throw Object.assign(new Error(data.error || 'HTTP ' + res.status), { status: res.status, data: data, kind: data.errorKind || 'server', hint: data.hint || null })
			return data
		}

		function fmtTime(iso) {
			if (!iso) return ''
			var t = new Date(iso).getTime()
			if (!Number.isFinite(t)) return ''
			var days = Math.floor((Date.now() - t) / 86400000)
			if (days <= 0) return '今天'
			if (days === 1) return '昨天'
			if (days < 30) return days + ' 天前'
			if (days < 365) return Math.floor(days / 30) + ' 个月前'
			return Math.floor(days / 365) + ' 年前'
		}

		function starsText(n) {
			n = Number(n) || 0
			if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
			return String(n)
		}

		var PKG_SELF = 'dsh-whale-market'
		var KIND_LABELS = { plugin: '插件', skill: 'Skills', skin: '皮肤', preset: '预设' }

		// ---- i18n (main UI strings; toggle persisted in localStorage) ----
		var I18N = {
			zh: { market: '插件市场', installed: '已安装', install: '安装', installedTag: '已安装', detail: '详情', close: '收起', cancel: '取消', refresh: '刷新', search: '搜索（名称 / 简介）', plugin: '插件', skill: 'Skills', skin: '皮肤', preset: '预设', allCat: '全部分类', allLang: '全部语言', sortStars: '按星标', sortUpdated: '最近更新', favorites: '收藏', prev: '上一页', next: '下一页', env: '环境变量', uninstall: '卸载', update: '更新', backup: '备份', restore: '恢复…', history: '历史', hideHistory: '收起历史', loading: '加载中…', empty: '没有匹配的项目。', confirmTitle: '确认安装', trustInstall: '信任并安装', save: '保存', author: '作者工具', dashboard: '大盘', feedbackOk: '正常', feedbackBad: '异常', markSeen: '全部已读', restart: '重启 DSH 后生效。' },
			en: { market: 'Market', installed: 'Installed', install: 'Install', installedTag: 'Installed', detail: 'Details', close: 'Close', cancel: 'Cancel', refresh: 'Refresh', search: 'Search (name / description)', plugin: 'Plugins', skill: 'Skills', skin: 'Skins', preset: 'Presets', allCat: 'All categories', allLang: 'All languages', sortStars: 'By stars', sortUpdated: 'Recently updated', favorites: 'Favorites', prev: 'Prev', next: 'Next', env: 'Env vars', uninstall: 'Remove', update: 'Update', backup: 'Backup', restore: 'Restore…', history: 'History', hideHistory: 'Hide history', loading: 'Loading…', empty: 'No matches.', confirmTitle: 'Confirm install', trustInstall: 'Trust & install', save: 'Save', author: 'Author tools', dashboard: 'Stats', feedbackOk: 'Works', feedbackBad: 'Broken', markSeen: 'Mark seen', restart: 'Restart DSH to apply.' },
		}
		var currentLocale = (typeof localStorage !== 'undefined' && localStorage.getItem('wm-locale')) || 'zh'
		function T(k) {
			var d = I18N[currentLocale] || I18N.zh
			return d[k] || I18N.zh[k] || k
		}
		function useLocale() {
			var [, force] = useState(0)
			return {
				locale: currentLocale,
				setLocale: function (l) {
					currentLocale = l
					try { localStorage.setItem('wm-locale', l) } catch (e) { /* private mode */ }
					force(function (n) { return n + 1 })
				},
			}
		}

		var TYPE_LABELS = { plugin: 'cordis 插件', skill: '技能', preset: '预设', script: '安装脚本', manual: '手动安装' }

		function useJobPolling(activeJob, onSettled) {
			var [state, setState] = useState(null)
			useEffect(function () {
				if (!activeJob) { setState(null); return }
				var stopped = false
				var timer = null
				function tick() {
					api('/install/status?job=' + encodeURIComponent(activeJob))
						.then(function (st) {
							if (stopped) return
							setState(st)
							if (['done', 'failed', 'canceled'].indexOf(st.status) >= 0) {
								if (onSettled) onSettled(st)
							} else {
								timer = setTimeout(tick, 1000)
							}
						})
						.catch(function (e) {
							if (stopped) return
							setState({ status: 'failed', error: String(e && e.message || e), output: [] })
						})
				}
				timer = setTimeout(tick, 300)
				return function () { stopped = true; if (timer) clearTimeout(timer) }
			}, [activeJob])
			return state
		}

		/** Friendly error card: classified title + reason + actionable hint. */
		function ErrorCard(props) {
			var err = props.error || {}
			var msg = typeof err === 'string' ? err : (err.message || String(err))
			var hint = (typeof err === 'object' && err.hint) || null
			var kind = (typeof err === 'object' && err.kind) || null
			var onDiagnose = props.onDiagnose
			return h('div', { className: 'wm-banner', style: { borderColor: 'var(--dsw-alias-state-error-primary)', background: 'var(--dsw-static-red-50,transparent)' } },
				h('div', { className: 'wm-progress-head' },
					h('span', { className: 'wm-hazard' }, '⚠ ' + msg),
				),
				hint ? h('span', { className: 'wm-note' }, hint) : null,
				kind ? h('span', { className: 'wm-note' }, '错误类型：' + kind) : null,
				onDiagnose ? h('div', { className: 'wm-acts' },
					h('button', { className: 'wm-btn', onClick: onDiagnose }, '🔍 网络诊断'),
					h('button', { className: 'wm-btn', onClick: function () { props.onRetry && props.onRetry() } }, '重试'),
				) : null,
			)
		}

		/** Diagnose panel: runs GET /diagnose and renders the audit report. */
		function DiagnosePanel(props) {
			var [report, setReport] = useState(null)
			var [busy, setBusy] = useState(false)
			function run() {
				setBusy(true)
				api('/diagnose')
					.then(function (d) { setReport(d); setBusy(false) })
					.catch(function (e) { setReport({ error: String(e && e.message || e) }); setBusy(false) })
			}
			useEffect(function () { run() }, [])
			var rows = (report && report.network) || []
			return h('div', { className: 'wm-info', style: { borderColor: 'var(--dsw-alias-border-l2)' } },
				h('div', { className: 'wm-progress-head' },
					h('span', { className: 'wm-modal-title', style: { fontSize: 13 } }, '🔍 网络诊断（第三方审计）'),
					h('button', { className: 'wm-btn', disabled: busy, onClick: run }, busy ? '诊断中…' : '重新诊断'),
					h('button', { className: 'wm-btn', onClick: props.onClose }, '关闭'),
				),
				report && report.error ? h('span', { className: 'wm-err' }, report.error) : null,
				!report ? h('span', { className: 'wm-note' }, '运行中…') : null,
				rows.map(function (row) {
					return h('div', { key: row.label, className: 'wm-acts', style: { justifyContent: 'space-between' } },
						h('span', { className: 'wm-note' }, (row.ok ? '✅' : '❌') + ' ' + row.label + (row.ms ? ' · ' + row.ms + 'ms' : '') + (row.status ? ' · HTTP ' + row.status : '')),
						h('span', { className: row.ok ? 'wm-update' : 'wm-hazard' }, row.ok ? '正常' : (row.error || '失败')),
					)
				}),
				report && report.toolchain ? h('div', { className: 'wm-note' },
					'本地工具链：' + report.toolchain.map(function (t) { return (t.ok ? '✅' : '❌') + ' ' + t.name + (t.version ? ' ' + t.version : '') }).join(' · '),
				) : null,
				report && report.profileHealth ? h('div', { className: 'wm-note' },
					'Profile 健康：' + (report.profileHealth.ok ? '✅ ' + report.profileHealth.profile + ' 全部 ' + report.profileHealth.bundles + ' 个 bundle 入口正常' : '❌ 发现缺失入口的 bundle：' + (report.profileHealth.broken || []).join(', ')),
				) : null,
			)
		}

		function ProgressView(props) {
			var st = props.state
			var phaseLabel = {
				queued: '排队中…', resolving: '解析 CLI…', pulling: '拉取中…', running: '安装中…',
				installing: '执行中…', registering: '登记中…', reconciling: '整理配置…',
				'allow-builds': '放行构建脚本…', retrying: '重试中…',
				done: '完成', failed: '失败', canceled: '已取消',
			}[st.phase] || st.status || '…'
			var lines = (st.output || []).slice(-6)
			return h('div', { className: 'wm-progress' },
				h('div', { className: 'wm-progress-head' },
					h('span', { className: 'wm-progress-phase' }, phaseLabel),
					h('span', { className: 'wm-note' }, st.kind === 'install' ? (st.spec || '') : (st.spec || '')),
				),
				(st.status !== 'done' && st.status !== 'failed' && st.status !== 'canceled') ? h('div', { className: 'wm-progress-track' }, h('div', { className: 'wm-progress-fill' })) : null,
				lines.length ? h('div', { className: 'wm-log' }, lines.join('\n')) : null,
				(st.status === 'failed' && st.error) ? h('div', { className: 'wm-err' }, st.error) : null,
				(st.status === 'done') ? h('div', { className: 'wm-note' }, '✓ 完成。' + (st.result && st.result.requiresRestart === false ? '' : ' 重启 DSH 后生效。')) : null,
			)
		}

		function ConfirmModal(props) {
			var info = props.info || {}
			return h('div', { className: 'wm-overlay', onClick: function (e) { if (e.target === e.currentTarget) props.onCancel() } },
				h('div', { className: 'wm-modal' },
					h('div', { className: 'wm-modal-head' },
						h('span', { className: 'wm-modal-title' }, '⚠ 确认安装 ' + (info.repo || props.spec)),
					),
					h('div', { className: 'wm-info' },
						h('span', null, '类型判定：' + (TYPE_LABELS[info.type] || info.type || '未知') + (info.typeReason ? ' — ' + info.typeReason : '')),
						info.valid === false && info.type === 'plugin' ? h('span', { className: 'wm-tag wm-tag-warn' }, '未声明 DSH 插件能力（无 dsh 字段 / @deepseek-ai 依赖）') : null,
						(info.hazards && info.hazards.length) ? h('div', null, info.hazards.map(function (hz, i) { return h('div', { className: 'wm-hazard', key: i }, '⚡ ' + hz) })) : null,
						(info.rootFiles && info.rootFiles.length) ? h('div', null, h('span', { className: 'wm-note' }, '根目录文件：'), h('div', { className: 'wm-files' }, info.rootFiles.slice(0, 30).join('\n'))) : null,
					),
					h('div', { className: 'wm-note' }, '安装第三方代码存在风险（pnpm 可能执行构建脚本 / 安装脚本会直接运行）。请确认你信任该仓库。'),
					h('div', { className: 'wm-modal-actions' },
						h('button', { className: 'wm-btn', onClick: props.onCancel }, '取消'),
						h('button', { className: 'wm-btn wm-primary', onClick: props.onConfirm }, '信任并安装'),
					),
				),
			)
		}

		// ---------------------------------------------------------------- Market tab

		function MarketTab() {
			var [data, setData] = useState(null)
			var [meta, setMeta] = useState(null)
			var [q, setQ] = useState('')
			var [page, setPage] = useState(1)
			var [kind, setKind] = useState('plugin')
			var [category, setCategory] = useState('all')
			var [language, setLanguage] = useState('all')
			var [sort, setSort] = useState('stars')
			var [loading, setLoading] = useState(true)
			var [error, setError] = useState(null)
			var [jobId, setJobId] = useState(null)
			var [activeSpec, setActiveSpec] = useState(null)
			var [infoFor, setInfoFor] = useState(null)
			var [infoData, setInfoData] = useState(null)
			var [confirmReq, setConfirmReq] = useState(null)
			var [favOnly, setFavOnly] = useState(false)
			var [recent, setRecent] = useState([])
			var [fbPending, setFbPending] = useState([])
			var [fbNotice, setFbNotice] = useState(null)
			var [dash, setDash] = useState(null)
			var [showDash, setShowDash] = useState(false)
			var [notify, setNotify] = useState(null)
			var [authorOpen, setAuthorOpen] = useState(false)
			var [authorName, setAuthorName] = useState('')
			var [authorKind, setAuthorKind] = useState('plugin')
			var [authorResult, setAuthorResult] = useState(null)
			var [checkPath, setCheckPath] = useState('')
			var [checkResult, setCheckResult] = useState(null)
			var loc = useLocale()
			var [diagnoseOpen, setDiagnoseOpen] = useState(false)
			var debounceRef = useRef(null)

			useEffect(function () {
				api('/meta').then(function (m) { setMeta(m) }).catch(function () {})
				api('/history?n=30').then(function (h) {
					var seen = []
					var installs = (h.events || []).filter(function (e) { return e.action === 'install' })
					installs.reverse()
					for (var i = 0; i < installs.length && seen.length < 5; i++) {
						var repo = installs[i].repo || installs[i].name
						if (repo && repo.indexOf('/') > 0 && seen.indexOf(repo) < 0) seen.push(repo)
					}
					setRecent(seen)
				}).catch(function () {})
				api('/feedback').then(function (f) { setFbPending(f.pending || []) }).catch(function () {})
				api('/notifications').then(function (n) { setNotify(n.updated || []) }).catch(function () {})
			}, [])

			function toggleDash() {
				if (!showDash && !dash) {
					api('/dashboard').then(function (d) { setDash(d) }).catch(function (e) { setError(String(e && e.message || e)) })
				}
				setShowDash(!showDash)
			}

			function markSeen() {
				api('/notifications/seen', { method: 'POST', body: JSON.stringify({}) })
					.then(function () { setNotify([]) })
					.catch(function () {})
			}

			function runScaffold() {
				setAuthorResult(null)
				api('/author/scaffold', { method: 'POST', body: JSON.stringify({ name: authorName, kind: authorKind }) })
					.then(function (r) { setAuthorResult(r) })
					.catch(function (e) { setAuthorResult({ ok: false, error: String(e && e.message || e) }) })
			}

			function runCheck() {
				setCheckResult(null)
				api('/author/check', { method: 'POST', body: JSON.stringify({ path: checkPath }) })
					.then(function (r) { setCheckResult(r) })
					.catch(function (e) { setCheckResult({ ok: false, error: String(e && e.message || e) }) })
			}

			var load = useCallback(function (kw, pg, force) {
				setLoading(true)
				setError(null)
				var url = '/list?kind=' + kind + '&page=' + pg + '&perPage=50'
					+ (kw ? '&q=' + encodeURIComponent(kw) : '')
					+ (category !== 'all' ? '&category=' + encodeURIComponent(category) : '')
					+ (language !== 'all' ? '&language=' + encodeURIComponent(language) : '')
					+ (sort === 'updated' ? '&sort=updated' : '')
					+ (force ? '&force=1' : '')
				api(url)
					.then(function (d) { setData(d); setLoading(false) })
					.catch(function (e) { setError({ message: String(e && e.message || e), kind: e.kind || (e.data && e.data.errorKind) || 'server', hint: e.hint || null }); setLoading(false) })
			}, [kind, category, language, sort])

			useEffect(function () {
				if (debounceRef.current) clearTimeout(debounceRef.current)
				debounceRef.current = setTimeout(function () {
					setPage(1)
					load(q, 1, false)
				}, 450)
				return function () { if (debounceRef.current) clearTimeout(debounceRef.current) }
			}, [q, kind, category, language, sort])

			var jobState = useJobPolling(jobId, function (st) {
				if (st.status === 'done') {
					setJobId(null)
					load(q, page, true)
				}
			})

			function startInstall(spec, confirmed) {
				setActiveSpec(spec)
				api('/install', { method: 'POST', body: JSON.stringify({ spec: spec, confirmed: confirmed === true }) })
					.then(function (r) {
						if (r && r.jobId) setJobId(r.jobId)
						else setJobId(null)
					})
					.catch(function (e) {
						setJobId(null)
						if (e && e.status === 409 && e.data && e.data.needsConfirm) {
							setConfirmReq({ spec: spec, info: e.data.info })
						} else if (e && e.status === 0) {
							setError({ message: e.message, kind: e.kind || 'network', hint: e.hint })
						} else if (e && e.data && e.data.errorKind) {
							setError({ message: e.message, kind: e.data.errorKind, hint: e.data.hint })
						} else {
							setError(String(e && e.message || e))
						}
					})
			}

			function installRepo(it) {
				var spec = String(it.fullName || '').trim()
				if (!spec) return
				startInstall(spec, false)
			}

			function toggleFav(it) {
				var fav = !it.favorite
				api('/favorite', { method: 'POST', body: JSON.stringify({ repo: it.fullName, favorite: fav }) })
					.then(function () { load(q, page, false) })
					.catch(function (e) { setError(String(e && e.message || e)) })
			}

			function submitFeedback(item, ok) {
				api('/feedback/submit', { method: 'POST', body: JSON.stringify({ repo: item.repo, ok: ok, note: '' }) })
					.then(function (r) {
						setFbPending(fbPending.filter(function (f) { return f.repo !== item.repo }))
						if (r && r.issueUrl) setFbNotice('反馈已提交：' + r.issueUrl)
						else if (r && r.manualUrl) { setFbNotice({ manual: r.manualUrl }) }
					})
					.catch(function (e) { setFbNotice(String(e && e.message || e)) })
			}

			function cancelJob() {
				if (!jobId) return
				api('/install/cancel', { method: 'POST', body: JSON.stringify({ job: jobId }) })
					.then(function () { setJobId(null); setActiveSpec(null) })
					.catch(function () {})
			}

			function probeInfo(it) {
				var full = String(it.fullName || '').trim()
				if (infoFor === full) { setInfoFor(null); return }
				setInfoFor(full)
				setInfoData(null)
				api('/info?repo=' + encodeURIComponent(full))
					.then(function (d) { setInfoData(d) })
					.catch(function (e) { setInfoData({ error: String(e && e.message || e) }) })
			}

			function card(it) {
				var busy = jobState && activeSpec === it.fullName
				var catLabel = (meta && meta.categories || []).find(function (c) { return c.id === it.category })
				var showVerified = it.verified === true
				return h('li', { className: 'wm-card', key: it.fullName },
					h('div', { className: 'wm-card-body' },
						h('div', { className: 'wm-title-row' },
							h('a', { className: 'wm-card-title', href: it.url, target: '_blank', rel: 'noreferrer', title: it.fullName }, it.name || it.fullName),
							showVerified ? h('span', { className: 'wm-verified' }, h('span', { className: 'wm-verified-dot' }), '已验证') : null,
						),
						it.fullName.indexOf('/') >= 0 ? h('p', { className: 'wm-author' }, it.fullName.split('/')[0]) : null,
						h('p', { className: 'wm-card-desc', title: it.description !== '' ? it.description : undefined }, it.description === '' ? '\u00A0' : it.description),
						h('div', { className: 'wm-stats' },
							h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
								h('span', { className: 'wm-stat', title: 'stars' }, '★ ' + starsText(it.stars)),
								it.language ? h('span', { className: 'wm-stat' }, it.language) : null,
							),
							it.updatedAt ? h('span', { className: 'wm-updated', title: '更新于 ' + fmtTime(it.updatedAt) }, fmtTime(it.updatedAt)) : null,
						),
						h('div', { className: 'wm-chiprow' },
							catLabel ? h('span', { className: 'wm-chip' }, catLabel.label) : null,
							it.installed ? h('span', { className: 'wm-chip', style: { color: 'var(--dsw-alias-state-success-primary)' } }, it.needsRestart ? '已装·待重启' : '已安装') : h('span', { className: 'wm-chip' }, it.category || '插件'),
						),
						h('div', { className: 'wm-card-actions' },
							busy ? h('button', { className: 'wm-btn wm-danger', onClick: cancelJob }, T('cancel')) : (
								it.installed
									? h('button', { className: 'wm-btn', disabled: true }, T('installedTag'))
									: h('button', { className: 'wm-btn wm-primary', onClick: function () { installRepo(it) } }, T('install'))
							),
							h('div', { className: 'wm-card-actlinks' },
								h('button', { className: 'wm-btn', title: it.favorite ? '取消收藏' : '收藏', onClick: function () { toggleFav(it) } }, it.favorite ? '★' : '☆'),
								h('a', { className: 'wm-github', href: it.url, target: '_blank', rel: 'noreferrer', title: it.fullName }, 'GitHub'),
								h('button', { className: 'wm-detail-toggle', onClick: function () { probeInfo(it) } },
									infoFor === it.fullName ? T('close') : T('detail'),
									h('span', { style: { display: 'inline-flex', transform: infoFor === it.fullName ? 'rotate(180deg)' : undefined } }, '▾'),
								),
							),
						),
					),
					busy ? h(ProgressView, { state: jobState }) : null,
					infoFor === it.fullName ? (function () {
						if (!infoData) return h('div', { className: 'wm-note' }, '检测中…')
						var d = infoData
						if (d.error) return h('div', { className: 'wm-info' }, h('span', { className: 'wm-err' }, d.error))
						return h('div', { className: 'wm-info' },
							h('span', null, '类型：' + (TYPE_LABELS[d.type] || d.type || '未知') + (d.typeReason ? ' — ' + d.typeReason : '')),
							h('span', null, '包名：' + (d.name || '（无）') + (d.version ? ' · v' + d.version : '') + (d.defaultBranch ? ' · 分支 ' + d.defaultBranch : '')),
							d.valid === true ? h('span', { className: 'wm-update' }, '✓ 已声明 DSH 插件能力') : (
								d.valid === false ? h('span', { className: 'wm-tag wm-tag-warn' }, '⚠ 未声明 DSH 插件能力，安装可能无效') : h('span', { className: 'wm-note' }, '无法判断插件能力')
							),
							d.score ? h('span', { className: d.score.level === 'ok' ? 'wm-update' : (d.score.level === 'warn' ? 'wm-tag wm-tag-warn' : 'wm-hazard') },
								(d.score.level === 'ok' ? '✅' : (d.score.level === 'warn' ? '⚠️' : '❌')) + ' 兼容性：' + (d.score.reasons || []).join('；')) : null,
							(d.hazards && d.hazards.length) ? h('span', { className: 'wm-hazard' }, '危险模式：' + d.hazards.join('；')) : null,
							(d.rootFiles && d.rootFiles.length) ? h('div', { className: 'wm-files' }, '根目录：' + d.rootFiles.slice(0, 30).join(', ')) : null,
						)
					})() : null,
				)
			}

var totalPages = data && data.perPage ? Math.ceil(Math.min(data.total, 1000) / data.perPage) : 0
			var columns = [['plugin', '插件'], ['skill', 'Skills'], ['skin', '皮肤'], ['preset', '预设']]

			return h('div', { className: 'wm-root' },
				confirmReq ? h(ConfirmModal, {
					spec: confirmReq.spec,
					info: confirmReq.info,
					onCancel: function () { setConfirmReq(null); setActiveSpec(null) },
					onConfirm: function () { var spec = confirmReq.spec; setConfirmReq(null); startInstall(spec, true) },
				}) : null,
				h('div', { className: 'wm-nav' },
					columns.map(function (c) {
						return h('button', {
							key: c[0],
							className: 'wm-nav-btn' + (kind === c[0] ? ' wm-nav-btn-on' : ''),
							onClick: function () { setKind(c[0]); setCategory('all'); setPage(1) },
						}, T(c[0]))
					}),
				),
				h('div', { className: 'wm-head' },
					h('span', { className: 'wm-meta' }, data ? ('共 ' + data.total + ' 个 · ' + (data.fromCache ? '离线数据' : 'GitHub 实时')) : ''),
					h('button', { className: 'wm-btn', title: 'dashboard', onClick: toggleDash }, T('dashboard')),
					h('button', { className: 'wm-btn', title: 'author tools', onClick: function () { setAuthorOpen(!authorOpen) } }, T('author')),
					h('button', { className: 'wm-btn' + (favOnly ? ' wm-primary' : ''), onClick: function () { setFavOnly(!favOnly) } }, '★ ' + T('favorites')),
					h('button', { className: 'wm-btn', title: 'language', onClick: function () { loc.setLocale(loc.locale === 'zh' ? 'en' : 'zh') } }, loc.locale === 'zh' ? 'EN' : '中文'),
					h('div', { className: 'wm-grow' },
						h('input', {
							className: 'wm-input', placeholder: T('search'), value: q,
							onChange: function (e) { setQ(e.target.value) },
						}),
						kind === 'plugin' ? h('select', { className: 'wm-select', value: category, onChange: function (e) { setCategory(e.target.value) } },
							h('option', { value: 'all' }, T('allCat')),
							(meta && meta.categories || []).map(function (c) { return h('option', { key: c.id, value: c.id }, c.label) }),
						) : null,
						kind === 'plugin' ? h('select', { className: 'wm-select', value: language, onChange: function (e) { setLanguage(e.target.value) } },
							h('option', { value: 'all' }, T('allLang')),
							(meta && meta.languages || []).map(function (l) { return h('option', { key: l, value: l }, l) }),
						) : null,
						h('button', { className: 'wm-pill' + (sort === 'stars' ? ' wm-pill-on' : ''), onClick: function () { setSort('stars'); setPage(1) } }, T('sortStars')),
						h('button', { className: 'wm-pill' + (sort === 'trending' ? ' wm-pill-on' : ''), onClick: function () { setSort('trending'); setPage(1) } }, '趋势'),
						h('button', { className: 'wm-pill' + (sort === 'updated' ? ' wm-pill-on' : ''), onClick: function () { setSort('updated'); setPage(1) } }, T('sortUpdated')),
						h('button', { className: 'wm-btn', disabled: loading, onClick: function () { load(q, page, true) } }, T('refresh')),
					),
				),
				h('div', { className: 'wm-tags', style: { marginTop: -4 } },
					h('span', { className: 'wm-note' }, '按功能搜：'),
					(meta && meta.functionAliases || []).slice(0, 16).map(function (w) {
						return h('button', {
							key: w,
							className: 'wm-tag' + (q === w ? ' wm-tag-installed' : ''),
							style: { cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-module-platform)', color: 'var(--dsw-alias-label-secondary)' },
							onClick: function () { setQ(w); setPage(1); load(w, 1, true) },
						}, w)
					}),
				),
				fbPending.length ? h('div', { className: 'wm-banner' },
					fbPending.map(function (f) {
						return h('div', { key: f.repo },
							h('span', null, '上次安装的 ' + (f.repo || f.name) + ' 是否正常？'),
							h('div', { className: 'wm-acts' },
								h('button', { className: 'wm-btn wm-primary', onClick: function () { submitFeedback(f, true) } }, '✅ 正常'),
								h('button', { className: 'wm-btn wm-danger', onClick: function () { submitFeedback(f, false) } }, '❌ 异常'),
							),
						)
					}),
				) : null,
				fbNotice ? h('div', { className: 'wm-banner' },
					fbNotice && fbNotice.manual
						? h('span', null, h('a', { className: 'wm-name', href: fbNotice.manual, target: '_blank', rel: 'noreferrer' }, '打开预填的反馈 Issue（需手动提交）'))
						: h('span', null, String(fbNotice)),
				) : null,
				notify && notify.length ? h('div', { className: 'wm-banner' },
					notify.map(function (n) {
						return h('div', { key: n.repo, className: 'wm-acts' },
							h('span', { className: 'wm-note' }, '🔔 ' + n.repo + ' 有新更新（' + fmtTime(n.updatedAt) + '）'),
							h('a', { className: 'wm-tag wm-tag-lang', style: { textDecoration: 'none' }, href: 'https://github.com/' + n.repo, target: '_blank', rel: 'noreferrer' }, '查看'),
						)
					}),
				) : null,
				notify && notify.length ? h('div', { className: 'wm-acts' }, h('button', { className: 'wm-btn', onClick: markSeen }, T('markSeen'))) : null,
				showDash ? h('div', { className: 'wm-info' },
					!dash ? h('span', { className: 'wm-note' }, T('loading')) : (
						dash.error ? h('span', { className: 'wm-err' }, dash.error) : h('div', null,
							h('div', { className: 'wm-tags' },
								h('span', { className: 'wm-tag' }, '插件 ' + (dash.static?.plugins?.count ?? 0)),
								h('span', { className: 'wm-tag' }, 'Skills ' + (dash.static?.skills?.count ?? 0)),
								h('span', { className: 'wm-tag' }, '收藏 ' + dash.local?.favorites),
								h('span', { className: 'wm-tag' }, '已装 ' + dash.local?.installedPlugins),
								h('span', { className: 'wm-tag' }, '操作 ' + dash.local?.historyEvents),
							),
							h('div', { className: 'wm-note' }, '分类 TOP：' + (dash.topCategories || []).map(function (c) { return c.label + ' ' + c.count }).join(' · ')),
							h('div', { className: 'wm-note' }, '语言 TOP：' + (dash.topLanguages || []).map(function (l) { return l.lang + ' ' + l.count }).join(' · ')),
							h('div', { className: 'wm-note' }, '星标分布：1000+=' + (dash.starBuckets?.big ?? 0) + ' · 100-999=' + (dash.starBuckets?.med ?? 0) + ' · 10-99=' + (dash.starBuckets?.small ?? 0) + ' · 1-9=' + (dash.starBuckets?.tiny ?? 0) + ' · 0=' + (dash.starBuckets?.zero ?? 0)),
						)
					),
				) : null,
				authorOpen ? h('div', { className: 'wm-info' },
					h('span', { className: 'wm-title', style: { fontSize: 13 } }, '作者工具：脚手架 + 发布前自查'),
					h('div', { className: 'wm-acts' },
						h('input', { className: 'wm-input', style: { minWidth: 160 }, placeholder: '包名（如 my-dsh-plugin）', value: authorName, onChange: function (e) { setAuthorName(e.target.value) } }),
						h('select', { className: 'wm-select', value: authorKind, onChange: function (e) { setAuthorKind(e.target.value) } },
							h('option', { value: 'plugin' }, '宿主插件'),
							h('option', { value: 'client-only' }, 'client-only'),
						),
						h('button', { className: 'wm-btn wm-primary', onClick: runScaffold }, '生成脚手架'),
					),
					authorResult ? h('div', { className: 'wm-info' },
						authorResult.ok
							? h('div', null,
								h('span', { className: 'wm-update' }, '✓ 已生成到 ' + authorResult.path),
								h('div', { className: 'wm-files' }, '文件：' + (authorResult.files || []).join(', ')),
								h('div', { className: 'wm-note' }, '安装：' + (authorResult.hint || '')),
							)
							: h('span', { className: 'wm-err' }, authorResult.error),
					) : null,
					h('div', { className: 'wm-acts' },
						h('input', { className: 'wm-input', style: { minWidth: 260 }, placeholder: '检查现有插件目录路径（如 C:\\dev\\my-plugin）', value: checkPath, onChange: function (e) { setCheckPath(e.target.value) } }),
						h('button', { className: 'wm-btn', onClick: runCheck }, '自查'),
					),
					checkResult ? h('div', { className: 'wm-info' },
						checkResult.ok
							? (checkResult.results || []).map(function (r, i) {
								return h('div', { key: i, className: r.ok ? 'wm-update' : 'wm-hazard' }, (r.ok ? '✓' : '✗') + ' [' + r.file + '] ' + r.message)
							})
							: h('span', { className: 'wm-err' }, checkResult.error),
					) : null,
				) : null,
				recent.length ? h('div', { className: 'wm-tags' },
					h('span', { className: 'wm-note' }, '最近安装：'),
					recent.map(function (r) {
						return h('a', { key: r, className: 'wm-tag wm-tag-lang', style: { textDecoration: 'none', cursor: 'pointer' }, href: 'https://github.com/' + r, target: '_blank', rel: 'noreferrer' }, r)
					}),
				) : null,
				data && data.error ? h('div', { className: 'wm-banner' }, h('span', null, '⚠ ' + data.error), h('div', { className: 'wm-acts' }, h('button', { className: 'wm-btn', onClick: function () { setDiagnoseOpen(true) } }, '🔍 网络诊断'))) : null,
				error ? h(ErrorCard, { error: error, onDiagnose: function () { setDiagnoseOpen(true) }, onRetry: function () { load(q, page, true) } }) : null,
				diagnoseOpen ? h('div', { className: 'wm-overlay', onClick: function (e) { if (e.target === e.currentTarget) setDiagnoseOpen(false) } },
					h('div', { className: 'wm-modal' }, h(DiagnosePanel, { onClose: function () { setDiagnoseOpen(false) } })),
				) : null,
				loading && !data ? h('div', { className: 'wm-note' }, T('loading')) : null,
				data && data.items && data.items.length === 0 ? h('div', { className: 'wm-note' }, T('empty')) : null,
				data && data.items ? h('ul', { className: 'wm-cards' }, data.items.map(card)) : null,
				data ? h('div', { className: 'wm-page' },
					h('button', { className: 'wm-btn', disabled: page <= 1 || loading, onClick: function () { var p = page - 1; setPage(p); load(q, p, false) } }, T('prev')),
					h('span', { className: 'wm-note' }, '第 ' + page + ' / ' + Math.max(totalPages, 1) + ' 页'),
					h('button', { className: 'wm-btn', disabled: !data.hasMore || loading, onClick: function () { var p = page + 1; setPage(p); load(q, p, false) } }, T('next')),
				) : null,
				h('div', { className: 'wm-note' }, '安装 / 更新 / 卸载 / 开关插件后，需要重启 DSH 才会生效（技能热加载除外）。安装第三方插件前请先审阅其仓库源码。'),
			)
		}

		// ---------------------------------------------------------------- Installed tab

		function InstalledTab() {
			var [data, setData] = useState(null)
			var [error, setError] = useState(null)
			var [jobId, setJobId] = useState(null)
			var [busyName, setBusyName] = useState(null)
			var [notice, setNotice] = useState(null)
			var [envFor, setEnvFor] = useState(null)
			var [envData, setEnvData] = useState(null)
			var [envDraft, setEnvDraft] = useState({})
			var [history, setHistory] = useState([])
			var [showHistory, setShowHistory] = useState(false)
			var [restoring, setRestoring] = useState(null)
			var [diagnoseOpen, setDiagnoseOpen] = useState(false)
			var loc = useLocale()

			function exportAudit() {
				api('/audit')
					.then(function (a) {
						var blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' })
						var url = window.URL.createObjectURL(blob)
						var el = document.createElement('a')
						el.href = url
						el.download = 'dsh-market-audit-' + new Date().toISOString().slice(0, 10) + '.json'
						document.body.appendChild(el)
						el.click()
						document.body.removeChild(el)
						window.URL.revokeObjectURL(url)
						setNotice('审计日志已导出（已脱敏）')
					})
					.catch(function (e) { setNotice(String(e && e.message || e)) })
			}

			function webdavBackup() {
				api('/backup/webdav', { method: 'POST', body: JSON.stringify({}) })
					.then(function (r) { setNotice(r && r.ok ? '已推送到 WebDAV：' + r.url : String((r && r.error) || '失败')) })
					.catch(function (e) { setNotice(String(e && e.message || e)) })
			}

			function load() {
				api('/installed')
					.then(function (d) { setData(d); setError(null) })
					.catch(function (e) { setError(String(e && e.message || e)) })
			}
			useEffect(function () {
				load()
				api('/history?n=30').then(function (h) { setHistory((h.events || []).slice().reverse()) }).catch(function () {})
			}, [])

			var jobState = useJobPolling(jobId, function (st) {
				if (st.status === 'done' || st.status === 'failed') {
					setJobId(null)
					setBusyName(null)
					setNotice(st.status === 'done' ? '✓ 完成，重启 DSH 后生效。' : '✗ ' + (st.error || st.status))
					load()
				}
			})

			function toggle(p) {
				api('/set-enabled', { method: 'POST', body: JSON.stringify({ name: p.name, enabled: !p.enabled }) })
					.then(function (r) { if (r && r.error) setNotice(r.error); else setNotice(r.changed ? (r.enabled ? '已启用（重启后生效）' : '已关闭（重启后生效）') : '未变化'); load() })
					.catch(function (e) { setNotice(String(e && e.message || e)) })
			}

			function update(p) {
				setBusyName(p.name)
				api('/update', { method: 'POST', body: JSON.stringify({ name: p.name }) })
					.then(function (r) {
						if (r && r.jobId) setJobId(r.jobId)
						else { setNotice(String((r && r.error) || '启动更新失败')); setBusyName(null) }
					})
					.catch(function (e) { setBusyName(null); setNotice(String(e && e.message || e)) })
			}

			function remove(p) {
				if (typeof window !== 'undefined' && window.confirm && !window.confirm('确定卸载 ' + p.name + ' 吗？卸载后需重启 DSH 生效。')) return
				setBusyName(p.name)
				api('/uninstall', { method: 'POST', body: JSON.stringify({ name: p.name }) })
					.then(function (r) {
						setBusyName(null)
						setNotice(r && r.ok ? '已卸载（重启后生效）' : String((r && r.error) || '卸载失败'))
						load()
					})
					.catch(function (e) { setBusyName(null); setNotice(String(e && e.message || e)) })
			}

			function row(p) {
				var busy = busyName === p.name
				return h('div', { className: 'wm-row', key: p.name },
					h('div', { className: 'wm-row-main' },
						h('span', { className: 'wm-row-name' }, p.name + (p.official ? '（官方内置）' : '')),
						h('span', { className: 'wm-row-meta' },
							(p.kind === 'builtin' ? '内置插件' : '用户安装') + ' · v' + (p.version || '?')
							+ (p.updateAvailable ? ' · 最新 v' + p.latestVersion : '')
							+ (p.description ? ' · ' + p.description : '')),
					),
					p.kind === 'installed' ? h('div', { className: 'wm-acts' },
						h('button', {
							className: 'wm-switch' + (p.enabled ? ' wm-switch-on' : ''),
							disabled: busy, title: p.enabled ? '已启用（点击关闭）' : '已关闭（点击启用）',
							onClick: function () { toggle(p) },
						}, h('span', { className: 'wm-knob' })),
						p.updateAvailable ? h('button', { className: 'wm-btn wm-primary', disabled: busy, onClick: function () { update(p) } }, busy ? '更新中…' : T('update')) : null,
						h('button', { className: 'wm-btn', disabled: busy, onClick: function () { openEnv(p) } }, T('env')),
						h('button', { className: 'wm-btn wm-danger', disabled: busy, onClick: function () { remove(p) } }, T('uninstall')),
					) : null,
				)
			}

			function openEnv(p) {
				setEnvFor(p.name)
				setEnvData(null)
				setEnvDraft({})
				api('/env?name=' + encodeURIComponent(p.name))
					.then(function (d) {
						setEnvData(d)
						var draft = {}
						var all = {}
						Object.keys(d.saved || {}).forEach(function (k) { all[k] = true })
						;(d.candidates || []).forEach(function (k) { all[k] = true })
						Object.keys(all).forEach(function (k) { draft[k] = (d.saved || {})[k] || '' })
						setEnvDraft(draft)
					})
					.catch(function (e) { setEnvData({ error: String(e && e.message || e) }) })
			}

			function saveEnv() {
				var values = {}
				Object.keys(envDraft).forEach(function (k) { if (envDraft[k]) values[k] = envDraft[k] })
				api('/env/save', { method: 'POST', body: JSON.stringify({ name: envFor, values: values }) })
					.then(function (r) {
						setNotice('环境变量已保存到 ~/.dsh/.env（重启 DSH 生效）：' + (r.applied || []).join(', '))
						setEnvFor(null)
					})
					.catch(function (e) { setNotice(String(e && e.message || e)) })
			}

			function downloadBackup() {
				api('/backup')
					.then(function (b) {
						var blob = new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' })
						var url = window.URL.createObjectURL(blob)
						var a = document.createElement('a')
						a.href = url
						a.download = 'dsh-market-backup-' + new Date().toISOString().slice(0, 10) + '.json'
						document.body.appendChild(a)
						a.click()
						document.body.removeChild(a)
						window.URL.revokeObjectURL(url)
						setNotice('备份已下载（' + Object.keys(b.records || {}).length + ' 条记录）')
					})
					.catch(function (e) { setNotice(String(e && e.message || e)) })
			}

			function restoreBackup(file) {
				var reader = new FileReader()
				reader.onload = function () {
					try {
						var backup = JSON.parse(String(reader.result))
						if (!backup || typeof backup.records !== 'object') { setNotice('备份文件格式不正确'); return }
						api('/restore', { method: 'POST', body: JSON.stringify({ records: backup.records }) })
							.then(function (r) {
								if (r && r.error) { setNotice(r.error); return }
								setNotice('恢复中：' + r.restoring + ' 个未安装项目…')
								pollRestore()
							})
							.catch(function (e) { setNotice(String(e && e.message || e)) })
					} catch (e) { setNotice('备份文件解析失败：' + String(e && e.message || e)) }
				}
				reader.readAsText(file)
			}

			function pollRestore() {
				api('/restore/status')
					.then(function (st) {
						setRestoring(st)
						if (st && st.running) setTimeout(pollRestore, 1500)
						else {
							setNotice('恢复完成：成功 ' + (st.done || []).length + '，失败 ' + (st.failed || []).length
								+ (st.failed && st.failed.length ? '（' + st.failed.map(function (f) { return f.repo }).join(', ') + '）' : ''))
							setRestoring(null)
							load()
						}
					})
					.catch(function () { setTimeout(pollRestore, 1500) })
			}

			function selfUpdate() {
				setBusyName(PKG_SELF)
				api('/self-update', { method: 'POST', body: JSON.stringify({}) })
					.then(function (r) {
						if (r && r.jobId) setJobId(r.jobId)
						else { setBusyName(null); setNotice(String((r && r.error) || '无需更新')) }
					})
					.catch(function (e) { setBusyName(null); setNotice(String(e && e.message || e)) })
			}

			function contentRow(c) {
				return h('div', { className: 'wm-row', key: c.repo + c.type },
					h('div', { className: 'wm-row-main' },
						h('span', { className: 'wm-row-name' }, c.name + ' (' + (TYPE_LABELS[c.type] || c.type) + ')'),
						h('span', { className: 'wm-row-meta' }, '来源：' + c.repo + (c.installedAt ? ' · ' + fmtTime(c.installedAt) + ' 安装' : '') + (c.location ? ' · ' + c.location : '')),
					),
					h('div', { className: 'wm-acts' },
						h('button', { className: 'wm-btn wm-danger', onClick: function () { remove(c) } }, '卸载'),
					),
				)
			}

			return h('div', { className: 'wm-root' },
				h('div', { className: 'wm-head' },
					h('span', { className: 'wm-title' }, T('installed')),
					data ? h('span', { className: 'wm-meta' }, 'profile: ' + data.profile) : null,
					h('div', { className: 'wm-grow' },
						h('button', { className: 'wm-btn', title: 'language', onClick: function () { loc.setLocale(loc.locale === 'zh' ? 'en' : 'zh') } }, loc.locale === 'zh' ? 'EN' : '中文'),
						h('button', { className: 'wm-btn', onClick: downloadBackup }, T('backup')),
						h('button', { className: 'wm-btn', onClick: webdavBackup }, 'WebDAV'),
						h('label', { className: 'wm-btn', style: { cursor: 'pointer' } },
							T('restore'),
							h('input', { type: 'file', accept: '.json', style: { display: 'none' }, onChange: function (e) { if (e.target.files && e.target.files[0]) restoreBackup(e.target.files[0]); e.target.value = '' } }),
						),
						h('button', { className: 'wm-btn', onClick: function () { setShowHistory(!showHistory) } }, showHistory ? T('hideHistory') : T('history')),
						showHistory ? h('button', { className: 'wm-btn', onClick: exportAudit }, '导出审计') : null,
						h('button', { className: 'wm-btn', onClick: function () { setDiagnoseOpen(true) } }, '🔍 诊断'),
						h('button', { className: 'wm-btn', onClick: load }, T('refresh')),
					),
				),
				notice ? h('div', { className: 'wm-banner' }, h('span', null, notice)) : null,
				error ? h(ErrorCard, { error: error, onDiagnose: function () { setDiagnoseOpen(true) }, onRetry: load }) : null,
				diagnoseOpen ? h('div', { className: 'wm-overlay', onClick: function (e) { if (e.target === e.currentTarget) setDiagnoseOpen(false) } },
					h('div', { className: 'wm-modal' }, h(DiagnosePanel, { onClose: function () { setDiagnoseOpen(false) } })),
				) : null,
				!data ? h('div', { className: 'wm-note' }, '加载中…') : null,
				data && data.error ? h('div', { className: 'wm-err' }, data.error) : null,
				jobState && busyName ? h(ProgressView, { state: jobState }) : null,
				data && data.plugins ? data.plugins.map(row) : null,
				data && data.contents && data.contents.length ? h('div', { className: 'wm-note' }, '内容安装（技能 / 预设 / 脚本）：') : null,
				data && data.contents ? data.contents.map(contentRow) : null,
				data && data.self ? h('div', { className: 'wm-info' },
					h('span', null, '插件市场（dsh-whale-market）v' + data.self.version + (data.self.latestVersion ? ' · 最新 v' + data.self.latestVersion : '')),
					h('div', { className: 'wm-acts' },
						data.self.updateAvailable ? h('button', { className: 'wm-btn wm-primary', onClick: selfUpdate }, busyName === PKG_SELF ? '更新中…' : '一键更新市场') : h('span', { className: 'wm-note' }, '市场已是最新'),
					),
				) : null,
				showHistory ? h('div', { className: 'wm-info' },
					history.length ? history.slice(0, 20).map(function (ev, i) {
						return h('div', { key: i, className: 'wm-note' },
							'[' + fmtTime(ev.at) + '] ' + (ev.action || '?') + ' ' + (ev.name || ev.repo || ''))
					}) : h('span', { className: 'wm-note' }, '暂无历史'),
				) : null,
				restoring ? h('div', { className: 'wm-info' },
					h('span', null, '恢复中：' + (restoring.done || []).length + '/' + restoring.total + (restoring.current ? ' · 当前 ' + restoring.current : '')),
				) : null,
				envFor ? h('div', { className: 'wm-overlay', onClick: function (e) { if (e.target === e.currentTarget) setEnvFor(null) } },
					h('div', { className: 'wm-modal' },
						h('div', { className: 'wm-modal-head' },
							h('span', { className: 'wm-modal-title' }, '环境变量 — ' + envFor),
						),
						!envData ? h('span', { className: 'wm-note' }, '加载中…') : (
							envData.error ? h('span', { className: 'wm-err' }, envData.error) : h('div', { className: 'wm-info' },
								h('span', { className: 'wm-note' }, '保存后写入 ~/.dsh/.env，重启 DSH 生效（DSH_ 前缀为保留字，不可设置）。'),
								Object.keys(envDraft).map(function (k) {
									return h('div', { key: k, style: { display: 'flex', alignItems: 'center', gap: 8 } },
										h('span', { className: 'wm-note', style: { minWidth: 180, fontFamily: 'ui-monospace,Consolas,monospace' } }, k),
										h('input', {
											className: 'wm-input', type: 'password', value: envDraft[k] || '',
											placeholder: '（留空则不设置）',
											onChange: function (e) { var next = Object.assign({}, envDraft); next[k] = e.target.value; setEnvDraft(next) },
										}),
									)
								}),
								Object.keys(envDraft).length === 0 ? h('span', { className: 'wm-note' }, '未检测到候选环境变量。可编辑 ~/.dsh/.env 手动添加。') : null,
							)
						),
						h('div', { className: 'wm-modal-actions' },
							h('button', { className: 'wm-btn', onClick: function () { setEnvFor(null) } }, '取消'),
							h('button', { className: 'wm-btn wm-primary', onClick: saveEnv }, '保存'),
						),
					),
				) : null,
				h('div', { className: 'wm-note' }, '关闭 / 启用 / 更新 / 卸载后需要重启 DSH 才会生效。内置插件不可卸载。'),
			)
		}

		// ---------------------------------------------------------------- apply

		function apply(ctx) {
			ctx.slots.inject('settings.plugins.tab', function () {
				return ctx.slots.register({
					name: 'settings.plugins.tab',
					id: 'market',
					order: 10,
					label: function () { return '插件市场' },
				}, MarketTab)
			})
			ctx.slots.inject('settings.plugins.tab', function () {
				return ctx.slots.register({
					name: 'settings.plugins.tab',
					id: 'installed',
					order: 20,
					label: function () { return '已安装' },
				}, InstalledTab)
			})
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
