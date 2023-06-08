import Fastify from "fastify";
import { db, Tables } from "db-lib";
import { Temporal, toTemporalInstant } from "@js-temporal/polyfill";
import fastifyStatic from "@fastify/static";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// TODO: parse JUnit XML submissions using @xml-tools/parser

const server = Fastify({
  logger:
    {
      production: true,
      development: {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
          },
        },
      },
    }[process.env.NODE_ENV ?? "development"] ?? true,
});

// Serve static files from the `web-interface` project
server.register(fastifyStatic, {
  root: path.join(
    fileURLToPath(import.meta.url),
    "..",
    "..",
    "..",
    "web-interface",
    "dist",
  ),
});

server.get("/", (_, reply) => {
  reply.sendFile("index.html");
});

/**
 * Analyzes the PR statuses in the database and caches the results for a brief
 * period of time.
 */
namespace PRStatusAnalysis {
  /**
   * A single date bucket, containing the date and the number of PRs with each
   * status type on this date.
   */
  export interface DateBucket {
    date: string;
    counts: Record<Tables.PR["status"], number>;
  }

  /** The result of the analysis. */
  export type Result = DateBucket[];

  // This stores the cached value and its expiration time
  let cache:
    | { result: Result; expires: Temporal.Instant }
    | Promise<Result>
    | undefined;

  /**
   * Computes the analysis.
   */
  async function compute(): Promise<Result> {
    // Fetch the PRs from the database in ascending order by merge date
    const prs = db<Tables.PR>("prs")
      .select("*")
      .orderBy("merged_at", "asc")
      .stream();

    // Construct the result as PRs stream through
    const result: Result = [];
    let currentBucket: DateBucket | undefined;

    for await (const pr of prs) {
      // Determine the date this PR was merged on
      const date = toTemporalInstant
        .call(pr.merged_at)
        .toZonedDateTimeISO("UTC")
        .toString();

      if (currentBucket === undefined) {
        // If there's no current bucket, then create one
        currentBucket = {
          date,
          counts: {
            success: 0,
            failure: 0,
            neutral: 0,
            unknown: 0,
          },
        };
      } else if (date !== currentBucket.date) {
        // If the date has changed, then push the current bucket and create a
        // new one
        result.push(currentBucket);
        currentBucket = {
          date,
          counts: {
            success: 0,
            failure: 0,
            neutral: 0,
            unknown: 0,
          },
        };
      }

      // Increment the count for this status
      currentBucket.counts[pr.status] += 1;
    }

    // Push the last bucket
    if (currentBucket !== undefined) {
      result.push(currentBucket);
    } else {
      console.error("No PRs found in database");
    }

    return result;
  }

  /**
   * A cached/memoized analysis.
   */
  export function get(): Promise<Result> {
    // If we have a cached result, try to use that
    if (cache !== undefined) {
      // If the cache is a promise, then we're already fetching the data
      if (cache instanceof Promise) {
        return cache;
      }

      // Check if the result is still valid
      if (Temporal.Instant.compare(Temporal.Now.instant(), cache.expires) < 0) {
        return Promise.resolve(cache.result);
      }

      // Expired, so clear it and then recompute it
      cache = undefined;
    }

    // Compute the result and cache it
    cache = compute();
    return cache;
  }
}

server.get("/merged-pr-statuses", async (_, reply) => {
  // Fetch the analysis
  const result = await PRStatusAnalysis.get();

  // Return the analysis
  reply.send(result);
});

const port = parseInt(process.env.PORT!) || 3000;
server.listen({ port }, (err, addr) => {
  // Exit if the server fails to start.
  if (err) {
    server.log.error(err);
    process.exit(1);
  }

  // Otherwise, log the server address.
  server.log.info(`Server listening on ${addr}`);
});
