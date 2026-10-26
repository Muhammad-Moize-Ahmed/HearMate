import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { PasswordField, TextField } from '../../components/ui/TextField';
import { useRemoveChildLogin, useSetChildLogin, type Child } from './queries';
import { childLoginSchema, suggestUsername } from './schemas';

/** The child's own sign-in: a username (unique across HearMate) and a PIN the parent picks. */
export function ChildLoginCard({ child }: { child: Child }) {
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [saved, setSaved] = useState<'set' | 'removed' | null>(null);
  const remove = useRemoveChildLogin(child.id);
  const name = child.display_name;

  if (editing) {
    return (
      <LoginForm
        child={child}
        onDone={() => {
          setEditing(false);
          setSaved('set');
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {saved === 'set' && child.login && (
        <Alert tone="success">
          Saved! {name} can sign in with the username <strong>{child.login.username}</strong> and
          the PIN you chose. Any device they were already signed in on has been signed out.
        </Alert>
      )}
      {saved === 'removed' && (
        <Alert tone="success">{name} can no longer sign in on their own.</Alert>
      )}

      {child.login ? (
        <p className="text-lg">
          {name} signs in on the <strong>Child</strong> tab with the username{' '}
          <strong className="rounded-lg bg-brand-100 px-2 py-0.5 font-mono">
            {child.login.username}
          </strong>{' '}
          and their PIN.
        </p>
      ) : (
        <p className="text-lg text-ink-soft">
          Give {name} a username and a secret PIN so they can sign in and play on their own, without
          your password.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant={child.login ? 'secondary' : 'primary'}
          onClick={() => {
            setSaved(null);
            setEditing(true);
          }}
        >
          {child.login ? 'Change username or PIN' : 'Set up sign-in'}
        </Button>
        {child.login && (
          <Button variant="ghost" onClick={() => setConfirmingRemove(true)}>
            Turn off sign-in
          </Button>
        )}
      </div>

      {confirmingRemove && (
        <ConfirmDialog
          title={`Turn off ${name}'s sign-in?`}
          confirmLabel="Turn off sign-in"
          pending={remove.isPending}
          error={remove.error && <Alert tone="error">{describeError(remove.error)}</Alert>}
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={() =>
            remove.mutate(undefined, {
              onSuccess: () => {
                setConfirmingRemove(false);
                setSaved('removed');
              },
            })
          }
        >
          <p>
            {name} will be signed out on every device and won't be able to sign in until you set up
            a new username and PIN. Their progress is kept.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}

function LoginForm({
  child,
  onDone,
  onCancel,
}: {
  child: Child;
  onDone: () => void;
  onCancel: () => void;
}) {
  const save = useSetChildLogin(child.id);
  const form = useForm({
    resolver: zodResolver(childLoginSchema),
    defaultValues: {
      username: child.login?.username ?? suggestUsername(child.display_name),
      pin: '',
      confirm: '',
    },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values: z.output<typeof childLoginSchema>) =>
    save.mutate(
      { username: values.username, pin: values.pin },
      {
        onSuccess: onDone,
        onError: (error) => {
          if (error instanceof ApiError && error.code === 'username_taken') {
            form.setError('username', {
              message: `That username is taken. Try adding a number, like ${values.username}${child.age_years}.`,
            });
          }
        },
      },
    ),
  );
  const otherError =
    save.error instanceof ApiError && save.error.code === 'username_taken' ? null : save.error;

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      {otherError && <Alert tone="error">{describeError(otherError)}</Alert>}
      <TextField
        label="Username"
        hint="What they type to sign in. It must be unique across HearMate."
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        error={errors.username?.message}
        {...form.register('username')}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <PasswordField
          label={child.login ? 'New PIN' : 'PIN'}
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          hint="4 to 8 numbers. Avoid 1111 or 1234."
          error={errors.pin?.message}
          {...form.register('pin')}
        />
        <PasswordField
          label="Type the PIN again"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          error={errors.confirm?.message}
          {...form.register('confirm')}
        />
      </div>
      {child.login && (
        <p className="text-sm text-ink-soft">
          Saving signs {child.display_name} out on every device; they'll sign in again with the new
          details.
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={save.isPending}>
          Save sign-in
        </Button>
      </div>
    </form>
  );
}
