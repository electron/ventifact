import { Temporal } from "@js-temporal/polyfill";

export function isAscending(a: Temporal.Instant, b: Temporal.Instant): boolean {
  return Temporal.Instant.compare(a, b) < 0;
}
