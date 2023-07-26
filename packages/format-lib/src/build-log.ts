import { Test } from "./lib.js";

/**
 * Split a stream of string chunks into separate lines.
 */
async function* lines(
  chunks: AsyncIterable<string>,
): AsyncIterableIterator<string> {
  // This var tracks the "partial" line from the previous chunk
  let overflow = "";
  for await (const chunk of chunks) {
    // Split the chunk into lines, and keep the last line as overflow
    const lines = (overflow + chunk).split("\n").map((line) => line.trim());
    overflow = lines.pop()!;

    // Yield all the lines except the last one (which is still being streamed)
    yield* lines;
  }

  // We ignore the last line if it's empty
  if (overflow !== "") {
    yield overflow;
  }
}

/**
 * Removes the leading timestamp from a log line, if there is one. Timestamps
 * are expected to be in the format `[##:##:##] `, where # is any character.
 * (Note the space at the end.)
 */
function withoutTimestamp(line: string): string {
  if (
    line.length >= 11 &&
    line[0] === "[" &&
    line[3] === ":" &&
    line[6] === ":" &&
    line[9] === "]" &&
    line[10] === " "
  ) {
    return line.slice(11);
  } else {
    return line;
  }
}

const TEST_LINE = /^(ok|not ok) (\d+) (.*)( # SKIP -)?$/;
export async function parse(
  buildLogChunks: AsyncIterable<string>,
): Promise<Test[]> {
  const tests: Test[] = [];

  let numberMismatch = false;
  for await (const rawLine of lines(buildLogChunks)) {
    const line = withoutTimestamp(rawLine);

    const match = TEST_LINE.exec(line);
    if (match !== null) {
      const state =
        match[1] === "ok"
          ? "passed"
          : match[4] === undefined
          ? "failed"
          : "skipped";
      const name = match[3];

      // Double check the test number, just in case
      const testNumber = parseInt(match[2], 10);
      if (tests.length + 1 !== testNumber) {
        numberMismatch = true;
      }

      tests.push({ name, state });
    }
  }

  if (numberMismatch) {
    console.warn(
      "Test numbers in build log did not match the number of tests parsed.",
    );
  }

  return tests;
}
