import { Temporal, toTemporalInstant } from "@js-temporal/polyfill";
import { db } from "./db.js";

export interface PR {
  /**
   * The PR number, e.g. `#12345`.
   */
  number: number;

  /**
   * The date and time that the PR was merged.
   */
  mergedAt: Temporal.PlainDateTime;

  /**
   * The status of the checks and runs on the PR.
   */
  status: "success" | "failure" | "neutral" | "unknown";
}

/**
 * Creates a new blueprint in the database.
 */
export function createPR(pr: PR): Promise<void> {
  return db("prs").insert({
    number: pr.number,
    merged_at: pr.mergedAt.toString(),
    status: pr.status,
  });
}

/**
 * Fetches a stream of PRs from the database, ordered by `merged_at` in
 * ascending order.
 */
export async function* streamPRsByMergedAtAsc(): AsyncIterable<PR> {
  const prs = db("prs").select("*").orderBy("merged_at", "asc").stream();

  // Convert the database representation to the in-memory representation, namely
  // converting the `merged_at` column from a Date to a Temporal.Instant.
  for await (const { number, merged_at, status } of prs) {
    yield {
      number,
      mergedAt: toTemporalInstant
        .call(merged_at)
        .toZonedDateTimeISO("UTC")
        .toPlainDateTime(),
      status,
    };
  }
}
