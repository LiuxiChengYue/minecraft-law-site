# ============================================================================
#  《我的世界》世界基本法典 官方网站 —— 一键上线脚本
#
#  用法：右键本文件 →「使用 PowerShell 运行」
#        （或在 PowerShell 里执行： .\tools\上线.ps1 ）
#
#  它会依次完成：
#    1. 检查/安装 Git（需要管理员权限时会给出手动步骤）
#    2. 在本地初始化仓库并提交
#    3. 在 GitHub 上创建仓库（用你提供的 Token）
#    4. 推送代码
#    5. 打印 Render 部署步骤
# ============================================================================

$ErrorActionPreference = 'Stop'
$RepoDir = Split-Path -Parent $PSScriptRoot   # 项目根目录

function Write-Step($text) {
  Write-Host ''
  Write-Host ('─' * 62) -ForegroundColor DarkGray
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('─' * 62) -ForegroundColor DarkGray
}
function Write-Ok($text)   { Write-Host "  ✓ $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }
function Write-Err($text)  { Write-Host "  ✗ $text" -ForegroundColor Red }

function Find-Git {
  $candidates = @(
    'C:\Program Files\Git\cmd\git.exe',
    'C:\Program Files (x86)\Git\cmd\git.exe',
    "$env:LOCALAPPDATA\Programs\Git\cmd\git.exe"
  )
  foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
  $cmd = Get-Command git -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ''
Write-Host '  《我的世界》世界基本法典 · 官方网站上线助手' -ForegroundColor White
Write-Host "  项目目录：$RepoDir" -ForegroundColor DarkGray

# ─────────────────────────────── 1. Git ───────────────────────────────
Write-Step '第 1 步 / 检查 Git'

$git = Find-Git
if ($git) {
  Write-Ok "已找到 Git：$git"
  Write-Host "    $(& $git --version)" -ForegroundColor DarkGray
} else {
  Write-Warn '没有找到 Git，准备自动安装…'

  $installer = Join-Path $RepoDir 'build\git-installer.exe'
  if (-not (Test-Path $installer)) {
    Write-Host '  正在下载安装包（走国内镜像）…'
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) {
      foreach ($p in @(
        "$env:USERPROFILE\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
      )) { if (Test-Path $p) { $node = $p; break } }
    }
    if ($node) {
      & $node (Join-Path $RepoDir 'tools\get-git.js')
    } else {
      Write-Err '没找到 node，无法自动下载。请手动访问 https://git-scm.com/download/win 下载安装。'
      exit 1
    }
  }

  if (Test-Path $installer) {
    Write-Host '  正在安装（会弹出 UAC 授权框，请点「是」）…'
    $p = Start-Process -FilePath $installer -ArgumentList @(
      '/VERYSILENT', '/NORESTART', '/NOCANCEL', '/SP-', '/CLOSEAPPLICATIONS'
    ) -Verb RunAs -Wait -PassThru
    Write-Host "  安装器退出码：$($p.ExitCode)"
    $git = Find-Git
    if ($git) { Write-Ok "Git 安装完成：$git" }
    else {
      Write-Err '安装后仍未找到 Git。请手动安装：https://git-scm.com/download/win'
      exit 1
    }
  }
}

# ─────────────────────────── 2. 本地仓库 ───────────────────────────
Write-Step '第 2 步 / 初始化本地仓库'

Set-Location $RepoDir

if (Test-Path (Join-Path $RepoDir '.git')) {
  Write-Ok '仓库已存在，跳过初始化'
} else {
  & $git init -q
  Write-Ok '已初始化 git 仓库'
}

# 只在本仓库内配置身份，不动全局设置
$name = & $git config user.name 2>$null
if (-not $name) {
  $input_name = Read-Host '  请输入提交用的名字（例如你的游戏 ID）'
  if (-not $input_name) { $input_name = 'server-admin' }
  & $git config user.name $input_name
}
$mail = & $git config user.email 2>$null
if (-not $mail) {
  $input_mail = Read-Host '  请输入邮箱（仅用于提交记录，可随意填）'
  if (-not $input_mail) { $input_mail = 'admin@example.com' }
  & $git config user.email $input_mail
}
Write-Ok "提交身份：$(& $git config user.name) <$(& $git config user.email)>"

& $git add -A
$changes = & $git status --porcelain
if ($changes) {
  & $git commit -q -m '《我的世界》世界基本法典 G2.8 官方网站：全文、检索与 AI 法务问答'
  Write-Ok '已提交全部文件'
} else {
  Write-Ok '没有新改动，跳过提交'
}

# ─────────────────────── 3. GitHub Token ───────────────────────
Write-Step '第 3 步 / 连接 GitHub'

Write-Host @'
  需要一个 GitHub「个人访问令牌」(PAT)，用来创建仓库并推送。
  获取方式（约 1 分钟）：
    1. 打开 https://github.com/settings/tokens?type=beta
    2. 点 Generate new token
    3. Token name 随便填，Expiration 选 30 days
    4. Repository access 选 All repositories
    5. Permissions 里把 Contents 和 Administration 设为 Read and write
    6. 点 Generate token，把 gh 开头的那串复制下来
'@ -ForegroundColor Gray

$token = Read-Host '  粘贴你的 GitHub Token（输入时不显示）' -AsSecureString
$tokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($token))
if (-not $tokenPlain) { Write-Err '没有输入 Token，退出。'; exit 1 }

$repoName = Read-Host '  仓库名（直接回车用 minecraft-law-site）'
if (-not $repoName) { $repoName = 'minecraft-law-site' }

$headers = @{
  Authorization          = "Bearer $tokenPlain"
  Accept                 = 'application/vnd.github+json'
  'User-Agent'           = 'law-site-setup'
  'X-GitHub-Api-Version' = '2022-11-28'
}

Write-Host '  正在读取 GitHub 账号信息…'
try {
  $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $headers -TimeoutSec 30
  Write-Ok "已登录：$($me.login)"
} catch {
  Write-Err "Token 无效或网络不通：$($_.Exception.Message)"
  exit 1
}

$fullName = "$($me.login)/$repoName"
$exists = $false
try {
  $null = Invoke-RestMethod -Uri "https://api.github.com/repos/$fullName" -Headers $headers -TimeoutSec 30
  $exists = $true
  Write-Warn "仓库 $fullName 已存在，将直接推送"
} catch { }

if (-not $exists) {
  Write-Host "  正在创建仓库 $fullName …"
  $body = @{
    name        = $repoName
    description = '《我的世界》世界基本法典 G2.8 官方网站：全文条款、检索与 AI 法务问答'
    private     = $false
    auto_init   = $false
  } | ConvertTo-Json
  try {
    $null = Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Method Post `
      -Headers $headers -Body $body -ContentType 'application/json' -TimeoutSec 30
    Write-Ok "仓库已创建：https://github.com/$fullName"
  } catch {
    Write-Err "创建失败：$($_.Exception.Message)"
    exit 1
  }
}

# ─────────────────────────── 4. 推送 ───────────────────────────
Write-Step '第 4 步 / 推送代码'

$remoteUrl = "https://$($me.login):$tokenPlain@github.com/$fullName.git"
$existing = & $git remote 2>$null
if ($existing -contains 'origin') { & $git remote remove origin }
& $git remote add origin $remoteUrl
& $git branch -M main 2>$null

Write-Host '  正在推送（首次可能稍慢）…'
$push = & $git push -u origin main --force 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Ok "推送成功：https://github.com/$fullName"
} else {
  Write-Err "推送失败：$push"
  Write-Host '  可以试试在项目目录手动执行：' -ForegroundColor Gray
  Write-Host "    git push -u origin main" -ForegroundColor Gray
  exit 1
}

# 把带 Token 的远程地址换掉，避免令牌留在配置里
& $git remote set-url origin "https://github.com/$fullName.git"
Write-Ok '已移除远程地址中的令牌（安全）'

# ─────────────────────────── 5. Render ───────────────────────────
Write-Step '第 5 步 / 部署到 Render（获得公网地址）'

Write-Host @"

  代码已经上传完成，接下来只需在网页上点几下：

    1. 打开   https://dashboard.render.com  用 GitHub 账号登录
    2. 点右上角  New  →  选  Blueprint
    3. 在列表里选中  $repoName   →  点 Connect
    4. Render 会自动读取项目里的 render.yaml，直接点  Apply
    5. 等 1~2 分钟，部署完成后顶部会显示你的公网地址，形如：
         https://$repoName.onrender.com

  这个地址 Windows、手机、平板都能直接打开，不需要装任何东西。

  免费套餐注意：15 分钟无人访问会休眠，下次打开需约 30 秒唤醒。

  以后想更新网站内容，只要在本目录执行：
      git add -A ; git commit -m "更新" ; git push
  Render 会自动重新部署。

"@ -ForegroundColor White

Write-Host ('─' * 62) -ForegroundColor DarkGray
Write-Host '  全部完成！' -ForegroundColor Green
Write-Host ('─' * 62) -ForegroundColor DarkGray
