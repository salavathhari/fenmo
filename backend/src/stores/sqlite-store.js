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

  const hasMigrationStmt = db.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const insertMigrationStmt = db.prepare("INSERT INTO schema_migrations(name) VALUES (?)");

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

function createSqliteStore({ dbFilePath, migrationsDir }) {
  ensureDatabaseDirectory(dbFilePath);

  const db = new Database(dbFilePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db, migrationsDir);

  const insertExpenseStmt = db.prepare(`
    INSERT INTO expenses (request_id, amount_paise, category, description, date)
    VALUES (@request_id, @amount_paise, @category, @description, @date)
    ON CONFLICT(request_id) DO NOTHING
  `);
  const getExpenseByIdStmt = db.prepare("SELECT * FROM expenses WHERE id = ?");
  const getExpenseByRequestIdStmt = db.prepare("SELECT * FROM expenses WHERE request_id = ?");
  let isClosed = false;

  return {
    async createExpense(payload) {
      const result = insertExpenseStmt.run(payload);

      if (result.changes === 1) {
        return {
          created: true,
          row: getExpenseByIdStmt.get(result.lastInsertRowid)
        };
      }

      return {
        created: false,
        row: getExpenseByRequestIdStmt.get(payload.request_id) || null
      };
    },

    async listExpenses({ category, sort }) {
      const params = [];
      let sql = "SELECT * FROM expenses";

      if (category) {
        sql += " WHERE category = ? COLLATE NOCASE";
        params.push(category);
      }

      if (sort === "date_desc") {
        sql += " ORDER BY date DESC, created_at DESC, id DESC";
      } else {
        sql += " ORDER BY date ASC, id ASC";
      }

      return db.prepare(sql).all(...params);
    },

    async debugGetExpensesByRequestId(requestId) {
      return db.prepare("SELECT * FROM expenses WHERE request_id = ? ORDER BY id ASC").all(requestId);
    },

    async debugGetExpensesByCategory(category) {
      return db.prepare("SELECT * FROM expenses WHERE category = ? ORDER BY request_id ASC").all(category);
    },

    async debugGetAllExpenses() {
      return db.prepare("SELECT * FROM expenses ORDER BY id ASC").all();
    },

    close() {
      if (isClosed) {
        return;
      }

      isClosed = true;
      db.close();
    }
  };
}

module.exports = {
  createSqliteStore
};
