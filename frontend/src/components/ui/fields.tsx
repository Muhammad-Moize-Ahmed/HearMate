import {
  useId,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/** Shared look for form controls, matching `TextField`. */
const CONTROL =
  'w-full rounded-2xl border-2 bg-white px-4 text-lg transition focus:border-brand-500 focus:ring-4 focus:ring-brand-200 focus:outline-none focus-visible:outline-none';

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, hint: unknown, error: unknown): string | undefined {
  return (
    [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  );
}

type SelectFieldProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  ref?: Ref<HTMLSelectElement>;
  options: readonly { value: string; label: string }[];
  /** Label for an empty first option (e.g. "Not sure"); omit to require a choice. */
  emptyLabel?: string;
};

export function SelectField({
  label,
  hint,
  error,
  options,
  emptyLabel,
  id,
  ...props
}: SelectFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <select
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={`${CONTROL} min-h-12 ${error ? 'border-rose-400' : 'border-brand-200'}`}
        {...props}
      >
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

type TextAreaFieldProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: ReactNode;
  error?: string;
  ref?: Ref<HTMLTextAreaElement>;
};

export function TextAreaField({ label, hint, error, id, ...props }: TextAreaFieldProps) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error}>
      <textarea
        id={fieldId}
        rows={3}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(fieldId, hint, error)}
        className={`${CONTROL} py-3 ${error ? 'border-rose-400' : 'border-brand-200'}`}
        {...props}
      />
    </FieldShell>
  );
}

type Choice<V extends string | number> = { value: V; label: string; emoji?: string };

/** Tick any number of options, shown as big tappable chips. */
export function ChipGroup<V extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  options: readonly Choice<V>[];
  value: readonly V[];
  onChange: (value: V[]) => void;
}) {
  const toggle = (option: V) =>
    onChange(value.includes(option) ? value.filter((v) => v !== option) : [...value, option]);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{legend}</legend>
      {hint && <p className="-mt-1 mb-1 text-sm text-ink-soft">{hint}</p>}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = value.includes(option.value);
          return (
            <label
              key={option.value}
              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-2 px-4 py-1.5 transition has-focus-visible:ring-4 has-focus-visible:ring-brand-300 ${
                checked
                  ? 'border-brand-500 bg-brand-100 font-semibold text-brand-800'
                  : 'border-brand-100 bg-white hover:border-brand-300'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(option.value)}
              />
              {option.emoji && <span aria-hidden="true">{option.emoji}</span>}
              {option.label}
              {checked && <span aria-hidden="true">✓</span>}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Pick one option from a few, shown side by side. */
export function SegmentedChoice<V extends string | number>({
  legend,
  options,
  value,
  onChange,
  name,
}: {
  legend: string;
  options: readonly Choice<V>[];
  value: V;
  onChange: (value: V) => void;
  name: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 font-semibold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={String(option.value)}
              className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 px-3 text-center transition has-focus-visible:ring-4 has-focus-visible:ring-brand-300 ${
                checked
                  ? 'border-brand-500 bg-brand-100 font-bold text-brand-800'
                  : 'border-brand-100 bg-white hover:border-brand-300'
              }`}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={checked}
                onChange={() => onChange(option.value)}
              />
              {option.emoji && <span aria-hidden="true">{option.emoji}</span>}
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
