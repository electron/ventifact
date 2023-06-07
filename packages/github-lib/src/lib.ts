import { Temporal } from "@js-temporal/polyfill";
import { graphql } from "@octokit/graphql";

// Error early if the auth token isn't provided
if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable is not set");
}

/**
 * Resolves after a given number of milliseconds.
 */
function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A small wrapper around fetch that handles rate limiting
const githubFetch: typeof fetch = async (input, init) => {
  // Continue to retry until we succeed
  while (true) {
    const response = await fetch(input, init);

    // If we succeeded, then return the response
    if (response.ok) {
      return response;
    }

    console.warn(`Request failed with status ${response.status}...`);

    // Wait for the rate limit to reset
    let delay = 20 * 1000; // 20 seconds

    // Check the headers for hints on how long to wait for
    const { headers } = response;
    if (headers.has("Retry-After")) {
      // The Retry-After header indicates how many seconds to wait before
      // retrying this request
      delay = parseInt(headers.get("Retry-After")!) * 1000;
    } else if (headers.has("X-RateLimit-Reset")) {
      // The X-RateLimit-Reset header indicates the time at which the rate limit
      // will reset, in seconds since the Unix epoch
      delay = Temporal.Instant.fromEpochSeconds(
        parseInt(headers.get("X-RateLimit-Reset")!),
      )
        .since(Temporal.Now.instant())
        .total("milliseconds");
    }

    // Add a little bit of time, just to be safe
    delay += 420;

    console.warn(`Rate limited, retrying in ${delay}ms...`);
    await timeout(delay);
  }
};

// Create a GraphQL client with the necessary auth header
const github = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
  request: {
    fetch: githubFetch,
  },
});

/**
 * Information about a merged pull request.
 */
export interface MergedPR {
  number: number;
  mergedAt: string;
  status: "success" | "failure" | "neutral" | "unknown";
}

/**
 * Returns a stream of merged pull requests, starting with the most recent and
 * ending when the cutoff is reached (or when we reach the oldest PR).
 */
export async function* getMergedPRsUntil(
  cutoff: Temporal.Instant,
): AsyncGenerator<MergedPR> {
  // The cursor is used to paginate through the results
  let cursor: string | undefined;

  // Repeatedly fetch the next page of results
  while (true) {
    // NOTE: only the GraphQL API supports querying for the status check rollup,
    // so we have to use that instead of the REST API.
    //
    // Query the next page of merged PRs
    const response = await github<{
      repository: {
        pullRequests: {
          pageInfo: {
            hasNextPage: boolean;
            endCursor: string;
          };
          nodes: {
            updatedAt: string;
            mergedAt: string;
            number: number;

            commits: {
              nodes: {
                commit: {
                  statusCheckRollup: {
                    state:
                      | "SUCCESS"
                      | "FAILURE"
                      | "PENDING"
                      | "ERROR"
                      | "EXPECTED";
                  };
                };
              }[];
            };
          }[];
        };
      };
    }>(
      `
      query($cursor: String) {
        repository(owner: "electron", name: "electron") {
          pullRequests(
            first: 20
            after: $cursor
            states: MERGED
            orderBy: { field: UPDATED_AT, direction: DESC }
          ) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              updatedAt
              mergedAt
              number

              commits(last: 1) {
                nodes {
                  commit {
                    statusCheckRollup {
                      state
                    }
                  }
                }
              }
            }
          }
        }
      }
      `,
      { cursor },
    );

    // Extract the PRs and the page metadata from the response
    const { pageInfo, nodes: prs } = response.repository.pullRequests;

    // Whether we've reached the cutoff
    let reachedCutoff = false;

    for (const pr of prs) {
      // Determine if we've reached the cutoff
      if (Temporal.Instant.compare(pr.updatedAt, cutoff) < 0) {
        console.info("Reached cutoff");
        reachedCutoff = true;
        break;
      }

      // Determine if this PR was merged before the cutoff. If it was, skip it.
      // This isn't stopping criteria since this PR may have been **updated**
      // after a more-recently-**merged** PR was merged.
      if (Temporal.Instant.compare(pr.mergedAt, cutoff) < 0) {
        continue;
      }

      // Ensure that there's at least one commit
      if (pr.commits.nodes.length <= 0) {
        console.warn(`PR #${pr.number} has no commits? Skipping...`);
        continue;
      }

      const { commit } = pr.commits.nodes[0];

      // Sometimes very old PRs are bumped. Those PRs don't have statuses or
      // checks, so they don't have a rollup. Skip them since they're old.
      if (commit.statusCheckRollup === null) {
        continue;
      }

      // Determine the status of the PR
      let status: MergedPR["status"] = "unknown";
      switch (commit.statusCheckRollup.state) {
        case "SUCCESS":
          status = "success";
          break;
        case "FAILURE":
        case "ERROR":
          status = "failure";
          break;
        case "PENDING":
        case "EXPECTED":
          status = "unknown";
          break;
        default:
          console.warn(
            `PR with unknown status: ${commit.statusCheckRollup.state}`,
          );
          status = "neutral";
          break;
      }

      // Yield the PR
      yield {
        number: pr.number,
        mergedAt: pr.mergedAt,
        status,
      };
    }

    // Stop if we've reached the cutoff
    if (reachedCutoff) {
      break;
    }

    // Update the pagination cursor (or break if we're done)
    if (pageInfo.hasNextPage) {
      cursor = pageInfo.endCursor;
    } else {
      break;
    }
  }
}
