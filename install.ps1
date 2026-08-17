# dsh-whale-market 一键安装脚本（Windows PowerShell）
# 用法：在 dsh-whale-market 目录下运行  .\install.ps1
# 作用：把本市场安装进目标 profile（默认优先 desktop，其次 web），
#       重启 DSH 后生效（设置 → 插件 → 插件市场 / 已安装）。
$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1) 选 profile：优先 desktop（DSH Desktop），其次 web，可用 -Profile 覆盖
$profile = $null
if ($args -contains '-Profile') {
    $i = [array]::IndexOf($args, '-Profile')
    $profile = $args[$i + 1]
} elseif (Test-Path (Join-Path $env:USERPROFILE '.dsh\profiles\desktop\package.json')) {
    $profile = 'desktop'
} elseif (Test-Path (Join-Path $env:USERPROFILE '.dsh\profiles\web\package.json')) {
    $profile = 'web'
} else {
    Write-Host '未找到任何 profile。请先启动一次 DSH（Desktop 或 dsh web），再运行本脚本。' -ForegroundColor Yellow
    exit 1
}

# 2) 找 CLI：优先 dsh（官方 npm 包），其次 whale（fork）
$cli = $null
foreach ($cand in @('dsh', 'whale')) {
    if (Get-Command $cand -ErrorAction SilentlyContinue) { $cli = $cand; break }
}
if (-not $cli) {
    Write-Host '未找到 dsh / whale CLI。请先安装：npm i -g @deepseek-ai/dsh' -ForegroundColor Yellow
    exit 1
}

Write-Host "==> 安装 dsh-whale-market 到 profile: $profile （CLI: $cli）" -ForegroundColor Cyan

# 3) 安装（本地目录，pnpm 以 link 方式接入，方便同步开发）
& $cli plugin --profile $profile add $here
if ($LASTEXITCODE -ne 0) {
    Write-Host "安装失败（退出码 $LASTEXITCODE）。请检查上面 pnpm 输出。" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ''
Write-Host '完成 ✔ 请重启 DSH（Desktop 应用或 dsh web 进程），然后进入：' -ForegroundColor Green
Write-Host '  设置 → 插件 → 插件市场（浏览/搜索/一键安装）'
Write-Host '  设置 → 插件 → 已安装（更新/开关/卸载）'
Write-Host ''
Write-Host '卸载：dsh plugin --profile ' + $profile + ' remove dsh-whale-market'
