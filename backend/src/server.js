const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 4000);
const app = createApp();

const server = app.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Expense Tracker API running on port ${PORT}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
