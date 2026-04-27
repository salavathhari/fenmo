const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");

function ensureDatabaseDirectory(dbFilePath) {
  if (dbFilePath === ":memory:") {
    return;
  }

  const dir = path.dirname(dbFilePath);
  fs.mkdirSync(dir, { recursive: true });
}

function runMigrations(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const hasMigrationStmt = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE name = ?"
  );

  const insertMigrationStmt = db.prepare(
    "INSERT INTO schema_migrations(name) VALUES (?)"
  );

  for (const migrationName of migrationFiles) {
    const alreadyApplied = hasMigrationStmt.get(migrationName);
    if (alreadyApplied) {
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, migrationName), "utf8");

    const applyMigration = db.transaction(() => {
      db.exec(sql);
      insertMigrationStmt.run(migrationName);
    });

    applyMigration();
  }
}

function createDb({ dbFilePath, migrationsDir }) {
  ensureDatabaseDirectory(dbFilePath);

  const db = new Database(dbFilePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db, migrationsDir);
  return db;
}

module.exports = {
  createDb
};
