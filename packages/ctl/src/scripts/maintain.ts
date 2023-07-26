import { insertPR, deleteMergedPRsBefore, getLatestPRMergedAt } from "data-lib";
import { GitHub } from "extern-api-lib";
import { Temporal } from "@js-temporal/polyfill";
import { getEnvVarOrThrow } from "../env-var.js";

async function prs() {
  const github = new GitHub.Client(getEnvVarOrThrow("GITHUB_AUTH_TOKEN"));

  // Delete old merged PRs
  const oldCutoff = Temporal.Now.zonedDateTimeISO("UTC")
    .subtract({ years: 1 })
    .toInstant();
  console.info(`Purging old merged PRs before ${oldCutoff}...`);
  const numDeleted = await deleteMergedPRsBefore(oldCutoff);
  console.info(`Purged ${numDeleted} old merged PRs.`);

  // Add newly merged PRs
  const latestMergedTime = await getLatestPRMergedAt();
  console.info(`Adding PRs merged after ${latestMergedTime.toString()}...`);
  for await (const pr of github.mergedPRsAfterDesc(
    "electron",
    "electron",
    latestMergedTime,
  )) {
    await insertPR({
      number: pr.number,
      mergedAt: Temporal.Instant.from(pr.mergedAt),
      status: pr.status,
    });

    console.info(`Inserted PR #${pr.number} with status "${pr.status}".`);
  }
  console.info("Done adding PRs.");
}

// TODO: test analysis

prs()
  .then(() => console.info("Done."))
  .catch((err) => {
    console.error("Failed to maintain database.");
    console.error(err);
    process.exit(1);
  });
