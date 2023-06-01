import knexPkg from "knex";
const { knex } = knexPkg;

if (!process.env.PG_CONNECTION) {
  throw new Error("PG_CONNECTION environment variable is not set");
}

export const db = knex({
  client: "pg",
  connection: process.env.PG_CONNECTION,
  pool: {
    // note: these numbers have been chosen arbitrarily
    min: 0,
    max: 7,
  },
});

export namespace Tables {
  export type uuid = string;

  // export interface Test {
  //   id: uuid;
  //   title: string;
  // }

  // export interface TestRun {
  //   id: uuid;
  //   timestamp: Date;
  //   branch?: string | null;
  // }

  // export interface TestResult {
  //   test_run: uuid;
  //   test: uuid;
  //   status: "pass" | "fail" | "unknown";
  // }

  export interface PR {
    number: number;
    merged_at: Date;
    status: "success" | "failure" | "neutral" | "unknown";
  }
}

// /**
//  * Gets the ID of the test with the given title, or creates a new test with
//  * that title and returns its ID.
//  */
// export async function getOrCreateTestIdByTitle(title: string): Promise<Tables.uuid> {
//   // Check if a test with that title already exists.
//   const existing = await db("tests").select("id").where({ title }).first();
//   if (existing) {
//     return existing.id;
//   }

//   // Otherwise, insert a new test and return its ID.
//   const [{ id }] = await db("tests").insert({ title }).returning("id");
//   return id;
// }
