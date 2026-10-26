import type { TextFieldProps } from './TextField';
import { TextField } from './TextField';

/**
 * The 6-digit code from an email. One plain input (not six boxes), so pasting, autofill
 * (`one-time-code`) and screen readers all just work.
 */
export function CodeInput(props: Omit<TextFieldProps, 'type'>) {
  return (
    <TextField
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="••••••"
      className="text-center font-mono text-3xl tracking-[0.5em]"
      {...props}
    />
  );
}
