const { Pool } = require("pg");

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id BIGSERIAL PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(category)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date DESC)");
}

function normalizeRow(row) {
  return {
    ...row,
    id: Number(row.id),
    amount_paise: Number(row.amount_paise),
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date)
  };
}

function createPostgresStore({ databaseUrl }) {
  const pool = new Pool({
    connectionString: databaseUrl || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  let initPromise;
  let closePromise;

  function init() {
    if (!initPromise) {
      initPromise = ensureSchema(pool);
    }

    return initPromise;
  }

  return {
    async createExpense(payload) {
      await init();

      const inserted = await pool.query(
        `
          INSERT INTO expenses (request_id, amount_paise, category, description, date)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (request_id) DO NOTHING
          RETURNING *
        `,
        [payload.request_id, payload.amount_paise, payload.category, payload.description, payload.date]
      );

      if (inserted.rows.length > 0) {
        return {
          created: true,
          row: normalizeRow(inserted.rows[0])
        };
      }

      const existing = await pool.query("SELECT * FROM expenses WHERE request_id = $1", [payload.request_id]);

      return {
        created: false,
        row: existing.rows[0] ? normalizeRow(existing.rows[0]) : null
      };
    },

    async listExpenses({ category, sort }) {
      await init();

      const params = [];
      let sql = "SELECT * FROM expenses";

      if (category) {
        params.push(category);
        sql += ` WHERE LOWER(category) = LOWER($${params.length})`;
      }

      if (sort === "date_desc") {
        sql += " ORDER BY date DESC, created_at DESC, id DESC";
      } else {
        sql += " ORDER BY date ASC, id ASC";
      }

      const result = await pool.query(sql, params);
      return result.rows.map(normalizeRow);
    },

    async debugGetExpensesByRequestId(requestId) {
      await init();
      const result = await pool.query("SELECT * FROM expenses WHERE request_id = $1 ORDER BY id ASC", [requestId]);
      return result.rows.map(normalizeRow);
    },

    async debugGetExpensesByCategory(category) {
      await init();
      const result = await pool.query("SELECT * FROM expenses WHERE category = $1 ORDER BY request_id ASC", [category]);
      return result.rows.map(normalizeRow);
    },

    async debugGetAllExpenses() {
      await init();
      const result = await pool.query("SELECT * FROM expenses ORDER BY id ASC");
      return result.rows.map(normalizeRow);
    },

    async close() {
      if (!closePromise) {
        closePromise = pool.end();
      }

      await closePromise;
    }
  };
}

module.exports = {
  createPostgresStore
};
