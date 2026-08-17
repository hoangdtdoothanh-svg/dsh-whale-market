# dsh-whale-market 鲸鱼插件市场 🐋

浏览、搜索、一键安装与更新 GitHub dsh-plugin 主题下的 DSH 社区插件。
运行在 **DeepSeek Harness**（DSH / whale fork）的 Web 设置页里，同时给 Agent 提供四个市场工具。

## 功能总览（v0.2+：ROADMAP P0/P1/P2 全部落地）

### 市场核心
- **实时市场**：GitHub Search API 拉取 topic:dsh-plugin（4700+ 仓库）与 topic:agent-skills（15000+ 技能），按 star 排序、分页、关键词搜索。
- **四级数据降级**：实时 API → 磁盘快照 → **静态索引**（内置 registry.json.gz 4260 条 + skills.json.gz，可用 registryUrl/skillsUrl 指向自建 CI 产物走 jsDelivr CDN）→ 内置种子，任何网络状况都能浏览。
- **四个栏目**：插件 / Skills / 皮肤 / 预设（静态索引分类过滤，13 个社区维护分类）。
- **筛选排序**：分类、语言、只看收藏、只看已验证（索引构建期探测 package.json 是否声明 dsh 能力）、按星标/最近更新。
- **功能词搜索**：输入中文功能词（看图 / 记忆 / 皮肤 / 工作流 / 翻译 …37 个别名）自动扩展为英文同义词 OR 查询（GitHub 实时 + 静态索引双通道），并有一排「按功能搜」快捷 chip。

### 安装体验
- **类型检测**（/info）：cordis 插件 / 技能 / 预设 / 安装脚本 / 手动安装，附判定报告与根目录文件清单。
- **风险确认门禁**：脚本型、非插件、手动型仓库安装前返回 409 + 判定报告，UI 弹窗确认（含危险模式扫描：下载执行 / 写启动项 / 读凭据 / 改 rc）后才安装。
- **分形态安装**：技能 → ~/.dsh/skills（热加载）；预设 → ~/.dsh/.agent-presets；脚本 → 确认后执行（保留在 ~/.dsh/market/cache）；插件 → dsh plugin 官方机制（异步任务 + 进度/取消/进程树看门狗 + 密钥清洗 + bundles 自愈 + pnpm allowBuilds 自动放行重试）。
- **git 直连失败自动回退 codeload tarball**（隔离全局 git 代理改写，实测 ghfast.top 代理宕机场景）。
- **兼容性评分**：manifest 检查（dsh 字段 / patch 文件 / main 入口 / react peer）→ ✅/⚠️/❌ + 原因。
- **分级错误提示**：网络错误分类（DNS / 连接被拒 / 超时 / TLS / fetch failed）+ 中文原因 + 操作建议 + 一键重试。
- **网络诊断审计**（/diagnose）：一键检查安装链路每个环节（GitHub API / raw / codeload / jsDelivr / npm registry / dsh CLI / pnpm / git / profile bundle 入口健康），✅/❌ + 耗时 + HTTP 状态，入口在「插件市场」错误卡片与「已安装」头部。

### 已安装管理
- 开关 / 更新（npm 最新版对比）/ 卸载 / 环境变量编辑（写入 ~/.dsh/.env，DSH_ 保留，备份不含密钥）。
- **内容安装清单**（技能/预设/脚本独立管理）。
- **市场自更新**（一键更新本体）。

### 生态与效率
- **收藏夹** + 收藏更新通知（GitHub pushed_at 对比 + 红点/横幅）。
- **安装历史 + 备份/恢复**（JSON 导出/导入，批量重建）+ **WebDAV 备份**（config.webdavUrl）。
- **安装反馈 → GitHub Issue**（config.githubToken 自动建 issue，否则预填链接）。
- **审计日志**（脱敏导出）。
- **市场数据大盘**（总数/分类/语言/星标分布）。
- **插件作者工具**：合规脚手架（package.json + patch + host 模板）+ 发布前自查。
- **错标仓库适配层**（adaptor.json 重定向）。
- **双语 UI**（中/EN 切换，覆盖主要界面文案）。
- **Agent 工具**：market_search / market_install / market_installed / market_update（支持 kind/sort）。
- **原生 UI**：对齐 DSH design tokens（--dsw-alias-* / --dsw-font-*），12px 圆角卡片、原生反色按钮、Tab 下划线指示器、胶囊徽标。

## 安装

> 依赖：Node ≥ 18、dsh（或 whale）CLI 与 pnpm 在 PATH 上。

~~~powershell
# 方式一：本地（开发时推荐，link 方式接入）
cd dsh-whale-market
.\install.ps1                    # 自动选 desktop（有则）/ web profile

# 方式二：npm 包（发布后）
dsh plugin --profile desktop add dsh-whale-market

# 方式三：GitHub
dsh plugin --profile desktop add github:QiFeng/dsh-whale-market

# 手动挂载（任一用户 patch 层）
#   - insert:
#       - id: whale-market
#         name: dsh-whale-market
#         config: {}
~~~

**重启 DSH 后**，进入：设置 → 插件 → 插件市场 与 设置 → 插件 → 已安装。

### 插件 config 选项（cordis.patch.yml 的 config）

| 键 | 默认 | 说明 |
|---|---|---|
| profile | 自动 | 强制指定管理目标 profile |
| cli | dsh→whale | 指定 CLI 二进制 |
| registryUrl | 内置 gz | 远程静态插件索引（CI 产物，走 CDN） |
| skillsUrl | 内置 gz | 远程静态技能索引 |
| agentTools | auto | Agent 市场工具开关：auto/on 注册 market_* 工具（与官方内置同名工具共存，本插件实现接管同名调用）；off 让位官方内置工具 |
| githubToken | 无 | 反馈自动建 issue 用的 GitHub Token |
| webdavUrl / webdavUser / webdavPassword | 无 | WebDAV 备份目标 |

### 静态索引构建（自托管 / 参与维护）

~~~bash
# 从社区 registry 构建（导入模式）
node scripts/build-registry.mjs --from https://cdn.jsdelivr.net/gh/bradeGithub/DSH-Plugins-Marketplace@main/registry.json.gz --kind plugin

# 全量爬取（stars 分段，GITHUB_TOKEN 可提速）
node scripts/build-registry.mjs --crawl plugin
node scripts/build-registry.mjs --crawl skill --top 2000
~~~

仓库自带 GitHub Actions（.github/workflows/registry.yml）定时爬取并提交更新索引。

## Agent 工具示例

    market_search q=记忆 kind=plugin      # 搜索插件
    market_install spec=owner/repo        # 安装（风险仓库会要求确认）
    market_installed                      # 已安装清单 + 更新状态
    market_update name=xxx                # 更新插件

## 架构

    dsh-whale-market/
    ├─ package.json        dsh.bundle.patch + dsh.client（web）声明
    ├─ cordis.patch.yml    bundle 补丁（id: whale-market）
    ├─ adaptor.json        错标仓库重定向适配层
    ├─ lib/
    │  ├─ index.js         宿主半侧（零依赖，纯 Node 内建）：
    │  │                   GitHub/静态索引 → 类型检测 → 安装任务 → HTTP API → Agent 工具
    │  ├─ client.js        浏览器半侧（web lazy-CJS，无构建步骤）
    │  ├─ categories.json  13 个分类规则（社区可维护）
    │  ├─ registry.json.gz 静态插件索引（4260 条）
    │  └─ skills.json.gz   静态技能索引（2000 条）
    ├─ scripts/build-registry.mjs   索引构建（导入/爬取双模式）
    ├─ .github/workflows/registry.yml  CI 定时刷新索引
    ├─ install.ps1         一键安装脚本
    ├─ docs/ROADMAP.md     功能规划
    └─ test/host-smoke.mjs 隔离环境端到端测试（60 项）

### HTTP API（同源 + loopback + 写操作 CSRF 头）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /plugins/dsh-whale-market/list | 市场列表（kind/category/language/sort/favorite） |
| GET | /plugins/dsh-whale-market/meta | 分类/语言/静态索引状态 |
| GET | /plugins/dsh-whale-market/info | 类型检测 + 兼容性评分 + 危险扫描 |
| GET | /plugins/dsh-whale-market/installed | 插件 + 内容安装清单 + 自更新状态 |
| GET | /plugins/dsh-whale-market/dashboard | 数据大盘 |
| POST | /plugins/dsh-whale-market/install | 安装（409 需确认） |
| GET | /plugins/dsh-whale-market/install/status | 任务进度 |
| POST | /plugins/dsh-whale-market/install/cancel | 取消任务 |
| POST | /plugins/dsh-whale-market/set-enabled · /update · /uninstall | 管理 |
| GET/POST | /plugins/dsh-whale-market/favorites · /favorite | 收藏 |
| GET | /plugins/dsh-whale-market/history · /backup · /audit | 历史 / 备份 / 审计 |
| POST | /plugins/dsh-whale-market/restore（+/status） | 恢复 |
| GET/POST | /plugins/dsh-whale-market/env | 环境变量管理 |
| GET/POST | /plugins/dsh-whale-market/feedback | 安装反馈（GitHub Issue） |
| GET/POST | /plugins/dsh-whale-market/notifications | 收藏更新通知 |
| POST | /plugins/dsh-whale-market/self-update | 市场自更新 |
| POST | /plugins/dsh-whale-market/backup/webdav | WebDAV 备份 |
| POST | /plugins/dsh-whale-market/author/scaffold · /author/check | 作者工具 |
| GET | /plugins/dsh-whale-market/status | 市场状态（profile/CLI） |

## 安全与注意事项

- 安装第三方插件 = 运行第三方代码（pnpm 可能执行构建脚本 / 脚本型仓库会执行 install.sh/ps1）。安装前先审阅仓库源码；市场会给出类型判定、兼容性评分与危险模式扫描结果并要求确认。
- 安装/更新/卸载/开关后需要**重启 DSH** 才生效（技能热加载除外）。
- 只支持安装到市场自身所在的 profile。
- 环境变量编辑不会写入备份文件（密钥不进备份）。

## 更新日志

- **v0.2.0（2026-08-16，第三方体检反馈落地）**
  - 修复危险模式扫描静默失效 bug（双重）：① `scanScriptHazards` 缺 `const text = await res.text()`，正则抛错被空 catch 吞掉，危险命中恒为 0；② downloadExec 正则要求管道后紧跟 sh，真实场景多为 `" | sh"`（带空格）永远无法命中。已拆出纯函数 `scanScriptText`（修复正则 + 5 条单测）
  - 索引构建期验证：`build-registry.mjs --verify` 探测仓库 package.json 是否声明 dsh 能力，产出 `verified` 标记；列表支持 `verified=1` 只看已验证；meta 上报验证统计
  - Agent 工具注册开关 `agentTools`（off 时让位官方内置同名 `market_*` 工具）
  - 种子索引（seed）与列表均走适配层，剔除 reactive-resume / OpenViking / zhuzhiliao / yao 等误标仓库
  - 测试进 CI：syntax check + host-smoke（无 dsh CLI 时自动跳过安装类用例）

## 参考与致谢

架构参考了开源生态（吸收其思路、按需取舍）并致谢：
- [bradeGithub/DSH-Plugins-Marketplace](https://github.com/bradeGithub/DSH-Plugins-Marketplace) — 类型检测/安全审查/反馈体系/静态索引构建
- [AwesomeHou/dsh-plugin-marketplace](https://github.com/AwesomeHou/dsh-plugin-marketplace) — 异步安装任务/进度/Agent 工具
- [Noob-stupid/dsh-plugin-hub](https://github.com/Noob-stupid/dsh-plugin-hub) — 面板 + 市场一体化
- [With-With/dsh-hindsight-plugins](https://github.com/With-With/dsh-hindsight-plugins) — 零依赖宿主 + settings.plugins.tab 注入范式

## License

MIT
