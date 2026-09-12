import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/**
 * Open (or create) the SQLite database and bring it to the current schema by
 * applying the migrations in `apps/api/drizzle`. ":memory:" gives an isolated
 * database for tests. A file that is not a SQLite database is refused.
 */
export function openDb(path: string): { db: Db; sqlite: Database.Database } {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    return { db, sqlite };
  } catch (err) {
    sqlite.close();
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot open ${path} as a SQLite database: ${msg}. Delete it, or point GG_DB_PATH somewhere else.`);
  }
}

export { schema };
