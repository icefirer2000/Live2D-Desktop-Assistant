using System;
using System.Diagnostics;
using System.IO;

internal static class Launcher
{
    private static string FindBrowser()
    {
        string[] candidates =
        {
            @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            @"C:\Program Files\Google\Chrome\Application\chrome.exe",
            @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
        };

        foreach (string candidate in candidates)
        {
            if (File.Exists(candidate)) return candidate;
        }

        return null;
    }

    public static void Main()
    {
        string browser = FindBrowser();
        if (browser == null)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "https://chatgpt.com",
                UseShellExecute = true
            });
            return;
        }

        string projectRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
        string settingsPath = Path.Combine(projectRoot, "settings.html");
        if (!File.Exists(settingsPath))
        {
            settingsPath = Path.Combine(projectRoot, "src", "settings.html");
        }
        string settingsUrl = new Uri(settingsPath).AbsoluteUri;
        string profile = Path.Combine(Path.GetTempPath(), "Live2DDesktopAssistantSettings");
        Directory.CreateDirectory(profile);

        Process.Start(new ProcessStartInfo
        {
            FileName = browser,
            Arguments = "--app=\"" + settingsUrl + "\" --user-data-dir=\"" + profile + "\" --no-first-run --disable-features=msEdgeSidebarV2",
            WorkingDirectory = projectRoot,
            UseShellExecute = false,
            CreateNoWindow = true
        });
    }
}
