import { z } from "zod";
import { COUNTDOWN_SECONDS, DRY_RUN_MESSAGES, PROTOCOL_VERSION } from "./constants";
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

const permissionRequestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  type: z.literal("request_permission"),
});

const executeActionRequestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  type: z.literal("execute_action"),
  action: powerActionSchema,
  executionMode: z.literal("dry_run"),
  context: downloadContextSchema,
});

const scheduleActionRequestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  type: z.literal("schedule_action"),
  actionId: requestIdSchema,
  action: z.literal("sleep"),
  executionMode: z.literal("real"),
  countdownSeconds: z.literal(COUNTDOWN_SECONDS),
  context: downloadContextSchema,
});

const cancelActionRequestSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  type: z.literal("cancel_action"),
  actionId: requestIdSchema,
});

export const oneShotRequestSchema = z.discriminatedUnion("type", [
  pingRequestSchema,
  capabilitiesRequestSchema,
  permissionRequestSchema,
  executeActionRequestSchema,
]);

export const portRequestSchema = z.discriminatedUnion("type", [
  scheduleActionRequestSchema,
  cancelActionRequestSchema,
]);

export const nativeRequestSchema = z.discriminatedUnion("type", [
  pingRequestSchema,
  capabilitiesRequestSchema,
  permissionRequestSchema,
  executeActionRequestSchema,
  scheduleActionRequestSchema,
  cancelActionRequestSchema,
]);

export type NativeRequest = z.infer<typeof nativeRequestSchema>;
export type OneShotRequest = z.infer<typeof oneShotRequestSchema>;
export type ExecuteActionRequest = z.infer<typeof executeActionRequestSchema>;
export type ScheduleActionRequest = z.infer<typeof scheduleActionRequestSchema>;
export type CancelActionRequest = z.infer<typeof cancelActionRequestSchema>;

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
    platform: z.string().min(1).max(32),
    dryRunActions: z.array(powerActionSchema).length(3),
    realActions: z.array(z.literal("sleep")).max(1),
    countdown: z.strictObject({
      required: z.literal(true),
      minimumSeconds: z.number().int().min(1).max(120),
    }),
  }),
});

const permissionSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z.strictObject({
    permission: z.literal("granted"),
  }),
});

const executeSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z.strictObject({
    executed: z.literal(false),
    executionMode: z.literal("dry_run"),
    action: powerActionSchema,
    message: z.string(),
  }),
});

const scheduleSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z.strictObject({
    status: z.enum(["scheduled", "coalesced"]),
    actionId: requestIdSchema,
    action: z.literal("sleep"),
    executionMode: z.literal("real"),
    countdownSeconds: z.number().int().min(10).max(120),
  }),
});

const cancelSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z.strictObject({
    status: z.literal("cancelled"),
    actionId: requestIdSchema,
    action: z.literal("sleep"),
    executionMode: z.literal("real"),
    countdownSeconds: z.number().int().min(10).max(120),
  }),
});

const lifecycleSuccessSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  requestId: requestIdSchema,
  ok: z.literal(true),
  result: z
    .strictObject({
      status: z.enum(["executing", "executed", "failed"]),
      actionId: requestIdSchema,
      action: z.literal("sleep"),
      executionMode: z.literal("real"),
      countdownSeconds: z.number().int().min(10).max(120),
      executed: z.boolean(),
      message: z.string().min(1).max(300),
    })
    .refine((result) => (result.status === "executed" ? result.executed : !result.executed), {
      message: "Execution flag does not match status",
    }),
});

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  unsupported_protocol_version: "The helper must be updated before Download Automations can run.",
  unknown_message_type: "The helper rejected the request.",
  unknown_action: "The helper does not recognize that action.",
  real_action_not_enabled: "The helper refused real execution for that action.",
  invalid_countdown: "The helper refused the countdown.",
  invalid_action_id: "The helper refused the pending action.",
  unknown_action_id: "The helper had no matching pending sleep.",
  permission_denied: "macOS did not allow System Events control.",
  permission_unavailable: "System Events permission cannot be requested on this system.",
  malformed_request: "The helper could not read the request.",
  payload_too_large: "The request to the helper was too large.",
  connection_lost: "The helper connection closed before the action ran.",
};

export type HostResponseKind =
  | "ping"
  | "get_capabilities"
  | "request_permission"
  | "execute_action"
  | "schedule_action"
  | "cancel_action"
  | "action_event";

export type HostResponseParse =
  | { ok: true; type: "ping" }
  | { ok: true; type: "get_capabilities"; actions: PowerAction[]; realSleepSupported: boolean }
  | { ok: true; type: "request_permission"; permission: "granted" }
  | { ok: true; type: "execute_action"; action: PowerAction; message: string }
  | {
      ok: true;
      type: "schedule_action";
      status: "scheduled" | "coalesced";
      actionId: string;
      countdownSeconds: number;
    }
  | { ok: true; type: "cancel_action"; actionId: string }
  | {
      ok: true;
      type: "action_event";
      status: "executing" | "executed" | "failed";
      actionId: string;
      message: string;
      executed: boolean;
    }
  | { ok: false; code: string; message: string };

export function pingRequest(requestId: string): OneShotRequest {
  return pingRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    type: "ping",
  });
}

export function capabilitiesRequest(requestId: string): OneShotRequest {
  return capabilitiesRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    type: "get_capabilities",
  });
}

export function permissionRequest(requestId: string): OneShotRequest {
  return permissionRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId,
    type: "request_permission",
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
    executionMode: "dry_run",
    context: {
      downloadId: input.downloadId,
      filename: input.filename,
    },
  });
}

export function scheduleActionRequest(input: {
  requestId: string;
  actionId: string;
  downloadId: number;
  filename: string;
}): ScheduleActionRequest {
  return scheduleActionRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: input.requestId,
    type: "schedule_action",
    actionId: input.actionId,
    action: "sleep",
    executionMode: "real",
    countdownSeconds: COUNTDOWN_SECONDS,
    context: {
      downloadId: input.downloadId,
      filename: input.filename,
    },
  });
}

export function cancelActionRequest(input: { requestId: string; actionId: string }): CancelActionRequest {
  return cancelActionRequestSchema.parse({
    protocolVersion: PROTOCOL_VERSION,
    requestId: input.requestId,
    type: "cancel_action",
    actionId: input.actionId,
  });
}

export function isScheduleAck(requestId: string, payload: unknown): boolean {
  return matchesRequest(requestId, payload) && (scheduleSuccessSchema.safeParse(payload).success || errorResponseSchema.safeParse(payload).success);
}

export function isCancelAck(requestId: string, payload: unknown): boolean {
  return matchesRequest(requestId, payload) && (cancelSuccessSchema.safeParse(payload).success || errorResponseSchema.safeParse(payload).success);
}

export function parseHostResponse(requestId: string, expected: HostResponseKind, payload: unknown): HostResponseParse {
  if (isLegacyHost(payload)) {
    return rejected(
      "unsupported_protocol_version",
      SAFE_ERROR_MESSAGES.unsupported_protocol_version ?? "The helper must be updated before Download Automations can run.",
    );
  }

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
    const actions = parsed.data.result.dryRunActions;
    if (!hasEveryDryRunAction(actions)) {
      return rejected("unexpected_result", "The helper did not confirm dry-run actions.");
    }
    const realSleepSupported =
      parsed.data.result.platform === "macos" &&
      parsed.data.result.realActions.length === 1 &&
      parsed.data.result.realActions[0] === "sleep" &&
      parsed.data.result.countdown.minimumSeconds <= COUNTDOWN_SECONDS;
    return { ok: true, type: "get_capabilities", actions, realSleepSupported };
  }

  if (expected === "request_permission") {
    const parsed = permissionSuccessSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId) {
      return malformedResponse(parsed.success);
    }
    return { ok: true, type: "request_permission", permission: "granted" };
  }

  if (expected === "execute_action") {
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

  if (expected === "schedule_action") {
    const parsed = scheduleSuccessSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId) {
      return malformedResponse(parsed.success);
    }
    return {
      ok: true,
      type: "schedule_action",
      status: parsed.data.result.status,
      actionId: parsed.data.result.actionId,
      countdownSeconds: parsed.data.result.countdownSeconds,
    };
  }

  if (expected === "cancel_action") {
    const parsed = cancelSuccessSchema.safeParse(payload);
    if (!parsed.success || parsed.data.requestId !== requestId) {
      return malformedResponse(parsed.success);
    }
    return { ok: true, type: "cancel_action", actionId: parsed.data.result.actionId };
  }

  const parsed = lifecycleSuccessSchema.safeParse(payload);
  if (!parsed.success || parsed.data.requestId !== requestId) {
    return malformedResponse(parsed.success);
  }
  return {
    ok: true,
    type: "action_event",
    status: parsed.data.result.status,
    actionId: parsed.data.result.actionId,
    message: parsed.data.result.message,
    executed: parsed.data.result.executed,
  };
}

function isLegacyHost(payload: unknown): boolean {
  return isRecord(payload) && payload.protocolVersion === 1;
}

function matchesRequest(requestId: string, payload: unknown): boolean {
  return isRecord(payload) && payload.requestId === requestId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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

function hasEveryDryRunAction(actions: PowerAction[]): boolean {
  return actions.includes("sleep") && actions.includes("shutdown") && actions.includes("reboot");
}
