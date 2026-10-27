import { useId, useState, type FormEvent } from 'react';

import { Button } from '../../components/ui/Button';
import { todayISO } from '../../lib/dates';
import { customRangeError, defaultCustom, PRESETS, readRange, type Range } from './range';

/** Week / Month / 3 months, or a custom pair of dates (7 days to a year, ending by today). */
export function RangeFilter({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const [custom, setCustom] = useState(range.kind === 'custom');
  const options = [
    ...PRESETS.map((p) => ({ value: p.value, label: p.label })),
    { value: 'custom', label: 'Custom' },
  ];
  const selected = custom ? 'custom' : range.kind;

  return (
    <div className="flex flex-col gap-3 print:hidden">
      <div role="group" aria-label="Period" className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected === option.value}
            onClick={() => {
              if (option.value === 'custom') {
                setCustom(true);
                return;
              }
              setCustom(false);
              const preset = PRESETS.find((p) => p.value === option.value)!;
              onChange({ kind: preset.value, days: preset.days });
            }}
            className="min-h-11 rounded-full px-4 font-bold ring-2 ring-brand-200 transition aria-pressed:bg-brand-600 aria-pressed:text-white aria-pressed:ring-brand-600 hover:bg-brand-50 aria-pressed:hover:bg-brand-700"
          >
            {option.label}
          </button>
        ))}
      </div>
      {custom && <CustomRange range={range} onApply={onChange} />}
    </div>
  );
}

function CustomRange({ range, onApply }: { range: Range; onApply: (r: Range) => void }) {
  const id = useId();
  const today = todayISO();
  const [dates, setDates] = useState(() => defaultCustom(range, today));
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = customRangeError(dates.from, dates.to, today);
    setError(problem);
    if (problem) return;
    const params = new URLSearchParams({ range: 'custom', ...dates });
    onApply(readRange(params, today, 'month'));
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      {(['from', 'to'] as const).map((field) => (
        <label key={field} htmlFor={`${id}-${field}`} className="flex flex-col gap-1 font-semibold">
          {field === 'from' ? 'From' : 'To'}
          <input
            id={`${id}-${field}`}
            type="date"
            max={today}
            value={dates[field]}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => setDates({ ...dates, [field]: event.target.value })}
            className="min-h-11 rounded-xl border-2 border-brand-200 bg-white px-3 font-normal focus:border-brand-500 focus:outline-none"
          />
        </label>
      ))}
      <Button type="submit" variant="secondary">
        Show
      </Button>
      {error && (
        <p id={`${id}-error`} role="alert" className="w-full font-semibold text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
