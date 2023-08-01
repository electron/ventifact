import { Temporal } from "@js-temporal/polyfill";
import { Config } from "config-lib";
import { TestRun, checkTestRunExistsById } from "data-lib";
import { AppVeyor, CircleCI } from "extern-api-lib";
import { BuildLog } from "format-lib";
import { isAscending } from "../temporal.js";

/**
 * Fetches TestRuns from the AppVeyor API in descending order until one is found
 * that was *updated* before the given cutoff time.
 */
export async function* fetchAppVeyorTestRunsUpdatedDescUntil(
  client: AppVeyor.Client,
  cutoff: Temporal.Instant,
): AsyncIterableIterator<TestRun> {
  // Read config values
  const ACC_NAME = Config.APPVEYOR.ACCOUNT_NAME();
  const PROJ_SLUGS = Config.APPVEYOR.PROJECT_SLUGS();

  // TODO: parallelize
  for (const projSlug of PROJ_SLUGS) {
    console.debug(`Getting AppVeyor test runs for project '${projSlug}'...`);
    for await (const historyBuild of client.buildHistoryByUpdatedDesc(
      ACC_NAME,
      projSlug,
    )) {
      // Stop if this build is before the cutoff
      const timestamp = Temporal.Instant.from(historyBuild.updated);
      if (isAscending(timestamp, cutoff)) {
        console.debug(
          `Build ${historyBuild.buildId} @ ${timestamp.toString()} ` +
            `updated before cutoff ${cutoff.toString()}, stopping.`,
        );
        break;
      }

      // Skip builds that have not concluded
      if (
        historyBuild.status !== "success" &&
        historyBuild.status !== "failed"
      ) {
        continue;
      }

      console.debug(
        `Processing AppVeyor build history for build ${historyBuild.buildId}...`,
      );

      // Get the full build details
      const build = await client.build(
        ACC_NAME,
        projSlug,
        historyBuild.buildId,
      );

      // Find the test job
      const testJob = build.jobs.find((job) => job.testsCount > 0);
      // NOTE: ^ we assume there's only one test job per build, but that may not
      // hold in the future.

      // Skip builds without tests
      if (testJob === undefined) {
        continue;
      }

      // Get the test results from the build log
      const testJobLogStream = client.buildJobLogStream(testJob.jobId);
      const logTestResults = await BuildLog.parse(testJobLogStream);

      // Convert the build log results and metadata into a TestRun
      yield {
        id: {
          source: "appveyor",
          buildId: build.buildId,
        },
        results: logTestResults.map((result) => ({
          title: result.name,
          passed: result.state !== "failed",
        })),
        timestamp,
        branch: build.branch,
      };
    }
  }
}

/**
 * Fetches TestRuns from the CircleCI API in descending order until one is found
 * that was *created* before the given cutoff time.
 */
export async function* fetchCircleCITestRunsCreatedDescUntil(
  client: CircleCI.Client,
  cutoff: Temporal.Instant,
  {
    dbIsFresh = false,
  }: {
    /**
     * If true, it will be assumed that no test runs were collected before this
     * function was called.
     */
    dbIsFresh?: boolean;
  } = {},
): AsyncIterableIterator<TestRun> {
  // Read config values
  const PROJ_SLUG = Config.CIRCLECI.PROJECT_SLUG();
  const WORKFLOW_NAMES = Config.CIRCLECI.WORKFLOW_NAMES();
  const JOB_NAMES = Config.CIRCLECI.JOB_NAMES();

  for await (const pipeline of client.pipelinesByCreationDesc(PROJ_SLUG)) {
    // Stop if this pipeline is before the cutoff
    const timestamp = Temporal.Instant.from(pipeline.created_at);
    if (isAscending(timestamp, cutoff)) {
      console.debug(
        `Pipeline ${pipeline.id} @ ${timestamp.toString()} ` +
          `created before cutoff ${cutoff.toString()}, stopping.`,
      );
      break;
    }

    // Skip pipelines that have not been created yet
    if (pipeline.state !== "created") {
      continue;
    }

    console.debug(`Processing CircleCI pipeline ${pipeline.id}...`);

    for await (const workflow of client.workflowsInPipeline(pipeline.id)) {
      // Skip workflows that haven't concluded and ones that aren't configured
      // to be collected
      if (
        !WORKFLOW_NAMES.has(workflow.name) ||
        (workflow.status !== "success" && workflow.status !== "failed")
      ) {
        continue;
      }

      console.debug(`Processing CircleCI workflow ${workflow.id}...`);

      for await (const job of client.jobsInWorkflow(workflow.id)) {
        // Skip jobs without a job number, ones that aren't configured to be
        // collected, and ones that haven't concluded
        if (
          job.job_number === undefined ||
          !JOB_NAMES.has(job.name) ||
          job.started_at === null ||
          (job.status !== "success" && job.status !== "failed")
        ) {
          continue;
        }

        // Skip this job if it's already present in the database
        if (
          !dbIsFresh &&
          (await checkTestRunExistsById({
            source: "circleci",
            jobId: job.job_number,
          }))
        ) {
          continue;
        }

        // Skip this job if it's before the cutoff
        const timestamp = Temporal.Instant.from(job.started_at);
        if (isAscending(timestamp, cutoff)) {
          continue;
        }

        console.debug(
          `Processing CircleCI job ${
            job.job_number
          } @ ${timestamp.toString()}...`,
        );

        // Collect all the tests for this job
        const tests = [];
        for await (const test of client.testMetadataInJob(
          PROJ_SLUG,
          job.job_number,
        )) {
          tests.push(test);
        }

        // Skip jobs that didn't end up reporting any tests
        if (tests.length === 0) {
          continue;
        }

        // Convert the test results and metadata into a TestRun
        yield {
          id: {
            source: "circleci",
            jobId: job.job_number,
          },
          results: tests.map((test) => ({
            title: test.name,
            passed: test.result === "success",
          })),
          timestamp,
          branch: pipeline.vcs?.branch ?? undefined,
        };
      }
    }
  }
}
