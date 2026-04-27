function createStore(options = {}) {
  if (options.databaseUrl || process.env.DATABASE_URL) {
    const { createPostgresStore } = require("./stores/postgres-store");
    return createPostgresStore(options);
  }

  const { createSqliteStore } = require("./stores/sqlite-store");
  return createSqliteStore(options);
}

module.exports = {
  createStore
};
