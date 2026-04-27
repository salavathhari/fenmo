const path = require("node:path");
const express = require("express");
const cors = require("cors");

const { createStore } = require("./store");
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

  const databaseUrl = options.databaseUrl || process.env.DATABASE_URL;
  const defaultSqlitePath =
    process.env.VERCEL && !databaseUrl
      ? path.join("/tmp", "expenses.db")
      : path.join(__dirname, "..", "data", "expenses.db");
  const dbFilePath = options.dbFilePath || defaultSqlitePath;
  const migrationsDir = options.migrationsDir || path.join(__dirname, "..", "migrations");
  const frontendDir = options.frontendDir || path.join(__dirname, "..", "..", "frontend");

  const store = createStore({ dbFilePath, migrationsDir, databaseUrl });

  app.locals.store = store;

  app.use(cors());
  app.use(express.json());

  app.post("/expenses", async (req, res) => {
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
      const result = await store.createExpense(payload);

      if (result.created && result.row) {
        return res.status(201).json({
          ...toExpenseResponse(result.row),
          created: true,
          replayed: false
        });
      }

      if (result.row) {
        return res.status(200).json({
          ...toExpenseResponse(result.row),
          created: false,
          replayed: true
        });
      }

      return res.status(500).json({ error: "failed to resolve idempotent request" });
    } catch (error) {
      return res.status(500).json({ error: "failed to create expense" });
    }
  });

  app.get("/expenses", async (req, res) => {
    try {
      const rows = await store.listExpenses({
        category: req.query.category ? String(req.query.category) : "",
        sort: req.query.sort ? String(req.query.sort) : ""
      });
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
