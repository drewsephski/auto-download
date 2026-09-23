const NOTIFICATION_PREFIX = "da-sleep-";

export function notificationIdForAction(actionId: string): string {
  return `${NOTIFICATION_PREFIX}${actionId}`;
}

export function actionIdFromNotification(notificationId: string): string | null {
  if (!notificationId.startsWith(NOTIFICATION_PREFIX)) {
    return null;
  }
  const actionId = notificationId.slice(NOTIFICATION_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(actionId)) {
    return null;
  }
  return actionId;
}
