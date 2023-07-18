import { knex } from "knex";

// Determine the URL to connect to the database
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

export const db = knex({
  client: "pg",
  connection: {
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  },
  pool: {
    // note: these numbers have been chosen arbitrarily
    min: 0,
    max: 7,
  },
});

/**
 * The JS representation of a Blueprint ID. See `docs/db-design.rst` for more
 * information.
 */
export type BlueprintID = string;

/**
 * The JS representation of a list of Blueprint IDs. See `docs/db-design.rst`
 * for more information.
 */
export type BlueprintIDList = string;
