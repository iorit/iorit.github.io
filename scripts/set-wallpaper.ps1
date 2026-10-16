# ============================================================
#  设置博客动态壁纸
#  用法(任选其一):
#    1. 把视频/图片文件拖到 set-wallpaper.cmd 上
#    2. 双击 set-wallpaper.cmd 后再把文件路径粘贴进去
#
#  支持:mp4/webm/mov/mkv/avi(视频)、gif/jpg/jpeg/png/webp/bmp(图片)
#  视频会自动转成网页友好的 mp4(H.264、无声、循环播放、限制大小)
# ============================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Info($msg) { Write-Host "[信息] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[成功] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[注意] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[错误] $msg" -ForegroundColor Red }

$scriptsDir = $PSScriptRoot
$repoRoot   = Split-Path -Parent $scriptsDir
$wallpaperDir = Join-Path $repoRoot "assets\wallpaper"

# ---------- 获取输入文件 ----------
$src = $args[0]
if (-not $src) {
    Write-Host "请把壁纸文件(视频或图片)拖到本窗口,或直接粘贴文件完整路径,然后回车:"
    $src = Read-Host "文件路径"
}
$src = $src.Trim('"').Trim()

if (-not (Test-Path $src)) {
    Write-Err "找不到文件:$src"
    exit 1
}
$src = (Resolve-Path $src).Path
$ext = [System.IO.Path]::GetExtension($src).ToLower()
Write-Info "输入文件:$src"

New-Item -ItemType Directory -Path $wallpaperDir -Force | Out-Null

# 清掉旧的壁纸(换个格式时避免旧文件残留导致不生效)
Get-ChildItem $wallpaperDir -File -ErrorAction SilentlyContinue | Remove-Item -Force

$videoExts = @(".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".flv", ".wmv")
$imageExts = @(".gif", ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".avif")

if ($videoExts -contains $ext) {
    # ---------- 视频:转成网页友好的 mp4 ----------
    $ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $ff) {
        Write-Err "需要 ffmpeg 来转换视频。请先安装:winget install Gyan.FFmpeg"
        exit 1
    }

    $out = Join-Path $wallpaperDir "wallpaper.mp4"
    Write-Info "正在转换(无声、H.264、最长 30 秒、最长边 1920px、循环友好)..."

    # scale:限制最长边到 1920;-an 去掉声音;t 30 限制时长
    & ffmpeg -y -hide_banner -loglevel error `
        -i $src `
        -t 30 -an `
        -vf "scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))',setsar=1" `
        -c:v libx264 -profile:v high -pix_fmt yuv420p `
        -crf 28 -preset slow -movflags +faststart `
        $out

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) {
        Write-Err "转换失败,请检查源文件是否可播放。"
        exit 1
    }
    $size = [math]::Round((Get-Item $out).Length / 1KB)
    Write-Ok "视频壁纸已生成:assets\wallpaper\wallpaper.mp4($size KB)"

} elseif ($imageExts -contains $ext) {
    # ---------- 图片:转成最优格式 ----------
    if ($ext -eq ".gif") {
        Copy-Item $src (Join-Path $wallpaperDir "wallpaper.gif") -Force
        Write-Ok "GIF 动图已就位:assets\wallpaper\wallpaper.gif"
    } else {
        # 转为 webp(体积小、质量好)
        $ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
        if ($ff) {
            $out = Join-Path $wallpaperDir "wallpaper.webp"
            & ffmpeg -y -hide_banner -loglevel error -i $src -vf "scale='min(2560,iw)':-2" -q:v 82 $out
            if ($LASTEXITCODE -eq 0 -and (Test-Path $out)) {
                $size = [math]::Round((Get-Item $out).Length / 1KB)
                Write-Ok "图片壁纸已生成:assets\wallpaper\wallpaper.webp($size KB)"
            } else {
                Copy-Item $src (Join-Path $wallpaperDir ("wallpaper" + $ext)) -Force
                Write-Ok "图片已复制:assets\wallpaper\wallpaper$ext"
            }
        } else {
            Copy-Item $src (Join-Path $wallpaperDir ("wallpaper" + $ext)) -Force
            Write-Ok "图片已复制(未装 ffmpeg,跳过压缩):assets\wallpaper\wallpaper$ext"
        }
    }
} else {
    Write-Err "不支持的文件类型:$ext"
    Write-Host "支持:mp4/webm/mov/mkv/avi(视频),gif/jpg/jpeg/png/webp/bmp/avif(图片)"
    exit 1
}

Write-Host ""
Write-Warn "接下来运行 publish.cmd 发布到网站,约 1~2 分钟后生效。"
Write-Host "想取消壁纸:删除 assets\wallpaper\ 里的文件,然后重新发布。"
