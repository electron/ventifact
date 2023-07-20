import knexPkg from "knex";
const { knex } = knexPkg;

// Determine the URL to connect to the database
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

export const db = knex({
  client: "pg",
  connection: {
    connectionString: process.env.DATABASE_URL,
    ...(process.env.NODE_ENV === "production"
      ? {
          ssl: {
            rejectUnauthorized: false,
          },
        }
      : {}),
  },
  pool: {
    // note: these numbers have been chosen arbitrarily
    min: 0,
    max: 7,
  },
});

export const dbSchema = db.schema;
