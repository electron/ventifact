import { AppVeyor, CircleCI, GitHub } from "extern-api-lib";
import { Temporal } from "@js-temporal/polyfill";
import { TestRun, closeDb, insertPR, createTestRun, dbSchema } from "data-lib";
import { BuildLog } from "format-lib";
import { getEnvVarOrThrow } from "../env-var.js";

/**
 * Constructs and populates the PRs section of the database.
 */
async function prs() {
  const github = new GitHub.Client(getEnvVarOrThrow("GITHUB_AUTH_TOKEN"));

  console.info("Dropping old PRs table...");
  await dbSchema().dropTableIfExists("prs");
  console.info("Dropped old PRs table.");

  console.info("Creating new PRs table...");
  await dbSchema().createTable("prs", (table) => {
    table.integer("number").primary();
    table.timestamp("merged_at", { useTz: true }).notNullable();
    table
      .enum("status", ["success", "failure", "neutral", "unknown"])
      .notNullable();
  });
  console.info("Created new PRs table.");

  console.info("Populating new PRs table...");
  {
    // Get PRs until a year ago
    const initialPRTime = Temporal.Now.zonedDateTimeISO("UTC")
      .subtract({ years: 1 })
      .toInstant();

    for await (const pr of github.mergedPRsAfterDesc(
      "electron",
      "electron",
      initialPRTime,
    )) {
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
  const appveyor = new AppVeyor.Client(getEnvVarOrThrow("APPVEYOR_AUTH_TOKEN"));

  // TODO: auth tokens cause internal server errors for some reason, so we have
  // to omit them here. This is a bug in CircleCI. Luckily, the calls we're
  // making don't require authentication.
  const circleci = new CircleCI.Client();

  const cutoff = Temporal.Now.zonedDateTimeISO("UTC")
    .subtract({ months: 3 })
    .toInstant();

  async function* getAppVeyorTestRuns(): AsyncGenerator<TestRun> {
    const ACCOUNT_NAME = "electron-bot";
    const PROJECT_SLUGS = [
      "electron-ia32-testing",
      "electron-woa-testing",
      "electron-x64-testing",
    ];

    // TODO: parallelize
    for (const projSlug of PROJECT_SLUGS) {
      console.debug(`Getting AppVeyor test runs for project '${projSlug}'...`);
      for await (const historyBuild of appveyor.projBuildHistory(
        ACCOUNT_NAME,
        projSlug,
      )) {
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

        // Stop if this build is before the cutoff
        const timestamp = Temporal.Instant.from(historyBuild.created);
        if (Temporal.Instant.compare(timestamp, cutoff) < 0) {
          break;
        }

        // Get the full build details
        const build = await appveyor.build(
          ACCOUNT_NAME,
          projSlug,
          historyBuild.buildId,
        );

        // Find the test job
        const testJob = build.jobs.find((job) => job.testsCount > 0);

        // Skip builds without tests
        if (testJob === undefined) {
          continue;
        }

        // Get the test results from the build log
        const testJobLogStream = appveyor.buildJobLogStream(testJob.jobId);
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

  async function* getCircleCITestRuns(): AsyncGenerator<TestRun> {
    const PROJECT_SLUG = "github/electron/electron";

    // TODO: parallelize
    for await (const pipeline of circleci.pipelines(PROJECT_SLUG)) {
      console.debug(`Processing CircleCI pipeline ${pipeline.id}...`);
      for await (const workflow of circleci.workflows(pipeline.id)) {
        console.debug(`Processing CircleCI workflow ${workflow.id}...`);
        for await (const job of circleci.jobs(workflow.id)) {
          // Skip jobs without a job number, ones that haven't concluded yet,
          // and ones that aren't our Electron tests
          if (
            job.job_number === undefined ||
            job.started_at === null ||
            (job.status !== "success" && job.status !== "failed") ||
            !job.name.endsWith("-tests")
          ) {
            continue;
          }

          console.debug(`Processing CircleCI job ${job.job_number}...`);

          // Stop if this build is before the cutoff
          const timestamp = Temporal.Instant.from(job.started_at);
          if (Temporal.Instant.compare(timestamp, cutoff) < 0) {
            return;
          }

          // Collect all the tests for this job
          const tests = [];
          for await (const test of circleci.testMetadata(
            PROJECT_SLUG,
            job.job_number,
          )) {
            tests.push(test);
          }

          // Skip jobs without tests
          if (tests.length === 0) {
            console.debug(`Skipping job ${job.job_number} without tests...`);
            continue;
          }

          // Convert the test metadata into a TestRun
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

  console.info("Dropping old tests tables...");
  await dbSchema()
    .dropTableIfExists("test_runs")
    .then(() =>
      Promise.all([
        dbSchema().dropTableIfExists("test_blueprints"),
        dbSchema().dropTableIfExists("test_run_blueprints"),
      ]),
    );
  console.info("Dropped old tests tables.");

  console.info("Creating new tests tables...");
  await Promise.all([
    dbSchema().createTable("test_blueprints", (table) => {
      table.bigInteger("id").primary();
      table.string("title").notNullable();
    }),
    dbSchema().createTable("test_run_blueprints", (table) => {
      table.bigInteger("id").primary();
      table.binary("test_blueprint_ids").notNullable();
    }),
  ]).then(() =>
    dbSchema().createTable("test_runs", (table) => {
      table.binary("id").primary();
      table.bigInteger("blueprint_id").references("test_run_blueprints.id");
      table.timestamp("timestamp").notNullable();
      table.string("branch").nullable();
      table.binary("result_spec").nullable();
    }),
  );
  console.info("Created new tests tables.");

  console.info("Populating new tests tables...");
  {
    await Promise.all([
      (async () => {
        for await (const testRun of getAppVeyorTestRuns()) {
          await createTestRun(testRun);
          console.debug(
            `Inserted AppVeyor test run from ${testRun.timestamp} on ` +
              `branch '${testRun.branch}' with ${testRun.results.length} tests.`,
          );
        }
      })(),
      (async () => {
        for await (const testRun of getCircleCITestRuns()) {
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
    closeDb();
  })
  .catch((err) => {
    console.error("Failed to construct database.");
    console.error(err);
    process.exit(1);
  });
