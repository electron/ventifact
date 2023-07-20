/**
 * Gets the value of an environment variable or throws an error if it is not
 * set.
 */
export function getEnvVarOrThrow(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Environment variable '${name}' is not set`);
  }
  return value;
}
