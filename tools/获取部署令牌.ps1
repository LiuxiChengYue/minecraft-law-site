<#
  最后一公里 —— 获取 Vercel 部署令牌

  用法：右键本文件 →「使用 PowerShell 运行」
#>

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$C_BG     = [Drawing.Color]::FromArgb(252, 252, 251)
$C_INK    = [Drawing.Color]::FromArgb(20, 23, 26)
$C_GREY   = [Drawing.Color]::FromArgb(110, 116, 124)
$C_ACCENT = [Drawing.Color]::FromArgb(31, 79, 216)
$C_OK     = [Drawing.Color]::FromArgb(22, 121, 79)
$C_WARN   = [Drawing.Color]::FromArgb(138, 90, 17)

$form = New-Object Windows.Forms.Form
$form.Text = '最后一步：获取部署令牌'
$form.Size = New-Object Drawing.Size(900, 660)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_BG
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)

$title = New-Object Windows.Forms.Label
$title.Text = '最后一步：拿一个 Vercel 令牌'
$title.Font = New-Object Drawing.Font('Microsoft YaHei UI', 16, [Drawing.FontStyle]::Bold)
$title.ForeColor = $C_INK
$title.Location = New-Object Drawing.Point(24, 18)
$title.Size = New-Object Drawing.Size(850, 36)
$form.Controls.Add($title)

$sub = New-Object Windows.Forms.Label
$sub.Text = '网站已经打包好、云函数也测通了。拿到令牌后我立刻部署，你不用再操作。'
$sub.ForeColor = $C_GREY
$sub.Location = New-Object Drawing.Point(26, 56)
$sub.Size = New-Object Drawing.Size(850, 24)
$form.Controls.Add($sub)

$steps = New-Object Windows.Forms.RichTextBox
$steps.ReadOnly = $true
$steps.BackColor = [Drawing.Color]::White
$steps.BorderStyle = 'FixedSingle'
$steps.Location = New-Object Drawing.Point(24, 90)
$steps.Size = New-Object Drawing.Size(850, 300)
$steps.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)
$steps.DetectUrls = $false

function Add-Line($text, $color, $bold) {
  $steps.SelectionColor = $color
  if ($bold) { $steps.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 11, [Drawing.FontStyle]::Bold) }
  else { $steps.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 10) }
  $steps.AppendText($text + "`n")
}

Add-Line '第 1 步　注册 Vercel（用 GitHub 一键注册，不用填表）' $C_ACCENT $true
Add-Line '     点下面第一个按钮打开注册页' $C_INK $false
Add-Line '     页面上找「Continue with GitHub」，点它' $C_INK $false
Add-Line '     如果已经登录 GitHub，会直接完成，不需要输密码' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '第 2 步　生成令牌' $C_ACCENT $true
Add-Line '     点下面第二个按钮打开令牌页面' $C_INK $false
Add-Line '     在「Token Name」里随便填一个名字，例如 law-site' $C_INK $false
Add-Line '     下面的期限（Expiration）选 No Expiration 或 1 Year 都可以' $C_INK $false
Add-Line '     Scope 保持默认（Full Account）不用改' $C_INK $false
Add-Line '     点「Create Token」' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '第 3 步　把令牌发给我' $C_ACCENT $true
Add-Line '     页面上会显示一串字符（可能以 vercel_ 开头）' $C_INK $false
Add-Line '     点旁边的复制按钮，粘贴到对话框发给我，我就立刻部署' $C_INK $false
Add-Line '' $C_INK $false
Add-Line '────────────────────────────────────────────────' $C_GREY $false
Add-Line '英文对照： Continue with GitHub = 用 GitHub 继续' $C_GREY $false
Add-Line 'Create Token = 创建令牌　Token Name = 令牌名称' $C_GREY $false
Add-Line 'Expiration = 有效期　Copy = 复制' $C_GREY $false

$form.Controls.Add($steps)

function New-BigButton($text, $subText, $y, $color) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.Location = New-Object Drawing.Point(24, $y)
  $b.Size = New-Object Drawing.Size(850, 56)
  $b.BackColor = $color
  $b.ForeColor = [Drawing.Color]::White
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 0
  $b.Font = New-Object Drawing.Font('Microsoft YaHei UI', 11.5, [Drawing.FontStyle]::Bold)
  $b.TextAlign = 'MiddleLeft'
  $b.Padding = New-Object Windows.Forms.Padding(18, 0, 0, 0)
  $form.Controls.Add($b)
  return $b
}

$b1 = New-BigButton '① 打开 Vercel 注册页（用 GitHub 登录）' '' 404 $C_ACCENT
$b2 = New-BigButton '② 打开令牌创建页' '' 472 $C_OK

$note = New-Object Windows.Forms.RichTextBox
$note.ReadOnly = $true
$note.BackColor = [Drawing.Color]::FromArgb(245, 246, 247)
$note.BorderStyle = 'FixedSingle'
$note.Location = New-Object Drawing.Point(24, 540)
$note.Size = New-Object Drawing.Size(850, 68)
$note.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9.5)
$note.DetectUrls = $false
$note.SelectionColor = $C_WARN
$note.AppendText("注意：Vercel 的免费域名（xxx.vercel.app）在国内部分网络下可能需要梯子才能打开。`n")
$note.AppendText("部署完你先自己打开试试；如果打不开，告诉我，我马上换成国内能直连的方案。`n")
$form.Controls.Add($note)

$b1.Add_Click({ Start-Process 'https://vercel.com/signup' })
$b2.Add_Click({ Start-Process 'https://vercel.com/account/tokens' })

[void]$form.ShowDialog()
