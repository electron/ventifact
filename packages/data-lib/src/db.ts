import knexPkg, { Knex } from "knex";
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

export function dbSchema(): Knex.SchemaBuilder {
  // DO NOT REFACTOR THIS INTO A CONSTANT!
  //
  // `db.schema` is actually a property accessor that returns a new instance of
  // `Knex.SchemaBuilder` every time it's called, which causes race conditions
  // when used multiple times--which is very bad!!
  return db.schema;
}

export async function closeDb() {
  return db.destroy();
}
