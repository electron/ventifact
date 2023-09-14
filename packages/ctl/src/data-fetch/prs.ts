import { Temporal } from "@js-temporal/polyfill";
import { GitHub } from "extern-api-lib";
import { isAscending } from "../temporal.js";

const GITHUB_REPO_OWNER = "electron";
const GITHUB_REPO_NAME = "electron";

/**
 * Fetches merged PRs in descending order until the given cutoff time is reached.
 */
export async function* fetchMergedPRsDescUntil(
  client: GitHub.AppClient,
  cutoff: Temporal.Instant,
): AsyncIterableIterator<GitHub.MergedPR> {
  for await (const pr of client.mergedPRsDesc(
    GITHUB_REPO_OWNER,
    GITHUB_REPO_NAME,
  )) {
    // Stop if the PR is before the cutoff
    const updateTime = Temporal.Instant.from(pr.updatedAt);
    if (isAscending(updateTime, cutoff)) {
      return;
    }

    // Ignore PRs that are from before the cutoff
    const mergeTime = Temporal.Instant.from(pr.mergedAt);
    if (isAscending(mergeTime, cutoff)) {
      continue;
    }

    yield pr;
  }
}
