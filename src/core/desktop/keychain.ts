import { run, runOrThrow, isCommandAvailable } from "../../utils/shell.js";
import { DesktopKeychainError } from "../../utils/errors.js";

interface KeychainEntry {
  label: string;
  account: string;
  password: string;
}

const WIN32_CRED_PREAMBLE = `
Add-Type -Namespace Win32 -Name Cred -MemberDefinition '
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredWrite(ref CREDENTIAL cred, int flags);
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredDelete(string target, int type, int flags);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
  public int Persist; public int AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}';
`;

function escapePS(s: string): string {
  return s.replace(/'/g, "''");
}

function ensureKeychainTool(): void {
  const platform = process.platform;
  if (platform === "darwin") {
    if (!isCommandAvailable("security")) {
      throw new DesktopKeychainError(
        "darwin",
        "macOS 'security' CLI not found",
        "The 'security' command should be available by default on macOS.",
      );
    }
  } else if (platform === "win32") {
    // Windows uses P/Invoke to advapi32.dll — no external tools needed
  } else if (platform === "linux") {
    if (!isCommandAvailable("secret-tool")) {
      throw new DesktopKeychainError(
        "linux",
        "'secret-tool' CLI not found",
        "Install with: sudo apt install libsecret-tools (Debian/Ubuntu) or equivalent",
      );
    }
  }
}

function readToken(label: string): string {
  const platform = process.platform;

  if (platform === "darwin") {
    return runOrThrow("security", [
      "find-internet-password",
      "-l",
      label,
      "-w",
    ]);
  }

  if (platform === "win32") {
    const result = runOrThrow("powershell.exe", [
      "-NoProfile",
      "-Command",
      `${WIN32_CRED_PREAMBLE}
$ptr=[IntPtr]::Zero;
if([Win32.Cred]::CredRead('${escapePS(label)}',1,0,[ref]$ptr)){
  $c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][Win32.Cred+CREDENTIAL]);
  $bytes=New-Object byte[] $c.CredentialBlobSize;
  [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$bytes,0,$c.CredentialBlobSize);
  [Win32.Cred]::CredFree($ptr);
  Write-Output ([Convert]::ToBase64String($bytes))
} else { exit 1 }`,
    ]);
    return result;
  }

  // Linux
  return runOrThrow("secret-tool", ["lookup", "label", label]);
}

function deleteEntry(label: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    run("security", ["delete-internet-password", "-l", label]);
    return;
  }

  if (platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `${WIN32_CRED_PREAMBLE}
[Win32.Cred]::CredDelete('${escapePS(label)}',1,0) | Out-Null`,
    ]);
    return;
  }

  // Linux
  run("secret-tool", ["clear", "label", label]);
}

function addEntry(label: string, account: string, token: string): void {
  const platform = process.platform;

  if (platform === "darwin") {
    runOrThrow("security", [
      "add-internet-password",
      "-l",
      label,
      "-a",
      account,
      "-s",
      "github.com",
      "-w",
      token,
    ]);
    return;
  }

  if (platform === "win32") {
    runOrThrow("powershell.exe", [
      "-NoProfile",
      "-Command",
      `${WIN32_CRED_PREAMBLE}
$bytes=[Convert]::FromBase64String('${token}');
$c=New-Object Win32.Cred+CREDENTIAL;
$c.Type=1;
$c.TargetName='${escapePS(label)}';
$c.UserName='${escapePS(account)}';
$c.CredentialBlobSize=$bytes.Length;
$c.CredentialBlob=[Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length);
[Runtime.InteropServices.Marshal]::Copy($bytes,0,$c.CredentialBlob,$bytes.Length);
$c.Persist=2;
if(-not [Win32.Cred]::CredWrite([ref]$c,0)){ exit 1 }
[Runtime.InteropServices.Marshal]::FreeHGlobal($c.CredentialBlob);`,
    ]);
    return;
  }

  // Linux — pipe token via stdin
  const result = run("bash", [
    "-c",
    `printf '%s' '${token.replace(/'/g, "'\\''")}' | secret-tool store --label="${label}" label "${label}"`,
  ]);
  if (result.exitCode !== 0) {
    throw new DesktopKeychainError(
      "linux",
      `Failed to store credential: ${result.stderr}`,
    );
  }
}

export interface DetectedCredential {
  target: string;
  user: string;
}

export function listGitHubCredentials(): DetectedCredential[] {
  ensureKeychainTool();
  const platform = process.platform;

  if (platform === "win32") {
    const result = run("cmdkey", ["/list"]);
    if (result.exitCode !== 0) return [];

    const credentials: DetectedCredential[] = [];
    const blocks = result.stdout.split(/\r?\n\s*\r?\n/);
    for (const block of blocks) {
      const targetMatch = block.match(/Target:\s*(?:LegacyGeneric:target=)?(.+)/i);
      const userMatch = block.match(/User:\s*(.+)/i);
      if (!targetMatch) continue;
      const target = targetMatch[1]!.trim();
      const user = userMatch ? userMatch[1]!.trim() : "";
      // GitHub Desktop credentials match: "GitHub - https://api.github.com/{user}"
      // Skip git credential manager (git:https://...), gh CLI, VS Code, and parked entries
      if (/^GitHub - https:\/\/api\.github\.com\//i.test(target)) {
        credentials.push({ target, user });
      }
    }
    return credentials;
  }

  if (platform === "darwin") {
    const result = run("security", [
      "dump-keychain",
    ]);
    if (result.exitCode !== 0) return [];

    const credentials: DetectedCredential[] = [];
    const entries = result.stdout.split(/keychain:/);
    for (const entry of entries) {
      if (!/github/i.test(entry)) continue;
      const labelMatch = entry.match(/"labl"<blob>="([^"]+)"/);
      const acctMatch = entry.match(/"acct"<blob>="([^"]+)"/);
      if (labelMatch) {
        credentials.push({
          target: labelMatch[1]!,
          user: acctMatch ? acctMatch[1]! : "",
        });
      }
    }
    return credentials;
  }

  // Linux — secret-tool doesn't have a good list command for filtering
  return [];
}

export function readKeychainEntry(label: string): KeychainEntry | null {
  ensureKeychainTool();
  try {
    const password = readToken(label);
    return { label, account: "", password };
  } catch {
    return null;
  }
}

/**
 * Validate a stored GitHub OAuth token against the GitHub API.
 * Returns the GitHub username if valid, or null if expired/invalid.
 */
export async function validateStoredToken(label: string): Promise<string | null> {
  const entry = readKeychainEntry(label);
  if (!entry) return null;

  // Decode the Base64 token to get the raw OAuth token
  const token = Buffer.from(entry.password, "base64").toString("utf-8");
  if (!token.startsWith("gho_")) return null;

  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (resp.ok) {
      const data = (await resp.json()) as { login: string };
      return data.login;
    }
    return null;
  } catch {
    // Network error — can't validate, assume OK
    return "unknown";
  }
}

/**
 * Rename a keychain entry by deleting the old one and adding a new one with the same password.
 */
export function renameKeychainEntry(
  oldLabel: string,
  newLabel: string,
  account: string,
): void {
  ensureKeychainTool();
  const token = readToken(oldLabel);
  deleteEntry(oldLabel);
  addEntry(newLabel, account, token);
}

/**
 * Perform the full keychain rotation for a desktop profile switch.
 *
 * 1. Park the currently active entry under the current profile's stored_label
 * 2. Activate the target profile's parked entry under its keychain_label
 */
export function rotateKeychainEntries(opts: {
  currentKeychainLabel: string;
  currentStoredLabel: string;
  currentAccount: string;
  targetKeychainLabel: string;
  targetStoredLabel: string;
  targetAccount: string;
}): void {
  ensureKeychainTool();

  // Park the currently active entry
  renameKeychainEntry(
    opts.currentKeychainLabel,
    opts.currentStoredLabel,
    opts.currentAccount,
  );

  // Activate the target profile's parked entry
  renameKeychainEntry(
    opts.targetStoredLabel,
    opts.targetKeychainLabel,
    opts.targetAccount,
  );
}
