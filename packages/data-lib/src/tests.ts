import { Temporal } from "@js-temporal/polyfill";
import { createHash } from "crypto";
import { db } from "./db.js";

/**
 * The JS representation of a Blueprint ID. See `docs/db-design.rst` for more
 * information.
 */
export type BlueprintID = string;

/**
 * The JS representation of a list of Blueprint IDs. See `docs/db-design.rst`
 * for more information.
 */
export type BlueprintIDList = Buffer;

export interface TestRun {
  results: TestResult[];
  timestamp: Temporal.Instant;
  branch: string | null;
}

export interface TestResult {
  title: string;
  passed: boolean;
}

/**
 * Converts a Blueprint ID buffer to its JS representation.
 */
function bufToBlueprintID(buf: Buffer): BlueprintID {
  return buf.readBigInt64BE().toString(10);
}

/**
 * Derives the Blueprint ID for a TestResult given the structure contents.
 */
function deriveTestBlueprintIDBuf(title: string): Buffer {
  return createHash("shake256", { outputLength: 8 }).update(title).digest();
}

/**
 * Derives the Blueprint ID for a TestRun given the structure contents.
 */
function deriveTestRunBlueprintIDBuf(testIDs: Buffer[]): Buffer {
  return testIDs
    .sort((a, b) => a.compare(b))
    .reduce(
      (hash, id) => hash.update(id),
      createHash("sha256", { outputLength: 8 }),
    )
    .digest();
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
  const result = Buffer.alloc(1 + 8 * idsToEncode);

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
    const id = deriveTestBlueprintIDBuf(title);
    id.copy(result, offset);
    offset += 8;
  }

  return result;
}

/**
 * Creates a test run in the database.
 */
export async function createTestRun(testRun: TestRun): Promise<void> {
  const testBlueprints = testRun.results.map(({ title }) => ({
    id: deriveTestBlueprintIDBuf(title),
    title,
  }));

  // Insert the test blueprints
  await db("test_blueprints")
    .insert(
      testBlueprints.map(({ id, title }) => ({ id: id.toString(), title })),
    )
    .onConflict("blueprint_id")
    .ignore();

  // Insert the test run blueprint
  const testRunBlueprintID = bufToBlueprintID(
    deriveTestRunBlueprintIDBuf(testBlueprints.map(({ id }) => id)),
  );
  await db("test_run_blueprints").insert({
    id: testRunBlueprintID,
    test_blueprint_ids: Buffer.concat(testBlueprints.map(({ id }) => id)),
  });

  // Insert the test run
  await db("test_runs")
    .insert({
      blueprint_id: testRunBlueprintID,
      timestamp: testRun.timestamp.toString(),
      result_spec: encodeResultSpec(testRun.results),
      branch: testRun.branch ?? undefined,
    })
    .onConflict(["blueprint_id", "timestamp"])
    .merge();
}
