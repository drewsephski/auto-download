import type { PowerAction } from "./settings";

export const NOTIFICATION_TITLE = "Download finished";

export function actionPhrase(action: PowerAction): string {
  switch (action) {
    case "sleep":
      return "sleep";
    case "shutdown":
      return "shut down";
    case "reboot":
      return "restart";
  }
}

export function liveLabel(action: PowerAction): string {
  switch (action) {
    case "sleep":
      return "LIVE — SLEEP ENABLED";
    case "shutdown":
      return "LIVE — SHUT DOWN ENABLED";
    case "reboot":
      return "LIVE — RESTART ENABLED";
  }
}

export function liveDetail(action: PowerAction, enabled: boolean): string {
  if (!enabled) {
    return `Real ${actionPhrase(action)} is armed. Turn on automation before a download can use it.`;
  }
  switch (action) {
    case "sleep":
      return "After a download finishes, this Mac sleeps in 30 seconds unless you cancel.";
    case "shutdown":
      return "After a download finishes, this Mac shuts down in 30 seconds unless you cancel.";
    case "reboot":
      return "After a download finishes, this Mac restarts in 30 seconds unless you cancel.";
  }
}

export function confirmationCopy(action: PowerAction): {
  title: string;
  paragraphs: string[];
  confirm: string;
  dismiss: string;
} {
  const dismiss = "Keep dry run";
  switch (action) {
    case "sleep":
      return {
        title: "Enable real sleep",
        paragraphs: [
          "After a download finishes, this Mac can sleep automatically.",
          "There is a 30-second cancellation period.",
          "Closing Chrome or losing the helper connection cancels the pending action.",
        ],
        confirm: "Enable real sleep",
        dismiss,
      };
    case "shutdown":
      return {
        title: "Enable real shut down",
        paragraphs: [
          "After a download finishes, this Mac can shut down automatically.",
          "Unsaved work in other applications could be lost.",
          "There is a 30-second cancellation period.",
          "Closing Chrome or losing the helper connection before execution cancels it.",
        ],
        confirm: "Enable real shut down",
        dismiss,
      };
    case "reboot":
      return {
        title: "Enable real restart",
        paragraphs: [
          "After a download finishes, this Mac can restart automatically.",
          "Unsaved work in other applications could be lost.",
          "There is a 30-second cancellation period.",
          "Closing Chrome or losing the helper connection before execution cancels it.",
        ],
        confirm: "Enable real restart",
        dismiss,
      };
  }
}

export function pendingCopy(action: PowerAction): { title: string; countdown: string; cancel: string } {
  switch (action) {
    case "sleep":
      return { title: "Sleep pending", countdown: "Sleeping in ~30 seconds", cancel: "Cancel sleep" };
    case "shutdown":
      return { title: "Shut down pending", countdown: "Shutting down in ~30 seconds", cancel: "Cancel shut down" };
    case "reboot":
      return { title: "Restart pending", countdown: "Restarting in ~30 seconds", cancel: "Cancel restart" };
  }
}

export function notificationMessage(action: PowerAction): string {
  switch (action) {
    case "sleep":
      return "This Mac will sleep in 30 seconds.";
    case "shutdown":
      return "This Mac will shut down in 30 seconds. Save any open work now.";
    case "reboot":
      return "This Mac will restart in 30 seconds. Save any open work now.";
  }
}

export function scheduledMessage(action: PowerAction): string {
  switch (action) {
    case "sleep":
      return "This Mac will sleep in 30 seconds unless you cancel.";
    case "shutdown":
      return "This Mac will shut down in 30 seconds unless you cancel.";
    case "reboot":
      return "This Mac will restart in 30 seconds unless you cancel.";
  }
}

export function coalesceMessage(action: PowerAction): string {
  const name = pendingCopy(action).title.replace(" pending", "");
  return `${name} is already pending, so this download did not schedule another one.`;
}

export function cancelledMessage(action: PowerAction): string {
  switch (action) {
    case "sleep":
      return "The pending sleep was cancelled.";
    case "shutdown":
      return "The pending shut down was cancelled.";
    case "reboot":
      return "The pending restart was cancelled.";
  }
}

export function interruptedMessage(action: PowerAction): string {
  switch (action) {
    case "sleep":
      return "The sleep was cancelled because the helper connection closed.";
    case "shutdown":
      return "The shut down was cancelled because the helper connection closed.";
    case "reboot":
      return "The restart was cancelled because the helper connection closed.";
  }
}

export function notificationBlockedMessage(action: PowerAction): string {
  const name = pendingCopy(action).title.replace(" pending", "");
  return `${name} was cancelled because the notification could not be shown.`;
}

export function failureCode(action: PowerAction): string {
  return `${action}_failed`;
}
