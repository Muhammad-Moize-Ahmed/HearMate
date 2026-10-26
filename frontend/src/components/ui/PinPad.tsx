import { useId } from 'react';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

type PinPadProps = {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  error?: string;
  label?: string;
  disabled?: boolean;
};

/**
 * A PIN entry for children: big number buttons they can tap, plus an ordinary field (dots) that
 * also accepts typing, the device keyboard and screen readers.
 */
export function PinPad({
  value,
  onChange,
  maxLength = 8,
  error,
  label = 'Your secret PIN',
  disabled = false,
}: PinPadProps) {
  const id = useId();
  const errorId = `${id}-error`;

  const press = (digit: string) => {
    if (value.length < maxLength) onChange(value + digit);
  };

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={id} className="text-lg font-bold">
        {label}
      </label>
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, maxLength))}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`min-h-16 w-full rounded-3xl border-4 bg-white text-center font-mono text-4xl tracking-[0.4em] focus:border-brand-500 focus:outline-none focus-visible:outline-none ${error ? 'border-rose-400' : 'border-brand-200'}`}
      />
      {error && (
        <p id={errorId} className="text-center font-semibold text-rose-700">
          {error}
        </p>
      )}
      <div
        role="group"
        aria-label="Number pad"
        className="mx-auto grid w-full max-w-xs grid-cols-3 gap-3"
      >
        {KEYS.map((digit) => (
          <PadKey key={digit} label={digit} onPress={() => press(digit)} disabled={disabled} />
        ))}
        <PadKey
          label="⌫"
          accessibleLabel="Delete last number"
          onPress={() => onChange(value.slice(0, -1))}
          disabled={disabled || value.length === 0}
          tone="soft"
        />
        <PadKey label="0" onPress={() => press('0')} disabled={disabled} />
        <PadKey
          label="✕"
          accessibleLabel="Clear PIN"
          onPress={() => onChange('')}
          disabled={disabled || value.length === 0}
          tone="soft"
        />
      </div>
    </div>
  );
}

function PadKey({
  label,
  accessibleLabel,
  onPress,
  disabled,
  tone = 'bright',
}: {
  label: string;
  accessibleLabel?: string;
  onPress: () => void;
  disabled: boolean;
  tone?: 'bright' | 'soft';
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-label={accessibleLabel}
      className={`aspect-square min-h-16 rounded-3xl text-3xl font-black transition active:scale-95 disabled:opacity-40 ${
        tone === 'bright'
          ? 'bg-white text-brand-700 shadow-[0_4px_0_var(--color-brand-200)] hover:bg-brand-100'
          : 'bg-brand-100 text-brand-700 hover:bg-brand-200'
      }`}
    >
      {label}
    </button>
  );
}
