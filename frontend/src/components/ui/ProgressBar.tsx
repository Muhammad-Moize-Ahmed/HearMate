export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.min(value, max)}
      aria-valuetext={`${value} of ${max}`}
      className="h-4 w-full overflow-hidden rounded-full bg-brand-100"
    >
      <div
        className={`h-full rounded-full transition-[width] ${percent >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
