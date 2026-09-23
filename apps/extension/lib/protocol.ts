import { z } from "zod";
import { DRY_RUN_MESSAGES, PROTOCOL_VERSION } from "./constants";
import { powerActionSchema, type PowerAction } from "./settings";

const requestIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);

export const filenameSchema = z
  .string()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !value.split("").some((character) => character.charCodeAt(0) < 32),
    "Invalid filename",
  );

const downloadContextSchema = z.strictObject({
  downloadId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  filename: filenameSchema,
});

const pingRequestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  type: z.literal("ping"),
});

const capabilitiesRequestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  type: z.literal("get_capabilities"),
});

const executeActionRequestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  type: z.literal("execute_action"),
  action: powerActionSchema,
  dryRun: z.literal(true),
  context: downloadContextSchema,
});

export const nativeRequestSchema = z.discriminatedUnion("type", [
  pingRequestSchema,
  capabilitiesRequestSchema,
  executeActionRequestSchema,
]);

export type NativeRequest = z.infer<typeof nativeRequestSchema>;
export type ExecuteActionRequest = z.infer<typeof executeActionRequestSchema>;

const errorResponseSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(false),
  error: z.strictObject({
    code: z.string().regex(/^[a-z0-9_]{1,64}$/),
    message: z.string().min(1).max(300),
  }),
});

const pingSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z.strictObject({
    pong: z.literal(true),
  }),
});

const capabilitiesSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z.strictObject({
    dryRunOnly: z.literal(true),
    actions: z.array(powerActionSchema).length(3),
  }),
});

const executeSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z.strictObject({
    executed: z.literal(false),
    dryRun: z.literal(true),
    action: powerActionSchema,
    message: z.string(),
  }),
});

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  unsupported_protocol_version: "The helper does not support this version of Download Automations.",
  unknown_message_type: "The helper rejected the request.",
  unknown_action: "The helper does not recognize that action.",
  dry_run_required: "The helper refused the request because it was not a dry run.",
  malformed_request: "The helper could not read the request.",
  payload_too_large: "The request to the helper was too large.",
};

export type HostResponseParse =
  | { ok: true; type: "ping" }
  | { ok: true; type: "get_capabilities"; actions: PowerAction[]; dryRunOnly: true }
  | { ok: true; type: "execute_action"; action: PowerAction; message: string }
  | { ok: false; code: string; message: string };

export function pingRequest(requestId: string): NativeRequest {
  return nativeRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    type: "ping",
  });
}

export function capabilitiesRequest(requestId: string): NativeRequest {
  return nativeRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    type: "get_capabilities",
  });
}

export function executeActionRequest(input: {
  requestId: string;
  action: PowerAction;
  downloadId: number;
  filename: string;
}): ExecuteActionRequest {
  return executeActionRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: input.requestId,
    type: "execute_action",
    action: input.action,
    dryRun: true,
    context: {
      downloadId: input.downloadId,
      filename: input.filename,
    },
  });
}

export function parseHostResponse(
  requestId: string,
  expected: "ping" | "get_capabilities" | "execute_action",
  payload: unknown,
): HostResponseParse {
  const error = errorResponseSchema.safeParse(payload);
  if (error.success) {
    if (error.data.requestId !== requestId) {
      return rejected("request_id_mismatch", "The helper response did not match this request.");
    }
    const message = SAFE_ERROR_MESSAGES[error.data.error.code] ?? "The helper rejected the request.";
    return rejected(error.data.error.code, message);
  }

  if (expected === "ping") {
    const parsed = pingSuccessSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId) {
      return malformedResponse(parsed.success);
    }
    return { ok: true, type: "ping" };
  }

  if (expected === "get_capabilities") {
    const parsed = capabilitiesSuccessSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId) {
      return malformedResponse(parsed.success);
    }
    const actions = parsed.data.result.actions;
    if (!hasEveryAction(actions)) {
      return rejected("unexpected_result", "The helper did not confirm dry-run-only actions.");
    }
    return { ok: true, type: "get_capabilities", actions, dryRunOnly: true };
  }

  const parsed = executeSuccessSchema.safeParse(payload);
  if (!parsed.success || parsed.data.requestId !== requestId) {
    return malformedResponse(parsed.success);
  }
  const { action, message } = parsed.data.result;
  if (message !== DRY_RUN_MESSAGES[action]) {
    return rejected("unexpected_result", "The helper returned an unexpected result.");
  }
  return { ok: true, type: "execute_action", action, message };
}

function malformedResponse(requestMatchedShape: boolean): HostResponseParse {
  if (requestMatchedShape) {
    return rejected("request_id_mismatch", "The helper response did not match this request.");
  }
  return rejected("malformed_response", "The helper returned a response this extension could not understand.");
}

function rejected(code: string, message: string): HostResponseParse {
  return { ok: false, code, message };
}

function hasEveryAction(actions: PowerAction[]): boolean {
  return (
    actions.includes("sleep") && actions.includes("shutdown") && actions.includes("reboot")
  );
}
