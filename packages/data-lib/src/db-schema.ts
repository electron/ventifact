import * as DB from "./db.js";

export interface Tables {
  prs: {
    number: number;
    merged_at: Date;
    status: "success" | "failure" | "neutral" | "unknown";
  };
  test_blueprints: {
    id: bigint;
    title: string;
  };
  test_run_blueprints: {
    id: bigint;
    test_blueprint_ids: Buffer;
  };
  test_runs: {
    source: string;
    ext_id: number;
    blueprint_id: bigint;
    timestamp: Date;
    branch: string | null;
    result_spec: Buffer | null;
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
        "id                 bigint PRIMARY KEY," +
        "test_blueprint_ids bytea  NOT NULL" +
        ")",
    );
  },
  async test_runs() {
    await DB.query(
      "CREATE TABLE test_runs (" +
        "source       text        NOT NULL," +
        "ext_id       integer     NOT NULL," +
        "blueprint_id bigint      NOT NULL," +
        "timestamp    timestamptz NOT NULL," +
        "branch       text," +
        "result_spec  bytea," +
        "PRIMARY KEY (source, ext_id)," +
        "FOREIGN KEY (blueprint_id) REFERENCES test_run_blueprints (id)" +
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
    await DB.query("DROP TABLE IF EXISTS test_runs");
  },
};
