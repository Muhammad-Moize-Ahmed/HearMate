import { useId, useState, type FormEvent, type ReactNode } from 'react';

import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/TextField';
import { useOnline } from '../../lib/network';

type DeletionConfirmProps = {
  /** What goes, as a list the user reads before confirming. */
  children: ReactNode;
  confirmLabel: string;
  cancelTo: string;
  pending: boolean;
  error: Error | null;
  onConfirm: (password: string) => void;
};

/**
 * The confirmation for a permanent deletion: what will go, an "I understand" box and the account
 * password again. Nothing is sent until both are given, and never while offline (a deletion is
 * not queued for later).
 */
export function DeletionConfirm({
  children,
  confirmLabel,
  cancelTo,
  pending,
  error,
  onConfirm,
}: DeletionConfirmProps) {
  const online = useOnline();
  const checkboxId = useId();
  const [understood, setUnderstood] = useState(false);
  const [password, setPassword] = useState('');
  const ready = understood && password !== '' && online;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (ready && !pending) onConfirm(password);
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-[2rem] bg-white p-5 ring-2 ring-coral-300 sm:p-6"
    >
      <div className="flex flex-col gap-3 text-ink-soft">{children}</div>
      <p className="font-bold text-rose-800">This happens straight away and can't be undone.</p>
      {error && <Alert tone="error">{deletionErrorMessage(error)}</Alert>}
      {!online && (
        <Alert tone="info">You need the internet to do this. Nothing has been deleted.</Alert>
      )}
      <label htmlFor={checkboxId} className="flex items-start gap-3 font-bold">
        <input
          id={checkboxId}
          type="checkbox"
          checked={understood}
          onChange={(event) => setUnderstood(event.target.checked)}
          className="mt-1 size-5 accent-rose-700"
        />
        I understand that this is permanent.
      </label>
      <PasswordField
        label="Your password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="danger" disabled={!ready} loading={pending}>
          {confirmLabel}
        </Button>
        <LinkButton to={cancelTo} variant="secondary">
          Cancel
        </LinkButton>
      </div>
    </form>
  );
}

function deletionErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.code === 'wrong_password') {
    return "That password isn't right. Nothing has been deleted.";
  }
  return describeError(error);
}
