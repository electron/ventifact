import { Knex } from "knex";
import { BlueprintID, BlueprintIDList } from "./tests.ts";

/**
 * Given a table with `Date` fields, converts it to accept `string` values for
 * those fields when inserting, updating, or upserting.
 */
type UpsertDatesAsString<T> = Knex.CompositeTableType<
  // Base, used when returning rows
  T,
  // Inserts, updates, and upserts
  {
    [K in keyof T]: T[K] extends Date ? string : T[K];
  }
>;

/**
 * This module specifies concrete types for the database schema.
 */
declare module "knex/types/tables.js" {
  interface Tables {
    test_blueprints: {
      id: BlueprintID;
      title: string;
    };
    test_run_blueprints: {
      id: BlueprintID;
      test_blueprint_ids: BlueprintIDList;
    };
    test_runs: Knex.CompositeTableType<
      {
        blueprint_id: BlueprintID;
        timestamp: Date;
        result_spec: Buffer;
        branch: string;
      },
      {
        blueprint_id: BlueprintID;
        timestamp: string;
        result_spec?: Buffer;
        branch?: string;
      }
    >;
    prs: UpsertDatesAsString<{
      number: number;
      merged_at: Date;
      status: "success" | "failure" | "neutral" | "unknown";
    }>;
  }
}
