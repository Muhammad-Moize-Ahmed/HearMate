import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

export type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: ReactNode;
  ref?: Ref<HTMLInputElement>;
  /** Extra content inside the field, on the right (e.g. a show-password button). */
  trailing?: ReactNode;
};

export function TextField({
  label,
  error,
  hint,
  trailing,
  id,
  className = '',
  ...inputProps
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
          className={`min-h-12 w-full rounded-2xl border-2 bg-white px-4 text-lg transition placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus-visible:outline-none focus:ring-4 focus:ring-brand-200 ${error ? 'border-rose-400' : 'border-brand-200'} ${trailing ? 'pr-24' : ''} ${className}`}
          {...inputProps}
        />
        {trailing && <div className="absolute inset-y-0 right-2 flex items-center">{trailing}</div>}
      </div>
      {hint && (
        <p id={hintId} className="text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm font-semibold text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'trailing'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          // An explicit label: text split across elements loses its space ("Showpassword").
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="min-h-9 rounded-xl px-3 text-sm font-bold text-brand-700 hover:bg-brand-100"
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      }
    />
  );
}
