import { existsSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test } from "@playwright/test";

const extensionPath = path.resolve(".output/chrome-mv3");

test("options page saves and reflects download conditions", async () => {
  expect(existsSync(path.join(extensionPath, "manifest.json"))).toBe(true);

  const context = await chromium.launchPersistentContext("", {
    headless: false,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const serviceWorker = await waitForExtensionWorker(context);
    const extensionId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(popup.getByRole("button", { name: "Edit conditions" })).toBeVisible();
    await expect(popup.getByText("Any download")).toBeVisible();

    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.getByRole("heading", { name: "Download conditions" })).toBeVisible();
    await expect(options.getByLabel("Filename pattern")).toBeVisible();
    await expect(options.getByLabel("File types")).toBeVisible();
    await expect(options.getByLabel("Source domains")).toBeVisible();
    await expect(options.getByLabel("Minimum size (MB)")).toBeVisible();
    await expect(options.getByLabel("Maximum size (MB)")).toBeVisible();

    await options.getByLabel("File types").fill("zip");
    await options.getByRole("button", { name: "Save conditions" }).click();
    await expect(options.getByText("Conditions saved.")).toBeVisible();

    await options.reload();
    await expect(options.getByLabel("File types")).toHaveValue("zip");

    await popup.reload();
    await expect(popup.getByText(/1 condition/)).toBeVisible();

    await options.getByLabel("Minimum size (MB)").fill("500");
    await options.getByLabel("Maximum size (MB)").fill("10");
    await options.getByRole("button", { name: "Save conditions" }).click();
    await expect(options.getByText("Minimum size must be less than or equal to maximum size.")).toBeVisible();
  } finally {
    await context.close();
  }
});

async function waitForExtensionWorker(context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>) {
  const matches = () => context.serviceWorkers().find((worker) => worker.url().endsWith("/background.js"));
  const existing = matches();
  if (existing) {
    return existing;
  }
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const worker = await context.waitForEvent("serviceworker", { timeout: deadline - Date.now() }).catch(() => null);
    if (worker?.url().endsWith("/background.js")) {
      return worker;
    }
    const found = matches();
    if (found) {
      return found;
    }
  }
  throw new Error("Download Automations background service worker did not start");
}
