declare module "junitxml-to-javascript" {
  export default class Parser {
    constructor(opts?: object);
    parseXMLString(xml: string): Promise<Report>;
    // others omitted
  }

  export interface Report {
    testsuites: TestSuite[];
  }

  export interface TestSuite {
    name: string;
    testCases: TestCase[];
    // others omitted
  }

  export interface TestCase {
    name: string;
    result: "succeeded" | "failed" | "skipped";
    message: string;
    // others omitted
  }
}
