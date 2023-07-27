import { PR, TestRun, createTestRun, streamPRsByMergedAtAsc } from "data-lib";
import { JUnit, Test } from "format-lib";
import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { Temporal } from "@js-temporal/polyfill";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

/**
 * This token is used by requests to some `/api` endpoints to authenticate for
 * write access to the database.
 */
const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (AUTH_TOKEN === undefined || AUTH_TOKEN.length === 0) {
  throw new Error("AUTH_TOKEN environment variable is not set");
}

/**
 * Authenticates a request, returning `true` if the request is authenticated.
 * If the request fails authentication, it will be replied to and closed so no
 * further information can be sent.
 */
function authenticate(request: FastifyRequest, reply: FastifyReply): boolean {
  if (request.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
    reply.status(401).send();
    reply.raw.end();
    return false;
  }

  return true;
}

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
    counts: Record<PR["status"], number>;
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
    const prs = streamPRsByMergedAtAsc();

    // Construct the result as PRs stream through
    const result: Result = [];
    let currentBucket: DateBucket | undefined;

    for await (const pr of prs) {
      // Determine the date this PR was merged on
      const date = pr.mergedAt
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
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

server.get("/api/merged-pr-statuses", async (_, reply) => {
  // Fetch the analysis
  const result = await PRStatusAnalysis.get();

  // Return the analysis
  reply.send(result);
});

server.put("/api/junit", async (request, reply) => {
  // Authenticate the request
  if (!authenticate(request, reply)) {
    return;
  }

  const query = request.query as Record<string, string>;

  // Check that the metadata query parameters are set
  const [rawSource, rawID, rawTimestamp, branch] = [
    "source",
    "id",
    "timestamp",
    "branch",
  ].map((key) => {
    const value = query[key];
    if (value === undefined || value.length === 0) {
      reply.status(400).send(`Expected query parameter: ${key}`);
      return undefined;
    }

    return value;
  });
  if (
    rawSource === undefined ||
    rawID === undefined ||
    rawTimestamp === undefined ||
    branch === undefined
  ) {
    return;
  }

  // Parse the ID
  let id: TestRun["id"];
  switch (rawSource) {
    case "appveyor": {
      const appveyorID = parseInt(rawID, 10);
      if (isNaN(appveyorID)) {
        reply.status(400).send("Expected appveyor ID to be a number");
        return;
      }

      id = {
        source: "appveyor",
        buildId: appveyorID,
      };
      break;
    }
    case "circleci": {
      const circleciID = parseInt(rawID, 10);
      if (isNaN(circleciID)) {
        reply.status(400).send("Expected circleci ID to be a number");
        return;
      }

      id = {
        source: "circleci",
        jobId: circleciID,
      };
      break;
    }
    default:
      reply.status(400).send("Invalid source");
      return;
  }

  // Parse the timestamp
  let timestamp: Temporal.Instant;
  try {
    timestamp = Temporal.Instant.from(rawTimestamp);
  } catch (err) {
    reply.status(400).send("Invalid timestamp, expected ISO 8601 format");
    return;
  }

  // Check that the content type is XML
  if (request.headers["content-type"] !== "application/xml") {
    reply.status(400).send("Expected content-type: application/xml");
    return;
  }

  // Validate that the request sent a string body
  if (typeof request.body !== "string" || request.body.length === 0) {
    reply.status(400).send("Expected body");
    return;
  }

  // Parse the JUnit XML, handling any errors
  let tests: Test[];
  try {
    tests = await JUnit.parse(request.body);
  } catch (err) {
    // aside: technically this can be 400 too if the XML is misencoded, but /shrug
    reply.status(422);
    return;
  }

  // Insert the tests into the database
  await createTestRun({
    id,
    results: tests.map(({ name, state }) => ({
      title: name,
      passed: state === "passed",
    })),
    timestamp,
    branch,
  });

  // Return a 201 Created response
  reply.status(201);
});

const port = parseInt(process.env.PORT!) || 3000;
server.listen(
  {
    host: process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost",
    port,
  },
  (err, addr) => {
    // Exit if the server fails to start.
    if (err) {
      server.log.error(err);
      process.exit(1);
    }

    // Otherwise, log the server address.
    server.log.info(`Server listening on ${addr}`);
  },
);
