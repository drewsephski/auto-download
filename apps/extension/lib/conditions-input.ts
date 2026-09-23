import {
  parseExtensionList,
  parseFilenamePattern,
  parseSizeMegabytes,
  parseSourceHostList,
  type RuleConditions,
} from "./rule-conditions";

export interface ConditionsFormInput {
  filenamePattern: string;
  extensions: string;
  sourceHosts: string;
  minSizeMb: string;
  maxSizeMb: string;
  waitForAllDownloads: boolean;
}

export interface ConditionsFormErrors {
  filenamePattern?: string;
  extensions?: string;
  sourceHosts?: string;
  minSizeMb?: string;
  maxSizeMb?: string;
  sizeRange?: string;
}

export function validateConditionsForm(input: ConditionsFormInput): {
  conditions: RuleConditions;
  waitForAllDownloads: boolean;
  errors: ConditionsFormErrors;
} {
  const errors: ConditionsFormErrors = {};
  const filename = parseFilenamePattern(input.filenamePattern);
  if (filename.error) {
    errors.filenamePattern = filename.error;
  }
  const extensions = parseExtensionList(input.extensions);
  if (extensions.error) {
    errors.extensions = extensions.error;
  }
  const hosts = parseSourceHostList(input.sourceHosts);
  if (hosts.error) {
    errors.sourceHosts = hosts.error;
  }
  const minSize = parseSizeMegabytes(input.minSizeMb);
  if (minSize.error) {
    errors.minSizeMb = minSize.error;
  }
  const maxSize = parseSizeMegabytes(input.maxSizeMb);
  if (maxSize.error) {
    errors.maxSizeMb = maxSize.error;
  }
  if (
    !errors.minSizeMb &&
    !errors.maxSizeMb &&
    minSize.bytes !== null &&
    maxSize.bytes !== null &&
    minSize.bytes > maxSize.bytes
  ) {
    errors.sizeRange = "Minimum size must be less than or equal to maximum size.";
  }
  if (Object.keys(errors).length > 0) {
    return {
      conditions: {
        filenamePattern: null,
        extensions: [],
        sourceHosts: [],
        minSizeBytes: null,
        maxSizeBytes: null,
      },
      waitForAllDownloads: input.waitForAllDownloads,
      errors,
    };
  }
  return {
    conditions: {
      filenamePattern: filename.pattern,
      extensions: extensions.extensions,
      sourceHosts: hosts.hosts,
      minSizeBytes: minSize.bytes,
      maxSizeBytes: maxSize.bytes,
    },
    waitForAllDownloads: input.waitForAllDownloads,
    errors: {},
  };
}

export function conditionsToFormInput(
  conditions: RuleConditions,
  waitForAllDownloads: boolean,
): ConditionsFormInput {
  return {
    filenamePattern: conditions.filenamePattern ?? "",
    extensions: conditions.extensions.join(", "),
    sourceHosts: conditions.sourceHosts.join(", "),
    minSizeMb: conditions.minSizeBytes === null ? "" : String(conditions.minSizeBytes / (1024 * 1024)),
    maxSizeMb: conditions.maxSizeBytes === null ? "" : String(conditions.maxSizeBytes / (1024 * 1024)),
    waitForAllDownloads,
  };
}

export function formatMatchFailure(reason: string): string {
  switch (reason) {
    case "filename":
      return "filename pattern";
    case "extension":
      return "file type";
    case "sourceHost":
      return "source domain";
    case "minSize":
      return "minimum size";
    case "maxSize":
      return "maximum size";
    default:
      return "conditions";
  }
}
