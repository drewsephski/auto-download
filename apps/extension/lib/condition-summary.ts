import { countActiveConditions, type RuleConditions } from "./rule-conditions";

export function summarizeConditions(conditions: RuleConditions, waitForAllDownloads: boolean): string {
  const count = countActiveConditions(conditions, false);
  if (count === 0 && !waitForAllDownloads) {
    return "Any download";
  }
  const parts: string[] = [];
  if (count === 0) {
    parts.push("Any download");
  } else if (count === 1) {
    parts.push("1 condition");
  } else {
    parts.push(`${count} conditions`);
  }
  if (waitForAllDownloads) {
    parts.push("waits for all downloads");
  }
  return parts.join(" · ");
}
