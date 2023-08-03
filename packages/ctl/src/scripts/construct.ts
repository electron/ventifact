/**
 * Constructs the database from scratch and populates it with data.
 *
 * This script is expected to be the only script modifying the database during
 * its execution.
 */

import { AppVeyor, CircleCI, GitHub } from "extern-api-lib";
import { Temporal } from "@js-temporal/polyfill";
import { Config } from "config-lib";
import { closeDB, insertPR, createTestRun, Schema } from "data-lib";
import { fetchMergedPRsDescUntil } from "../data-fetch/prs.js";
import {
  fetchAppVeyorTestRunsUpdatedDescUntil,
  fetchCircleCITestRunsCreatedDescUntil,
} from "../data-fetch/tests.js";

/**
 * Constructs and populates the PRs section of the database.
 */
async function prs() {
  const github = new GitHub.Client(Config.GITHUB_AUTH_TOKEN());

  console.info("Dropping old PRs table...");
  await Schema.drop.prs();
  console.info("Dropped old PRs table.");

  console.info("Creating new PRs table...");
  await Schema.create.prs();
  console.info("Created new PRs table.");

  console.info("Populating new PRs table...");
  {
    // Set the initial PR time within the PR retention time
    const initialPRTime = Temporal.Now.zonedDateTimeISO("UTC")
      .subtract(Config.MERGED_PR_LIFETIME())
      .toInstant();

    for await (const pr of fetchMergedPRsDescUntil(github, initialPRTime)) {
      // Insert the PR into the database
      await insertPR({
        number: pr.number,
        mergedAt: Temporal.Instant.from(pr.mergedAt),
        status: pr.status,
      });

      console.debug(`Inserted PR #${pr.number} with status "${pr.status}".`);
    }
  }
  console.info("Populated new PRs table.");
}

/**
 * Constructs and populates the Tests section of the database.
 */
async function tests() {
  const appveyor = new AppVeyor.Client(Config.APPVEYOR.AUTH_TOKEN());

  // TODO: auth tokens cause internal server errors for some reason, so we have
  // to omit them here. This is a bug in CircleCI. Luckily, the calls we're
  // making don't require authentication.
  const circleci = new CircleCI.Client();

  console.info("Dropping old tests tables...");
  await Schema.drop.test_flakes();
  await Schema.drop.test_runs();
  await Promise.all([
    Schema.drop.test_blueprints(),
    Schema.drop.test_run_blueprints(),
  ]);
  console.info("Dropped old tests tables.");

  console.info("Creating new tests tables...");
  await Promise.all([
    Schema.create.test_blueprints(),
    Schema.create.test_run_blueprints(),
  ]);
  await Schema.create.test_runs();
  await Schema.create.test_flakes();
  console.info("Created new tests tables.");

  console.info("Populating new tests tables...");
  {
    // Determine the cutoff
    const cutoff = Temporal.Now.zonedDateTimeISO("UTC")
      .subtract(Config.TEST_RUN.LIFETIME())
      .toInstant();

    // Fetch test runs from AppVeyor and CircleCI
    await Promise.all([
      (async () => {
        for await (const testRun of fetchAppVeyorTestRunsUpdatedDescUntil(
          appveyor,
          cutoff,
        )) {
          await createTestRun(testRun);
          console.debug(
            `Inserted AppVeyor test run from ${testRun.timestamp} on ` +
              `branch '${testRun.branch}' with ${testRun.results.length} tests.`,
          );
        }
      })(),
      (async () => {
        for await (const testRun of fetchCircleCITestRunsCreatedDescUntil(
          circleci,
          cutoff,
          {
            dbIsFresh: true,
          },
        )) {
          await createTestRun(testRun);
          console.debug(
            `Inserted CircleCI test run from ${testRun.timestamp} on ` +
              `branch '${testRun.branch}' with ${testRun.results.length} tests.`,
          );
        }
      })(),
    ]);
  }
  console.info("Populated new tests tables.");
}

Promise.all([prs(), tests()])
  .then(() => {
    console.info("Done, closing database.");
    closeDB();
  })
  .catch((err) => {
    console.error("Failed to construct database.");
    console.error(err);
    process.exit(1);
  });
