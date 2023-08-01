import { Config } from "config-lib";
import pg from "pg";

export const db = new pg.Pool({
  connectionString: Config.DATABASE_URL(),
  ...(process.env.NODE_ENV === "production"
    ? {
        ssl: {
          rejectUnauthorized: false,
        },
      }
    : {}),
  // note: these numbers have been chosen arbitrarily
  min: 0,
  max: 7,
});

/**
 * Safely runs a database transaction, rolling back the transaction if an error
 * is thrown.
 */
export async function transaction<T>(
  closure: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await closure(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function closeDb(): Promise<void> {
  return db.end();
}
