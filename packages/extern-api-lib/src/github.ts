import { App as BaseOctokitApp } from "@octokit/app";
import { Octokit as BaseOctokit } from "@octokit/core";
import { paginateGraphql } from "@octokit/plugin-paginate-graphql";

// This is some type fiddling to get an Octokit & App type with type information
// about the plugins used
const Octokit = BaseOctokit.plugin(paginateGraphql);
type Octokit = InstanceType<typeof Octokit>;
const OctokitApp = BaseOctokitApp.defaults({ Octokit });
type OctokitApp = InstanceType<typeof OctokitApp>;

export class AppClient {
  #app: OctokitApp;

  constructor(appId: number, appPrivateKey: string) {
    this.#app = new OctokitApp({
      appId,
      privateKey: appPrivateKey,
    });
  }

  /**
   * Iterates over merged pull requests in desceding order of last update time.
   */
  async *mergedPRsDesc(
    owner: string,
    repo: string,
  ): AsyncGenerator<MergedPR, void, void> {
    interface QueryResponse {
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
    }

    // Get an octokit client for the installation of this app on the repo
    const installation = await this.#app.octokit.request(
      "GET /repos/{owner}/{repo}/installation",
      {
        owner,
        repo,
      },
    );
    const octokit = await this.#app.getInstallationOctokit(
      installation.data.id,
    );

    const iter = octokit.graphql.paginate.iterator<QueryResponse>(
      `
      query paginate($cursor: String, $owner: String!, $repo: String!) {
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
    );

    // Paginate over pull requests
    for await (const {
      repository: {
        pullRequests: { nodes: prs },
      },
    } of iter) {
      // Convert and yield each PR
      for (const { number, mergedAt, updatedAt, commits } of prs) {
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

        yield {
          number,
          mergedAt,
          updatedAt,
          status,
        };
      }
    }
  }
}

export interface MergedPR {
  number: number;
  mergedAt: string;
  updatedAt: string;
  status: "success" | "failure" | "neutral" | "unknown";
}
