using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class LauncherCommon
{
    public static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
    public static string Run(string executable, string arguments, string directory)
    {
        var start = new ProcessStartInfo(executable, arguments) {
            WorkingDirectory = directory, UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8
        };
        var output = new StringBuilder(); var errors = new StringBuilder();
        using (var process = new Process { StartInfo = start }) {
            process.OutputDataReceived += (s, e) => { if (e.Data != null && output.Length < 65536) output.AppendLine(e.Data); };
            process.ErrorDataReceived += (s, e) => { if (e.Data != null && errors.Length < 65536) errors.AppendLine(e.Data); };
            process.Start(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
            if (!process.WaitForExit(120000)) { process.Kill(); throw new Exception("启动等待超时，请重新打开工作台。"); }
            process.WaitForExit();
            if (process.ExitCode != 0) throw new Exception("工作台未能启动。\n" + errors.ToString().Substring(0, Math.Min(errors.Length, 2000)));
        }
        return output.ToString().Trim();
    }
    public static string Open(string directory, bool noBrowser)
    {
        var runtime = Path.Combine(directory, "runtime", "node.exe");
        var cli = Path.Combine(directory, "dist", "cli.mjs");
        if (!File.Exists(runtime) || !File.Exists(cli)) throw new Exception("请先解压完整的 ZIP，再双击 Character Studio.exe。请保留同目录的 runtime 和 dist 文件夹。");
        return Run(runtime, Quote(cli) + " open --executor keep" + (noBrowser ? " --no-browser" : ""), directory);
    }
    public static int Start(string mutexName, bool quiet, Func<string> action)
    {
        bool created;
        using (var mutex = new Mutex(true, mutexName, out created)) {
            if (!created) return 0;
            Exception failure = null;
            Action work = () => { try { action(); } catch (Exception error) { failure = error; } };
            if (quiet) work();
            else {
                Application.EnableVisualStyles();
                using (var window = new Form { Text = "Character Studio", Width = 390, Height = 130, StartPosition = FormStartPosition.CenterScreen, FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false }) {
                    window.Controls.Add(new Label { Text = "正在打开人物工作台…\n首次启动会自动准备运行环境，请稍候。", AutoSize = false, Dock = DockStyle.Fill, TextAlign = System.Drawing.ContentAlignment.MiddleCenter });
                    window.Shown += (s, e) => {
                        var worker = new System.ComponentModel.BackgroundWorker();
                        worker.DoWork += (a, b) => work();
                        worker.RunWorkerCompleted += (a, b) => window.Close();
                        worker.RunWorkerAsync();
                    };
                    window.ShowDialog();
                }
            }
            if (failure == null) return 0;
            if (!quiet) MessageBox.Show(failure.Message, "人物工作台打不开", MessageBoxButtons.OK, MessageBoxIcon.Error);
            else Console.Error.WriteLine(failure.Message);
            return 1;
        }
    }
}
