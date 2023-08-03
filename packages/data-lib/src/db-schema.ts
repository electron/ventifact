import { Temporal } from "@js-temporal/polyfill";
import * as DB from "./db.js";

export interface Tables {
  prs: {
    number: number;
    merged_at: Temporal.Instant;
    status: "success" | "failure" | "neutral" | "unknown";
  };
  test_blueprints: {
    id: bigint;
    title: string;
  };
  test_run_blueprints: {
    id: bigint;
    test_blueprint_ids: Tables["test_blueprints"]["id"][];
  };
  test_runs: {
    source: "appveyor" | "circleci";
    ext_id: number;
    blueprint_id: Tables["test_run_blueprints"]["id"];
    timestamp: Temporal.Instant;
    branch: string | null;
    commit_id: Buffer;
    result_spec: Buffer | null;
  };
  test_flakes: {
    test_run_source: Tables["test_runs"]["source"];
    test_run_ext_id: Tables["test_runs"]["ext_id"];
    test_id: Tables["test_blueprints"]["id"];
  };
}

type TableName = keyof Tables;

/**
 * Creates database tables.
 */
export const create: Record<TableName, () => Promise<void>> = {
  async prs() {
    await DB.query(
      "CREATE TYPE prs_status AS ENUM ('success', 'failure', 'neutral', 'unknown');" +
        "CREATE TABLE prs (" +
        "number    integer     PRIMARY KEY," +
        "merged_at timestamptz NOT NULL," +
        "status    prs_status  NOT NULL" +
        ")",
    );
  },
  async test_blueprints() {
    await DB.query(
      "CREATE TABLE test_blueprints (" +
        "id    bigint PRIMARY KEY," +
        "title text   NOT NULL" +
        ")",
    );
  },
  async test_run_blueprints() {
    await DB.query(
      "CREATE TABLE test_run_blueprints (" +
        "id                 bigint   PRIMARY KEY," +
        "test_blueprint_ids bigint[] NOT NULL" +
        ")",
    );
  },
  async test_runs() {
    await DB.query(
      "CREATE TYPE test_runs_source AS ENUM ('appveyor', 'circleci');" +
        "CREATE TABLE test_runs (" +
        "source       test_runs_source NOT NULL," +
        "ext_id       integer          NOT NULL," +
        "blueprint_id bigint           NOT NULL," +
        "timestamp    timestamptz      NOT NULL," +
        "branch       text," +
        "commit_id    bytea            NOT NULL," +
        "result_spec  bytea," +
        "PRIMARY KEY (source, ext_id)," +
        "FOREIGN KEY (blueprint_id) REFERENCES test_run_blueprints (id)" +
        ")",
    );
  },
  async test_flakes() {
    await DB.query(
      "CREATE TABLE test_flakes (" +
        "test_run_source   test_runs_source NOT NULL," +
        "test_run_ext_id   integer          NOT NULL," +
        "test_blueprint_id bigint           NOT NULL," +
        "FOREIGN KEY (test_run_source, test_run_ext_id) REFERENCES test_runs (source, ext_id)," +
        "FOREIGN KEY (test_blueprint_id) REFERENCES test_blueprints (id)" +
        ")",
    );
  },
};

/**
 * Drops a database table if it exists.
 */
export const drop: Record<TableName, () => Promise<void>> = {
  async prs() {
    await DB.query("DROP TABLE IF EXISTS prs; DROP TYPE IF EXISTS prs_status");
  },
  async test_blueprints() {
    await DB.query("DROP TABLE IF EXISTS test_blueprints");
  },
  async test_run_blueprints() {
    await DB.query("DROP TABLE IF EXISTS test_run_blueprints");
  },
  async test_runs() {
    await DB.query(
      "DROP TABLE IF EXISTS test_runs; DROP TYPE IF EXISTS test_runs_source",
    );
  },
  async test_flakes() {
    await DB.query("DROP TABLE IF EXISTS test_flakes");
  },
};
