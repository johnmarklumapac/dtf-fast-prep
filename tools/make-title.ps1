# Renders images/title.png: "DTF FAST PREP" filled with a dotted halftone pattern
# in a neon blue to neon orange gradient.
# Run from the project root:  powershell -ExecutionPolicy Bypass -File tools/make-title.ps1
Add-Type -AssemblyName System.Drawing

$text     = "DTF FAST PREP"
$fontName = "Arial Black"
$width    = 1200
$height   = 180
$cell     = 10      # dot grid spacing (px)
$dotScale = 0.50    # dot radius at full coverage, in cells

# 1. Text mask: text outline stretched to fill the image (tight, tall letters)
$mask = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($mask)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Black)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$family = New-Object System.Drawing.FontFamily $fontName
$path.AddString($text, $family, [int][System.Drawing.FontStyle]::Bold, 200, (New-Object System.Drawing.PointF 0, 0), [System.Drawing.StringFormat]::GenericTypographic)
$b = $path.GetBounds()
$pad = 4
$matrix = New-Object System.Drawing.Drawing2D.Matrix
$matrix.Translate($pad, $pad)
$matrix.Scale(($width - 2 * $pad) / $b.Width, ($height - 2 * $pad) / $b.Height)
$matrix.Translate(-$b.X, -$b.Y)
$path.Transform($matrix)
$g.FillPath([System.Drawing.Brushes]::White, $path)
$g.Dispose()

# 2. Dots sized by text coverage per cell
$out = New-Object System.Drawing.Bitmap $width, $height
$g = [System.Drawing.Graphics]::FromImage($out)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
# Dot color fades left to right from neon blue (#00d4ff) to neon orange (#ff7a18)
# through a bright midpoint, so the middle stays vivid instead of turning gray.
$blue   = @(0, 212, 255)
$mid    = @(235, 240, 250)
$orange = @(255, 122, 24)
for ($cy = 0; $cy -lt $height; $cy += $cell) {
  for ($cx = 0; $cx -lt $width; $cx += $cell) {
    $sum = 0; $n = 0
    for ($py = $cy; $py -lt [Math]::Min($cy + $cell, $height); $py += 2) {
      for ($px = $cx; $px -lt [Math]::Min($cx + $cell, $width); $px += 2) {
        $sum += $mask.GetPixel($px, $py).R; $n++
      }
    }
    $cov = $sum / ($n * 255)
    if ($cov -lt 0.08) { continue }
    $t = $cx / $width
    if ($t -lt 0.5) { $from = $blue; $to = $mid; $u = $t * 2 } else { $from = $mid; $to = $orange; $u = ($t - 0.5) * 2 }
    $light = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,
      [int]($from[0] + ($to[0] - $from[0]) * $u),
      [int]($from[1] + ($to[1] - $from[1]) * $u),
      [int]($from[2] + ($to[2] - $from[2]) * $u)))
    $r = $cell * $dotScale * [Math]::Sqrt($cov)
    $g.FillEllipse($light, $cx + $cell / 2 - $r, $cy + $cell / 2 - $r, 2 * $r, 2 * $r)
    $light.Dispose()
  }
}
$g.Dispose()
$out.Save((Join-Path (Get-Location) "images/title.png"), [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output "Wrote images/title.png"
