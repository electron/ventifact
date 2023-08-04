import { mkdtemp, readFile, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { simpleGit } from "simple-git";

const GIT_TOKEN = "todo";
const DISABLED_TESTS_PATH = "spec/disabled-tests.json";

/**
 * Creates a new branch with the given test title disabled.
 */
export async function createBranchWithTestDisabled(
  testTitle: string,
): Promise<string | undefined> {
  let tempDir: string | undefined;
  try {
    // Create a temp directory for doing the git operations in
    tempDir = await mkdtemp(path.join(tmpdir(), ".ventifact-"));

    const git = simpleGit(tempDir);

    // Configure git
    await git.addConfig("user.email", "electron@github.com");
    await git.addConfig("user.name", "Ventifact");
    await git.addConfig("commit.gpgsign", "false");

    // Clone the repo
    await git.clone(
      `https://x:${GIT_TOKEN}@github.com/electron/electron.git`,
      "electron",
    );

    // Determine the temp branch name
    const branchName = `ventifact/disable-test/${Date.now()}-${testTitle
      .substring(0, 32)
      .toLowerCase()
      .replace(/[^a-z0-9]+/, "-")}`;

    // Create a new branch
    await git.checkoutLocalBranch(branchName);

    // Add the test title to the disabled tests list
    const disabledTestsPath = path.join(
      tempDir,
      "electron",
      DISABLED_TESTS_PATH,
    );
    const disabledTestsSrc = await readFile(disabledTestsPath, "utf8");
    const disabledTests = JSON.parse(disabledTestsSrc);
    Array.prototype.push.call(disabledTests, testTitle);
    const newDisabledTestsSrc = JSON.stringify(disabledTestsSrc);
    await writeFile(disabledTestsPath, newDisabledTestsSrc);

    // Commit and push the updated file
    await git.commit("test: disable flaky test", [disabledTestsPath]);
    await git.push("origin", branchName);

    // Return the name of the branch with the change
    return branchName;
  } catch (err) {
    console.error("Failed to submit PR to add disabled test: ", err);
    return undefined;
  } finally {
    // Clean up the temp directory
    if (tempDir !== undefined) {
      await rmdir(tempDir, { recursive: true });
    }
  }
}
