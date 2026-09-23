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

`cargo run` builds the debug binary and registers that absolute path. Chrome will launch that binary later, so leave the project where it is. Run `install` again after `cargo clean`, after moving the repository, or after pulling a host change. Protocol version 2 is not compatible with a version 1 helper. The popup reports that the helper must be updated.

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

- **Connected** means ping and `get_capabilities` succeeded on protocol version 2.
- **Not installed** means Chrome could not find `dev.downloadautomations.host`. Repeat the install command. The popup shows the command with this extension's ID.
- **Error** can mean the allowlist ID does not match, the recorded binary cannot start, or the installed helper is still protocol version 1. Run verify, then install again with the ID from the popup.

The popup shows **DRY RUN** until real sleep is armed.

## 8. Allow macOS control

Real sleep uses System Events. Choose **Allow macOS control** in the popup. macOS may ask whether the helper can control System Events. That button is the only place this request is sent. A finished download does not open it.

The popup says **macOS permission granted** only after the helper reports success. Until then, real mode stays unavailable. Dry run does not need this permission.

If Chrome notifications are blocked, real mode also stays unavailable. The cancel button lives on a notification, so the extension will not arm real sleep without one.

## 9. Enable automation

Turn on **Enable after-download automation**. Choose Sleep, Shut down, or Restart. Dry run is the default execution mode and works for all three.

To arm real sleep:

1. Leave the action on Sleep.
2. Choose **Real**.
3. Read the confirmation. It says a finished download can sleep this Mac, that there is a 30-second cancel window, and that closing Chrome or losing the helper cancels the pending sleep.
4. Choose **Enable real sleep**.

The banner changes to **LIVE — SLEEP ENABLED**. Shut down and Restart cannot be switched to real. The host would reject those requests anyway.

## 10. Download a harmless file

In Chrome, download a small public file, for example:

```text
https://github.com/github/gitignore/archive/refs/heads/main.zip
```

Any other small file you are comfortable saving is fine. The extension does not read the file.

## 11. Confirm the result

Open the popup again.

Dry run:

- **Latest download** shows the file name, not the full path.
- **Latest result** shows `Would put this computer to sleep`, or the shut-down / restart sentence for the action you chose.
- The computer does not sleep, shut down, or restart.

Real sleep:

- A Chrome notification says the Mac will sleep in 30 seconds and offers **Cancel**.
- The popup can also show **Cancel sleep**.
- Cancel, closing Chrome, reloading the extension, or a helper disconnect leaves the computer awake.
- If you do not cancel, the host calls sleep once after the deadline. It does not retry a failure.
- A second download during the countdown does not start a second sleep.

Downloading the same completed item does not add a second result. If automation is off, the download can still appear and no result is added.

## 12. Remove the host registration

```bash
cargo run -p native-host -- uninstall --browser chrome
```

That deletes the user-level manifest. It does not delete the built binary. Running uninstall again is safe if the manifest is already gone.

## Checks

```bash
pnpm check
cargo test --workspace
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
```

`cargo test` uses a fake power controller. It does not sleep, shut down, or restart the machine. One ignored test calls real sleep only when both `--ignored` and `ALLOW_REAL_SLEEP_TEST=1` are set. Do not set that variable for normal checks.

`pnpm check` includes a Playwright test that loads the built extension and reads the popup. Branded Google Chrome ignores `--load-extension`, so that test uses Playwright's Chromium. It does not install the native host and does not claim a native-messaging round trip. Use **Test connection** in your own Chrome profile for that.

## When a production extension ID exists

Run `install` again with the store ID. Chrome will reject the host for any extension that is not listed in `allowed_origins`. If the host name changes for production, update `NATIVE_HOST_NAME` and `HOST_NAME` together and reinstall. The `native_messaging` crate's browser keys are the place to add Windows or Linux path support later; the install command already delegates path selection to that crate.
