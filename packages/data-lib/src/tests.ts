import { Temporal } from "@js-temporal/polyfill";
import { createHash } from "crypto";
import { db } from "./db.js";

export interface TestRun {
  id:
    | { source: "unknown"; id: Buffer }
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
   * Convert this Blueprint ID to a string suitable for use in the database.
   */
  toDbId(): string {
    return this.toInt64().toString(10);
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

  /**
   * Create a buffer containing the concatenation of all the Blueprint IDs in
   * this list.
   */
  toConcatenatedBuffer(): Buffer {
    return Buffer.concat(this.#ids.map((id) => id.asBuffer()));
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

function encodeTestRunID(id: TestRun["id"]): Buffer {
  const contentLength = id.source === "unknown" ? id.id.length : 4;
  const result = Buffer.alloc(1 + contentLength);

  // Encode the source tag
  switch (id.source) {
    case "unknown":
      result.writeUInt8(0);
      break;
    case "appveyor":
      result.writeUInt8(1);
      break;
    case "circleci":
      result.writeUInt8(2);
      break;
  }

  // Encode the content
  switch (id.source) {
    case "unknown":
      id.id.copy(result, 1);
      break;
    case "appveyor":
      result.writeUInt32BE(id.buildId, 1);
      break;
    case "circleci":
      result.writeUInt32BE(id.jobId, 1);
      break;
  }

  return result;
}

/**
 * A set of known test blueprint IDs, used to avoid unnecessary database
 * queries and inserts when possible.
 */
const KNOWN_TEST_BLUEPRINT_IDS = new Set<bigint>();

/**
 * Ensures that the given test blueprints exist in the database. Only test
 * blueprints that are not already known to exist will be inserted.
 */
async function ensureTestBlueprintsExist(
  blueprints: { id: BlueprintID; title: string }[],
): Promise<void> {
  const unknownBlueprints = blueprints.filter(
    ({ id }) => !KNOWN_TEST_BLUEPRINT_IDS.has(id.toInt64()),
  );

  // If all of the blueprints are known, we can skip the database query 🎉
  if (unknownBlueprints.length === 0) {
    return;
  }

  // Insert the unknown blueprints
  await db("test_blueprints")
    .insert(
      blueprints.map(({ id, title }) => ({
        id: id.toDbId(),
        title,
      })),
    )
    .onConflict("id")
    .ignore();

  // Add the new blueprints to the known set
  for (const { id } of unknownBlueprints) {
    KNOWN_TEST_BLUEPRINT_IDS.add(id.toInt64());
  }
}

/**
 * Creates a test run in the database.
 */
export async function createTestRun(testRun: TestRun): Promise<void> {
  // As a heuristic, ensure these are Electron tests by checking for a test that
  // includes "BrowserWindow", the giveaway of an Electron test run.
  if (!testRun.results.some(({ title }) => title.includes("BrowserWindow"))) {
    console.debug("Ignoring non-Electron test run");
    return;
  }

  const testBlueprints = testRun.results.map(({ title }) => ({
    id: deriveBlueprintIDForTestBlueprint(title),
    title,
  }));

  // Ensure the test blueprints exist in the database, inserting them if needed
  await ensureTestBlueprintsExist(testBlueprints);

  // Insert the test run blueprint
  const blueprintIDs = new BlueprintIDList(testBlueprints.map(({ id }) => id));
  const testRunBlueprintIDStr = blueprintIDs.deriveBlueprintID().toDbId();

  await db("test_run_blueprints")
    .insert({
      id: testRunBlueprintIDStr,
      test_blueprint_ids: blueprintIDs.toConcatenatedBuffer(),
    })
    .onConflict("id")
    .ignore();

  // Insert the test run
  await db("test_runs")
    .insert({
      id: encodeTestRunID(testRun.id),
      blueprint_id: testRunBlueprintIDStr,
      timestamp: testRun.timestamp.toString(),
      branch: testRun.branch ?? undefined,
      result_spec: encodeResultSpec(testRun.results),
    })
    .onConflict("id")
    .ignore();
}
