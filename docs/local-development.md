# Local development on macOS

These steps use Google Chrome for the signed-in macOS user. The native host manifest is installed for that user, not for a Chrome profile and not as root.

From the repository root:

## 1. Install dependencies

Install Node.js, pnpm, Rust, and Google Chrome. Then:

```bash
pnpm install
```

## 2. Build the extension

```bash
pnpm build
```

For a watch build while you edit the extension, use `pnpm dev` instead. Load the same output directory either way.

The unpacked extension is:

```text
apps/extension/.output/chrome-mv3
```

## 3. Load the unpacked extension

1. Open `chrome://extensions`.
2. Turn on Developer mode.
3. Choose **Load unpacked**.
4. Select `apps/extension/.output/chrome-mv3`.

## 4. Copy the extension ID

The ID is on the extension card at `chrome://extensions`. It is also shown in the popup setup panel. It is 32 characters from `a` through `p`.

An unpacked extension's ID is derived from the directory path. Loading this output directory again keeps the same ID. Moving the directory, or loading a different build folder, changes it. There is no Chrome Web Store ID yet, so do not commit a private key to pin one.

## 5. Build and install the native host

`cargo run` builds the debug binary and registers that absolute path. Chrome will launch that binary later, so leave the project where it is. Run `install` again after `cargo clean` or after moving the repository.

```bash
cargo run -p native-host -- install \
  --browser chrome \
  --extension-id <CHROME_EXTENSION_ID>
```

This writes, without root:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.downloadautomations.host.json
```

The manifest `path` is the absolute debug binary, normally `target/debug/native-host`. `allowed_origins` contains only:

```text
chrome-extension://<CHROME_EXTENSION_ID>/
```

To register a release binary instead:

```bash
cargo build -p native-host --release
cargo run -p native-host -- install \
  --browser chrome \
  --extension-id <CHROME_EXTENSION_ID> \
  --binary target/release/native-host
```

Use the second command's binary only if that file exists. `install` canonicalizes the path it records.

## 6. Verify registration

```bash
cargo run -p native-host -- verify --browser chrome --extension-id <CHROME_EXTENSION_ID>
```

You should see the manifest path, the binary path, and the allowed origin. If the manifest exists but the binary file is gone, verify says the executable is missing. If you omit `--extension-id`, verify checks the manifest and binary without comparing the allowlist.

## 7. Test the connection

Reload the extension at `chrome://extensions` if it was loaded before you installed the host. Open the Download Automations popup and choose **Test connection**.

- **Connected** means ping and `get_capabilities` succeeded, and the host is dry-run only.
- **Not installed** means Chrome could not find `dev.downloadautomations.host`. Repeat the install command. The popup shows the command with this extension's ID.
- **Error** usually means the allowlist ID does not match, or the recorded binary cannot start. Run verify, then install again with the ID from the popup.

The popup always shows a **DRY RUN** banner. Sleep, Shut down, and Restart are labels only.

## 8. Enable automation

Turn on **Enable after-download automation** and choose Sleep, Shut down, or Restart. The choice is stored in extension storage and remains after the browser restarts. The default is off.

## 9. Download a harmless file

In Chrome, download a small public file, for example:

```text
https://github.com/github/gitignore/archive/refs/heads/main.zip
```

Any other small file you are comfortable saving is fine. The extension does not read the file.

## 10. Confirm the dry run

Open the popup again.

- **Latest download** shows the file name, not the full path.
- **Latest result** shows `Would put this computer to sleep`, or the shut-down / restart sentence for the action you chose.
- The computer does not sleep, shut down, or restart.
- Downloading the same completed item does not add a second result. A second, different download adds one new result when automation is still enabled.
- If automation is off, the download can still appear and no result is added.

## 11. Remove the host registration

```bash
cargo run -p native-host -- uninstall --browser chrome
```

That deletes the user-level manifest. It does not delete the built binary. Running uninstall again is safe if the manifest is already gone.

## Checks

```bash
pnpm check
cargo test --workspace
cargo fmt --check
cargo clippy --workspace --all-targets -- -D warnings
```

`pnpm check` includes a Playwright test that loads the built extension and reads the popup. Branded Google Chrome ignores `--load-extension`, so that test uses Playwright's Chromium. It does not install the native host and does not claim a native-messaging round trip. Use **Test connection** in your own Chrome profile for that.

## When a production extension ID exists

Run `install` again with the store ID. Chrome will reject the host for any extension that is not listed in `allowed_origins`. If the host name changes for production, update `NATIVE_HOST_NAME` and `HOST_NAME` together and reinstall. The `native_messaging` crate's browser keys are the place to add Windows or Linux path support later; the install command already delegates path selection to that crate.
