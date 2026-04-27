const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 4000);
const app = createApp();

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Expense Tracker API running at http://localhost:${PORT}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
