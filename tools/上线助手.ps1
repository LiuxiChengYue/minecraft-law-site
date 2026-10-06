<#
  《我的世界》世界基本法典 —— 上线助手（中文图形界面）

  用法：右键本文件 →「使用 PowerShell 运行」
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$C_BG     = [Drawing.Color]::FromArgb(252, 252, 251)
$C_INK    = [Drawing.Color]::FromArgb(20, 23, 26)
$C_GREY   = [Drawing.Color]::FromArgb(110, 116, 124)
$C_LINE   = [Drawing.Color]::FromArgb(214, 214, 210)
$C_ACCENT = [Drawing.Color]::FromArgb(31, 79, 216)
$C_OK     = [Drawing.Color]::FromArgb(22, 121, 79)
$C_WARN   = [Drawing.Color]::FromArgb(138, 90, 17)
$C_ERR    = [Drawing.Color]::FromArgb(176, 42, 42)

function Test-Site([string]$url) {
  $box.Clear()
  if (-not $url -or $url.Trim().Length -lt 8) {
    $box.SelectionColor = $C_ERR
    $box.AppendText("请先把 Render 给你的网址粘贴到上面的输入框。`n")
    return
  }
  $url = $url.Trim().TrimEnd('/')
  if ($url -notmatch '^https?://') { $url = 'https://' + $url }

  $box.SelectionColor = $C_GREY
  $box.AppendText("正在检查 $url …`n`n")
  $box.Refresh()

  try {
    $h = Invoke-RestMethod "$url/api/health" -TimeoutSec 25 -ErrorAction Stop
    $box.SelectionColor = $C_OK
    $box.AppendText("✓ 后端服务正常`n")
    $box.SelectionColor = $C_INK
    $box.AppendText("     法典版本：$($h.version)`n")
    $box.AppendText("     条文数量：$($h.articles) 条`n")
    $box.AppendText("     AI 引擎：$($h.engine)`n`n")
  } catch {
    $code = $null
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    $box.SelectionColor = $C_ERR
    $box.AppendText("✗ 打不开 $url/api/health")
    if ($code) { $box.AppendText("（HTTP $code）") }
    $box.AppendText("`n")
    $box.SelectionColor = $C_WARN
    $box.AppendText("     说明这个地址上还没有运行中的网站，请确认：`n")
    $box.AppendText("       1. Render 上的状态是不是已经变成绿色的 Live`n")
    $box.AppendText("       2. 网址是不是从 Render 页面顶部复制的（可能带随机后缀）`n")
    $box.AppendText("       3. 刚部署完的话，等 30 秒再点一次「验证网站」`n")
    return
  }

  try {
    $p = Invoke-WebRequest $url -TimeoutSec 25 -UseBasicParsing -ErrorAction Stop
    if ($p.Content -match '世界基本法典') {
      $box.SelectionColor = $C_OK
      $box.AppendText("✓ 首页正常，已载入法典内容（$([int]($p.RawContentLength/1024)) KB）`n")
    } else {
      $box.SelectionColor = $C_WARN
      $box.AppendText("! 首页能打开，但没看到法典内容`n")
    }
  } catch {
    $box.SelectionColor = $C_WARN
    $box.AppendText("! 首页打不开：$($_.Exception.Message)`n")
  }

  try {
    $body = '{"question":"偷东西怎么判"}'
    $a = Invoke-RestMethod "$url/api/ask" -Method Post -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 30 -ErrorAction Stop
    $titles = ($a.citations | ForEach-Object { $_.title }) -join '、'
    $box.SelectionColor = $C_OK
    $box.AppendText("`n✓ AI 问答正常`n")
    $box.SelectionColor = $C_INK
    $box.AppendText("     测试问题：偷东西怎么判`n")
    $box.AppendText("     引用条文：$titles`n")
    $box.AppendText("     响应耗时：$($a.elapsedMs) 毫秒`n`n")
    $box.SelectionColor = $C_OK
    $box.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 11, [Drawing.FontStyle]::Bold)
    $box.AppendText("网站已成功上线！把这个地址发给任何人即可：`n")
    $box.AppendText("$url`n")
    $box.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 9.5)
  } catch {
    $box.SelectionColor = $C_WARN
    $box.AppendText("`n! AI 问答没通过：$($_.Exception.Message)`n")
  }
}

# ── 窗口 ──
$form = New-Object Windows.Forms.Form
$form.Text = '法典官网上线助手'
$form.Size = New-Object Drawing.Size(940, 800)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_BG
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)

$title = New-Object Windows.Forms.Label
$title.Text = '《我的世界》世界基本法典 · 上线助手'
$title.Font = New-Object Drawing.Font('Microsoft YaHei UI', 16, [Drawing.FontStyle]::Bold)
$title.ForeColor = $C_INK
$title.Location = New-Object Drawing.Point(26, 20)
$title.Size = New-Object Drawing.Size(880, 36)
$form.Controls.Add($title)

$sub = New-Object Windows.Forms.Label
$sub.Text = '代码已经上传到 GitHub，只差在 Render 上点 4 下。下面每一步都标出了界面上对应的英文按钮。'
$sub.ForeColor = $C_GREY
$sub.Location = New-Object Drawing.Point(28, 58)
$sub.Size = New-Object Drawing.Size(880, 24)
$form.Controls.Add($sub)

$steps = New-Object Windows.Forms.RichTextBox
$steps.ReadOnly = $true
$steps.BackColor = [Drawing.Color]::White
$steps.BorderStyle = 'FixedSingle'
$steps.Location = New-Object Drawing.Point(26, 92)
$steps.Size = New-Object Drawing.Size(884, 376)
$steps.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)
$steps.DetectUrls = $false
$steps.ScrollBars = 'Vertical'

function Add-Line($text, $color, $bold) {
  $steps.SelectionColor = $color
  if ($bold) {
    $steps.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 11, [Drawing.FontStyle]::Bold)
  } else {
    $steps.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 10)
  }
  $steps.AppendText($text + "`n")
}

Add-Line '第 1 步　登录 Render' $C_ACCENT $true
Add-Line '     浏览器打开： https://dashboard.render.com' $C_INK $false
Add-Line '     页面上点 →「Get Started」→ 再点「GitHub」' $C_INK $false
Add-Line '     会跳到 GitHub 让你授权，点绿色按钮「Authorize Render」' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '第 2 步　新建蓝图项目' $C_ACCENT $true
Add-Line '     登录后，点右上角的「+ New」（有的界面是「New +」）' $C_INK $false
Add-Line '     在弹出的菜单里选「Blueprint」' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '第 3 步　选择你的仓库' $C_ACCENT $true
Add-Line '     列表里找到「minecraft-law-site」，点它右边的「Connect」' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '第 4 步　确认并部署' $C_ACCENT $true
Add-Line '     页面会自动读出配置，出现一个叫 minecraft-law-site 的服务' $C_INK $false
Add-Line '     拉到最下面，点「Apply」（旧版显示「Create Resources」）' $C_INK $false
Add-Line '     等 1~2 分钟，状态从「Building」变成绿色的「Live」' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '第 5 步　拿网址回来验证' $C_ACCENT $true
Add-Line '     页面顶部会显示网址，点旁边的复制图标' $C_INK $false
Add-Line '     粘贴到下面输入框，点「验证网站」' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '──────────────────────────────────────────────────' $C_LINE $false
Add-Line '英文对照： Get Started=开始　Authorize=授权　Blueprint=蓝图' $C_GREY $false
Add-Line 'Connect=连接　Apply=应用　Building=部署中　Live=已上线' $C_GREY $false
Add-Line 'Logs=日志　Environment=环境变量　Free=免费套餐' $C_GREY $false

$form.Controls.Add($steps)

$lbl = New-Object Windows.Forms.Label
$lbl.Text = '你的网站地址：'
$lbl.ForeColor = $C_INK
$lbl.Location = New-Object Drawing.Point(26, 484)
$lbl.Size = New-Object Drawing.Size(110, 26)
$form.Controls.Add($lbl)

$urlBox = New-Object Windows.Forms.TextBox
$urlBox.Location = New-Object Drawing.Point(138, 481)
$urlBox.Size = New-Object Drawing.Size(540, 30)
$urlBox.Font = New-Object Drawing.Font('Consolas', 10.5)
$urlBox.Text = ''
$form.Controls.Add($urlBox)

$btn = New-Object Windows.Forms.Button
$btn.Text = '验证网站'
$btn.Location = New-Object Drawing.Point(690, 479)
$btn.Size = New-Object Drawing.Size(108, 34)
$btn.BackColor = $C_INK
$btn.ForeColor = [Drawing.Color]::White
$btn.FlatStyle = 'Flat'
$btn.FlatAppearance.BorderSize = 0
$form.Controls.Add($btn)

$btn2 = New-Object Windows.Forms.Button
$btn2.Text = '打开网站'
$btn2.Location = New-Object Drawing.Point(806, 479)
$btn2.Size = New-Object Drawing.Size(104, 34)
$btn2.FlatStyle = 'Flat'
$form.Controls.Add($btn2)

$box = New-Object Windows.Forms.RichTextBox
$box.ReadOnly = $true
$box.BackColor = [Drawing.Color]::FromArgb(245, 246, 247)
$box.BorderStyle = 'FixedSingle'
$box.Location = New-Object Drawing.Point(26, 526)
$box.Size = New-Object Drawing.Size(884, 214)
$box.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9.5)
$box.DetectUrls = $false
$box.SelectionColor = $C_GREY
$box.AppendText("用法：在 Render 上部署完成后，把页面顶部的网址粘贴到上面的输入框，点「验证网站」。`n`n")
$box.AppendText("我会自动检查三件事：`n")
$box.AppendText("   · 后端接口 /api/health 是否正常`n")
$box.AppendText("   · 首页是否载入了法典内容`n")
$box.AppendText("   · AI 问答能不能正确引用条号`n`n")
$box.AppendText("如果哪一项不对，把这里的内容截图发我；`n")
$box.AppendText("如果卡在上面某一步，也直接把 Render 页面截图发我，我告诉你该点哪里。`n")
$form.Controls.Add($box)

$btn.Add_Click({ Test-Site $urlBox.Text })
$btn2.Add_Click({
  $u = $urlBox.Text.Trim()
  if ($u -and $u -notmatch '^https?://') { $u = 'https://' + $u }
  if ($u) { Start-Process $u }
})
$urlBox.Add_KeyDown({ if ($_.KeyCode -eq 'Enter') { Test-Site $urlBox.Text } })

[void]$form.ShowDialog()
