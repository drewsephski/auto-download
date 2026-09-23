import { cn } from "./cn";

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({ checked, disabled = false, label, onCheckedChange }: SwitchProps) {
  function handleClick() {
    onCheckedChange(!checked);
  }

  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/80",
        checked ? "bg-amber-400" : "bg-zinc-700",
      )}
      disabled={disabled}
      onClick={handleClick}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-zinc-950 transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}
