import { Temporal, toTemporalInstant } from "@js-temporal/polyfill";
import { createHash } from "crypto";
import { db, transaction } from "./db.js";
import { Tables } from "./db-schema.js";
import QueryStream from "pg-query-stream";

export interface TestRun {
  id:
    | { source: "appveyor"; buildId: number }
    | { source: "circleci"; jobId: number };
  results: TestResult[];
  timestamp: Temporal.Instant;
  branch?: string;
}

export interface TestResult {
  title: string;
  passed: boolean;
}

/**
 * The expected size of a Blueprint ID in bytes.
 */
const BLUEPRINT_ID_BUFFER_SIZE = 8;

export class BlueprintID {
  #digest: Buffer;

  constructor(digest: Buffer) {
    // We expect a 64-bit digest
    if (digest.length !== BLUEPRINT_ID_BUFFER_SIZE) {
      throw new Error("Expected a 64-bit digest");
    }

    this.#digest = digest;
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

export class BlueprintIDList {
  #ids: BlueprintID[];

  constructor(ids: BlueprintID[]) {
    // Store the IDs in sorted order
    this.#ids = ids.sort((a, b) => a.asBuffer().compare(b.asBuffer()));
  }

  /**
   * Parses a list of Blueprint IDs from a buffer of concatenated Blueprint IDs.
   */
  static fromConcatenatedBuffer(buffer: Buffer): BlueprintIDList {
    // Ensure the buffer is a multiple of the expected size
    if (buffer.length % BLUEPRINT_ID_BUFFER_SIZE !== 0) {
      throw new Error("Expected a multiple of 8 bytes");
    }

    // Parse the buffer into individual Blueprint IDs
    const ids = [];
    for (let i = 0; i < buffer.length; i += BLUEPRINT_ID_BUFFER_SIZE) {
      ids.push(
        new BlueprintID(buffer.subarray(i, i + BLUEPRINT_ID_BUFFER_SIZE)),
      );
    }

    return new BlueprintIDList(ids);
  }

  /**
   * Create a buffer containing the concatenation of all the Blueprint IDs in
   * this list.
   */
  toConcatenatedBuffer(): Buffer {
    return Buffer.concat(this.#ids.map((id) => id.asBuffer()));
  }

  /**
   * Iterates over each Blueprint ID in this list.
   */
  [Symbol.iterator](): IterableIterator<BlueprintID> {
    return this.#ids[Symbol.iterator]();
  }

  /**
   * Derive a blueprint ID for this list.
   */
  deriveBlueprintID(): BlueprintID {
    return new BlueprintID(
      this.#ids
        .reduce(
          (hash, id) => hash.update(id.asBuffer()),
          createHash("shake256", { outputLength: BLUEPRINT_ID_BUFFER_SIZE }),
        )
        .digest(),
    );
  }
}

/**
 * Derives the Blueprint ID for a test blueprint given its structure.
 */
function deriveBlueprintIDForTestBlueprint(title: string): BlueprintID {
  return new BlueprintID(
    createHash("shake256", { outputLength: BLUEPRINT_ID_BUFFER_SIZE })
      .update(title)
      .digest(),
  );
}

/**
 * Encodes a list of test results into a Buffer following the "Result Spec"
 * section in `docs/db-design.rst`.
 */
function encodeResultSpec(results: TestResult[]): Buffer | undefined {
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

  // Allocate the resulting buffer: 1 byte for the variant tag, then 8 bytes per
  // test result
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
}

/**
 * Creates a test run in the database.
 */
export async function createTestRun(testRun: TestRun): Promise<void> {
  const testBlueprints = testRun.results.map(({ title }) => ({
    id: deriveBlueprintIDForTestBlueprint(title),
    title,
  }));
  const blueprintIDs = new BlueprintIDList(testBlueprints.map(({ id }) => id));
  const testRunBlueprintID = blueprintIDs.deriveBlueprintID();

  // Create the test run safely in a transaction
  await transaction(async (db) => {
    // Insert the test blueprints and test run blueprint
    await Promise.all([
      db.query({
        text:
          "INSERT INTO test_blueprints (id, title) " +
          `VALUES ${testBlueprints
            .map((_, i) => `($${2 * i + 1}, $${2 * i + 2})`)
            .join(",")} ` +
          "ON CONFLICT (id) DO NOTHING",
        values: testBlueprints.flatMap(({ id, title }) => [
          id.toInt64(),
          title,
        ]),
      }),
      db.query({
        text:
          "INSERT INTO test_run_blueprints (id, test_blueprint_ids) " +
          "VALUES ($1, $2) " +
          "ON CONFLICT (id) DO NOTHING",
        values: [
          testRunBlueprintID.toInt64(),
          blueprintIDs.toConcatenatedBuffer(),
        ],
      }),
    ]);

    // Insert the test run
    await db.query({
      text:
        "INSERT INTO test_runs (source, ext_id, blueprint_id, timestamp, branch, result_spec) " +
        "VALUES ($1, $2, $3, $4, $5, $6) " +
        "ON CONFLICT (source, ext_id) DO NOTHING",
      values: [
        testRun.id.source,
        testRun.id.source === "appveyor"
          ? testRun.id.buildId
          : testRun.id.jobId,
        testRunBlueprintID.toInt64(),
        testRun.timestamp.toString(),
        testRun.branch ?? undefined,
        encodeResultSpec(testRun.results),
      ],
    });
  });
}

/**
 * Deletes all test runs before the given cutoff, including cleaning up any
 * associated blueprints that are no longer referenced.
 */
export async function deleteTestRunsBefore(
  cutoff: Temporal.Instant,
): Promise<number> {
  return await transaction(async (db) => {
    // Find the test run blueprints that will become orphaned once the test
    // runs are deleted
    const orphanedTestRunBlueprints = await db.query<
      Tables["test_run_blueprints"] & { num_test_runs: number }
    >({
      text: `
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
      values: [cutoff.toString()],
    });

    // Delete the test expired runs, which must be done before deleting the
    // corresponding blueprints that reference them
    const testRunsDeletedResult = await db.query({
      text: "DELETE FROM test_runs WHERE timestamp < $1",
      values: [cutoff.toString()],
    });

    // Handle the test blueprints in any orphaned test run blueprints
    if (orphanedTestRunBlueprints.rowCount > 0) {
      // Figure out all the potentially-orphaned test blueprints
      const potentiallyOrphanedTestBlueprintIDs = new Set<bigint>();
      for (const { test_blueprint_ids } of orphanedTestRunBlueprints.rows) {
        const blueprintIDs =
          BlueprintIDList.fromConcatenatedBuffer(test_blueprint_ids);
        for (const id of blueprintIDs) {
          potentiallyOrphanedTestBlueprintIDs.add(id.toInt64());
        }
      }

      // Try to eliminate every potentially-orphaned test blueprint by finding
      // if there exists any other test run blueprint that references it
      const stream = new QueryStream(
        "SELECT id, test_blueprint_ids FROM test_run_blueprints " +
          "WHERE id <> ALL ($1)",
        [orphanedTestRunBlueprints.rows.map(({ id }) => id)],
      );
      const streamQuery = db.query(stream) as AsyncIterable<
        Tables["test_run_blueprints"]
      >;

      for await (const { test_blueprint_ids } of streamQuery) {
        // Remove all of this test run blueprint's test blueprint IDs from the
        // set of potentially-orphaned test blueprints
        const blueprintIDs =
          BlueprintIDList.fromConcatenatedBuffer(test_blueprint_ids);
        for (const id of blueprintIDs) {
          potentiallyOrphanedTestBlueprintIDs.delete(id.toInt64());
        }

        // If the set is now empty, we can stop early
        if (potentiallyOrphanedTestBlueprintIDs.size === 0) {
          break;
        }
      }

      // Delete the identified orphaned test blueprints
      if (potentiallyOrphanedTestBlueprintIDs.size > 0) {
        await db.query({
          text: "DELETE FROM test_blueprints WHERE id = ANY ($1)",
          values: [Array.from(potentiallyOrphanedTestBlueprintIDs)],
        });
      }

      // Delete the identified orphaned test run blueprints
      await db.query({
        text: "DELETE FROM test_run_blueprints WHERE id = ANY ($1)",
        values: [orphanedTestRunBlueprints.rows.map(({ id }) => id)],
      });
    }

    return testRunsDeletedResult.rowCount;
  });
}

/**
 * Find the latest test run timestamp for the given source type and returns it.
 */
export async function getLatestTestRunTimestampForSource(
  source: TestRun["id"]["source"],
): Promise<Temporal.Instant | undefined> {
  const latestTimestampQuery = await db.query<Date[]>({
    text: "SELECT MAX(timestamp) FROM test_runs WHERE source = $1",
    values: [source],
    rowMode: "array",
  });
  const latestTimestamp = latestTimestampQuery.rows[0]?.[0];

  if (latestTimestamp === undefined) {
    return undefined;
  }

  return toTemporalInstant.call(latestTimestamp);
}

/**
 * Checks if the given test run exists in the database.
 */
export async function checkTestRunExistsById(
  id: TestRun["id"],
): Promise<boolean> {
  const result = await db.query({
    text: "SELECT 1 FROM test_runs WHERE source = $1 AND ext_id = $2",
    values: [id.source, id.source === "appveyor" ? id.buildId : id.jobId],
  });

  return result.rowCount > 0;
}
