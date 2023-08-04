import { Temporal } from "@js-temporal/polyfill";
import { Config } from "config-lib";
import pg, { PoolClient } from "pg";
import QueryStream from "pg-query-stream";

// Parse timestamps as Temporal.Instant
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (value) =>
  Temporal.Instant.from(value),
);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (value) =>
  Temporal.Instant.from(value),
);

// Parse dates as Temporal.PlainDate
pg.types.setTypeParser(pg.types.builtins.DATE, (value) =>
  Temporal.PlainDate.from(value),
);

// Parse bigint as JS BigInt
const PG_INT8_ARRAY_OID = 1016;
pg.types.setTypeParser(pg.types.builtins.INT8, BigInt);
pg.types.setTypeParser(PG_INT8_ARRAY_OID, (value) => {
  // Values should be in `{n,m,...}` format
  return value
    .substring(1, value.length - 1)
    .split(",")
    .map(BigInt);
});

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

  try {
    // Stream the query with the acquired client
    yield* streamWith(client, ...args);
  } finally {
    // Release the client when the stream is finished
    client.release();
  }
}

/**
 * Similar to `stream`, but uses a client that is passed in.
 */
export function streamWith<T>(
  client: PoolClient,
  ...args: ConstructorParameters<typeof QueryStream>
): AsyncIterable<T> {
  // Start the query stream
  const stream = new QueryStream(...args);
  const query = client.query(stream);

  // Yield each row
  return query;
}

export function close(): Promise<void> {
  return pool.end();
}
