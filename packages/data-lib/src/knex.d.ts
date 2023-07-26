import { Knex } from "knex";

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
      id: string;
      title: string;
    };
    test_run_blueprints: {
      id: string;
      test_blueprint_ids: Buffer;
    };
    test_runs: Knex.CompositeTableType<
      {
        id: Buffer;
        blueprint_id: string;
        timestamp: Date;
        branch: string;
        result_spec: Buffer;
      },
      {
        id: Buffer;
        blueprint_id: string;
        timestamp: string;
        branch?: string;
        result_spec?: Buffer;
      }
    >;
    prs: UpsertDatesAsString<{
      number: number;
      merged_at: Date;
      status: "success" | "failure" | "neutral" | "unknown";
    }>;
  }
}
