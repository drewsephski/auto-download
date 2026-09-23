import { Download } from "lucide-react";
import { modePresentation } from "../../lib/arming";
import { NATIVE_HOST_NAME } from "../../lib/constants";
import { formatFileSize } from "../../lib/format";
import { permissionLabel } from "../../lib/permission";
import { isActivePending } from "../../lib/pending";
import type { PowerAction } from "../../lib/settings";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { usePopupModel } from "./use-popup-model";

const ACTIONS: Array<{ value: PowerAction; label: string }> = [
  { value: "sleep", label: "Sleep" },
  { value: "shutdown", label: "Shut down" },
  { value: "reboot", label: "Restart" },
];

const MODES = [
  { value: "dry_run", label: "Dry run" },
  { value: "real", label: "Real" },
] as const;

export function App() {
  const model = usePopupModel();
  const banner = modePresentation(model.rule);
  const statusTitle = model.connection.phase === "checking" ? "Checking" : model.connection.status.title;
  const statusMessage =
    model.connection.phase === "checking" ? "Looking for the local helper." : model.connection.status.message;
  const statusState = model.connection.phase === "checking" ? "checking" : model.connection.status.state;
  const showSetup = model.setupOpen || statusState === "not_installed";
  const installCommand = `cargo run -p native-host -- install \\\n  --browser chrome \\\n  --extension-id ${model.extensionId}`;
  const realActionBlocked = model.rule.action !== "sleep";
  const pending = isActivePending(model.pending) && model.pending.status === "scheduled" ? model.pending : null;

  return (
    <main className="flex flex-col gap-3 p-4">
      <header className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-amber-300">
          <Download aria-hidden="true" size={18} />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight text-zinc-50">Download Automations</h1>
          <p className="mt-1 text-sm leading-5 text-zinc-400">Runs an action you choose when a download finishes.</p>
        </div>
      </header>

      <section
        aria-live="polite"
        className={
          banner.live
            ? "rounded-lg border border-sky-400/50 bg-sky-400/10 px-3 py-2"
            : "rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2"
        }
        role="status"
      >
        <p className={banner.live ? "text-xs font-semibold tracking-[0.14em] text-sky-200" : "text-xs font-semibold tracking-[0.16em] text-amber-200"}>
          {banner.label}
        </p>
        <p className={banner.live ? "mt-1 text-sm leading-5 text-sky-50" : "mt-1 text-sm leading-5 text-amber-50"}>{banner.detail}</p>
      </section>

      <section aria-live="polite" className="flex items-start gap-2 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2">
        <span aria-hidden="true" className={statusDotClass(statusState)} />
        <div>
          <p className="text-sm font-medium text-zinc-100">{statusTitle}</p>
          <p className="text-xs leading-5 text-zinc-400">{statusMessage}</p>
          <p className="text-xs leading-5 text-zinc-400">{permissionLabel(model.permission.state)}</p>
        </div>
      </section>

      {pending ? (
        <section aria-live="polite" className="rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2">
          <h2 className="text-sm font-medium text-sky-50">Sleep pending</h2>
          <p className="mt-1 truncate text-sm text-zinc-100" title={pending.filename}>
            {pending.filename}
          </p>
          <p className="text-xs leading-5 text-zinc-300">Sleeping in ~30 seconds</p>
          <Button className="mt-2" onClick={() => void model.handleCancelSleep()} type="button" variant="secondary">
            Cancel sleep
          </Button>
        </section>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-100">Enable after-download automation</span>
        <Switch
          checked={model.rule.enabled}
          disabled={model.saving}
          label="Enable after-download automation"
          onCheckedChange={(checked) => {
            void model.handleEnabledChange(checked);
          }}
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">Action</legend>
        <div aria-label="Action after a download finishes" className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-900 p-1" role="radiogroup">
          {ACTIONS.map((action) => {
            const selected = model.rule.action === action.value;
            return (
              <button
                aria-checked={selected}
                className={
                  selected
                    ? "rounded-md bg-zinc-100 px-2 py-1.5 text-sm font-medium text-zinc-950"
                    : "rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                }
                key={action.value}
                onClick={() => {
                  void model.handleActionChange(action.value);
                }}
                onKeyDown={(event) => {
                  handleActionKeyDown(event.key, action.value, (next) => {
                    void model.handleActionChange(next);
                  });
                }}
                role="radio"
                type="button"
              >
                {action.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-xs font-medium tracking-wide text-zinc-400 uppercase">Execution</legend>
        <div aria-label="Execution mode" className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-900 p-1" role="radiogroup">
          {MODES.map((mode) => {
            const selected = mode.value === "real" ? banner.live : !banner.live;
            return (
              <button
                aria-checked={selected}
                className={
                  selected
                    ? "rounded-md bg-zinc-100 px-2 py-1.5 text-sm font-medium text-zinc-950"
                    : "rounded-md px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                }
                key={mode.value}
                onClick={() => {
                  void model.handleModeChange(mode.value);
                }}
                role="radio"
                type="button"
              >
                {mode.label}
              </button>
            );
          })}
        </div>
        {realActionBlocked ? (
          <p className="mt-2 text-xs leading-5 text-zinc-400">Real shut down and restart are not enabled yet.</p>
        ) : null}
      </fieldset>

      {model.confirmingReal ? (
        <section aria-labelledby="real-sleep-title" className="rounded-lg border border-sky-400/40 bg-zinc-900 px-3 py-2" role="dialog">
          <h2 className="text-sm font-medium text-zinc-50" id="real-sleep-title">
            Enable real sleep
          </h2>
          <p className="mt-1 text-sm leading-5 text-zinc-300">After a download finishes, this Mac can sleep automatically.</p>
          <p className="text-sm leading-5 text-zinc-300">There is a 30-second cancellation period.</p>
          <p className="text-sm leading-5 text-zinc-300">Closing Chrome or losing the helper connection cancels the pending sleep.</p>
          <div className="mt-2 flex items-center gap-2">
            <Button disabled={model.saving} onClick={() => void model.handleConfirmRealSleep()} type="button">
              Enable real sleep
            </Button>
            <Button onClick={model.handleKeepDryRun} type="button" variant="ghost">
              Keep dry run
            </Button>
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Latest download</h2>
        {model.latestDownload ? (
          <p className="mt-1 truncate text-sm text-zinc-100" title={model.latestDownload.filename}>
            {model.latestDownload.filename}
            <span className="text-zinc-500"> · {formatFileSize(model.latestDownload.fileSize)}</span>
          </p>
        ) : (
          <p className="mt-1 text-sm text-zinc-500">No completed downloads yet.</p>
        )}
      </section>

      <section aria-live="polite">
        <h2 className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Latest result</h2>
        {model.latestExecution ? (
          <p className={model.latestExecution.ok ? "mt-1 text-sm text-zinc-100" : "mt-1 text-sm text-red-300"}>
            {model.latestExecution.message}
          </p>
        ) : (
          <p className="mt-1 text-sm text-zinc-500">No automation has run yet.</p>
        )}
      </section>

      {model.notice ? <p className="text-sm text-red-300">{model.notice}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={model.connection.phase === "checking"}
          onClick={() => {
            void model.refreshConnection();
          }}
          type="button"
        >
          Test connection
        </Button>
        <Button disabled={model.permissionBusy} onClick={() => void model.handleRequestPermission()} type="button" variant="secondary">
          Allow macOS control
        </Button>
        <Button onClick={model.handleToggleSetup} type="button" variant="ghost">
          {showSetup ? "Hide setup" : "Setup instructions"}
        </Button>
      </div>

      {showSetup ? (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3 text-sm text-zinc-300">
          <p>Install the local helper from the project folder, then test the connection again.</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-zinc-950 p-2 text-xs leading-5 text-zinc-200">
            <code>{installCommand}</code>
          </pre>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            Host name <span className="text-zinc-300">{NATIVE_HOST_NAME}</span>. Full steps are in docs/local-development.md.
            Extension ID <span className="text-zinc-300">{model.extensionId}</span>.
          </p>
        </section>
      ) : null}
    </main>
  );
}

function statusDotClass(state: "checking" | "connected" | "not_installed" | "error"): string {
  const color =
    state === "connected" ? "bg-emerald-400" : state === "not_installed" ? "bg-amber-300" : state === "error" ? "bg-red-400" : "bg-zinc-500";
  return `mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`;
}

function handleActionKeyDown(key: string, current: PowerAction, onSelect: (action: PowerAction) => void) {
  const values = ACTIONS.map((action) => action.value);
  const index = values.indexOf(current);
  if (index < 0) {
    return;
  }
  if (key !== "ArrowRight" && key !== "ArrowLeft") {
    return;
  }
  const direction = key === "ArrowRight" ? 1 : -1;
  const next = values[(index + direction + values.length) % values.length];
  if (next) {
    onSelect(next);
  }
}
