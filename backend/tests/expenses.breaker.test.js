const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");

const { createApp } = require("../src/app");

function createMemoryContext(t) {
  const app = createApp({ dbFilePath: ":memory:" });
  const db = app.locals.db;

  t.after(() => {
    db.close();
  });

  return {
    app,
    api: request(app),
    db
  };
}

function createFileDbContext(t) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "expense-breaker-"));
  const dbFilePath = path.join(tempDir, "test.db");
  const app = createApp({ dbFilePath });
  const db = app.locals.db;

  t.after(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  return {
    app,
    api: request(app),
    db
  };
}

function toPaise(amount) {
  const match = String(amount).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    return 0;
  }

  const rupees = Number(match[1]);
  const paisePart = (match[2] || "").padEnd(2, "0");
  return rupees * 100 + Number(paisePart);
}

function payload(overrides = {}) {
  return {
    amount: "99.99",
    category: "Default",
    description: "Default description",
    date: "2026-04-27",
    ...overrides
  };
}

test("should prevent duplicates under heavy concurrency with same idempotency key", async (t) => {
  const { api } = createMemoryContext(t);

  const shared = payload({ request_id: "conc-heavy-1", amount: "123.45" });

  // Real parallel pressure: 50 concurrent duplicate requests.
  const responses = await Promise.all(
    Array.from({ length: 50 }, () => api.post("/expenses").send(shared))
  );

  const ids = new Set(responses.map((res) => res.body.id));
  const status201Count = responses.filter((res) => res.status === 201).length;
  const status200Count = responses.filter((res) => res.status === 200).length;

  const list = await api.get("/expenses");

  assert.equal(ids.size, 1);
  assert.equal(status201Count, 1);
  assert.equal(status200Count, 49);
  assert.equal(list.body.expenses.length, 1);
});

test("should handle rapid click simulation (10 quick submits) with one stored row", async (t) => {
  const { api } = createMemoryContext(t);

  const shared = payload({ request_id: "rapid-click-1", amount: "45.67", category: "Clicks" });

  // Simulates frontend submitting quickly before UX can react.
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => api.post("/expenses").send(shared))
  );

  const list = await api.get("/expenses").query({ category: "Clicks" });
  assert.equal(list.body.expenses.length, 1);
  assert.equal(new Set(responses.map((res) => res.body.id)).size, 1);
});

test("should remain consistent when client retries after assumed response loss", async (t) => {
  const { api } = createMemoryContext(t);

  const shared = payload({ request_id: "retry-loss-1", amount: "77.77", category: "Retry" });

  // Fire first request and intentionally treat its response as lost by not using it.
  const firstPromise = api.post("/expenses").send(shared);

  // Retry immediately with same idempotency key before awaiting first completion.
  const retryResponse = await api.post("/expenses").send(shared);
  const firstResponse = await firstPromise;

  const list = await api.get("/expenses").query({ category: "Retry" });

  assert.equal(list.body.expenses.length, 1);
  assert.equal(firstResponse.body.id, retryResponse.body.id);
  assert.ok([200, 201].includes(firstResponse.status));
  assert.ok([200, 201].includes(retryResponse.status));
});

test("should resist race conditions via DB-level uniqueness under simultaneous inserts", async (t) => {
  const { api, db } = createMemoryContext(t);

  const sharedKey = "race-db-1";
  const req = payload({ request_id: sharedKey, amount: "10.01", category: "Race" });

  // Simultaneous insert attempts for the same key.
  await Promise.all(Array.from({ length: 30 }, () => api.post("/expenses").send(req)));

  const rows = db.prepare("SELECT id, request_id FROM expenses WHERE request_id = ?").all(sharedKey);
  assert.equal(rows.length, 1);
});

test("should preserve money precision for edge values and exact totals", async (t) => {
  const { api, db } = createMemoryContext(t);

  const values = [
    { request_id: "money-a", amount: "10.10" },
    { request_id: "money-b", amount: "0.20" },
    { request_id: "money-c", amount: "999999.99" }
  ];

  for (const item of values) {
    await api.post("/expenses").send(
      payload({
        request_id: item.request_id,
        amount: item.amount,
        category: "Money",
        description: `money ${item.amount}`,
        date: "2026-05-01"
      })
    );
  }

  const rows = db.prepare("SELECT amount_paise FROM expenses WHERE category = 'Money'").all();
  const dbTotal = rows.reduce((sum, row) => sum + row.amount_paise, 0);

  const response = await api.get("/expenses").query({ category: "Money" });
  const apiTotal = response.body.expenses.reduce((sum, item) => sum + toPaise(item.amount), 0);

  assert.equal(dbTotal, 100001029);
  assert.equal(apiTotal, 100001029);
});

test("should reject invalid payloads (negative amount, missing fields, invalid date)", async (t) => {
  const { api } = createMemoryContext(t);

  const negative = await api.post("/expenses").send(
    payload({ request_id: "val-neg", amount: "-1.00", category: "Invalid" })
  );

  const missingCategory = await api.post("/expenses").send({
    request_id: "val-missing",
    amount: "12.00",
    description: "Missing category",
    date: "2026-05-01"
  });

  const invalidDate = await api.post("/expenses").send(
    payload({ request_id: "val-date", date: "2026-13-99", category: "Invalid" })
  );

  assert.equal(negative.status, 400);
  assert.equal(missingCategory.status, 400);
  assert.equal(invalidDate.status, 400);
});

test("should apply category filtering with case-insensitive behavior", async (t) => {
  const { api } = createMemoryContext(t);

  await api.post("/expenses").send(payload({ request_id: "case-1", category: "Food", amount: "1.00" }));
  await api.post("/expenses").send(payload({ request_id: "case-2", category: "food", amount: "2.00" }));
  await api.post("/expenses").send(payload({ request_id: "case-3", category: "FOOD", amount: "3.00" }));

  const exactFood = await api.get("/expenses").query({ category: "Food" });
  const exactLower = await api.get("/expenses").query({ category: "food" });

  assert.equal(exactFood.body.expenses.length, 3);
  assert.equal(exactLower.body.expenses.length, 3);
  assert.ok(exactFood.body.expenses.some((expense) => expense.category === "Food"));
  assert.ok(exactFood.body.expenses.some((expense) => expense.category === "food"));
  assert.ok(exactFood.body.expenses.some((expense) => expense.category === "FOOD"));
});

test("should return strict newest-first order for sort=date_desc", async (t) => {
  const { api } = createMemoryContext(t);

  await api.post("/expenses").send(payload({ request_id: "sort-a", date: "2026-01-03", amount: "3.00" }));
  await api.post("/expenses").send(payload({ request_id: "sort-b", date: "2026-01-01", amount: "1.00" }));
  await api.post("/expenses").send(payload({ request_id: "sort-c", date: "2026-01-02", amount: "2.00" }));

  const sorted = await api.get("/expenses").query({ sort: "date_desc" });
  const dates = sorted.body.expenses.map((item) => item.date);

  assert.deepEqual(dates, ["2026-01-03", "2026-01-02", "2026-01-01"]);
});

test("should fail cleanly when DB is unavailable and avoid inconsistent state", async (t) => {
  const { api, db } = createFileDbContext(t);

  await api.post("/expenses").send(payload({ request_id: "db-ok-1", amount: "55.00", category: "Stable" }));

  // Simulate DB crash/unavailability.
  db.close();

  const failure = await api.post("/expenses").send(
    payload({ request_id: "db-crash-1", amount: "66.00", category: "Stable" })
  );

  assert.equal(failure.status, 500);
});

test("data integrity check after mixed stress load: no duplicate keys and totals consistent", async (t) => {
  const { api, db } = createMemoryContext(t);

  const sharedKeys = ["integrity-dup-1", "integrity-dup-2", "integrity-dup-3"];
  const uniqueKeys = Array.from({ length: 20 }, (_, i) => `integrity-unique-${i + 1}`);

  // Mixed load: duplicates + unique inserts concurrently.
  const duplicateRequests = sharedKeys.flatMap((key, idx) =>
    Array.from({ length: 15 }, () =>
      api.post("/expenses").send(
        payload({
          request_id: key,
          amount: `${10 + idx}.10`,
          category: "Integrity",
          date: "2026-06-01"
        })
      )
    )
  );

  const uniqueRequests = uniqueKeys.map((key, idx) =>
    api.post("/expenses").send(
      payload({
        request_id: key,
        amount: `${idx + 1}.00`,
        category: "Integrity",
        date: "2026-06-02"
      })
    )
  );

  await Promise.all([...duplicateRequests, ...uniqueRequests]);

  const rows = db.prepare("SELECT request_id, amount_paise FROM expenses").all();
  const dbKeySet = new Set(rows.map((row) => row.request_id));
  const dbTotal = rows.reduce((sum, row) => sum + row.amount_paise, 0);

  const response = await api.get("/expenses");
  const apiTotal = response.body.expenses.reduce((sum, item) => sum + toPaise(item.amount), 0);

  assert.equal(rows.length, dbKeySet.size);
  assert.equal(rows.length, sharedKeys.length + uniqueKeys.length);
  assert.equal(apiTotal, dbTotal);
});
