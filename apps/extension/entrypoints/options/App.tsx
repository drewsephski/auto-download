import { Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Switch } from "../../components/ui/switch";
import { useOptionsModel } from "./use-options-model";

export function App() {
  const model = useOptionsModel();

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-6">
      <header className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-amber-300">
          <Download aria-hidden="true" size={18} />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-zinc-50">Download conditions</h1>
          <p className="mt-1 text-sm leading-5 text-zinc-400">
            Choose which completed downloads can trigger your after-download automation.
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
        <h2 className="text-sm font-medium text-zinc-100">When should this automation run?</h2>

        <div className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-200">Filename pattern</span>
            <input
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-50"
              onChange={(event) => {
                model.updateField("filenamePattern", event.target.value);
              }}
              placeholder="backup-*.zip"
              value={model.form.filenamePattern}
            />
            <span className="text-xs text-zinc-500">Use * for any characters and ? for one character.</span>
            {model.errors.filenamePattern ? (
              <span className="text-xs text-red-300">{model.errors.filenamePattern}</span>
            ) : null}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-200">File types</span>
            <input
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-50"
              onChange={(event) => {
                model.updateField("extensions", event.target.value);
              }}
              placeholder="zip, dmg, iso"
              value={model.form.extensions}
            />
            {model.errors.extensions ? <span className="text-xs text-red-300">{model.errors.extensions}</span> : null}
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm text-zinc-200">Source domains</span>
            <input
              className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-50"
              onChange={(event) => {
                model.updateField("sourceHosts", event.target.value);
              }}
              placeholder="example.com, *.githubusercontent.com"
              value={model.form.sourceHosts}
            />
            {model.errors.sourceHosts ? <span className="text-xs text-red-300">{model.errors.sourceHosts}</span> : null}
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm text-zinc-200">Minimum size (MB)</span>
              <input
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-50"
                inputMode="decimal"
                onChange={(event) => {
                  model.updateField("minSizeMb", event.target.value);
                }}
                placeholder="0"
                value={model.form.minSizeMb}
              />
              {model.errors.minSizeMb ? <span className="text-xs text-red-300">{model.errors.minSizeMb}</span> : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-sm text-zinc-200">Maximum size (MB)</span>
              <input
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-50"
                inputMode="decimal"
                onChange={(event) => {
                  model.updateField("maxSizeMb", event.target.value);
                }}
                placeholder="No limit"
                value={model.form.maxSizeMb}
              />
              {model.errors.maxSizeMb ? <span className="text-xs text-red-300">{model.errors.maxSizeMb}</span> : null}
            </label>
          </div>
          {model.errors.sizeRange ? <p className="text-xs text-red-300">{model.errors.sizeRange}</p> : null}

          <div className="flex items-start justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2">
            <div>
              <p className="text-sm text-zinc-100">Wait until all downloads finish</p>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                If another download is still active, this action waits until the download queue is empty. If a new
                download starts during the 30-second countdown, the pending action is cancelled and waits again.
              </p>
            </div>
            <Switch
              checked={model.form.waitForAllDownloads}
              label="Wait until all downloads finish"
              onCheckedChange={(checked) => {
                model.updateField("waitForAllDownloads", checked);
              }}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Button disabled={model.saving} onClick={() => void model.handleSave()} type="button">
            Save conditions
          </Button>
          {model.savedMessage ? <p className="text-sm text-emerald-300">{model.savedMessage}</p> : null}
          {model.errors.form ? <p className="text-sm text-red-300">{model.errors.form}</p> : null}
        </div>
      </section>

      {model.latestDownload ? (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm text-zinc-200">
          <h2 className="text-xs font-medium tracking-wide text-zinc-400 uppercase">Last download</h2>
          <p className="mt-1">
            {model.latestDownload.filename}
            {model.latestDownload.sizeBytes !== null ? (
              <span className="text-zinc-500"> · {model.formatFileSize(model.latestDownload.sizeBytes)}</span>
            ) : null}
            {model.latestDownload.sourceHost ? (
              <span className="text-zinc-500"> · {model.latestDownload.sourceHost}</span>
            ) : null}
          </p>
          {model.preview ? (
            <p className={model.preview.matched ? "mt-1 text-emerald-300" : "mt-1 text-amber-200"}>{model.preview.text}</p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
