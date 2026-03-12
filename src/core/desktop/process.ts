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
  run("sleep", ["1"]);
}

export function launchDesktop(): void {
  const { command, args } = getAppLaunchCommand();
  // Launch detached so it doesn't block
  run(command, args, { timeout: 5_000 });
}

export function restartDesktop(): void {
  if (isDesktopRunning()) {
    killDesktop();
  }
  launchDesktop();
}
