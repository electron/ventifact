/**
 * Maintains the database, which includes:
 * - Pruning expired data that is past its lifetime
 * - Adding new data that has been created since the last run
 * - Running analysis on the data
 *
 * This script expects that there may be other operations running on the
 * database at while it is executing, using safe database transactions to
 * maintain data invariants.
 */

import {
  insertPR,
  deleteMergedPRsBefore,
  getLatestPRMergedAt,
  deleteTestRunsBefore,
  createTestRun,
  getLatestTestRunTimestampForSource,
  checkTestRunExistsById,
} from "data-lib";
import { AppVeyor, CircleCI, GitHub } from "extern-api-lib";
import { Temporal } from "@js-temporal/polyfill";
import { Config } from "config-lib";
import { fetchMergedPRsDescUntil } from "../data-fetch/prs.js";
import {
  fetchAppVeyorTestRunsUpdatedDescUntil,
  fetchCircleCITestRunsCreatedDescUntil,
} from "../data-fetch/tests.js";

async function prs() {
  const github = new GitHub.Client(Config.GITHUB_AUTH_TOKEN());

  // Delete expired merged PRs
  const expiredCutoff = Temporal.Now.zonedDateTimeISO("UTC")
    .subtract(Config.MERGED_PR_LIFETIME())
    .toInstant();
  console.info(`Purging expired merged PRs before ${expiredCutoff}...`);
  const numDeleted = await deleteMergedPRsBefore(expiredCutoff);
  console.info(`Purged ${numDeleted} expired merged PRs.`);

  // Add newly merged PRs
  const latestMergedTime = await getLatestPRMergedAt();
  if (latestMergedTime !== undefined) {
    console.info(`Adding PRs merged after ${latestMergedTime.toString()}...`);
    for await (const pr of fetchMergedPRsDescUntil(github, latestMergedTime)) {
      await insertPR({
        number: pr.number,
        mergedAt: Temporal.Instant.from(pr.mergedAt),
        status: pr.status,
      });

      console.info(`Inserted PR #${pr.number} with status "${pr.status}".`);
    }
    console.info("Done adding PRs.");
  }
}

async function tests() {
  const appveyor = new AppVeyor.Client(Config.APPVEYOR.AUTH_TOKEN());

  // TODO: auth tokens cause internal server errors for some reason, so we have
  // to omit them here. This is a bug in CircleCI. Luckily, the calls we're
  // making don't require authentication.
  const circleci = new CircleCI.Client();

  // Delete expired test runs
  const expiredCutoff = Temporal.Now.zonedDateTimeISO("UTC")
    .subtract(Config.TEST_RUN_LIFETIME())
    .toInstant();
  console.info(`Purging expired test runs before ${expiredCutoff}...`);
  const numDeleted = await deleteTestRunsBefore(expiredCutoff);
  console.info(`Purged ${numDeleted} expired test runs.`);

  // Add newly created test runs
  await Promise.all([
    (async () => {
      const latestAppVeyorTestRunTimestamp =
        await getLatestTestRunTimestampForSource("appveyor");
      if (latestAppVeyorTestRunTimestamp === undefined) {
        return;
      }
      for await (const testRun of fetchAppVeyorTestRunsUpdatedDescUntil(
        appveyor,
        latestAppVeyorTestRunTimestamp,
      )) {
        await createTestRun(testRun);
        console.debug(
          `Inserted AppVeyor test run from ${testRun.timestamp} on ` +
            `branch '${testRun.branch}' with ${testRun.results.length} tests.`,
        );
      }
    })(),
    (async () => {
      // We need to fetch all test runs created since the original cutoff since
      // CircleCI doesn't expose a way to sort by updates, and we don't want to
      // miss reruns, which are important for finding flaky tests.
      for await (const testRun of fetchCircleCITestRunsCreatedDescUntil(
        circleci,
        expiredCutoff,
      )) {
        // Skip test runs that already exist in the database
        if (await checkTestRunExistsById(testRun.id)) {
          continue;
        }

        await createTestRun(testRun);
        console.debug(
          `Inserted CircleCI test run from ${testRun.timestamp} on ` +
            `branch '${testRun.branch}' with ${testRun.results.length} tests.`,
        );
      }
    })(),
  ]);

  // TODO: analyze tests
}

Promise.all([prs(), tests()])
  .then(() => console.info("Done."))
  .catch((err) => {
    console.error("Failed to maintain database.");
    console.error(err);
    process.exit(1);
  });
