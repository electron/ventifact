import got, { Got, Request } from "got";

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

  projBuildHistory(
    accountName: string,
    projectSlug: string,
  ): AsyncIterableIterator<HistoryBuild> {
    interface ProjHistory {
      builds: HistoryBuild[];
    }

    return this.#http.paginate<HistoryBuild, ProjHistory>(
      `projects/${accountName}/${projectSlug}/history`,
      {
        responseType: "json",
        searchParams: {
          recordsNumber: 20,
        },
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

  build(
    accountName: string,
    projectSlug: string,
    buildId: number,
  ): Promise<Build> {
    interface BuildResponse {
      build: Build;
    }

    return this.#http
      .get(`projects/${accountName}/${projectSlug}/builds/${buildId}`)
      .json<BuildResponse>()
      .then((resp) => resp.build);
  }

  buildJobLogStream(jobId: string): Request {
    return this.#http.get(`buildjobs/${jobId}/log`, {
      responseType: "text",
      isStream: true,
    });
  }
}

export interface Build {
  buildId: number;
  jobs: Job[];
  branch: string;
  created: string;
  status: string; // "success" | "failed" | "queued" | "running" | "cancelled", maybe more
}

/**
 * A build from the build history list in a project.
 *
 * This object is notably different from the full build object in that it does
 * not return information about the jobs in the build.
 */
export type HistoryBuild = Omit<Build, "jobs">;

export interface Job {
  jobId: string;
  messagesCount: number;
  testsCount: number;
}
