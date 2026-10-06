<#
  安全清理助手 —— 密码重置、令牌撤销、两步验证

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
$C_ERR    = [Drawing.Color]::FromArgb(176, 42, 42)
$C_RED    = [Drawing.Color]::FromArgb(196, 43, 43)

$form = New-Object Windows.Forms.Form
$form.Text = '账号安全清理助手'
$form.Size = New-Object Drawing.Size(880, 720)
$form.StartPosition = 'CenterScreen'
$form.BackColor = $C_BG
$form.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)

$title = New-Object Windows.Forms.Label
$title.Text = 'GitHub 账号安全清理'
$title.Font = New-Object Drawing.Font('Microsoft YaHei UI', 16, [Drawing.FontStyle]::Bold)
$title.ForeColor = $C_INK
$title.Location = New-Object Drawing.Point(24, 18)
$title.Size = New-Object Drawing.Size(840, 36)
$form.Controls.Add($title)

$sub = New-Object Windows.Forms.Label
$sub.Text = '三件事：改密码、撤销令牌、开两步验证。全部在浏览器里点，我这边打不开 GitHub 设置页。'
$sub.ForeColor = $C_GREY
$sub.Location = New-Object Drawing.Point(26, 56)
$sub.Size = New-Object Drawing.Size(840, 24)
$form.Controls.Add($sub)

$info = New-Object Windows.Forms.RichTextBox
$info.ReadOnly = $true
$info.BackColor = [Drawing.Color]::White
$info.BorderStyle = 'FixedSingle'
$info.Location = New-Object Drawing.Point(24, 90)
$info.Size = New-Object Drawing.Size(826, 150)
$info.Font = New-Object Drawing.Font('Microsoft YaHei UI', 10)
$info.DetectUrls = $false

$info.SelectionColor = $C_ERR
$info.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 10.5, [Drawing.FontStyle]::Bold)
$info.AppendText("为什么必须做：`n")
$info.SelectionFont = New-Object Drawing.Font('Microsoft YaHei UI', 10)
$info.SelectionColor = $C_INK
$info.AppendText("你之前把 GitHub 密码贴在了对话里，那串密码已经泄露。`n")
$info.AppendText("虽然密码不能直接用来推送代码，但任何人拿到它都能登录你的账号。`n")
$info.AppendText("你给我的访问令牌（ghp_ 开头那串）同样出现在对话里，也应该撤销。`n")
$info.AppendText("好在你今天刚注册这个账号，除了一个仓库之外没有任何重要东西，`n")
$info.AppendText("现在改密码是成本最低的时刻。`n")
$form.Controls.Add($info)

# ── 三个按钮 ──
function New-BigButton($text, $subText, $y, $color) {
  $b = New-Object Windows.Forms.Button
  $b.Text = $text
  $b.Location = New-Object Drawing.Point(24, $y)
  $b.Size = New-Object Drawing.Size(826, 62)
  $b.BackColor = $color
  $b.ForeColor = [Drawing.Color]::White
  $b.FlatStyle = 'Flat'
  $b.FlatAppearance.BorderSize = 0
  $b.Font = New-Object Drawing.Font('Microsoft YaHei UI', 11.5, [Drawing.FontStyle]::Bold)
  $b.TextAlign = 'MiddleLeft'
  $b.Padding = New-Object Windows.Forms.Padding(18, 0, 0, 0)
  $form.Controls.Add($b)
  $s = New-Object Windows.Forms.Label
  $s.Text = $subText
  $s.ForeColor = $C_GREY
  $s.Location = New-Object Drawing.Point(28, ($y + 64))
  $s.Size = New-Object Drawing.Size(820, 22)
  $s.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9.5)
  $form.Controls.Add($s)
  return $b
}

$btnPwd = New-BigButton '① 重置 GitHub 密码   →  点这里打开重置页面' `
  '   打开后输入用户名 LiuxiChengYue，点「Send password reset email」，然后去邮箱点链接设新密码' `
  252 $C_RED

$btnTok = New-BigButton '② 撤销泄露的访问令牌   →  点这里打开令牌页面' `
  '   页面上找到名字含 law-site 的那条，点右侧的「Delete」删掉。删掉不影响已经推送的代码' `
  340 $C_WARN

$btn2fa = New-BigButton '③ 开启两步验证   →  点这里打开安全设置' `
  '   建议用手机上的验证器 App（如 Microsoft Authenticator / 谷歌验证器），比短信安全' `
  428 $C_ACCENT

$btnDeploy = New-BigButton '④ 继续部署到 Render（不需要密码）   →  点这里打开 Render' `
  '   Render 用的是官方授权页，不用输 GitHub 密码。这一步做完网站就有公网地址了' `
  516 $C_OK

$note = New-Object Windows.Forms.RichTextBox
$note.ReadOnly = $true
$note.BackColor = [Drawing.Color]::FromArgb(245, 246, 247)
$note.BorderStyle = 'FixedSingle'
$note.Location = New-Object Drawing.Point(24, 600)
$note.Size = New-Object Drawing.Size(826, 72)
$note.Font = New-Object Drawing.Font('Microsoft YaHei UI', 9.5)
$note.DetectUrls = $false
$note.SelectionColor = $C_GREY
$note.AppendText("小提示：如果重置页面要求输入邮箱，你注册时用的很可能是 nan1231232022@163.com。`n")
$note.AppendText("如果收不到重置邮件，去邮箱的「垃圾邮件」里找一找。`n")
$note.AppendText("做完①②③之后，网站部署完全不受影响 —— 代码已经在 GitHub 上了。`n")
$form.Controls.Add($note)

$btnPwd.Add_Click({ Start-Process 'https://github.com/password_reset' })
$btnTok.Add_Click({ Start-Process 'https://github.com/settings/tokens' })
$btn2fa.Add_Click({ Start-Process 'https://github.com/settings/security' })
$btnDeploy.Add_Click({ Start-Process 'https://dashboard.render.com' })

[void]$form.ShowDialog()
