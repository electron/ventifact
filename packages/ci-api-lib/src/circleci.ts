import got, { Got } from "got";

export class Client {
  #http: Got;

  constructor(authToken: string) {
    this.#http = got.extend({
      prefixUrl: "https://circleci.com/api/v2/",
      headers: {
        "Circle-Token": authToken,
      },
    });
  }

  #paginate<T>(path: string): AsyncIterableIterator<T> {
    interface Items {
      items: T[];
      next_page_token?: string;
    }

    return this.#http.paginate<T, Items>(path, {
      responseType: "json",
      pagination: {
        paginate({ response }) {
          // Use the next page token if there is one, otherwise stop paginating
          const next = response.body.next_page_token;
          if (next !== undefined) {
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

  pipelines(projectSlug: string): AsyncIterableIterator<Pipeline> {
    return this.#paginate(`project/${projectSlug}/pipeline`);
  }

  workflows(pipelineId: string): AsyncIterableIterator<Workflow> {
    return this.#paginate(`pipeline/${pipelineId}/workflow`);
  }

  jobs(workflowId: string): AsyncIterableIterator<Job> {
    return this.#paginate(`workflow/${workflowId}/job`);
  }

  testMetadata(
    projectSlug: string,
    jobNum: number,
  ): AsyncIterableIterator<TestMetadata> {
    return this.#paginate(`project/${projectSlug}/${jobNum}/tests`);
  }
}

export interface Pipeline {
  id: string;
}

export interface Workflow {
  id: string;
  name: string;
}

export interface Job {
  id: string;
  name: string;
  job_number?: number;
}

export interface TestMetadata {
  message: string;
  source: string;
  run_time: number;
  file: string;
  result: string;
  name: string;
  classname: string;
}
