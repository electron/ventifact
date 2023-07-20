import { Temporal } from "@js-temporal/polyfill";
// import { db } from "./db.js";

/**
 * The JS representation of a Blueprint ID. See `docs/db-design.rst` for more
 * information.
 */
export type BlueprintID = string;

/**
 * The JS representation of a list of Blueprint IDs. See `docs/db-design.rst`
 * for more information.
 */
export type BlueprintIDList = string;

export interface TestRun {
  results: TestResult[];
  timestamp: Temporal.ZonedDateTime;
  branch: string | null;
}

export interface TestResult {
  title: string;
  passed: boolean;
}

export async function createTestRun(testRun: TestRun): Promise<void> {
  // TODO
}
