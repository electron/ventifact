import got, { Got } from "got";

export class Client {
  #http: Got;

  constructor(authToken: string) {
    this.#http = got.extend({
      prefixUrl: "https://ci.appveyor.com/api/",
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });
  }

  builds(
    accountName: string,
    projectSlug: string,
  ): AsyncIterableIterator<Build> {
    interface ProjHistory {
      builds: Build[];
    }

    return this.#http.paginate<Build, ProjHistory>(
      `projects/${accountName}/${projectSlug}/history`,
      {
        responseType: "json",
        pagination: {
          paginate({ currentItems }) {
            // Stop when there's no more builds
            if (currentItems.length === 0) {
              return false;
            }

            // Start at the last build we got
            const lastBuild = currentItems[currentItems.length - 1];
            return {
              searchParams: {
                startBuildId: lastBuild.buildId,
              },
            };
          },
          transform(response) {
            return response.body.builds;
          },
        },
      },
    );
  }

  buildJobLog(jobId: string): Promise<string> {
    return this.#http
      .get(`buildjobs/${jobId}/log`, {
        responseType: "text",
      })
      .text();
  }
}

export interface Build {
  buildId: number;
  jobs: Job[];
  branch: string;
  commitId: string;
}

export interface Job {
  jobId: string;
  messagesCount: number;
  testsCount: number;
}
