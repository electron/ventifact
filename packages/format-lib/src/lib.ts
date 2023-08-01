export interface Test {
  name: string;
  state: "passed" | "failed" | "skipped";
}

export * as BuildLog from "./build-log.js";
