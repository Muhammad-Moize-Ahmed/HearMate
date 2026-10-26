import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation } from 'react-router';
import type { z } from 'zod';

import { ApiError, describeError, publicApi, unwrap } from '../../api/client';
import { useAuth } from '../../auth/context';
import { pendingEmail, pendingPasswordFor } from '../../auth/pending';
import { readAuthState } from '../../auth/routing';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CodeInput } from '../../components/ui/CodeInput';
import { PasswordField, TextField } from '../../components/ui/TextField';
import { useCooldown } from '../../lib/useCooldown';
import { AuthCard } from './AuthCard';
import { verifySchema } from './schemas';

const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmailPage() {
  const { signIn } = useAuth();
  const location = useLocation();
  const form = useForm({
    resolver: zodResolver(verifySchema),
    defaultValues: {
      email: readAuthState(location.state).email ?? pendingEmail() ?? '',
      code: '',
      password: '',
    },
  });
  const email = useWatch({ control: form.control, name: 'email' });
  // Right after signing up we already hold the password in memory; after a reload we must ask.
  const needsPassword = pendingPasswordFor(email) === null;
  const { errors } = form.formState;

  const verify = useMutation({
    mutationFn: (values: z.output<typeof verifySchema>) =>
      unwrap(
        publicApi.POST('/api/auth/verify-email', {
          body: {
            email: values.email,
            code: values.code,
            password: pendingPasswordFor(values.email) ?? values.password,
          },
        }),
      ),
    onSuccess: signIn,
  });

  const [cooldown, startCooldown] = useCooldown();
  const resend = useMutation({
    mutationFn: (address: string) =>
      unwrap(publicApi.POST('/api/auth/resend-verification', { body: { email: address } })),
    onSuccess: () => startCooldown(RESEND_COOLDOWN_SECONDS),
  });

  const onSubmit = form.handleSubmit((values) => {
    if (needsPassword && values.password === '') {
      form.setError('password', { message: 'Please enter the password you chose.' });
      return;
    }
    resend.reset();
    verify.mutate(values);
  });

  const onResend = async () => {
    if (!(await form.trigger('email'))) return;
    verify.reset();
    resend.mutate(form.getValues('email'));
  };

  return (
    <AuthCard
      title="Check your email"
      emoji="📬"
      subtitle="We sent you a 6-number code. Type it here to finish setting up your account."
    >
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
        {verify.error && <Alert tone="error">{verifyErrorMessage(verify.error)}</Alert>}
        {resend.isSuccess && (
          <Alert tone="success">
            If this email still needs confirming, a new code is on its way.
          </Alert>
        )}
        {resend.error && <Alert tone="error">{describeError(resend.error)}</Alert>}
        {import.meta.env.DEV && (
          <Alert tone="info">Running locally? The code is printed in the backend terminal.</Alert>
        )}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <CodeInput
          label="Code from the email"
          error={errors.code?.message}
          {...form.register('code')}
        />
        {needsPassword && (
          <PasswordField
            label="Your password"
            autoComplete="current-password"
            hint="The one you chose when you signed up."
            error={errors.password?.message}
            {...form.register('password')}
          />
        )}

        <Button type="submit" size="lg" fullWidth loading={verify.isPending}>
          Confirm and continue
        </Button>
        <Button
          variant="ghost"
          fullWidth
          onClick={() => void onResend()}
          loading={resend.isPending}
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send me a new code'}
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

function verifyErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.code === 'invalid_code') {
    return "That code isn't right or has expired. Check your newest email, or send a new code.";
  }
  if (error instanceof ApiError && error.code === 'invalid_credentials') {
    return "That email and password don't match.";
  }
  return describeError(error);
}
