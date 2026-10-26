import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';

import { ApiError, describeError, publicApi, unwrap } from '../../api/client';
import type { AuthLocationState } from '../../auth/routing';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CodeInput } from '../../components/ui/CodeInput';
import { PasswordField, TextField } from '../../components/ui/TextField';
import { useCooldown } from '../../lib/useCooldown';
import { AuthCard } from './AuthCard';
import { forgotSchema, MIN_PASSWORD_LENGTH, resetSchema } from './schemas';

const RESEND_COOLDOWN_SECONDS = 60;

/** Two steps: ask for a code by email, then set a new password with it. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [cooldown, startCooldown] = useCooldown();

  const requestCode = useMutation({
    mutationFn: (address: string) =>
      unwrap(publicApi.POST('/api/auth/password/forgot', { body: { email: address } })),
    onSuccess: (_data, address) => {
      setEmail(address);
      startCooldown(RESEND_COOLDOWN_SECONDS);
    },
  });

  return email === null ? (
    <RequestStep
      onSubmit={(address) => requestCode.mutate(address)}
      pending={requestCode.isPending}
      error={requestCode.error}
    />
  ) : (
    <ResetStep
      email={email}
      onResend={() => requestCode.mutate(email)}
      resendPending={requestCode.isPending}
      resendError={requestCode.error}
      cooldown={cooldown}
    />
  );
}

function RequestStep({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (email: string) => void;
  pending: boolean;
  error: Error | null;
}) {
  const form = useForm({ resolver: zodResolver(forgotSchema), defaultValues: { email: '' } });
  return (
    <AuthCard
      title="Forgot your password?"
      emoji="🔑"
      subtitle="No problem. Tell us your email and we'll send you a code to set a new one."
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => onSubmit(v.email))}
        className="flex flex-col gap-5"
      >
        {error && <Alert tone="error">{describeError(error)}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" size="lg" fullWidth loading={pending}>
          Send me a code
        </Button>
        <p className="text-center text-ink-soft">
          <Link to="/login" className="font-bold text-brand-700 underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}

function ResetStep({
  email,
  onResend,
  resendPending,
  resendError,
  cooldown,
}: {
  email: string;
  onResend: () => void;
  resendPending: boolean;
  resendError: Error | null;
  cooldown: number;
}) {
  const navigate = useNavigate();
  const form = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { code: '', password: '', confirm: '' },
  });
  const reset = useMutation({
    mutationFn: (values: z.output<typeof resetSchema>) =>
      unwrap(
        publicApi.POST('/api/auth/password/reset', {
          body: { email, code: values.code, new_password: values.password },
        }),
      ),
    onSuccess: () => {
      const state: AuthLocationState = { notice: 'password-reset', email };
      void navigate('/login', { state });
    },
  });
  const { errors } = form.formState;

  return (
    <AuthCard
      title="Set a new password"
      emoji="📬"
      subtitle={`If ${email} has an account, we've emailed it a 6-number code.`}
    >
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => reset.mutate(v))}
        className="flex flex-col gap-5"
      >
        {reset.error && <Alert tone="error">{resetErrorMessage(reset.error)}</Alert>}
        {resendError && <Alert tone="error">{describeError(resendError)}</Alert>}
        {import.meta.env.DEV && (
          <Alert tone="info">Running locally? The code is printed in the backend terminal.</Alert>
        )}
        <CodeInput
          label="Code from the email"
          error={errors.code?.message}
          {...form.register('code')}
        />
        <PasswordField
          label="New password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <PasswordField
          label="Type it again"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...form.register('confirm')}
        />
        <Button type="submit" size="lg" fullWidth loading={reset.isPending}>
          Save new password
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onClick={onResend}
          loading={resendPending}
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send me a new code'}
        </Button>
      </form>
    </AuthCard>
  );
}

function resetErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.code === 'invalid_code') {
    return "That code isn't right or has expired. Check your newest email, or send a new code.";
  }
  return describeError(error);
}
