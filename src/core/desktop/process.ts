import { spawn } from "node:child_process";
import { run } from "../../utils/shell.js";

function getProcessName(): string {
  const platform = process.platform;
  if (platform === "darwin") return "GitHub Desktop";
  if (platform === "win32") return "GitHubDesktop.exe";
  return "github-desktop";
}

function getAppLaunchCommand(): { command: string; args: string[] } {
  const platform = process.platform;
  if (platform === "darwin") {
    return {
      command: "open",
      args: ["-a", "GitHub Desktop"],
    };
  }
  if (platform === "win32") {
    const localAppData =
      process.env["LOCALAPPDATA"] || "";
    return {
      command: `${localAppData}\\GitHubDesktop\\GitHubDesktop.exe`,
      args: [],
    };
  }
  // Linux
  return { command: "github-desktop", args: [] };
}

export function isDesktopRunning(): boolean {
  const name = getProcessName();
  const platform = process.platform;

  if (platform === "win32") {
    const result = run("tasklist", ["/FI", `IMAGENAME eq ${name}`]);
    return result.stdout.toLowerCase().includes(name.toLowerCase());
  }

  const result = run("pgrep", ["-f", name]);
  return result.exitCode === 0;
}

export function killDesktop(): void {
  const name = getProcessName();
  const platform = process.platform;

  if (platform === "win32") {
    run("taskkill", ["/F", "/IM", name]);
  } else {
    run("pkill", ["-f", name]);
  }

  // Give the process a moment to exit
  if (process.platform === "win32") {
    run("powershell.exe", ["-NoProfile", "-Command", "Start-Sleep -Seconds 1"]);
  } else {
    run("sleep", ["1"]);
  }
}

export function launchDesktop(): void {
  const platform = process.platform;

  if (platform === "win32") {
    // Use explorer.exe to launch — ensures proper user session context
    const localAppData = process.env["LOCALAPPDATA"] || "";
    const desktopExe = `${localAppData}\\GitHubDesktop\\GitHubDesktop.exe`;
    const child = spawn("explorer.exe", [desktopExe], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return;
  }

  const { command, args } = getAppLaunchCommand();
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function restartDesktop(): void {
  if (isDesktopRunning()) {
    killDesktop();
  }
  launchDesktop();
}
