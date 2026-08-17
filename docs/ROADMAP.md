# dsh-whale-market 功能规划路线图

> 当前版本 v0.1.0 已有：GitHub 实时同步 + 种子兜底、搜索/分页、一键安装（异步任务/进度/取消）、
> 已安装管理（开关/更新/卸载）、Agent 工具（market_search/install/installed/update）、
> profile 自动探测、安全门禁（loopback/CSRF/spec 校验/密钥清洗）。

## 差距分析（对标生态）

| 参考项目能力 | 我们现状 | 差距 |
|---|---|---|
| bradeGithub：类型检测（skill/preset/script/cordis） | 只有 dsh 声明探测 | 大 |
| bradeGithub：skills 栏目（agent-skills/claude-skills topic） | 无 | 大 |
| bradeGithub：皮肤清单 + 注入 | 无 | 中 |
| bradeGithub：安装反馈 → GitHub Issue | 无 | 小 |
| bradeGithub：环境变量编辑（API Key） | 无 | 中 |
| bradeGithub：备份/恢复 + WebDAV | 无 | 小 |
| bradeGithub：adaptor 错标仓库重定向 | 无 | 小 |
| bradeGithub：静态 registry + CI 构建（jsDelivr 分发） | 种子快照（手动） | 大 |
| bradeGithub：安装脚本危险模式扫描 | 无 | 中 |
| AwesomeHou：下载字节数/速度/ETA 代理中继 | 无 | 小 |
| AwesomeHou：自更新 | 仅提示 | 小 |
| 双方：皮肤/预设类栏目 | 无 | 中 |

## 功能清单（按优先级分组）

### P0 — 核心体验（先做这批）

**1. 静态索引双源 + CI 构建（L）**
- 问题：api.github.com 在部分网络不可达/限流，实时源不稳定。
- 方案：GitHub Actions 定时（2h 增量 + 每日全量）用 stars 分段抓全 4700+ 仓库，产物 registry.json.gz 提交仓库、经 jsDelivr CDN 分发；市场启动时「实时源 → 磁盘快照 → 静态 CDN 源 → 内置种子」四级降级，静态源内置搜索/分页/分类。可配置 registryUrl 指向自建源。
- 附带：权威分类表（社区维护 categories.json，按仓库名/描述规则归类）。

**2. 安装类型检测 + 阶段化进度（M）**
- 方案：安装前探测仓库（GitHub API + jsDelivr 双路径）识别六类：
  cordis 插件（dsh 声明）→ skill（SKILL.md）→ agent 预设（preset.yml）→ 皮肤（skin 清单）→ 安装脚本（install.sh/ps1，需确认）→ 手动安装（README）。
- 不同类型走不同安装路径（skill → ~/.dsh/skills；预设 → ~/.dsh/.agent-presets；脚本 → 执行前弹确认 + 危险模式扫描）。
- 进度改为五阶段：解析 → 拉取 → 依赖/构建 → 注册（bundles/patch）→ 完成，含输出日志。

**3. 皮肤 / Skills / 预设 三个栏目（L）**
- 方案：市场 Tab 顶部加分类导航：
  - 插件（topic:dsh-plugin，现有）
  - Skills（topic:agent-skills + topic:claude-skills，安装到 ~/.dsh/skills/<slug>，注册器热加载）
  - 皮肤（dsh-plugin 中 skin 子集 + 独立清单，安装后自动出现在 bundles，重启生效）
  - 预设（agent 预设安装到 ~/.dsh/.agent-presets/<slug>）
- 已安装判定按栏目独立（目录启发式 + 清单）。

**4. 非插件/风险仓库确认弹窗（S）**
- 方案：/info 探测结果 valid=false 或含安装脚本时，安装按钮变为「安装（有风险）」→ 弹确认框展示判定报告（类型、是否声明 dsh、危险模式命中数），确认后才启动任务。防盲装坏包。

### P1 — 生态扩展

**5. 收藏夹 + 最近安装（S）**
- favorites.json 持久化，列表卡片加 ★ 收藏；顶栏过滤「我的收藏」。

**6. 安装历史 + 备份/恢复（S）**
- installed.json 完整历史（含卸载记录），导出/导入 JSON 备份，一键恢复未安装项（批量重建任务队列）。

**7. 环境变量管理（M）**
- 已安装插件扫描 envKeys（常见 KEY/TOKEN 名），编辑后写入 ~/.dsh/.env（dsh user 层，重启注入）+ 本地 envs.json；拒绝 DSH_ 保留前缀；备份不含密钥。

**8. 安装反馈 → GitHub Issue（S）**
- 安装成功后下次打开市场弹「是否正常？」；配置 GITHUB_TOKEN 则自动建 issue（带 label），否则生成预填链接。

**9. 市场自更新（S）**
- 已安装页「检查更新」→ npm 最新版对比 → 一键 dsh plugin add dsh-whale-market@latest（任务流复用）。

**10. 筛选/排序增强（S）**
- 语言/分类/星数区间过滤 + 排序（stars/updated）；服务端静态源过滤 + 客户端兜底。

**11. 适配层（S）**
- adaptor.json：错标仓库（本体不是插件却打了 topic）列表移除 + 重定向到真实插件仓库；社区可 PR 维护。

### P2 — 进阶

**12. 兼容性评分（M）**：检查 manifest（dsh 字段/peer react/入口存在性）给出 ✅/⚠️/❌ 徽标与原因。
**13. 审计日志（S）**：市场全部操作（安装/卸载/开关/更新）写日志，可导出（自动脱敏）。
**14. WebDAV 备份（M）**：备份清单推送到自建 WebDAV。
**15. 双语 UI（M）**：zh/en 切换（settings 已有 locale 服务，可接）。
**16. 更新通知（M）**：收藏的插件有新版时顶栏红点；轮询 + 本地缓存。
**17. 插件作者工具（M）**：脚手架模板（生成合规 package.json + patch）+ 发布前自查（publint 类检查）。
**18. 市场数据大盘（S）**：首页统计卡（总数/本周新增/最热/分类分布），来自静态索引。

## 推荐路线图

    v0.2  P0 全部（静态双源、类型检测、三栏目、风险确认）     ← 形态完整
    v0.3  P1（收藏、备份、env 管理、反馈、自更新、筛选、适配层）
    v0.4  P2 按需（兼容评分、双语、通知、作者工具…）

---

## 第三方体检反馈（2026-08-16，v0.2.0 落地）

来源：对官方 DSH 插件市场与本文档插件的第三方审计（详见仓库根 `market-review-第三方体检报告.md`）。

### 已落地
- **P0-1 危险扫描静默失效（双重）**：① `scanScriptHazards` 缺 `res.text()` 赋值 → 正则抛 ReferenceError 被空 catch 吞掉，危险命中恒为 0；② downloadExec 正则 `\|(sh|...)` 要求管道后紧跟 sh，真实脚本多为 `" | sh"`（带空格）即使①修复也永不命中。已拆出纯函数 `scanScriptText`（修复正则 + 5 条单测）。
- **P0-2 验证下沉到索引构建期**：`build-registry.mjs --verify` 探测 `package.json` 的 dsh 字段，条目带 `verified` 标记；列表支持 `verified=1` 只看已验证；meta 上报验证统计。
- **P0-3 工具同名接管**：新增 `agentTools` 配置，`off` 时让位官方内置 `market_*` 工具。
- 种子索引走适配层，误标仓库（reactive-resume / OpenViking / zhuzhiliao / yao）从列表剔除。
- 测试进 CI：syntax check + host-smoke（无 dsh CLI 自动跳过安装类用例）。

### 待办（新 backlog）
- [ ] 分类纠错闭环：用户"分类错误"反馈回流到 categories.json / 静态索引
- [ ] Web UI「只看已验证」复选框接线（API `verified=1` 已就绪，live 模式自动切静态索引）
- [ ] 多 profile 安装目标管理（当前仅市场所在 profile）
- [ ] 安装后 `pnpm audit` 依赖漏洞扫描
- [ ] WebDAV 密码 / env 密钥加密存储（OS keychain 或加密文件）
- [ ] 静态索引增量更新（pushed_at 差异）+ CDN 预热
- [ ] 上游生态净化：向误标仓库提 PR 移除 topic、真插件补 topic、提交 awesome-dsh-plugin

## 每项工作量口径

S ≈ 半天（单文件小改）；M ≈ 1-2 天；L ≈ 2-4 天（多文件 + 测试）。
