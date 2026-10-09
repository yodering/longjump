import { Database } from 'bun:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

const migrations = new URL('./migrations/', import.meta.url);

/** Opens the leaderboard database and applies any migrations it has not recorded. */
export function openDatabase(path: string) {
  const db = new Database(path, { create: true, strict: true });
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY, appliedAt INTEGER NOT NULL)');
  const applied = new Set(db.query<{ name: string }, []>('SELECT name FROM schema_migration').all().map(row => row.name));
  for (const name of readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(new URL(name, migrations), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.query('INSERT INTO schema_migration (name, appliedAt) VALUES (?, ?)').run(name, Date.now());
    })();
  }
  return db;
}
