Add-Type @'
using System.Runtime.InteropServices;
public class Wallpaper {
  [DllImport("user32.dll", CharSet = CharSet.Auto)]
  public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);
}
'@

[Wallpaper]::SystemParametersInfo(20, 0, "C:\Users\jihuiwang\wallcraft_wallpaper.png", 3)
