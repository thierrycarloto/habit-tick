Add-Type -AssemblyName System.Drawing
$imagePath = "logo.png"
$image = [System.Drawing.Image]::FromFile((Resolve-Path $imagePath).Path)

function Resize-Image($img, $width, $height, $path) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $graph = [System.Drawing.Graphics]::FromImage($bmp)
    
    $graph.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    $graph.DrawImage($img, 0, 0, $width, $height)
    $bmp.Save((Join-Path (Get-Location) $path), [System.Drawing.Imaging.ImageFormat]::Png)
    
    $graph.Dispose()
    $bmp.Dispose()
}

Resize-Image $image 192 192 "icon-192.png"
Resize-Image $image 512 512 "icon-512.png"

$image.Dispose()
