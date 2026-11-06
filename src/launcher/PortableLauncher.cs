using System;
using System.IO;
using System.Reflection;

internal static class PortableLauncher
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool noBrowser = Array.IndexOf(args, "--no-browser") >= 0;
        var directory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        return LauncherCommon.Start("Local\\CharacterStudio.Portable.Open", noBrowser, () => LauncherCommon.Open(directory, noBrowser));
    }
}
