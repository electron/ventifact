import { db } from "db-lib";
import { Temporal } from "@js-temporal/polyfill";
import { getMergedPRsUntil } from "github-lib";

// Check for required environment variables early
if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable is not set");
}

/////////////////////
// Clearing tables //
/////////////////////

console.info("Clearing existing tables...");
// await Promise.all([
//   db.schema.dropTableIfExists("tests"),
//   db.schema.dropTableIfExists("test_runs"),
//   db.schema.dropTableIfExists("test_results"),
// ]);
await db.schema.dropTableIfExists("prs");
console.info("Cleared.");

/////////////////////
// Creating tables //
/////////////////////

console.info("Creating tables...");
// await Promise.all([
//   db.schema.createTable("tests", (table) => {
//     table.uuid("id").primary();
//     table.string("title").notNullable();
//   }),
//   db.schema.createTable("test_runs", (table) => {
//     table.uuid("id").primary();
//     table.timestamp("timestamp").notNullable();
//     table.string("branch").nullable();
//   }),
// ]).then(() => db.schema.createTable("test_results", (table) => {
//   table.uuid("test_run").references("test_runs.id");
//   table.uuid("test").references("tests.id");
//   table.enum("status", ["pass", "fail", "unknown"]).notNullable();
//   table.primary(["test_run", "test"]);
// }));
await db.schema.createTable("prs", (table) => {
  table.integer("number").primary();
  table.timestamp("merged_at").notNullable();
  table
    .enum("status", ["success", "failure", "neutral", "unknown"])
    .notNullable();
});
console.info("Created.");

//////////////////////
// Popuating tables //
//////////////////////

console.info("Populating tables...");
// Get PRs until a year ago
const initial = Temporal.Now.zonedDateTimeISO("UTC")
  .subtract({ years: 1 })
  .toInstant();
for await (const pr of getMergedPRsUntil(initial)) {
  // Insert the PR into the database
  await db("prs").insert({
    number: pr.number,
    merged_at: pr.mergedAt,
    status: pr.status,
  });

  console.info(`Inserted PR #${pr.number} with status "${pr.status}".`);
}
console.info("Populated.");

//////////////
// Finished //
//////////////
await db.destroy();
console.info("Done. Finished successfully.");
