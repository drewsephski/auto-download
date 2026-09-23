import { z } from "zod";

export const permissionRecordSchema = z.strictObject({
  state: z.enum(["unchecked", "granted", "denied", "error"]),
});

export type PermissionRecord = z.infer<typeof permissionRecordSchema>;

export const defaultPermission: PermissionRecord = { state: "unchecked" };

export function normalizePermission(input: unknown): PermissionRecord {
  const parsed = permissionRecordSchema.safeParse(input);
  return parsed.success ? parsed.data : defaultPermission;
}

export function permissionLabel(state: PermissionRecord["state"]): string {
  switch (state) {
    case "unchecked":
      return "macOS permission not checked";
    case "granted":
      return "macOS permission granted";
    case "denied":
      return "macOS permission denied";
    case "error":
      return "macOS permission error";
  }
}
