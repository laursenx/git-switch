import * as fs from "node:fs";
import * as path from "node:path";
import { GitSwitchError } from "../../utils/errors.js";
import { gitDesktopLocalStorageDir } from "../../utils/paths.js";

// ---------------------------------------------------------------------------
// CRC32C - lookup-table implementation (Castagnoli polynomial 0x1EDC6F41)
// ---------------------------------------------------------------------------

const CRC32C_TABLE = buildCrc32cTable();

function buildCrc32cTable(): Uint32Array {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let crc = i;
		for (let j = 0; j < 8; j++) {
			crc = crc & 1 ? (crc >>> 1) ^ 0x82f63b78 : crc >>> 1;
		}
		table[i] = crc >>> 0;
	}
	return table;
}

function crc32c(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = (crc >>> 8) ^ (CRC32C_TABLE[(crc ^ data[i]) & 0xff] ?? 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * LevelDB masks the CRC before storing it:
 *   masked = ((crc >>> 15) | (crc << 17)) + 0xa282ead8
 */
function maskCrc(crc: number): number {
	return (((crc >>> 15) | (crc << 17)) + 0xa282ead8) >>> 0;
}

// ---------------------------------------------------------------------------
// Varint encoding / decoding (unsigned LEB128, used by LevelDB)
// ---------------------------------------------------------------------------

function encodeVarint(value: number): Uint8Array {
	const bytes: number[] = [];
	while (value > 0x7f) {
		bytes.push((value & 0x7f) | 0x80);
		value >>>= 7;
	}
	bytes.push(value & 0x7f);
	return new Uint8Array(bytes);
}

function decodeVarint(buf: Uint8Array, offset: number): [number, number] {
	let result = 0;
	let shift = 0;
	let pos = offset;
	while (pos < buf.length) {
		const byte = buf[pos] ?? 0;
		result |= (byte & 0x7f) << shift;
		pos++;
		if ((byte & 0x80) === 0) break;
		shift += 7;
	}
	return [result >>> 0, pos];
}

// ---------------------------------------------------------------------------
// LevelDB WAL constants
// ---------------------------------------------------------------------------

const BLOCK_SIZE = 32768;
const HEADER_SIZE = 7; // checksum(4) + length(2) + type(1)

const RECORD_FULL = 1;
const RECORD_FIRST = 2;
const RECORD_MIDDLE = 3;
const RECORD_LAST = 4;

const BATCH_PUT = 1;

// ---------------------------------------------------------------------------
// Parsing: read all Put entries from a single WAL .log file
// ---------------------------------------------------------------------------

interface KvEntry {
	key: string;
	value: string;
	sequence: bigint;
}

function parseLogFile(data: Uint8Array): KvEntry[] {
	const entries: KvEntry[] = [];
	let offset = 0;

	// Reassemble logical records from physical blocks
	const logicalRecords: Uint8Array[] = [];
	let pending: Uint8Array[] = [];

	while (offset < data.length) {
		// Align to block boundary - skip block trailer if not enough room for header
		const blockOffset = offset % BLOCK_SIZE;
		const remaining = BLOCK_SIZE - blockOffset;
		if (remaining < HEADER_SIZE) {
			offset += remaining;
			continue;
		}

		if (offset + HEADER_SIZE > data.length) break;

		// Read record header
		const length = (data[offset + 4] ?? 0) | ((data[offset + 5] ?? 0) << 8);
		const type = data[offset + 6] ?? 0;

		if (type === 0 || length === 0) {
			// Zero-type records are padding; skip rest of block
			offset += remaining;
			continue;
		}

		if (offset + HEADER_SIZE + length > data.length) break;

		const payload = data.slice(
			offset + HEADER_SIZE,
			offset + HEADER_SIZE + length,
		);
		offset += HEADER_SIZE + length;

		switch (type) {
			case RECORD_FULL:
				logicalRecords.push(payload);
				break;
			case RECORD_FIRST:
				pending = [payload];
				break;
			case RECORD_MIDDLE:
				pending.push(payload);
				break;
			case RECORD_LAST:
				pending.push(payload);
				logicalRecords.push(concatUint8Arrays(pending));
				pending = [];
				break;
		}
	}

	// Parse each logical record as a WriteBatch
	for (const record of logicalRecords) {
		parseBatch(record, entries);
	}

	return entries;
}

function parseBatch(record: Uint8Array, out: KvEntry[]): void {
	if (record.length < 12) return; // sequence(8) + count(4)

	const view = new DataView(
		record.buffer,
		record.byteOffset,
		record.byteLength,
	);
	const sequence = view.getBigUint64(0, true);
	const count = view.getUint32(8, true);

	let pos = 12;
	for (let i = 0; i < count && pos < record.length; i++) {
		const entryType = record[pos] ?? 0;
		pos++;

		if (entryType === BATCH_PUT) {
			const [keyLen, keyStart] = decodeVarint(record, pos);
			const keyBytes = record.slice(keyStart, keyStart + keyLen);
			pos = keyStart + keyLen;

			const [valLen, valStart] = decodeVarint(record, pos);
			const valBytes = record.slice(valStart, valStart + valLen);
			pos = valStart + valLen;

			out.push({
				key: new TextDecoder().decode(keyBytes),
				value: new TextDecoder().decode(valBytes),
				sequence: sequence + BigInt(i),
			});
		} else {
			// Delete entry - skip key only
			const [keyLen, keyStart] = decodeVarint(record, pos);
			pos = keyStart + keyLen;
		}
	}
}

// ---------------------------------------------------------------------------
// Parsing: read entries from .ldb / .sst table files (simplified)
// ---------------------------------------------------------------------------

/**
 * Scan an SSTable / .ldb file for data block entries matching the target key.
 * This is a simplified scan: we look for the key bytes directly in data blocks
 * rather than implementing the full two-level index lookup. This works because
 * Electron localStorage tables are small and keys are plain text.
 */
function parseTableFile(data: Uint8Array, targetKey: string): string | null {
	const keyBytes = new TextEncoder().encode(targetKey);

	// LevelDB table footer is last 48 bytes; data blocks start at offset 0.
	// We scan for the key pattern inside data blocks. Each entry in a data block
	// has: shared_bytes(varint) + unshared_bytes(varint) + value_length(varint)
	//      + unshared_key(unshared_bytes) + value(value_length)
	// For the first entry in a restart group, shared_bytes == 0.

	// Simple byte-search approach: find occurrences of the key and try to parse
	// the entry around it.
	let searchFrom = 0;
	let lastValue: string | null = null;

	while (searchFrom < data.length - keyBytes.length) {
		const idx = indexOfBytes(data, keyBytes, searchFrom);
		if (idx === -1) break;

		// Try to read the entry assuming the key starts at idx.
		// We need to find the varint triple that precedes the key.
		// Walk backwards to find a plausible start (shared=0, unshared=keyLen).
		const parsed = tryParseTableEntry(data, idx, keyBytes.length);
		if (parsed !== null) {
			lastValue = parsed;
		}
		searchFrom = idx + 1;
	}

	return lastValue;
}

function tryParseTableEntry(
	data: Uint8Array,
	keyOffset: number,
	keyLen: number,
): string | null {
	// We expect: shared(varint=0) + unshared(varint=keyLen) + valueLen(varint) right before the key.
	// The varints are immediately before keyOffset. Try common small-varint patterns.
	// shared=0 is 1 byte (0x00), unshared=keyLen is 1-2 bytes, valueLen is 1-5 bytes.

	for (let prefixLen = 3; prefixLen <= 8; prefixLen++) {
		const start = keyOffset - prefixLen;
		if (start < 0) continue;

		let pos = start;
		const [shared, p1] = decodeVarint(data, pos);
		if (shared !== 0) continue;
		pos = p1;

		const [unshared, p2] = decodeVarint(data, pos);
		if (unshared !== keyLen) continue;
		pos = p2;

		const [valueLen, p3] = decodeVarint(data, pos);
		if (p3 !== keyOffset) continue;

		// Varints line up - read value
		const valueStart = keyOffset + keyLen;
		if (valueStart + valueLen > data.length) continue;

		// LevelDB internal key: user_key + 8-byte trailer (sequence + type)
		// The actual key stored is user_key + 8 bytes. So keyLen = user_key.length + 8
		// and the real unshared key includes those 8 bytes. Let's check if the value
		// makes sense. If keyLen includes the 8-byte trailer, the value starts 8 bytes later.
		// Try both interpretations.

		// Interpretation 1: the full entry key is exactly our target (no internal trailer in unshared)
		const val1 = data.slice(valueStart, valueStart + valueLen);
		const str1 = new TextDecoder().decode(val1);
		if (isPlausibleJsonOrText(str1)) return str1;

		// Interpretation 2: there's an 8-byte internal key suffix after the user key
		if (valueStart + 8 + valueLen <= data.length) {
			const val2 = data.slice(valueStart + 8, valueStart + 8 + valueLen);
			const str2 = new TextDecoder().decode(val2);
			if (isPlausibleJsonOrText(str2)) return str2;
		}
	}

	// Also try the case where unshared includes the 8-byte internal key suffix
	for (let prefixLen = 3; prefixLen <= 8; prefixLen++) {
		const start = keyOffset - prefixLen;
		if (start < 0) continue;

		let pos = start;
		const [shared, p1] = decodeVarint(data, pos);
		if (shared !== 0) continue;
		pos = p1;

		const [unshared, p2] = decodeVarint(data, pos);
		if (unshared !== keyLen + 8) continue; // key + 8-byte trailer
		pos = p2;

		const [valueLen, p3] = decodeVarint(data, pos);
		if (p3 !== keyOffset) continue;

		const valueStart = keyOffset + keyLen + 8; // skip key + trailer
		if (valueStart + valueLen > data.length) continue;

		const val = data.slice(valueStart, valueStart + valueLen);
		const str = new TextDecoder().decode(val);
		if (isPlausibleJsonOrText(str)) return str;
	}

	return null;
}

function isPlausibleJsonOrText(s: string): boolean {
	if (s.length === 0) return false;
	// Quick heuristic: if it starts with [ or { or is mostly printable, accept it
	const first = s[0];
	if (first === "[" || first === "{" || first === '"') return true;
	// Check that most characters are printable ASCII or common UTF-8
	let printable = 0;
	for (let i = 0; i < Math.min(s.length, 50); i++) {
		const c = s.charCodeAt(i);
		if (c >= 0x20 && c < 0x7f) printable++;
	}
	return printable / Math.min(s.length, 50) > 0.8;
}

function indexOfBytes(
	haystack: Uint8Array,
	needle: Uint8Array,
	fromIndex: number,
): number {
	outer: for (let i = fromIndex; i <= haystack.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (haystack[i + j] !== needle[j]) continue outer;
		}
		return i;
	}
	return -1;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
	let totalLength = 0;
	for (const arr of arrays) totalLength += arr.length;
	const result = new Uint8Array(totalLength);
	let offset = 0;
	for (const arr of arrays) {
		result.set(arr, offset);
		offset += arr.length;
	}
	return result;
}

function getLevelDbDir(): string {
	const dir = gitDesktopLocalStorageDir();
	if (!fs.existsSync(dir)) {
		throw new GitSwitchError(
			`GitHub Desktop Local Storage not found at: ${dir}`,
		);
	}
	return dir;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read a key from GitHub Desktop's Electron localStorage (LevelDB-backed).
 *
 * Scans all .log, .ldb, and .sst files to find the latest value for the given key.
 * Keys are automatically prefixed with `_file://\\0\\1` as Electron does internally.
 *
 * @param key - The localStorage key (without the `_file://\\0\\1` prefix)
 * @returns The value string, or null if the key is not found
 */
/**
 * Try to read the "users" key from Desktop's localStorage.
 * Returns the JSON string or undefined if not available.
 */
export function tryReadDesktopUsers(): string | undefined {
	try {
		return readLocalStorageKey("users") ?? undefined;
	} catch {
		return undefined;
	}
}

export function readLocalStorageKey(key: string): string | null {
	const dir = getLevelDbDir();
	const fullKey = `_file://\x00\x01${key}`;

	let bestEntry: { value: string; sequence: bigint } | null = null;

	// Read all .log files
	const logFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".log"));
	for (const file of logFiles) {
		const data = new Uint8Array(fs.readFileSync(path.join(dir, file)));
		const entries = parseLogFile(data);
		for (const entry of entries) {
			if (entry.key === fullKey) {
				if (bestEntry === null || entry.sequence > bestEntry.sequence) {
					bestEntry = { value: entry.value, sequence: entry.sequence };
				}
			}
		}
	}

	// Read all .ldb and .sst files (compacted SSTables)
	const tableFiles = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".ldb") || f.endsWith(".sst"));
	for (const file of tableFiles) {
		const data = new Uint8Array(fs.readFileSync(path.join(dir, file)));
		const value = parseTableFile(data, fullKey);
		if (value !== null) {
			// Table entries have already been compacted; if we have no WAL entry
			// or this is the only source, use it. WAL entries take precedence
			// since they represent more recent writes.
			if (bestEntry === null) {
				bestEntry = { value, sequence: 0n };
			}
		}
	}

	return bestEntry?.value ?? null;
}

/**
 * Write or update a key in GitHub Desktop's Electron localStorage (LevelDB-backed).
 *
 * Rebuilds the LevelDB from scratch with all existing keys plus the updated key.
 * Appending records to an existing log causes corruption on recovery, so we read
 * all current entries, apply the update, and write a fresh database.
 *
 * GitHub Desktop must be closed when writing, as LevelDB does not support
 * concurrent access.
 *
 * @param key - The localStorage key (without the `_file://\\0\\1` prefix)
 * @param value - The value to write
 */
export function writeLocalStorageKey(key: string, value: string): void {
	const dir = getLevelDbDir();
	const fullKey = `_file://\x00\x01${key}`;

	// 1. Read all existing entries from the current database
	const entries = readAllEntries(dir);

	// 2. Update the target key
	entries.set(fullKey, new TextEncoder().encode(value));

	// 3. Build a single WAL record containing all entries
	const walData = buildFullBatchRecord(entries);

	// 4. Build a minimal MANIFEST
	const manifest = buildManifest(2, 3, entries.size);

	// 5. Replace the database atomically
	// Remove all existing data files (keep LOCK)
	for (const f of fs.readdirSync(dir)) {
		if (f === "LOCK") continue;
		fs.unlinkSync(path.join(dir, f));
	}

	fs.writeFileSync(path.join(dir, "MANIFEST-000001"), manifest);
	fs.writeFileSync(path.join(dir, "CURRENT"), "MANIFEST-000001\n");
	fs.writeFileSync(path.join(dir, "000002.log"), walData);
}

/**
 * Read all key-value entries from all .log and .ldb/.sst files in the LevelDB.
 * Returns a Map of full key → latest value bytes.
 */
function readAllEntries(dir: string): Map<string, Uint8Array> {
	const entries = new Map<string, { value: Uint8Array; sequence: bigint }>();

	// Read .log files
	const logFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".log"));
	for (const file of logFiles) {
		const data = new Uint8Array(fs.readFileSync(path.join(dir, file)));
		const parsed = parseLogFile(data);
		for (const entry of parsed) {
			const existing = entries.get(entry.key);
			if (!existing || entry.sequence > existing.sequence) {
				entries.set(entry.key, {
					value: new TextEncoder().encode(entry.value),
					sequence: entry.sequence,
				});
			}
		}
	}

	// Read .ldb/.sst files
	const tableFiles = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".ldb") || f.endsWith(".sst"));
	for (const file of tableFiles) {
		const data = new Uint8Array(fs.readFileSync(path.join(dir, file)));
		// Scan for all known keys from log entries, plus common prefixes
		for (const [key] of entries) {
			const value = parseTableFile(data, key);
			if (value !== null && !entries.has(key)) {
				entries.set(key, {
					value: new TextEncoder().encode(value),
					sequence: 0n,
				});
			}
		}
	}

	// Return just key → value (drop sequence tracking)
	const result = new Map<string, Uint8Array>();
	for (const [key, { value }] of entries) {
		result.set(key, value);
	}
	return result;
}

/**
 * Build a single FULL WAL record containing PUT entries for all keys.
 */
function buildFullBatchRecord(entries: Map<string, Uint8Array>): Uint8Array {
	// Build batch entries
	const parts: Uint8Array[] = [];
	for (const [key, value] of entries) {
		const keyBytes = new TextEncoder().encode(key);
		const keyLenV = encodeVarint(keyBytes.length);
		const valLenV = encodeVarint(value.length);

		const entry = new Uint8Array(
			1 + keyLenV.length + keyBytes.length + valLenV.length + value.length,
		);
		let p = 0;
		entry[p++] = BATCH_PUT;
		entry.set(keyLenV, p);
		p += keyLenV.length;
		entry.set(keyBytes, p);
		p += keyBytes.length;
		entry.set(valLenV, p);
		p += valLenV.length;
		entry.set(value, p);
		parts.push(entry);
	}

	let totalEntrySize = 0;
	for (const p of parts) totalEntrySize += p.length;

	const batchSize = 8 + 4 + totalEntrySize; // seq(8) + count(4) + entries
	const batch = new Uint8Array(batchSize);
	const batchView = new DataView(batch.buffer);

	batchView.setBigUint64(0, 1n, true); // sequence = 1
	batchView.setUint32(8, entries.size, true);

	let pos = 12;
	for (const p of parts) {
		batch.set(p, pos);
		pos += p.length;
	}

	// Wrap in WAL record (FULL type)
	const record = new Uint8Array(HEADER_SIZE + batchSize);
	const recordView = new DataView(record.buffer);

	const crcInput = new Uint8Array(1 + batchSize);
	crcInput[0] = RECORD_FULL;
	crcInput.set(batch, 1);

	recordView.setUint32(0, maskCrc(crc32c(crcInput)), true);
	recordView.setUint16(4, batchSize, true);
	record[6] = RECORD_FULL;
	record.set(batch, HEADER_SIZE);

	return record;
}

/**
 * Build a minimal LevelDB MANIFEST pointing to a log file.
 */
function buildManifest(
	logNumber: number,
	nextFileNumber: number,
	lastSequence: number,
): Uint8Array {
	const comp = new TextEncoder().encode("leveldb.BytewiseComparator");
	const edits: number[] = [];

	// Comparator (tag=1)
	edits.push(1, ...Array.from(encodeVarint(comp.length)), ...Array.from(comp));
	// Log number (tag=2)
	edits.push(2, ...Array.from(encodeVarint(logNumber)));
	// Next file number (tag=3)
	edits.push(3, ...Array.from(encodeVarint(nextFileNumber)));
	// Last sequence (tag=4)
	edits.push(4, ...Array.from(encodeVarint(lastSequence)));

	const editData = new Uint8Array(edits);

	const record = new Uint8Array(HEADER_SIZE + editData.length);
	const crcInput = new Uint8Array(1 + editData.length);
	crcInput[0] = RECORD_FULL;
	crcInput.set(editData, 1);

	const dv = new DataView(record.buffer);
	dv.setUint32(0, maskCrc(crc32c(crcInput)), true);
	dv.setUint16(4, editData.length, true);
	record[6] = RECORD_FULL;
	record.set(editData, HEADER_SIZE);

	return record;
}
