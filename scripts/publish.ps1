# ============================================================
#  iorit 的博客 - 一键发布脚本
#  用法:双击 E:\blog\publish.cmd,或在终端运行 .\publish.cmd
#
#  功能:
#    1. 自动为缺少 front matter 的文章补齐头部(标题取文件名,日期取修改时间)
#    2. 转换 Obsidian 图片语法
#    3. 图片归位(Obsidian 存错位置的图片搬回文章目录),并阻止裂图发布
#    4. 本地构建检查,构建失败会中止
#    5. git add / commit / push,推送后 GitHub Actions 自动部署
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptsDir = $PSScriptRoot                    # E:\blog\scripts
$repoRoot   = Split-Path -Parent $scriptsDir   # E:\blog
Set-Location $repoRoot

function Write-Info($msg) { Write-Host "[信息] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[成功] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[注意] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[错误] $msg" -ForegroundColor Red }

# 推送到 GitHub(自动找代理、失败重试)。成功返回 $true
function Push-Repo {
    Write-Info "推送到 GitHub..."

    # 收集候选代理:系统代理设置 + 常见本地端口;直连不通时挨个试
    $sysProxy = $null
    $proxyReg = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction SilentlyContinue
    if ($proxyReg.ProxyServer) { $sysProxy = "http://" + $proxyReg.ProxyServer }

    $listening = @()
    foreach ($port in @(7897, 7890, 10809, 1080, 8080)) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect("127.0.0.1", $port)
            if ($client.Connected) { $listening += "http://127.0.0.1:$port" }
        } catch { } finally { $client.Dispose() }
    }

    $proxies = @()
    if (($proxyReg.ProxyEnable -eq 1) -and $sysProxy) { $proxies += $sysProxy }
    $proxies += $listening
    if ($sysProxy) { $proxies += $sysProxy }
    $proxies = @($proxies | Where-Object { $_ } | Select-Object -Unique)

    $tries = @(@{ name = "直连"; arg = @() })
    foreach ($p in $proxies) {
        $tries += @{ name = $p; arg = @("-c", "http.proxy=$p", "-c", "https.proxy=$p") }
    }

    foreach ($t in $tries) {
        for ($i = 1; $i -le 2; $i++) {
            Write-Info "尝试推送($($t.name))..."
            $pushLog = & git @($t.arg) push 2>&1
            if ($LASTEXITCODE -eq 0) { Write-Ok "推送成功($($t.name))"; return $true }
            if ($i -lt 2) { Start-Sleep -Seconds 4 }
        }
    }

    Write-Err "所有方式都推不上去。请确认代理软件已开启,输出如下:"
    $pushLog | ForEach-Object { Write-Host $_ }
    return $false
}

# ---------- 1. 扫描文章,自动补 front matter ----------
Write-Info "扫描 content/ 下的文章..."

$postsDir = Join-Path $repoRoot "content"
$fixed = 0

Get-ChildItem $postsDir -Recurse -Filter "*.md" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -eq "_index.md") { return }
    if ($_.Name -like "test*") { return }
    if ($_.DirectoryName -like "*image*") { return }

    $raw = [System.IO.File]::ReadAllText($_.FullName, [System.Text.Encoding]::UTF8)
    if ($raw.TrimStart().StartsWith("---")) { return }

    Write-Warn "补 front matter: $($_.Name)"

    $name  = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
    $title = $name -replace "[-_]", " "
    # 仅当文件名全为小写时做首字母大写(避免破坏 CF1874B 这类惯用大写)
    if ($title -ceq $title.ToLower()) {
        $title = (Get-Culture).TextInfo.ToTitleCase($title)
    }
    $date  = $_.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:sszzz")
    $fm    = "---`ntitle: `"$title`"`ndate: $date`ndraft: false`n---`n`n"
    [System.IO.File]::WriteAllText($_.FullName, $fm + $raw, [System.Text.Encoding]::UTF8)
    $fixed++
}

if ($fixed -gt 0) { Write-Ok "已为 $fixed 篇文章补齐 front matter" }
else { Write-Info "所有文章均已有 front matter,无需处理" }

# ---------- 2. 本地构建检查 ----------
Write-Info "本地构建检查..."

$hugo = Join-Path $env:LOCALAPPDATA "hugo\hugo.exe"
if (-not (Test-Path $hugo)) {
    $cmd = Get-Command hugo -ErrorAction SilentlyContinue
    if ($cmd) { $hugo = $cmd.Source }
}
if (-not (Test-Path $hugo)) {
    Write-Err "找不到 hugo.exe(应位于 $env:LOCALAPPDATA\hugo\hugo.exe),无法构建检查。"
    exit 1
}

# 把 Obsidian 图片语法转成 Hugo 支持的形式
node (Join-Path $scriptsDir "fix-obsidian-links.js") | Out-Null

# 图片归位:把 Obsidian 存到别处的图片搬回文章目录;带图的单文件文章转成文章文件夹
# 有图片找不到时会以非 0 退出,这里必须中止,否则会发布出裂图
node (Join-Path $scriptsDir "fix-post-images.js")
if ($LASTEXITCODE -ne 0) {
    Write-Err "图片有问题(见上方列表),已中止,没有提交任何东西。"
    exit 1
}

# 重新生成文件树页(static/tree/index.html) —— 必须放在图片归位之后,文章结构可能变了
node (Join-Path $scriptsDir "gen-tree.js") | Out-Null

$buildLog = & $hugo --gc --minify 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Err "构建失败,请检查以下输出:"
    $buildLog | ForEach-Object { Write-Host $_ }
    exit 1
}
Write-Ok "构建通过"

# ---------- 3. 提交并推送 ----------
Write-Info "检查 git 状态..."

& git add -A 2>$null
$status = & git status --porcelain 2>$null
if (-not $status) {
    # 没新改动,但可能上次推送失败留下了未推送的提交 —— 这种也要推
    $unpushed = @(& git log --oneline "origin/main..HEAD" 2>$null)
    if ($unpushed.Count -eq 0) {
        Write-Info "没有需要提交的改动,已是最新。"
        exit 0
    }
    Write-Warn "本地有 $($unpushed.Count) 个提交还没推送,直接推送..."
    $unpushed | ForEach-Object { Write-Host "    $_" }
    if (-not (Push-Repo)) { exit 1 }
    Write-Host ""
    Write-Host "=== 发布完成! ===" -ForegroundColor Green
    Write-Host "约 1~2 分钟后自动上线: https://iorit.github.io/" -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "本次将上传以下文件:" -ForegroundColor White
& git status --short 2>$null

$commitMsg = "publish: " + (Get-Date -Format "yyyy-MM-dd HH:mm")
$commitLog = & git commit -m $commitMsg 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Err "提交失败:"
    $commitLog | ForEach-Object { Write-Host $_ }
    exit 1
}
Write-Ok "已提交:$commitMsg"

if (-not (Push-Repo)) { exit 1 }

Write-Host ""
Write-Host "=== 发布完成! ===" -ForegroundColor Green
Write-Host "约 1~2 分钟后上线: https://iorit.github.io/" -ForegroundColor Green
