import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Button } from './Button';

type ConfirmDialogProps = {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  /** For permanent actions: the user must type this text before confirming. */
  typeToConfirm?: string;
  error?: ReactNode;
};

/**
 * A modal "are you sure?" box. Focus starts on Cancel (the safe choice), Escape cancels, and
 * focus returns to whatever opened it.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
  typeToConfirm,
  error,
}: ConfirmDialogProps) {
  const titleId = useId();
  const inputId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  // The latest handler, so the effect below runs only on open and close.
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  });

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus();
    };
  }, []);

  const confirmed = typeToConfirm === undefined || typed.trim() === typeToConfirm.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md animate-pop-in rounded-3xl bg-white p-6 shadow-2xl"
      >
        <h2 id={titleId} className="mb-3 text-2xl font-black">
          {title}
        </h2>
        <div className="mb-5 flex flex-col gap-3 text-ink-soft">{children}</div>
        {typeToConfirm !== undefined && (
          <div className="mb-5 flex flex-col gap-1.5">
            <label htmlFor={inputId} className="font-semibold">
              Type <strong>{typeToConfirm}</strong> to confirm
            </label>
            <input
              id={inputId}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              className="min-h-12 rounded-2xl border-2 border-brand-200 px-4 text-lg focus:border-brand-500 focus:outline-none"
            />
          </div>
        )}
        {error && <div className="mb-4">{error}</div>}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={pending} disabled={!confirmed}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
