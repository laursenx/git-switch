import { run, runOrThrow, isCommandAvailable } from "../../utils/shell.js";
import { DesktopKeychainError } from "../../utils/errors.js";

interface KeychainEntry {
  label: string;
  account: string;
  password: string;
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
    // cmdkey is built into Windows — no extra modules needed
    if (!isCommandAvailable("cmdkey")) {
      throw new DesktopKeychainError(
        "win32",
        "'cmdkey' not found — this should be built into Windows",
      );
    }
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
    // cmdkey /list can show entries but can't extract passwords directly.
    // Use PowerShell's CredRead via P/Invoke for reading the actual credential.
    const result = runOrThrow("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Add-Type -Namespace Win32 -Name Cred -MemberDefinition '
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
  public int Flags; public int Type; public string TargetName; public string Comment;
  public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
  public int Persist; public int AttributeCount; public IntPtr Attributes;
  public string TargetAlias; public string UserName;
}';
$ptr=[IntPtr]::Zero;
if([Win32.Cred]::CredRead("${label.replace(/"/g, '`"')}",1,0,[ref]$ptr)){
  $c=[Runtime.InteropServices.Marshal]::PtrToStructure($ptr,[type][Win32.Cred+CREDENTIAL]);
  $pw=[Runtime.InteropServices.Marshal]::PtrToStringUni($c.CredentialBlob,$c.CredentialBlobSize/2);
  [Win32.Cred]::CredFree($ptr);
  Write-Output $pw
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
    run("cmdkey", ["/delete", label]);
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
    runOrThrow("cmdkey", [
      "/generic:" + label,
      "/user:" + account,
      "/pass:" + token,
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
