import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

const extensionPath = path.resolve(".output/chrome-mv3");

test("popup renders the dry-run utility", async () => {
  expect(existsSync(path.join(extensionPath, "manifest.json"))).toBe(true);
  const manifest = JSON.parse(readFileSync(path.join(extensionPath, "manifest.json"), "utf8")) as {
    permissions?: string[];
    host_permissions?: unknown;
    content_scripts?: unknown;
  };
  expect([...(manifest.permissions ?? [])].sort()).toEqual(["downloads", "nativeMessaging", "storage"]);
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect(manifest.content_scripts).toBeUndefined();

  const context = await chromium.launchPersistentContext("", {
    channel: "chrome",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    }
    const extensionId = new URL(serviceWorker.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page.getByRole("heading", { name: "Download Automations" })).toBeVisible();
    await expect(page.getByText("DRY RUN")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Enable after-download automation" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Sleep" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Test connection" })).toBeVisible();
  } finally {
    await context.close();
  }
});
