
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen
$b = $screen.Bounds
$bm = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bm)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bm.Save("D:\hermes-data\dsh-client-mod\logs\test-zindex.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bm.Dispose()
