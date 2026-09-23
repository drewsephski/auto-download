import { browser } from "wxt/browser";

export async function notificationsGranted(): Promise<boolean> {
  const notifications = browser.notifications;
  if (!notifications?.getPermissionLevel) {
    return false;
  }
  try {
    const level = await notifications.getPermissionLevel();
    return level === "granted";
  } catch {
    return false;
  }
}
