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
  mergedAt: Temporal.ZonedDateTime;

  /**
   * The status of the checks and runs on the PR.
   */
  status: "success" | "failure" | "neutral" | "unknown";
}

/**
 * Creates a new blueprint in the database, ignoring if a PR with the same
 * number already exists.
 */
export async function createPRIgnoringConflicts(pr: PR): Promise<void> {
  await db("prs")
    .insert({
      number: pr.number,
      merged_at: pr.mergedAt.toInstant().toString(),
      status: pr.status,
    })
    .onConflict("number")
    .ignore();
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
      mergedAt: toTemporalInstant.call(merged_at).toZonedDateTimeISO("UTC"),
      status,
    };
  }
}

/**
 * Gets the time of the most recently merged PR in the database.
 */
export async function getLatestPRMergedAt(): Promise<Temporal.ZonedDateTime> {
  const latestMergedTime = await db("prs")
    .select("merged_at")
    .orderBy("merged_at", "desc")
    .limit(1)
    .then((rows) => rows[0]?.merged_at);

  if (latestMergedTime === undefined) {
    throw new Error("No merged PRs found in the database!");
  }

  return toTemporalInstant.call(latestMergedTime).toZonedDateTimeISO("UTC");
}

/**
 * Deletes all PRs that were merged before the given cutoff date.
 */
export function deleteMergedPRsBefore(
  cutoff: Temporal.Instant,
): Promise<number> {
  return db("prs").where("merged_at", "<", cutoff.toString()).del();
}
