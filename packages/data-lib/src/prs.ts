import { Temporal } from "@js-temporal/polyfill";
import * as DB from "./db.js";

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
 * Counts the number of PRs with the same status on each date, in ascending
 * order by date.
 */
export async function countPRStatusesByDateAsc(): Promise<
  {
    date: Temporal.PlainDate;
    counts: Map<PR["status"], number>;
  }[]
> {
  const query = await DB.query<
    {
      merge_date: Temporal.PlainDate;
    } & {
      [status in PR["status"]]: number;
    }
  >(
    "SELECT merged_at::date AS merge_date, " +
      "COUNT(*) FILTER (WHERE status = 'success') AS success, " +
      "COUNT(*) FILTER (WHERE status = 'failure') AS failure, " +
      "COUNT(*) FILTER (WHERE status = 'neutral') AS neutral, " +
      "COUNT(*) FILTER (WHERE status = 'unknown') AS unknown " +
      "FROM prs " +
      "GROUP BY merge_date " +
      "ORDER BY merge_date ASC",
  );

  return query.rows.map(({ merge_date, ...counts }) => ({
    date: merge_date,
    counts: new Map(
      Object.entries(counts)
        .filter(([_, count]) => count > 0)
        .map(([status, count]) => [status, Number(count)]) as [
        PR["status"],
        number,
      ][],
    ),
  }));
}

/**
 * Gets the time of the most recently merged PR in the database.
 */
export async function getLatestPRMergedAt(): Promise<
  Temporal.Instant | undefined
> {
  const lastMergedTimeQuery = await DB.query<Temporal.Instant[]>({
    text: "SELECT MAX(merged_at) FROM prs",
    rowMode: "array",
  });
  const latestMergedTime = lastMergedTimeQuery.rows[0]?.[0];

  if (latestMergedTime === undefined) {
    return undefined;
  }

  return latestMergedTime;
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
