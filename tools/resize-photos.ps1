# Уменьшает картинки до 800 px по длинной стороне и сохраняет как JPEG (качество 85); прозрачность заливается белым.
# Вызывается из tools/pack-photos.js (только Windows: нужен встроенный System.Drawing). Параметр — JSON-файл со списком [{src, dst}].
param([string]$jobs)
Add-Type -AssemblyName System.Drawing
$list = [IO.File]::ReadAllText($jobs, [Text.Encoding]::UTF8) | ConvertFrom-Json
$codec = [Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$enc = New-Object Drawing.Imaging.EncoderParameters(1)
$enc.Param[0] = New-Object Drawing.Imaging.EncoderParameter([Drawing.Imaging.Encoder]::Quality, [long]85)
foreach ($j in $list) {
  try {
    $img = [Drawing.Image]::FromFile($j.src)
    $scale = [Math]::Min(1.0, 800.0 / [Math]::Max($img.Width, $img.Height))
    $w = [int][Math]::Max(1, [Math]::Round($img.Width * $scale))
    $h = [int][Math]::Max(1, [Math]::Round($img.Height * $scale))
    $bmp = New-Object Drawing.Bitmap($w, $h)
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.Clear([Drawing.Color]::White)
    $g.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $w, $h)
    $bmp.Save($j.dst, $codec, $enc)
    $g.Dispose(); $bmp.Dispose(); $img.Dispose()
    Write-Output ("ok`t" + $j.dst)
  } catch {
    Write-Output ("fail`t" + $j.src + "`t" + $_.Exception.Message)
  }
}
