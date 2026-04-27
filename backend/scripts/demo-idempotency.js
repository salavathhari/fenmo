const request = require("supertest");
const { createApp } = require("../src/app");

async function run() {
  const app = createApp({ dbFilePath: ":memory:" });
  const requestId = `demo-${Date.now()}`;

  const payload = {
    request_id: requestId,
    amount: "199.99",
    category: "Food",
    description: "Demo duplicate clicks",
    date: "2026-04-27"
  };

  const statuses = [];

  for (let i = 0; i < 5; i += 1) {
    const response = await request(app).post("/expenses").send(payload);
    statuses.push(response.status);
  }

  const listResponse = await request(app).get("/expenses");
  const expenses = listResponse.body.expenses || [];

  const matchingById = expenses.filter((expense) => expense.id === 1);

  console.log("Idempotency Demo");
  console.log("Scenario: User clicks submit 5 times with same request_id");
  console.log(`POST statuses: ${statuses.join(", ")}`);
  console.log(`Total expenses stored: ${expenses.length}`);
  console.log(`Entries for this request: ${matchingById.length}`);

  if (matchingById.length === 1) {
    console.log("Result: Only 1 expense is created");
    process.exit(0);
  }

  console.error("Result: Failed (duplicates found)");
  process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
