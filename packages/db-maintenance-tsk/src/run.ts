import { Temporal, toTemporalInstant } from "@js-temporal/polyfill";
import { Tables, db } from "db-lib";
import { getMergedPRsUntil } from "github-lib";

/////////////////////////////
// Adding newly merged PRs //
/////////////////////////////

// Find the latest merged PR in the database
const latestMergedTime = await db<Tables.PR>("prs")
  .select("merged_at")
  .orderBy("merged_at", "desc")
  .limit(1)
  .then((rows) => rows[0]?.merged_at);

// If there are no merged PRs, then the db hasn't been initialized yet
if (latestMergedTime === undefined) {
  console.error("No merged PRs found in the database!");
  process.exit(1);
}

const initial = toTemporalInstant.call(latestMergedTime).add({ seconds: 1 });
console.info(`Adding PRs merged after ${initial.toString()}...`);
for await (const pr of getMergedPRsUntil(initial)) {
  // Insert the PR into the database
  await db("prs").insert({
    number: pr.number,
    merged_at: pr.mergedAt,
    status: pr.status,
  });

  console.info(`Inserted PR #${pr.number} with status "${pr.status}".`);
}
console.info("Done adding PRs.");

////////////////////////////
// Purging old merged PRs //
////////////////////////////

// Determine the cutoff date for purging old PRs
const cutoff = Temporal.Now.zonedDateTimeISO("UTC")
  .subtract({ years: 1 })
  .toPlainDate()
  .toString();

// Delete all PRs that were merged before the cutoff date
console.info(`Deleting PRs merged before ${cutoff}...`);
const numDeleted = await db<Tables.PR>("prs")
  .where("merged_at", "<", cutoff)
  .del();
console.info(`Deleted ${numDeleted} old PRs.`);

//////////////
// Finished //
//////////////
await db.destroy();
console.info("Done!");
