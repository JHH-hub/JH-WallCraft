Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Wallpaper {
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
"@

$SPI_SETDESKWALLPAPER = 20
$SPIF_UPDATEINIFILE = 1
$SPIF_SENDCHANGE = 2
$flags = $SPIF_UPDATEINIFILE -bor $SPIF_SENDCHANGE

$result = [Wallpaper]::SystemParametersInfo($SPI_SETDESKWALLPAPER, 0, "C:\Users\jihuiwang\wallcraft_wallpaper.png", $flags)
Write-Host "SystemParametersInfo return: $result"