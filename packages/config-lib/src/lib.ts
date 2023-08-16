import { Temporal } from "@js-temporal/polyfill";

/**
 * Configuration values. These are read from environment variables with the
 * same name.
 */
export const Config = {
  /**
   * The connection URL for the database.
   */
  DATABASE_URL: () => Env.str("DATABASE_URL"),

  /**
   * The duration that a merged PR is retained for by this application.
   */
  MERGED_PR_LIFETIME: () => Env.duration("MERGED_PR_LIFETIME"),

  /**
   * Test run configuration.
   */
  TEST_RUN: {
    /**
     * The duration that a test run is retained for by this application.
     */
    LIFETIME: () => Env.duration("TEST_RUN_LIFETIME"),

    /**
     * The number of times that a test run can flake within the configured test
     * run lifetime duration before it's labeled as flaky.
     */
    FLAKE_THRESHOLD: () => Env.str("TEST_RUN_FLAKE_THRESHOLD"),
  },

  /**
   * AppVeyor configuration.
   */
  APPVEYOR: {
    /**
     * The AppVeyor auth token to use for API requests.
     */
    AUTH_TOKEN: () => Env.str("APPVEYOR_AUTH_TOKEN"),

    /**
     * Our AppVeyor account name.
     */
    ACCOUNT_NAME: () => Env.str("APPVEYOR_ACCOUNT_NAME"),

    /**
     * Comma-separated list of AppVeyor project slugs to fetch test runs for.
     */
    PROJECT_SLUGS: () => Env.strSet("APPVEYOR_PROJECT_SLUGS"),
  },

  /**
   * CircleCI configuration.
   */
  CIRCLECI: {
    /**
     * The CircleCI auth token to use for API requests.
     */
    AUTH_TOKEN: () => Env.str("CIRCLECI_AUTH_TOKEN"),

    /**
     * The CircleCI project slug to fetch test runs for.
     */
    PROJECT_SLUG: () => Env.str("CIRCLECI_PROJECT_SLUG"),

    /**
     * Comma-separated list of CircleCI workflow names to fetch test runs for.
     */
    WORKFLOW_NAMES: () => Env.strSet("CIRCLECI_WORKFLOW_NAMES"),

    /**
     * Comma-separated list of CircleCI job names to fetch test runs for.
     */
    JOB_NAMES: () => Env.strSet("CIRCLECI_JOB_NAMES"),
  },

  /**
   * The GitHub auth token to use for API requests.
   */
  GITHUB_AUTH_TOKEN: () => Env.str("GITHUB_AUTH_TOKEN"),
};

/**
 * Environment variable parsers.
 */
const Env = {
  str(key: string): string {
    const value = process.env[key];

    if (value === undefined) {
      throw new Error(`Missing environment variable: ${key}`);
    }

    return value;
  },
  strSet(key: string): Set<string> {
    return new Set(Env.str(key).split(","));
  },
  duration(key: string): Temporal.Duration {
    return Temporal.Duration.from(Env.str(key));
  },
};
