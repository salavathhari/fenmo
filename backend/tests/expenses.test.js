const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { createApp } = require("../src/app");

function setupTestApp() {
  return createApp({ dbFilePath: ":memory:" });
}

test("create expense returns persisted expense", async () => {
  const app = setupTestApp();

  const payload = {
    request_id: "req-create-1",
    amount: "123.45",
    category: "Food",
    description: "Lunch",
    date: "2026-04-27"
  };

  const response = await request(app).post("/expenses").send(payload);

  assert.equal(response.status, 201);
  assert.equal(response.body.id, 1);
  assert.equal(response.body.amount, "123.45");
  assert.equal(response.body.category, "Food");
  assert.equal(response.body.description, "Lunch");
  assert.equal(response.body.date, "2026-04-27");
  assert.equal(response.body.created, true);
  assert.equal(response.body.replayed, false);
  assert.ok(response.body.created_at);
});

test("duplicate request_id returns same expense and does not create a duplicate", async () => {
  const app = setupTestApp();

  const payload = {
    request_id: "req-duplicate-1",
    amount: "500.00",
    category: "Travel",
    description: "Cab",
    date: "2026-04-28"
  };

  const first = await request(app).post("/expenses").send(payload);
  const second = await request(app).post("/expenses").send(payload);
  const list = await request(app).get("/expenses");

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.body.id, second.body.id);
  assert.equal(first.body.created, true);
  assert.equal(first.body.replayed, false);
  assert.equal(second.body.created, false);
  assert.equal(second.body.replayed, true);
  assert.equal(list.status, 200);
  assert.equal(list.body.expenses.length, 1);
});

test("idempotency_key alias in request body is accepted", async () => {
  const app = setupTestApp();

  const payload = {
    idempotency_key: "req-alias-1",
    amount: "50.00",
    category: "Food",
    description: "Alias key",
    date: "2026-04-27"
  };

  const first = await request(app).post("/expenses").send(payload);
  const second = await request(app).post("/expenses").send(payload);

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(first.body.id, second.body.id);
});

test("list expenses supports category filter and newest-first sort", async () => {
  const app = setupTestApp();

  await request(app).post("/expenses").send({
    request_id: "req-list-1",
    amount: "100.00",
    category: "Food",
    description: "Breakfast",
    date: "2026-04-20"
  });

  await request(app).post("/expenses").send({
    request_id: "req-list-2",
    amount: "200.00",
    category: "Bills",
    description: "Internet",
    date: "2026-04-22"
  });

  await request(app).post("/expenses").send({
    request_id: "req-list-3",
    amount: "300.00",
    category: "Food",
    description: "Dinner",
    date: "2026-04-25"
  });

  const filtered = await request(app).get("/expenses").query({ category: "Food" });
  const sorted = await request(app).get("/expenses").query({ sort: "date_desc" });

  assert.equal(filtered.status, 200);
  assert.equal(filtered.body.expenses.length, 2);
  assert.ok(filtered.body.expenses.every((item) => item.category === "Food"));

  assert.equal(sorted.status, 200);
  assert.equal(sorted.body.expenses[0].date, "2026-04-25");
  assert.equal(sorted.body.expenses[1].date, "2026-04-22");
  assert.equal(sorted.body.expenses[2].date, "2026-04-20");
});
