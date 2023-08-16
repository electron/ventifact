import { Temporal } from "@js-temporal/polyfill";
import { Hash, createHash } from "crypto";
import * as DB from "./db.js";
import { Tables } from "./db-schema.js";
import QueryStream from "pg-query-stream";

export interface TestRun {
  id:
    | { source: "appveyor"; buildId: number }
    | { source: "circleci"; jobId: number };
  results: TestResult[];
  timestamp: Temporal.Instant;
  branch?: string;
  commitId: Buffer;
}

export interface TestResult {
  title: string;
  passed: boolean;
}

/**
 * The expected size of a Blueprint ID in bytes.
 */
const BLUEPRINT_ID_BUFFER_SIZE = 8;

class BlueprintID {
  #digest: Buffer;

  constructor(digest: Buffer) {
    // We expect a 64-bit digest
    if (digest.length !== BLUEPRINT_ID_BUFFER_SIZE) {
      throw new Error("Expected a 64-bit digest");
    }

    this.#digest = digest;
  }

  /**
   * Convenience method for creating a Blueprint ID from a closure that
   * transverses a some structure into a hash.
   */
  static hash(closure: (hash: Hash) => void): BlueprintID {
    const hash = createHash("shake256", {
      outputLength: BLUEPRINT_ID_BUFFER_SIZE,
    });
    closure(hash);
    return new BlueprintID(hash.digest());
  }

  /**
   * Compare two Blueprint IDs, returning a negative number if `a` is less than
   * `b`, a positive number if `a` is greater than `b`, or zero if they are
   * equal.
   */
  static compare(a: BlueprintID, b: BlueprintID): number {
    return Buffer.compare(a.asBuffer(), b.asBuffer());
  }

  /**
   * Convert this Blueprint ID to a 64-bit integer.
   */
  toInt64(): bigint {
    return this.#digest.readBigInt64BE();
  }

  /**
   * Retrieve the raw buffer for this Blueprint ID.
   */
  asBuffer(): Buffer {
    return this.#digest;
  }
}

/**
 * Derive a blueprint ID from a list.
 */
function deriveBlueprintIDForList(ids: BlueprintID[]): BlueprintID {
  return BlueprintID.hash((hash) =>
    [...ids]
      .sort(BlueprintID.compare)
      .reduce((hash, id) => hash.update(id.asBuffer()), hash),
  );
}

/**
 * Derives the Blueprint ID for a test blueprint given its structure.
 */
function deriveBlueprintIDForTestBlueprint(title: string): BlueprintID {
  return BlueprintID.hash((hash) => hash.update(title));
}

const ResultSpec = {
  /**
   * Encodes a list of test results into a Buffer following the "Result Spec"
   * section in `docs/db-design.rst`.
   */
  encodeFromResults(results: TestResult[]): Buffer | undefined {
    // Count the number of passed tests
    const passedCount = results.reduce(
      (count, { passed }) => count + (passed ? 1 : 0),
      0,
    );

    // If all tests passed, we can omit the result spec
    if (passedCount === results.length) {
      return undefined;
    }

    // Determine if we should encode passed tests or failed tests
    const encodingPassedTests = passedCount < results.length / 2;

    // Allocate the resulting buffer: 1 byte for the variant tag, then 8 bytes
    // per test result
    const idsToEncode = encodingPassedTests
      ? passedCount
      : results.length - passedCount;
    const result = Buffer.alloc(1 + BLUEPRINT_ID_BUFFER_SIZE * idsToEncode);

    // Write the variant tag
    result.writeUInt8(encodingPassedTests ? 1 : 0);

    // Write the test IDs
    let offset = 1;
    for (const { title, passed } of results) {
      // Skip the test if it doesn't match the encoding variant
      if (passed !== encodingPassedTests) {
        continue;
      }

      // Write the test ID
      deriveBlueprintIDForTestBlueprint(title).asBuffer().copy(result, offset);
      offset += BLUEPRINT_ID_BUFFER_SIZE;
    }

    return result;
  },
  /**
   * Decodes a result spec into a list of test IDs.
   */
  decodeIDResults(
    spec: Buffer | null,
    allIDs: Tables["test_blueprints"]["id"][],
  ): Map<Tables["test_blueprints"]["id"], boolean> {
    // If the spec is null, all tests passed
    if (spec === null) {
      return new Map(allIDs.map((id) => [id, true]));
    }

    // Read the variant tag
    const encodingPassedTests = spec.readUInt8(0) === 1;

    // Read the test IDs
    const ids = new Set<bigint>();
    for (
      let offset = 1;
      offset < spec.length;
      offset += BLUEPRINT_ID_BUFFER_SIZE
    ) {
      const buffer = spec.subarray(offset, offset + BLUEPRINT_ID_BUFFER_SIZE);
      const id = new BlueprintID(buffer);
      ids.add(id.toInt64());
    }

    // Determine whether each test ID passed or failed
    const result = new Map<Tables["test_blueprints"]["id"], boolean>();
    for (const id of allIDs) {
      const hasID = ids.has(id);
      result.set(id, encodingPassedTests ? hasID : !hasID);
    }

    return result;
  },
};

/**
 * Creates a test run in the database.
 */
export async function createTestRun(testRun: TestRun): Promise<void> {
  const testBlueprints = testRun.results.map(({ title }) => ({
    id: deriveBlueprintIDForTestBlueprint(title),
    title,
  }));
  const blueprintIDs = testBlueprints.map(({ id }) => id);
  const testRunBlueprintID = deriveBlueprintIDForList(blueprintIDs);
  const resultSpec = ResultSpec.encodeFromResults(testRun.results);

  // Create the test run safely in a transaction
  await DB.transaction(async (db) => {
    // Insert the test blueprints and test run blueprint
    await Promise.all([
      db.query(
        "INSERT INTO test_blueprints (id, title) " +
          `VALUES ${testBlueprints
            .map((_, i) => `($${2 * i + 1}, $${2 * i + 2})`)
            .join(",")} ` +
          "ON CONFLICT (id) DO NOTHING",
        testBlueprints.flatMap(({ id, title }) => [id.toInt64(), title]),
      ),
      db.query(
        "INSERT INTO test_run_blueprints (id, test_blueprint_ids) " +
          "VALUES ($1, $2) " +
          "ON CONFLICT (id) DO NOTHING",
        [testRunBlueprintID.toInt64(), blueprintIDs.map((id) => id.toInt64())],
      ),
    ]);

    // Insert the test run
    await db.query(
      "INSERT INTO test_runs (source, ext_id, blueprint_id, timestamp, branch, commit_id, result_spec) " +
        "VALUES ($1, $2, $3, $4, $5, $6, $7) " +
        "ON CONFLICT (source, ext_id) DO NOTHING",
      [
        testRun.id.source,
        testRun.id.source === "appveyor"
          ? testRun.id.buildId
          : testRun.id.jobId,
        testRunBlueprintID.toInt64(),
        testRun.timestamp.toString(),
        testRun.branch ?? undefined,
        testRun.commitId,
        resultSpec,
      ],
    );
  });
}

/**
 * Deletes all test runs before the given cutoff, including cleaning up any
 * associated blueprints that are no longer referenced.
 */
export async function deleteTestRunsBefore(
  cutoff: Temporal.Instant,
): Promise<number> {
  return await DB.transaction(async (tx) => {
    // Find the test run blueprints that will become orphaned once the test
    // runs are deleted
    const orphanedTestRunBlueprints = await tx.query<
      Tables["test_run_blueprints"] & { num_test_runs: number }
    >(
      `
      SELECT num_test_runs, blueprint_id, test_blueprint_ids
      FROM (
        SELECT expired_test_runs.blueprint_id, COUNT(*) AS num_test_runs
        FROM (
          SELECT blueprint_id, timestamp
          FROM test_runs
          WHERE timestamp < $1
        ) expired_test_runs
        LEFT JOIN test_runs
          ON test_runs.blueprint_id = expired_test_runs.blueprint_id
        GROUP BY expired_test_runs.blueprint_id
      ) q
      LEFT JOIN test_run_blueprints
        ON test_run_blueprints.id = q.blueprint_id
      WHERE q.num_test_runs <= 1
      `,
      [cutoff.toString()],
    );

    // Delete any test flakes referencing these test runs
    await tx.query(
      "DELETE FROM test_flakes " +
        "USING test_runs " +
        "WHERE test_runs.timestamp < $1",
      [cutoff.toString()],
    );

    // Delete the test expired runs, which must be done before deleting the
    // corresponding blueprints that reference them
    const testRunsDeletedResult = await tx.query(
      "DELETE FROM test_runs WHERE timestamp < $1",
      [cutoff.toString()],
    );

    // Handle the test blueprints in any orphaned test run blueprints
    if (orphanedTestRunBlueprints.rowCount > 0) {
      // Figure out all the potentially-orphaned test blueprints
      const potentiallyOrphanedTestBlueprintIDs = new Set<bigint>();
      for (const { test_blueprint_ids } of orphanedTestRunBlueprints.rows) {
        for (const id of test_blueprint_ids) {
          potentiallyOrphanedTestBlueprintIDs.add(id);
        }
      }

      // Try to eliminate every potentially-orphaned test blueprint by finding
      // if there exists any other test run blueprint that references it
      const stream = new QueryStream(
        "SELECT id, test_blueprint_ids FROM test_run_blueprints " +
          "WHERE id <> ALL ($1)",
        [orphanedTestRunBlueprints.rows.map(({ id }) => id)],
      );
      const streamQuery = tx.query(stream) as AsyncIterable<
        Tables["test_run_blueprints"]
      >;

      for await (const { test_blueprint_ids } of streamQuery) {
        // Remove all of this test run blueprint's test blueprint IDs from the
        // set of potentially-orphaned test blueprints
        for (const id of test_blueprint_ids) {
          potentiallyOrphanedTestBlueprintIDs.delete(id);
        }

        // If the set is now empty, we can stop early
        if (potentiallyOrphanedTestBlueprintIDs.size === 0) {
          break;
        }
      }

      // Delete the identified orphaned test blueprints
      if (potentiallyOrphanedTestBlueprintIDs.size > 0) {
        await tx.query("DELETE FROM test_blueprints WHERE id = ANY ($1)", [
          Array.from(potentiallyOrphanedTestBlueprintIDs),
        ]);
      }

      // Delete the identified orphaned test run blueprints
      await tx.query("DELETE FROM test_run_blueprints WHERE id = ANY ($1)", [
        orphanedTestRunBlueprints.rows.map(({ id }) => id),
      ]);
    }

    return testRunsDeletedResult.rowCount;
  });
}

/**
 * Finds the latest test run timestamp for the given source type.
 */
export async function getLatestTestRunTimestampForSource(
  source: TestRun["id"]["source"],
): Promise<Temporal.Instant | undefined> {
  const latestTimestampQuery = await DB.query<Temporal.Instant[]>({
    text: "SELECT MAX(timestamp) FROM test_runs WHERE source = $1",
    values: [source],
    rowMode: "array",
  });
  const latestTimestamp = latestTimestampQuery.rows[0]?.[0];

  if (latestTimestamp === undefined) {
    return undefined;
  }

  return latestTimestamp;
}

/**
 * Checks if the given test run exists in the database.
 */
export async function checkTestRunExistsById(
  id: TestRun["id"],
): Promise<boolean> {
  const result = await DB.query(
    "SELECT 1 FROM test_runs WHERE source = $1 AND ext_id = $2",
    [id.source, id.source === "appveyor" ? id.buildId : id.jobId],
  );

  return result.rowCount > 0;
}

/**
 * Finds the latest test flake's timestamp.
 */
export async function getLatestTestFlakeTimestamp(): Promise<
  Temporal.Instant | undefined
> {
  const latestTimestampQuery = await DB.query<Temporal.Instant[]>({
    text:
      "SELECT MAX(timestamp) " +
      "FROM test_flakes " +
      "LEFT JOIN test_runs " +
      "ON test_runs.source = test_flakes.test_run_source " +
      "AND test_runs.ext_id = test_flakes.test_run_ext_id",
    rowMode: "array",
  });
  const latestTimestamp = latestTimestampQuery.rows[0]?.[0];

  if (latestTimestamp === undefined) {
    return undefined;
  }

  return latestTimestamp;
}

/**
 * Marks test flakes that occurred since the given cutoff.
 */
export async function markTestFlakesSince(
  cutoff: Temporal.Instant,
): Promise<number> {
  const flakyTestReruns = await DB.query<
    Pick<
      Tables["test_runs"],
      "source" | "ext_id" | "blueprint_id" | "result_spec"
    > & {
      previous_source: Tables["test_runs"]["source"];
      previous_ext_id: Tables["test_runs"]["ext_id"];
    } & Pick<Tables["test_run_blueprints"], "test_blueprint_ids"> & {
        previous_result_spec: Tables["test_runs"]["result_spec"];
        rerun_num: number;
      }
  >(
    `
    SELECT q.source, q.ext_id, q.previous_source, q.previous_ext_id, q.blueprint_id, test_run_blueprints.test_blueprint_ids, q.result_spec, q.previous_result_spec, q.rerun_num
    FROM (
      SELECT
        *,
        LAG(source) OVER w AS previous_source,
        LAG(ext_id) OVER w AS previous_ext_id,
        LAG(result_spec) OVER w AS previous_result_spec,
        ROW_NUMBER() OVER w AS rerun_num
      FROM test_runs
      WINDOW w AS (PARTITION BY blueprint_id, commit_id ORDER BY timestamp ASC)
    ) q
    LEFT JOIN test_run_blueprints
      ON test_run_blueprints.id = q.blueprint_id
    WHERE timestamp > $1
      AND q.rerun_num > 1
      AND (
        (q.result_spec IS NULL AND q.previous_result_spec IS NOT NULL)
        OR (q.result_spec IS NOT NULL AND q.previous_result_spec IS NULL)
        OR (q.result_spec != q.previous_result_spec)
      )
    `,
    [cutoff.toString()],
  );

  // Find the flaky tests in each flaky test rerun
  const newTestFlakes: Tables["test_flakes"][] = [];
  for (const row of flakyTestReruns.rows) {
    const results = ResultSpec.decodeIDResults(
      row.result_spec,
      row.test_blueprint_ids,
    );
    const prevResults = ResultSpec.decodeIDResults(
      row.previous_result_spec,
      row.test_blueprint_ids,
    );

    // Determine which tests changed between the two test runs
    for (const [id, result] of results) {
      const prevResult = prevResults.get(id);

      // Safety check: this shouldn't happen
      if (prevResult === undefined) {
        throw new Error("Test run blueprint mismatch");
      }

      // If the result changed, mark it as a flake
      if (prevResult !== result) {
        // Determine which test run had the failing test, as it's much more
        // helpful to record the flake against the failing test run
        const failureInCurrentRun = !result;

        newTestFlakes.push({
          test_run_source: failureInCurrentRun
            ? row.source
            : row.previous_source,
          test_run_ext_id: failureInCurrentRun
            ? row.ext_id
            : row.previous_ext_id,
          test_id: id,
        });
      }
    }
  }

  // Insert the new test flakes
  if (newTestFlakes.length > 0) {
    await DB.query(
      "INSERT INTO test_flakes (test_run_source, test_run_ext_id, test_blueprint_id) VALUES " +
        newTestFlakes
          .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
          .join(", "),
      newTestFlakes.flatMap(({ test_run_source, test_run_ext_id, test_id }) => [
        test_run_source,
        test_run_ext_id,
        test_id,
      ]),
    );
  }

  return newTestFlakes.length;
}

/**
 * Fetches the given number of test runs, ordered by timestamp descending,
 * optionally since the given cutoff.
 */
export async function fetchSomeTestRunsSinceDesc(
  count: number,
  cutoff?: Temporal.Instant | undefined,
): Promise<
  {
    id: TestRun["id"];
    timestamp: Temporal.Instant;
    commitId: string;
    succeeded: boolean;
  }[]
> {
  return (
    await DB.query<{
      source: TestRun["id"]["source"];
      ext_id: number;
      timestamp: Temporal.Instant;
      commit_id: string;
      succeeded: boolean;
    }>(
      "SELECT source, ext_id, timestamp, commit_id, result_spec IS NOT NULL AS succeeded " +
        "FROM test_runs " +
        (cutoff === undefined ? "" : "WHERE timestamp > $2 ") +
        "ORDER BY timestamp DESC " +
        "LIMIT $1",
      [count, ...(cutoff === undefined ? [] : [cutoff.toString()])],
    )
  ).rows.map(({ source, ext_id, timestamp, commit_id, succeeded }) => ({
    id:
      source === "appveyor"
        ? { source, buildId: ext_id }
        : { source, jobId: ext_id },
    timestamp,
    commitId: commit_id,
    succeeded,
  }));
}

/**
 * Fetches the given number of test flakes, ordered by timestamp descending,
 * optionally since the given cutoff.
 */
export async function fetchSomeTestFlakesSince(
  count: number,
  cutoff?: Temporal.Instant | undefined,
): Promise<
  {
    test_run_id: TestRun["id"];
    test_title: string;
    timestamp: Temporal.Instant;
  }[]
> {
  return (
    await DB.query<{
      source: TestRun["id"]["source"];
      ext_id: number;
      timestamp: Temporal.Instant;
      title: string;
    }>(
      `
    SELECT q.test_run_source AS source, q.test_run_ext_id AS ext_id, q.timestamp, q.title
    FROM (
      SELECT test_flakes.test_run_source, test_flakes.test_run_ext_id, test_flakes.test_blueprint_id, test_runs.timestamp, test_blueprints.title
      FROM test_flakes
      LEFT JOIN test_runs
        ON test_runs.source = test_flakes.test_run_source AND test_runs.ext_id = test_flakes.test_run_ext_id
      LEFT JOIN test_blueprints
        ON test_blueprints.id = test_flakes.test_blueprint_id
    ) q
    ${cutoff === undefined ? "" : "WHERE q.timestamp > $2 "}
    ORDER BY q.timestamp DESC
    LIMIT $1
    `,
      [count, ...(cutoff === undefined ? [] : [cutoff.toString()])],
    )
  ).rows.map(({ source, ext_id, timestamp, title }) => ({
    test_run_id:
      source === "appveyor"
        ? { source, buildId: ext_id }
        : { source, jobId: ext_id },
    test_title: title,
    timestamp,
  }));
}
