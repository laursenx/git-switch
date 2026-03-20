import { DesktopKeychainError } from "../../utils/errors.js";

interface KeychainEntry {
	label: string;
	account: string;
	password: string;
}

// ---------------------------------------------------------------------------
// Windows Credential Manager via Bun FFI (advapi32.dll)
// ---------------------------------------------------------------------------
// TODO: Add macOS support (use `security` CLI for Keychain access)
// TODO: Add Linux support (use `secret-tool` CLI for libsecret access)

const CRED_TYPE_GENERIC = 1;
const CRED_PERSIST_LOCAL_MACHINE = 2;

// CREDENTIALW struct layout on x64 (80 bytes):
//  0: Flags (u32)       4: Type (u32)         8: TargetName (ptr)
// 16: Comment (ptr)    24: LastWritten (u64)  32: BlobSize (u32)
// 36: (pad 4)          40: Blob (ptr)        48: Persist (u32)
// 52: AttrCount (u32)  56: Attributes (ptr)  64: TargetAlias (ptr)
// 72: UserName (ptr)
const CRED_STRUCT_SIZE = 80;

interface Advapi32Symbols {
	CredReadW: (
		target: number,
		type: number,
		flags: number,
		out: number,
	) => number;
	CredWriteW: (cred: number, flags: number) => number;
	CredDeleteW: (target: number, type: number, flags: number) => number;
	CredFree: (ptr: number) => void;
	CredEnumerateW: (
		filter: number,
		flags: number,
		count: number,
		creds: number,
	) => number;
}

let _symbols: Advapi32Symbols | null = null;

function getAdvapi32(): Advapi32Symbols {
	if (_symbols) return _symbols;
	const { dlopen, FFIType } = require("bun:ffi");
	const lib = dlopen("advapi32.dll", {
		CredReadW: {
			args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
			returns: FFIType.i32,
		},
		CredWriteW: {
			args: [FFIType.ptr, FFIType.u32],
			returns: FFIType.i32,
		},
		CredDeleteW: {
			args: [FFIType.ptr, FFIType.u32, FFIType.u32],
			returns: FFIType.i32,
		},
		CredFree: {
			args: [FFIType.ptr],
			returns: FFIType.void,
		},
		CredEnumerateW: {
			args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
			returns: FFIType.i32,
		},
	});
	_symbols = lib.symbols as unknown as Advapi32Symbols;
	return _symbols;
}

function toWideString(str: string): { buffer: Buffer; pointer: number } {
	const { ptr } = require("bun:ffi");
	const buf = Buffer.alloc((str.length + 1) * 2);
	buf.write(str, "utf16le");
	return { buffer: buf, pointer: ptr(buf) };
}

function fromWideString(pointer: number): string {
	if (pointer === 0) return "";
	const { read, toArrayBuffer } = require("bun:ffi");
	let byteLen = 0;
	while (true) {
		const lo = read.u8(pointer, byteLen);
		const hi = read.u8(pointer, byteLen + 1);
		if (lo === 0 && hi === 0) break;
		byteLen += 2;
	}
	if (byteLen === 0) return "";
	const ab = toArrayBuffer(pointer, 0, byteLen);
	return new TextDecoder("utf-16le").decode(ab);
}

function win32CredRead(
	target: string,
): { blob: Buffer; userName: string } | null {
	const { ptr, read, toArrayBuffer } = require("bun:ffi");
	const api = getAdvapi32();

	const targetWide = toWideString(target);
	const outBuf = Buffer.alloc(8);
	const outPtr = ptr(outBuf);

	const ok = api.CredReadW(targetWide.pointer, CRED_TYPE_GENERIC, 0, outPtr);
	if (!ok) return null;

	const credPtr = read.ptr(outPtr, 0);
	const blobSize: number = read.u32(credPtr, 32);
	const blobPtr: number = read.ptr(credPtr, 40);
	const userNamePtr: number = read.ptr(credPtr, 72);

	const blob =
		blobSize > 0 && blobPtr
			? Buffer.from(toArrayBuffer(blobPtr, 0, blobSize))
			: Buffer.alloc(0);
	const userName = fromWideString(userNamePtr);

	api.CredFree(credPtr);

	// Keep references alive past native calls
	void targetWide.buffer;
	void outBuf;

	return { blob, userName };
}

function win32CredWrite(target: string, userName: string, blob: Buffer): void {
	const { ptr } = require("bun:ffi");
	const api = getAdvapi32();

	const targetWide = toWideString(target);
	const userWide = toWideString(userName);

	const structBuf = Buffer.alloc(CRED_STRUCT_SIZE);
	const view = new DataView(
		structBuf.buffer,
		structBuf.byteOffset,
		structBuf.byteLength,
	);

	view.setUint32(0, 0, true); // Flags
	view.setUint32(4, CRED_TYPE_GENERIC, true); // Type
	view.setBigUint64(8, BigInt(targetWide.pointer), true); // TargetName
	view.setBigUint64(16, BigInt(0), true); // Comment
	// LastWritten at 24 - leave zeros
	view.setUint32(32, blob.length, true); // BlobSize
	view.setBigUint64(40, BigInt(ptr(blob)), true); // Blob
	view.setUint32(48, CRED_PERSIST_LOCAL_MACHINE, true); // Persist
	view.setUint32(52, 0, true); // AttributeCount
	view.setBigUint64(56, BigInt(0), true); // Attributes
	view.setBigUint64(64, BigInt(0), true); // TargetAlias
	view.setBigUint64(72, BigInt(userWide.pointer), true); // UserName

	const ok = api.CredWriteW(ptr(structBuf), 0);

	// Keep references alive past native call
	void targetWide.buffer;
	void userWide.buffer;
	void blob;
	void structBuf;

	if (!ok) {
		throw new DesktopKeychainError(
			"win32",
			`CredWriteW failed for "${target}"`,
		);
	}
}

function win32CredDelete(target: string): void {
	const api = getAdvapi32();
	const targetWide = toWideString(target);
	api.CredDeleteW(targetWide.pointer, CRED_TYPE_GENERIC, 0);
	void targetWide.buffer;
}

function win32CredEnumerate(
	filter: string | null,
): Array<{ target: string; userName: string }> {
	const { ptr, read } = require("bun:ffi");
	const api = getAdvapi32();

	const filterWide = filter ? toWideString(filter) : null;
	const countBuf = Buffer.alloc(4);
	const credsBuf = Buffer.alloc(8);

	const ok = api.CredEnumerateW(
		filterWide?.pointer ?? 0,
		0,
		ptr(countBuf),
		ptr(credsBuf),
	);

	if (!ok) return [];

	const count = new DataView(countBuf.buffer, countBuf.byteOffset, 4).getUint32(
		0,
		true,
	);
	const arrayPtr = read.ptr(ptr(credsBuf), 0);

	const results: Array<{ target: string; userName: string }> = [];
	for (let i = 0; i < count; i++) {
		const credPtr = read.ptr(arrayPtr, i * 8);
		const targetNamePtr: number = read.ptr(credPtr, 8);
		const userNamePtr: number = read.ptr(credPtr, 72);
		results.push({
			target: fromWideString(targetNamePtr),
			userName: fromWideString(userNamePtr),
		});
	}

	api.CredFree(arrayPtr);

	void filterWide?.buffer;
	void countBuf;
	void credsBuf;

	return results;
}

// ---------------------------------------------------------------------------
// Public API (Windows-only)
// ---------------------------------------------------------------------------

let _keychainToolChecked = false;

function ensureKeychainTool(): void {
	if (_keychainToolChecked) return;

	if (process.platform !== "win32") {
		// TODO: Add macOS support (check for `security` CLI)
		// TODO: Add Linux support (check for `secret-tool` CLI)
		throw new DesktopKeychainError(
			process.platform,
			`Unsupported platform: ${process.platform}. Only Windows is currently supported.`,
		);
	}

	// Windows uses Bun FFI to advapi32.dll - no external tools needed
	_keychainToolChecked = true;
}

function readToken(label: string): string {
	// TODO: macOS - runOrThrow("security", ["find-internet-password", "-l", label, "-w"])
	// TODO: Linux - runOrThrow("secret-tool", ["lookup", "label", label])
	const result = win32CredRead(label);
	if (!result) {
		throw new DesktopKeychainError("win32", `Credential not found: "${label}"`);
	}
	return result.blob.toString("base64");
}

function deleteEntry(label: string): void {
	// TODO: macOS - run("security", ["delete-internet-password", "-l", label])
	// TODO: Linux - run("secret-tool", ["clear", "label", label])
	win32CredDelete(label);
}

function addEntry(label: string, account: string, token: string): void {
	// TODO: macOS - runOrThrow("security", ["add-internet-password", "-l", label, "-a", account, "-s", "github.com", "-w", token])
	// TODO: Linux - run("secret-tool", ["store", "--label", label, "label", label], { input: token })
	const blob = Buffer.from(token, "base64");
	win32CredWrite(label, account, blob);
}

export interface DetectedCredential {
	target: string;
	user: string;
}

export function listGitHubCredentials(): DetectedCredential[] {
	ensureKeychainTool();

	// TODO: macOS - parse `security dump-keychain` output for GitHub entries
	// TODO: Linux - secret-tool doesn't have a good list/filter command
	const all = win32CredEnumerate("GitHub*");
	return all
		.filter((c) => /^GitHub - https:\/\/api\.github\.com\//i.test(c.target))
		.map((c) => ({ target: c.target, user: c.userName }));
}

/**
 * List GitHub credentials that have a valid (non-expired) OAuth token.
 * Checks each credential against the GitHub API.
 */
export async function listValidGitHubCredentials(): Promise<
	DetectedCredential[]
> {
	const candidates = listGitHubCredentials();
	if (candidates.length === 0) return [];

	const results = await Promise.all(
		candidates.map(async (c) => {
			const userInfo = await validateStoredToken(c.target);
			return userInfo ? { target: c.target, user: userInfo.login } : null;
		}),
	);

	return results.filter((c): c is DetectedCredential => c !== null);
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
 * Read and decode a GitHub OAuth token from the credential store.
 * Returns the raw token string, or null if not found or not a GitHub OAuth token.
 */
function resolveOAuthToken(label: string): string | null {
	const entry = readKeychainEntry(label);
	if (!entry) return null;

	const token = Buffer.from(entry.password, "base64").toString("utf-8");
	if (!token.startsWith("gho_")) return null;

	return token;
}

export interface GitHubUserInfo {
	login: string;
	id: number;
	name: string | null;
	avatar_url: string;
	plan?: { name: string };
}

/**
 * Validate a stored GitHub OAuth token against the GitHub API.
 * Returns full user info if valid, or null if expired/invalid.
 * Returns a minimal object with login="unknown" on network errors.
 */
export async function validateStoredToken(
	label: string,
): Promise<GitHubUserInfo | null> {
	const token = resolveOAuthToken(label);
	if (!token) return null;

	try {
		const resp = await fetch("https://api.github.com/user", {
			headers: {
				Authorization: `token ${token}`,
				Accept: "application/vnd.github.v3+json",
			},
		});
		if (resp.ok) {
			return (await resp.json()) as GitHubUserInfo;
		}
		return null;
	} catch {
		// Network error - can't validate, assume OK
		return { login: "unknown", id: 0, name: null, avatar_url: "" };
	}
}

export interface GitHubDesktopUser {
	login: string;
	endpoint: string;
	token: string;
	emails: {
		email: string;
		primary: boolean;
		verified: boolean;
		visibility: string | null;
	}[];
	avatarURL: string;
	id: number;
	name: string;
	plan: string;
}

/**
 * Build Desktop-compatible users JSON from a credential.
 * If pre-fetched user info is provided, only fetches /user/emails (avoids duplicate /user call).
 * Returns the value with LevelDB prefix byte (\x01), ready to store in the DB or write to LevelDB.
 */
export async function fetchDesktopUsersJson(
	label: string,
	preFetchedUser?: GitHubUserInfo,
): Promise<string | null> {
	const token = resolveOAuthToken(label);
	if (!token) return null;

	try {
		const headers = {
			Authorization: `token ${token}`,
			Accept: "application/vnd.github.v3+json",
		};

		let user: GitHubUserInfo;
		if (preFetchedUser && preFetchedUser.id !== 0) {
			user = preFetchedUser;
		} else {
			const userResp = await fetch("https://api.github.com/user", {
				headers,
			});
			if (!userResp.ok) return null;
			user = (await userResp.json()) as GitHubUserInfo;
		}

		const emailsResp = await fetch("https://api.github.com/user/emails", {
			headers,
		});

		let emails: GitHubDesktopUser["emails"] = [];
		if (emailsResp.ok) {
			emails = (await emailsResp.json()) as GitHubDesktopUser["emails"];
		}

		const desktopUser: GitHubDesktopUser = {
			login: user.login,
			endpoint: "https://api.github.com",
			token: "",
			emails,
			avatarURL: user.avatar_url,
			id: user.id,
			name: user.name ?? user.login,
			plan: user.plan?.name ?? "free",
		};

		// LevelDB prefix byte - matches the format Electron localStorage uses
		return `\x01${JSON.stringify([desktopUser])}`;
	} catch {
		return null;
	}
}

/**
 * Copy a keychain entry to a new label, keeping the original in place.
 */
export function copyKeychainEntry(
	sourceLabel: string,
	destLabel: string,
	account: string,
): void {
	ensureKeychainTool();
	const token = readToken(sourceLabel);
	addEntry(destLabel, account, token);
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
	addEntry(newLabel, account, token);
	deleteEntry(oldLabel);
}
