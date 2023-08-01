import { Temporal, toTemporalInstant } from "@js-temporal/polyfill";
import * as DB from "./db.js";
import QueryStream from "pg-query-stream";
import { Tables } from "./db-schema.js";

export interface PR {
  /**
   * The PR number, e.g. `#12345`.
   */
  number: number;

  /**
   * The date and time that the PR was merged.
   */
  mergedAt: Temporal.Instant;

  /**
   * The status of the checks and runs on the PR.
   */
  status: "success" | "failure" | "neutral" | "unknown";
}

/**
 * Creates a new blueprint in the database, ignoring if a PR with the same
 * number already exists.
 */
export async function insertPR(pr: PR): Promise<void> {
  await DB.query({
    text:
      "INSERT INTO prs (number, merged_at, status) " +
      "VALUES ($1, $2, $3) " +
      "ON CONFLICT (number) DO NOTHING",
    values: [pr.number, pr.mergedAt.toString(), pr.status],
  });
}

/**
 * Fetches a stream of PRs from the database, ordered by `merged_at` in
 * ascending order.
 */
export async function* streamPRsByMergedAtAsc(): AsyncIterable<PR> {
  const stream = DB.stream<Tables["prs"]>(
    "SELECT * FROM prs ORDER BY merged_at ASC",
  );

  // Convert the database representation to the in-memory representation, namely
  // converting the `merged_at` column from a Date to a Temporal.Instant.
  for await (const { number, merged_at, status } of stream) {
    yield {
      number,
      mergedAt: toTemporalInstant.call(merged_at),
      status,
    };
  }
}

/**
 * Gets the time of the most recently merged PR in the database.
 */
export async function getLatestPRMergedAt(): Promise<
  Temporal.Instant | undefined
> {
  const lastMergedTimeQuery = await DB.query<Date[]>({
    text: "SELECT MAX(merged_at) FROM prs",
    rowMode: "array",
  });
  const latestMergedTime = lastMergedTimeQuery.rows[0]?.[0];

  if (latestMergedTime === undefined) {
    return undefined;
  }

  return toTemporalInstant.call(latestMergedTime);
}

/**
 * Deletes all PRs that were merged before the given cutoff date.
 */
export async function deleteMergedPRsBefore(
  cutoff: Temporal.Instant,
): Promise<number> {
  const result = await DB.query("DELETE FROM prs WHERE merged_at < $1", [
    cutoff.toString(),
  ]);
  return result.rowCount;
}
