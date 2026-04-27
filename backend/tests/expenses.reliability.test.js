const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../src/app");

function createTestContext(t) {
  const app = createApp({ dbFilePath: ":memory:" });
  const store = app.locals.store;

  // Ensure each test closes its DB connection.
  t.after(() => {
    return store.close();
  });

  return {
    app,
    api: request(app),
    store
  };
}

function paiseFromAmountString(amount) {
  const match = String(amount).match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) {
    return 0;
  }

  const rupees = Number(match[1]);
  const paisePart = (match[2] || "").padEnd(2, "0");
  return rupees * 100 + Number(paisePart);
}

test("idempotency: repeated same request_id returns one record and same expense", async (t) => {
  const { api } = createTestContext(t);

  const payload = {
    request_id: "idem-001",
    amount: "250.00",
    category: "Food",
    description: "Lunch",
    date: "2026-04-27"
  };

  const first = await api.post("/expenses").send(payload);
  const second = await api.post("/expenses").send(payload);
  const third = await api.post("/expenses").send(payload);
  const list = await api.get("/expenses");

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(third.status, 200);
  assert.equal(first.body.created, true);
  assert.equal(first.body.replayed, false);
  assert.equal(second.body.created, false);
  assert.equal(second.body.replayed, true);
  assert.equal(first.body.id, second.body.id);
  assert.equal(second.body.id, third.body.id);
  assert.equal(list.body.expenses.length, 1);
});

test("multiple click simulation: rapid submits create only one expense", async (t) => {
  const { api } = createTestContext(t);

  const payload = {
    request_id: "clicks-001",
    amount: "199.99",
    category: "Shopping",
    description: "Quick clicks",
    date: "2026-04-26"
  };

  // Simulate user hitting submit repeatedly in a short burst.
  const responses = await Promise.all(
    Array.from({ length: 5 }, () => api.post("/expenses").send(payload))
  );

  const list = await api.get("/expenses");
  const createdCount = responses.filter((res) => res.status === 201).length;
  const idSet = new Set(responses.map((res) => res.body.id));

  assert.equal(createdCount, 1);
  assert.equal(idSet.size, 1);
  assert.equal(list.body.expenses.length, 1);
});

test("retry behavior: resubmitting after success keeps data consistent", async (t) => {
  const { api } = createTestContext(t);

  const payload = {
    request_id: "retry-001",
    amount: "89.50",
    category: "Transport",
    description: "Cab ride",
    date: "2026-04-25"
  };

  const original = await api.post("/expenses").send(payload);

  // Simulate retry due to client not knowing if first response was received.
  const retry = await api.post("/expenses").send(payload);

  const list = await api.get("/expenses");
  const matching = list.body.expenses.filter((expense) => expense.id === original.body.id);

  assert.equal(original.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, original.body.id);
  assert.equal(matching.length, 1);
  assert.equal(list.body.expenses.length, 1);
});

test("money handling: paise storage is exact for decimal values", async (t) => {
  const { api, store } = createTestContext(t);

  const values = [
    { request_id: "money-1", amount: "10.10", expectedPaise: 1010 },
    { request_id: "money-2", amount: "0.99", expectedPaise: 99 },
    { request_id: "money-3", amount: "999999.99", expectedPaise: 99999999 }
  ];

  for (const item of values) {
    await api.post("/expenses").send({
      request_id: item.request_id,
      amount: item.amount,
      category: "Money",
      description: `amount ${item.amount}`,
      date: "2026-04-24"
    });
  }

  const rows = await store.debugGetExpensesByCategory("Money");

  assert.equal(rows.length, 3);
  assert.deepEqual(
    rows.map((row) => row.amount_paise).sort((a, b) => a - b),
    values.map((v) => v.expectedPaise).sort((a, b) => a - b)
  );
});

test("validation: rejects negative amount, missing fields, and invalid date", async (t) => {
  const { api } = createTestContext(t);

  const negativeAmount = await api.post("/expenses").send({
    request_id: "val-1",
    amount: "-1.00",
    category: "Food",
    description: "Invalid",
    date: "2026-04-23"
  });

  const missingDescription = await api.post("/expenses").send({
    request_id: "val-2",
    amount: "10.00",
    category: "Food",
    date: "2026-04-23"
  });

  const invalidDate = await api.post("/expenses").send({
    request_id: "val-3",
    amount: "10.00",
    category: "Food",
    description: "Invalid date",
    date: "2026-99-99"
  });

  assert.equal(negativeAmount.status, 400);
  assert.equal(missingDescription.status, 400);
  assert.equal(invalidDate.status, 400);
});

test("GET /expenses filtering returns only requested category", async (t) => {
  const { api } = createTestContext(t);

  await api.post("/expenses").send({
    request_id: "filter-1",
    amount: "25.00",
    category: "Food",
    description: "Meal",
    date: "2026-04-20"
  });
  await api.post("/expenses").send({
    request_id: "filter-2",
    amount: "45.00",
    category: "Bills",
    description: "Internet",
    date: "2026-04-21"
  });
  await api.post("/expenses").send({
    request_id: "filter-3",
    amount: "15.00",
    category: "Food",
    description: "Snack",
    date: "2026-04-22"
  });

  const filtered = await api.get("/expenses").query({ category: "Food" });

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.expenses.length, 2);
  assert.ok(filtered.body.expenses.every((expense) => expense.category === "Food"));
});

test("GET /expenses sorting with date_desc returns newest first", async (t) => {
  const { api } = createTestContext(t);

  await api.post("/expenses").send({
    request_id: "sort-1",
    amount: "10.00",
    category: "Food",
    description: "Old",
    date: "2026-01-01"
  });
  await api.post("/expenses").send({
    request_id: "sort-2",
    amount: "20.00",
    category: "Food",
    description: "Mid",
    date: "2026-02-01"
  });
  await api.post("/expenses").send({
    request_id: "sort-3",
    amount: "30.00",
    category: "Food",
    description: "New",
    date: "2026-03-01"
  });

  const sorted = await api.get("/expenses").query({ sort: "date_desc" });
  const dates = sorted.body.expenses.map((expense) => expense.date);

  assert.deepEqual(dates, ["2026-03-01", "2026-02-01", "2026-01-01"]);
});

test("total calculation from returned expenses is accurate including filtered view", async (t) => {
  const { api } = createTestContext(t);

  await api.post("/expenses").send({
    request_id: "total-1",
    amount: "10.10",
    category: "Food",
    description: "A",
    date: "2026-04-10"
  });
  await api.post("/expenses").send({
    request_id: "total-2",
    amount: "20.20",
    category: "Food",
    description: "B",
    date: "2026-04-11"
  });
  await api.post("/expenses").send({
    request_id: "total-3",
    amount: "5.05",
    category: "Travel",
    description: "C",
    date: "2026-04-12"
  });

  const all = await api.get("/expenses");
  const filtered = await api.get("/expenses").query({ category: "Food" });

  const allTotalPaise = all.body.expenses.reduce((sum, expense) => sum + paiseFromAmountString(expense.amount), 0);
  const filteredTotalPaise = filtered.body.expenses.reduce(
    (sum, expense) => sum + paiseFromAmountString(expense.amount),
    0
  );

  assert.equal(allTotalPaise, 3535);
  assert.equal(filteredTotalPaise, 3030);
});

test("error handling: malformed JSON gives 400 and DB failure gives 500", async (t) => {
  const { app, api } = createTestContext(t);

  const malformedJson = await api
    .post("/expenses")
    .set("Content-Type", "application/json")
    .send('{"request_id":"bad-json"');

  assert.equal(malformedJson.status, 400);

  // Force DB failure and verify route returns a server error.
  await app.locals.store.close();

  const dbFailure = await api.get("/expenses");
  assert.equal(dbFailure.status, 500);
});

test("category filter is case-insensitive", async (t) => {
  const { api } = createTestContext(t);

  await api.post("/expenses").send({
    request_id: "ci-filter-1",
    amount: "12.00",
    category: "Food",
    description: "Case one",
    date: "2026-04-20"
  });

  await api.post("/expenses").send({
    request_id: "ci-filter-2",
    amount: "13.00",
    category: "food",
    description: "Case two",
    date: "2026-04-21"
  });

  await api.post("/expenses").send({
    request_id: "ci-filter-3",
    amount: "14.00",
    category: "FOOD",
    description: "Case three",
    date: "2026-04-22"
  });

  const filtered = await api.get("/expenses").query({ category: "fOoD" });

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.expenses.length, 3);
});

test("concurrency safety: many parallel requests with same key create one row", async (t) => {
  const { api } = createTestContext(t);

  const payload = {
    request_id: "concurrency-001",
    amount: "111.11",
    category: "Concurrency",
    description: "Parallel requests",
    date: "2026-04-27"
  };

  // Simulate highly concurrent duplicate requests.
  const responses = await Promise.all(
    Array.from({ length: 25 }, () => api.post("/expenses").send(payload))
  );

  const list = await api.get("/expenses");
  const createdCount = responses.filter((res) => res.status === 201).length;
  const duplicateCount = responses.filter((res) => res.status === 200).length;

  assert.equal(createdCount, 1);
  assert.equal(duplicateCount, 24);
  assert.equal(list.body.expenses.length, 1);
});
