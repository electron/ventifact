import { Tables } from "./lib.js";

/**
 * This module specifies concrete types for the database schema.
 */
declare module "knex/types/tables" {
  interface Tables {
    // tests: Tables.Test;
    // test_runs: Tables.TestRun;
    // test_results: Tables.TestResult;
    prs: Tables.PR;
  }
}
