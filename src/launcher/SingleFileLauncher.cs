using System;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Collections.Generic;
using System.Web.Script.Serialization;

internal static class SingleFileLauncher
{
    private static string Hash(string file) { using (var stream = File.OpenRead(file)) using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    private static void Resource(string name, string target)
    {
        var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
        using (var input = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (var output = File.Create(temporary)) { if (input == null) throw new Exception("安装文件不完整，请重新下载。"); input.CopyTo(output); }
        if (File.Exists(target)) File.Delete(target);
        File.Move(temporary, target);
    }
    [STAThread]
    private static int Main(string[] args)
    {
        bool quiet = Array.IndexOf(args, "--no-browser") >= 0 || Array.IndexOf(args, "--install-only") >= 0;
        return LauncherCommon.Start("Local\\CharacterStudio.SingleFile.Install", quiet, () => {
            string root = Environment.GetEnvironmentVariable("CHARACTER_STUDIO_INSTALL_ROOT");
            if (String.IsNullOrWhiteSpace(root)) root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CharacterStudio");
            root = Path.GetFullPath(root);
            var cache = Path.Combine(root, ".packages", PayloadInfo.Hash);
            Directory.CreateDirectory(cache);
            var zip = Path.Combine(cache, "character-studio-windows-x64.zip");
            if (!File.Exists(zip) || Hash(zip) != PayloadInfo.Hash) Resource("studio-package", zip);
            if (Hash(zip) != PayloadInfo.Hash) throw new Exception("下载的文件校验失败，请从 GitHub 发行版重新下载。");
            File.WriteAllText(zip + ".sha256", PayloadInfo.Hash + "  character-studio-windows-x64.zip\n", new System.Text.UTF8Encoding(false));
            var script = Path.Combine(cache, "install.ps1"); Resource("studio-installer", script);
            var shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe");
            LauncherCommon.Run(shell, "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + LauncherCommon.Quote(script) + " -PackagePath " + LauncherCommon.Quote(zip) + " -InstallRoot " + LauncherCommon.Quote(root) + " -NoOpen", cache);
            var pointer = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(root, "current.json"), System.Text.Encoding.UTF8));
            var installed = (string)pointer["path"];
            var full = Path.GetFullPath(installed);
            if (!full.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("安装目录验证失败。");
            if (Array.IndexOf(args, "--install-only") < 0) LauncherCommon.Open(full, Array.IndexOf(args, "--no-browser") >= 0);
            return installed;
        });
    }
}
