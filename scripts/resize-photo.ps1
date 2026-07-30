# 把一张大图缩成大屏够用的 JPEG —— 讲者肖像进 assets/speaker/ 时用它。
#
#   scripts\resize-photo.ps1 -In "Photo\吴万安.jpg" -Out "assets\speaker\goh-ban-ann.jpg"
#
# 为什么是 PowerShell：本机没有 ffmpeg / ImageMagick，也没有 C++ 工具链（装不了 sharp），
# 而 Windows 自带的 System.Drawing 缩图够用且零依赖。顺带把 EXIF 一起丢掉。
#
# 默认高 1200px：致辞版式里照片高 min(46vh, 34vw)，1080p ≈ 497px、4K ≈ 994px，
# 1200 两边都有余量。原始肖像 2630×3946（2:3）缩完约 800×1200、250KB 上下。
#
# 注意：System.Drawing 不认 EXIF 旋转标记。手机直出的横竖颠倒图请先在图片查看器里转正。
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Height = 1200,
  [ValidateRange(1, 100)][int]$Quality = 88
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Resolve-OutPath([string]$path) {
  if ([System.IO.Path]::IsPathRooted($path)) { return [System.IO.Path]::GetFullPath($path) }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $path))
}

$inFull = (Resolve-Path -LiteralPath $In).Path
$outFull = Resolve-OutPath $Out
$outDir = Split-Path -Parent $outFull
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }


# 抠好背景的人像（PNG 带 alpha）要保住透明：存成 JPEG 的话透明区会被填成黑块或白块，
# 直接糊在深色大屏上。所以先看四个角是不是透明 —— 只看 PixelFormat 不够，很多 PNG
# 带 alpha 通道却整张不透明，那种照旧走 JPEG（小得多）。
function Test-Transparent([System.Drawing.Image]$img) {
  if (-not [System.Drawing.Image]::IsAlphaPixelFormat($img.PixelFormat)) { return $false }
  $bmp = New-Object System.Drawing.Bitmap($img)
  try {
    # 括号不能省：PowerShell 里逗号比减号**结合得更紧**，`@($w - 1, 1)` 会被读成
    # `$w - @(1,1)`（拿数字减一个数组），直接抛 op_Subtraction。
    $w = $bmp.Width - 2; $h = $bmp.Height - 2
    foreach ($pt in @(@(1, 1), @($w, 1), @(1, $h), @($w, $h))) {
      if ($bmp.GetPixel($pt[0], $pt[1]).A -lt 250) { return $true }
    }
  } finally { $bmp.Dispose() }
  return $false
}

$src = [System.Drawing.Image]::FromFile($inFull)
try {
  if ($src.Height -le $Height) {
    Write-Warning "$In 只有 $($src.Width)x$($src.Height)，比目标还小 —— 照原尺寸重新编码，不放大。"
    $Height = $src.Height
  }
  $width = [int][Math]::Round($src.Width * $Height / $src.Height)
  $transparent = Test-Transparent $src
  if ($transparent -and [System.IO.Path]::GetExtension($outFull) -ne '.png') {
    $outFull = [System.IO.Path]::ChangeExtension($outFull, '.png')
    Write-Warning "原图是抠好背景的透明图 —— 输出改成 PNG（$([System.IO.Path]::GetFileName($outFull))），JPEG 存不了透明。"
  }

  $dst = New-Object System.Drawing.Bitmap($width, $Height)
  try {
    $g = [System.Drawing.Graphics]::FromImage($dst)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      # 透明图用 SourceCopy：默认的 SourceOver 会把缩好的像素再叠一次，半透明边缘会变脏。
      if ($transparent) { $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy }
      $g.DrawImage($src, 0, 0, $width, $Height)
    } finally { $g.Dispose() }

    if ($transparent) {
      $dst.Save($outFull, [System.Drawing.Imaging.ImageFormat]::Png)
    } else {
      $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq 'image/jpeg' }
      $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
      $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
        [System.Drawing.Imaging.Encoder]::Quality, [int64]$Quality)
      try {
        $dst.Save($outFull, $codec, $encoderParams)
      } finally { $encoderParams.Dispose() }
    }
  } finally { $dst.Dispose() }
} finally { $src.Dispose() }

$kb = [Math]::Round((Get-Item -LiteralPath $outFull).Length / 1KB)
$fmt = if ($transparent) { "PNG 透明" } else { "JPEG q$Quality" }
Write-Host "$([System.IO.Path]::GetFileName($outFull))  ->  ${width}x${Height}  ${kb}KB  ($fmt)"
