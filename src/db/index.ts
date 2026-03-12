import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as path from "node:path";
import { configDir, ensureDir } from "../utils/paths.js";
import * as schema from "./schema.js";
import { migrations } from "./migrations.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Run embedded migrations. Each migration runs once — tracked in `_migrations` table.
 * Drizzle Kit generates the SQL; Bun embeds it as string constants at build time.
 */
function runMigrations(sqlite: Database): void {
  sqlite.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  for (const [id, sql] of migrations) {
    const applied = sqlite.query("SELECT 1 FROM _migrations WHERE id = ?").get(id);
    if (applied) continue;

    // Run each migration atomically — all statements succeed or none do
    sqlite.run("BEGIN");
    try {
      const statements = sql.split("--> statement-breakpoint");
      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (trimmed) sqlite.run(trimmed);
      }
      sqlite.run("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)", [
        id,
        new Date().toISOString(),
      ]);
      sqlite.run("COMMIT");
    } catch (err) {
      sqlite.run("ROLLBACK");
      throw err;
    }
  }
}

export function getDb() {
  if (!_db) {
    const dir = configDir();
    ensureDir(dir);
    const dbPath = path.join(dir, "git-switch.db");
    const sqlite = new Database(dbPath);
    sqlite.run("PRAGMA journal_mode = WAL");
    sqlite.run("PRAGMA foreign_keys = ON");
    runMigrations(sqlite);
    _db = drizzle(sqlite, { schema });
  }
  return _db;
}

export { schema };
