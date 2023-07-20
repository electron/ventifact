import { Temporal } from "@js-temporal/polyfill";
import got, { Got } from "got";

export class Client {
  #http: Got;

  constructor(authToken: string) {
    this.#http = got.extend({
      prefixUrl: "https://api.github.com/",
      headers: {
        Authorization: `token ${authToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  }

  /**
   * Paginate a GraphQL query using variables.
   *
   * @param query The GraphQL query.
   * @param initialVars The initial variables to use.
   * @param paginate A function that returns the next set of variables to use,
   *                 or `false` to stop paginating.
   * @param transform A function that transforms the response into a list of
   *                  items to yield.
   */
  #paginateGraphQL<T, Vars, Response>(
    query: string,
    initialVars: Vars,
    paginate: (response: Response) => Vars | false,
    transform: (response: Response) => T[],
  ): AsyncIterableIterator<T> {
    return this.#http.paginate<T, Response>("graphql", {
      method: "POST",
      json: {
        query,
        variables: initialVars,
      },
      responseType: "json",
      pagination: {
        paginate({ response }) {
          const vars = paginate(response.body);
          if (vars !== false) {
            return {
              json: {
                query,
                variables: vars,
              },
            };
          } else {
            return false;
          }
        },
        transform(response) {
          return transform(response.body);
        },
      },
    });
  }

  /**
   * Yields a stream of merged pull requests, starting with the most recently
   * merged PR and ending when the cutoff is reached or the list of merged PRs
   * is exhausted.
   */
  mergedPRsAfterDesc(
    owner: string,
    repo: string,
    after: Temporal.Instant,
  ): AsyncIterableIterator<MergedPR> {
    interface QueryResponse {
      data: {
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
                    } | null;
                  };
                }[];
              };
            }[];
          };
        };
      };
    }

    return this.#paginateGraphQL<
      MergedPR,
      {
        owner: string;
        repo: string;
        cursor?: string;
      },
      QueryResponse
    >(
      `
      query($owner: String!, $repo: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
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
      {
        owner,
        repo,
      },
      (response: QueryResponse) => {
        // If the oldest PR is before the cutoff, then stop paginating
        const oldestPRUpdatedAt =
          response.data.repository.pullRequests.nodes[0]?.updatedAt;
        if (
          oldestPRUpdatedAt === undefined ||
          Temporal.Instant.compare(oldestPRUpdatedAt, after) < 0
        ) {
          return false;
        }

        // Continue paginating using the cursor provided in the response
        return {
          owner,
          repo,
          cursor: response.data.repository.pullRequests.pageInfo.endCursor,
        };
      },
      (response: QueryResponse) => {
        // Edge case: if there are no PRs, return an empty list
        if (response.data.repository.pullRequests.nodes.length === 0) {
          return [];
        }

        // Get the PRs and their update times from the response
        const prs: {
          pr: MergedPR;
          updatedAt: string;
        }[] = response.data.repository.pullRequests.nodes.map(
          ({ number, mergedAt, updatedAt, commits }) => {
            // Determine the status of the PR
            let status: MergedPR["status"];
            switch (commits.nodes[0]?.commit.statusCheckRollup?.state) {
              case "SUCCESS":
                status = "success";
                break;
              case "FAILURE":
              case "ERROR":
                status = "failure";
                break;
              case "PENDING":
              case "EXPECTED":
                status = "neutral";
                break;
              default:
                status = "unknown";
                break;
            }

            return {
              pr: {
                number,
                mergedAt,
                status,
              },
              updatedAt,
            };
          },
        );

        // Determine which PRs are before the cutoff: if the oldest is before
        // the cutoff, then slice the list of PRs to the first PR that is after
        // the cutoff; otherwise, return the entire list of PRs since they're
        // sorted in descending order by update time
        const oldestIsBeforeCutoff =
          Temporal.Instant.compare(prs[prs.length - 1].updatedAt, after) < 0;
        const prsWithinCutoff = oldestIsBeforeCutoff
          ? prs.slice(
              0,
              prs.findIndex(
                ({ updatedAt }) =>
                  Temporal.Instant.compare(updatedAt, after) < 0,
              ),
            )
          : prs;
        return prsWithinCutoff.map(({ pr }) => pr);
      },
    );
  }
}

export interface MergedPR {
  number: number;
  mergedAt: string;
  status: "success" | "failure" | "neutral" | "unknown";
}
