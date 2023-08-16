import got, { Got } from "got";

export class Client {
  #http: Got;

  constructor(authToken: string) {
    this.#http = got.extend({
      prefixUrl: "https://circleci.com/api/v2",
      headers: {
        "Circle-Token": authToken,
      },
    });
  }

  #paginate<T>(path: string): AsyncIterableIterator<T> {
    interface Items {
      items: T[];
      next_page_token?: string | null;
    }

    return this.#http.paginate<T, Items>(path, {
      responseType: "json",
      pagination: {
        paginate({ response }) {
          // Use the next page token if there is one, otherwise stop paginating
          const next = response.body.next_page_token;
          if (next !== undefined && next !== null) {
            return {
              searchParams: {
                "page-token": next,
              },
            };
          } else {
            return false;
          }
        },
        transform(response) {
          return response.body.items;
        },
      },
    });
  }

  /**
   * Fetches pipelines for the given project in descending order by creation
   * time.
   */
  pipelinesByCreationDesc(
    projectSlug: string,
  ): AsyncIterableIterator<Pipeline> {
    // NOTE: This endpoint doesn't guarantee it will return pipelines in any
    // particular order, but in practice it seems to return them in descending
    // order by creation time, so this is the best option we have.
    return this.#paginate(`project/${projectSlug}/pipeline`);
  }

  workflowsInPipeline(pipelineId: string): AsyncIterableIterator<Workflow> {
    return this.#paginate(`pipeline/${pipelineId}/workflow`);
  }

  jobsInWorkflow(workflowId: string): AsyncIterableIterator<Job> {
    return this.#paginate(`workflow/${workflowId}/job`);
  }

  testMetadataInJob(
    projectSlug: string,
    jobNum: number,
  ): AsyncIterableIterator<TestMetadata> {
    return this.#paginate(`project/${projectSlug}/${jobNum}/tests`);
  }
}

export interface Pipeline {
  id: string;
  state: "created" | "errored" | "setup-pending" | "setup" | "pending";
  created_at: string;
  vcs?: {
    revision: string;
    branch?: string;
  };
}

export interface Workflow {
  id: string;
  name: string;
  status:
    | "success"
    | "running"
    | "not_run"
    | "failed"
    | "error"
    | "failing"
    | "on_hold"
    | "canceled"
    | "unauthorized";
}

export interface Job {
  id: string;
  name: string;
  job_number?: number;
  started_at: string;
  status: string;
}

export interface TestMetadata {
  message: string;
  source: string;
  run_time: number;
  file: string;
  result: string; // "success" | "failure"
  name: string;
  classname: string;
}
