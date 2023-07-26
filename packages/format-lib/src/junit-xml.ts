import Parser, { TestCase } from "junitxml-to-javascript";
import { Test } from "./lib.js";

function coerceTestResult(result: TestCase["result"]): Test["state"] {
  switch (result) {
    case "succeeded":
      return "passed";
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    default:
      throw new Error(`Unknown test result: ${result}`);
  }
}

export async function parse(xml: string): Promise<Test[]> {
  const parser = new Parser();
  const parsed = await parser.parseXMLString(xml);

  return parsed.testsuites
    .map((suite) =>
      suite.testCases.map(({ name, result }) => ({
        name,
        state: coerceTestResult(result),
      })),
    )
    .flat();
}
