import { Config } from "config-lib";
import pg from "pg";
import QueryStream from "pg-query-stream";

export const pool = new pg.Pool({
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

// Re-export the query function for convenience
export const query = pool.query.bind(pool);

/**
 * Safely runs a database transaction, rolling back the transaction if an error
 * is thrown.
 */
export async function transaction<T>(
  closure: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
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

/**
 * Safely streams the results of a query, releasing the client when the stream
 * is finished.
 */
export async function* stream<T>(
  ...args: ConstructorParameters<typeof QueryStream>
): AsyncIterable<T> {
  // Acquire a client for the stream
  const client = await pool.connect();

  // Start the query stream
  const stream = new QueryStream(...args);
  const query = client.query(stream);

  // Yield each row
  yield* query;

  // Release the client
  client.release();
}

export function close(): Promise<void> {
  return pool.end();
}
