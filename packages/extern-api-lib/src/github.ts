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
   * Iterates over merged pull requests in desceding order of last update time.
   */
  mergedPRsDesc(owner: string, repo: string): AsyncIterableIterator<MergedPR> {
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
        } | null;
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
      (resp) =>
        resp.data.repository !== null &&
        resp.data.repository.pullRequests.pageInfo.hasNextPage
          ? {
              owner,
              repo,
              cursor: resp.data.repository.pullRequests.pageInfo.endCursor,
            }
          : false,
      (resp) => {
        // Edge case: API errors
        if (resp.data.repository === null) {
          throw new Error("GitHub API failure: " + JSON.stringify(resp.data));
        }

        // Alias to the PR nodes
        const nodes = resp.data.repository.pullRequests.nodes;

        // Edge case: if there are no PRs, return an empty list
        if (nodes.length === 0) {
          return [];
        }

        // Convert the PR nodes to our own merged PR format
        return nodes.map(({ number, mergedAt, updatedAt, commits }) => {
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
            number,
            mergedAt,
            updatedAt,
            status,
          };
        });
      },
    );
  }
}

export interface MergedPR {
  number: number;
  mergedAt: string;
  updatedAt: string;
  status: "success" | "failure" | "neutral" | "unknown";
}
