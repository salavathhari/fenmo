const path = require("node:path");
const express = require("express");
const cors = require("cors");

const { createDb } = require("./db");
const { parseAmountToPaise, formatPaiseToAmount } = require("./money");

function isValidDateString(value) {
  if (!value || typeof value !== "string") {
    return false;
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function toExpenseResponse(row) {
  return {
    id: row.id,
    amount: formatPaiseToAmount(row.amount_paise),
    category: row.category,
    description: row.description,
    date: row.date,
    created_at: row.created_at
  };
}

function createApp(options = {}) {
  const app = express();

  const dbFilePath = options.dbFilePath || path.join(__dirname, "..", "data", "expenses.db");
  const migrationsDir = options.migrationsDir || path.join(__dirname, "..", "migrations");
  const frontendDir = options.frontendDir || path.join(__dirname, "..", "..", "frontend");

  const db = createDb({ dbFilePath, migrationsDir });

  app.locals.db = db;

  app.use(cors());
  app.use(express.json());

  const insertExpenseStmt = db.prepare(`
    INSERT INTO expenses (request_id, amount_paise, category, description, date)
    VALUES (@request_id, @amount_paise, @category, @description, @date)
    ON CONFLICT(request_id) DO NOTHING
  `);

  const getExpenseByIdStmt = db.prepare("SELECT * FROM expenses WHERE id = ?");
  const getExpenseByRequestIdStmt = db.prepare("SELECT * FROM expenses WHERE request_id = ?");

  app.post("/expenses", (req, res) => {
    const { amount, category, description, date, request_id, idempotency_key } = req.body || {};
    const idempotencyKey = request_id || idempotency_key || req.get("Idempotency-Key");

    if (!idempotencyKey || String(idempotencyKey).trim() === "") {
      return res
        .status(400)
        .json({ error: "request_id or idempotency_key (or Idempotency-Key header) is required" });
    }

    const parsedAmount = parseAmountToPaise(amount);
    if (!parsedAmount.ok) {
      return res.status(400).json({ error: parsedAmount.message });
    }

    if (!category || String(category).trim() === "") {
      return res.status(400).json({ error: "category is required" });
    }

    if (!description || String(description).trim() === "") {
      return res.status(400).json({ error: "description is required" });
    }

    if (!isValidDateString(date)) {
      return res.status(400).json({ error: "date is required in YYYY-MM-DD format" });
    }

    const payload = {
      request_id: String(idempotencyKey),
      amount_paise: parsedAmount.value,
      category: String(category).trim(),
      description: String(description).trim(),
      date: String(date)
    };

    try {
      const result = insertExpenseStmt.run(payload);

      if (result.changes === 1) {
        const created = getExpenseByIdStmt.get(result.lastInsertRowid);
        return res.status(201).json({
          ...toExpenseResponse(created),
          created: true,
          replayed: false
        });
      }

      const existing = getExpenseByRequestIdStmt.get(payload.request_id);
      if (existing) {
        return res.status(200).json({
          ...toExpenseResponse(existing),
          created: false,
          replayed: true
        });
      }

      return res.status(500).json({ error: "failed to resolve idempotent request" });
    } catch (error) {
      return res.status(500).json({ error: "failed to create expense" });
    }
  });

  app.get("/expenses", (req, res) => {
    try {
      const params = [];
      let sql = "SELECT * FROM expenses";

      if (req.query.category) {
        sql += " WHERE category = ? COLLATE NOCASE";
        params.push(String(req.query.category));
      }

      if (req.query.sort === "date_desc") {
        sql += " ORDER BY date DESC, created_at DESC, id DESC";
      } else {
        sql += " ORDER BY date ASC, id ASC";
      }

      const rows = db.prepare(sql).all(...params);
      const expenses = rows.map(toExpenseResponse);

      return res.status(200).json({ expenses });
    } catch (error) {
      return res.status(500).json({ error: "failed to list expenses" });
    }
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use(express.static(frontendDir));

  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      return res.status(400).json({ error: "invalid JSON payload" });
    }

    return res.status(500).json({ error: "internal server error" });
  });

  return app;
}

module.exports = {
  createApp
};
