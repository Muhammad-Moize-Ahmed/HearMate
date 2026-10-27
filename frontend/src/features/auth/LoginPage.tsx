import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { Link, useLocation, useSearchParams } from 'react-router';
import type { z } from 'zod';

import { ApiError, describeError, publicApi, unwrap } from '../../api/client';
import { useAuth } from '../../auth/context';
import { rememberPendingSignup } from '../../auth/pending';
import { readAuthState, type AuthLocationState } from '../../auth/routing';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PinPad } from '../../components/ui/PinPad';
import { PasswordField, TextField } from '../../components/ui/TextField';
import { AuthCard } from './AuthCard';
import { childLoginSchema, loginSchema } from './schemas';
import { panelId, tabId, type LoginTab } from './loginTabs';
import { RoleTabs } from './RoleTabs';

type Audience = 'parent' | 'therapist' | 'child';

// The parent and therapist wordings head the same form: neither checks or reveals a role.
const HEADINGS: Record<Audience, { title: string; subtitle: string; emoji: string }> = {
  parent: {
    title: 'Welcome back',
    subtitle: 'Parents and therapists sign in here.',
    emoji: '👋',
  },
  therapist: {
    title: 'Welcome back',
    subtitle: 'Sign in to see the children you work with.',
    emoji: '🩺',
  },
  child: { title: "Let's play!", subtitle: 'Type your name and your secret PIN.', emoji: '🎧' },
};

function parseAudience(value: string | null): Audience {
  return value === 'child' || value === 'therapist' ? value : 'parent';
}

export function LoginPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const audience = parseAudience(params.get('as'));
  const tab: LoginTab = audience === 'child' ? 'child' : 'adult';
  const heading = HEADINGS[audience];

  const selectTab = (next: LoginTab) => {
    if (next === tab) return; // keeps ?as=therapist when its tab is chosen again
    const search = new URLSearchParams(params);
    if (next === 'adult') search.delete('as');
    else search.set('as', next);
    // Keep router state (where to go after signing in); don't add a history entry per tab.
    setParams(search, { replace: true, state: location.state });
  };

  return (
    <AuthCard title={heading.title} subtitle={heading.subtitle} emoji={heading.emoji}>
      <RoleTabs value={tab} onChange={selectTab} />
      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {audience === 'child' ? <ChildLoginForm /> : <EmailLoginForm audience={audience} />}
      </div>
    </AuthCard>
  );
}

function SessionNotices({ state }: { state: AuthLocationState }) {
  const auth = useAuth();
  if (state.notice === 'password-reset') {
    return <Alert tone="success">Your password was changed. Sign in with your new password.</Alert>;
  }
  if (auth.status === 'signed-out' && auth.reason === 'expired') {
    return <Alert tone="info">You were signed out. Please sign in again.</Alert>;
  }
  return null;
}

/** Parents and therapists alike: the account's role decides which dashboard opens. */
function EmailLoginForm({ audience }: { audience: 'parent' | 'therapist' }) {
  const { signIn } = useAuth();
  const location = useLocation();
  const routerState = readAuthState(location.state);
  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: routerState.email ?? '', password: '' },
  });
  const login = useMutation({
    mutationFn: (body: z.output<typeof loginSchema>) =>
      unwrap(publicApi.POST('/api/auth/login', { body })),
    onSuccess: signIn,
    onError: (error, body) => {
      if (error instanceof ApiError && error.code === 'email_not_verified') {
        rememberPendingSignup(body.email, body.password);
      }
    },
  });
  const { errors } = form.formState;
  const submittedEmail = login.variables?.email;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => login.mutate(values))}
      className="flex flex-col gap-5"
    >
      <SessionNotices state={routerState} />
      {login.error && (
        <LoginError error={login.error} email={submittedEmail} from={routerState.from} />
      )}
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <div className="-mt-2 text-right">
        <Link
          to="/forgot-password"
          className="font-semibold text-brand-700 underline-offset-4 hover:underline"
        >
          Forgot your password?
        </Link>
      </div>
      <Button type="submit" size="lg" fullWidth loading={login.isPending}>
        Sign in
      </Button>
      <p className="text-center text-ink-soft">
        New to HearMate?{' '}
        <Link
          to={audience === 'therapist' ? '/signup?role=therapist' : '/signup'}
          className="font-bold text-brand-700 underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}

function LoginError({ error, email, from }: { error: Error; email?: string; from?: string }) {
  if (error instanceof ApiError && error.code === 'invalid_credentials') {
    return (
      <Alert tone="error">
        That email and password don't match. Please check them and try again.
      </Alert>
    );
  }
  if (error instanceof ApiError && error.code === 'email_not_verified') {
    const state: AuthLocationState = { email, from };
    return (
      <Alert tone="error">
        Please confirm your email address first.{' '}
        <Link to="/verify-email" state={state} className="font-bold underline">
          Enter your code
        </Link>
      </Alert>
    );
  }
  return <Alert tone="error">{describeError(error)}</Alert>;
}

function ChildLoginForm() {
  const { signIn } = useAuth();
  const form = useForm({
    resolver: zodResolver(childLoginSchema),
    defaultValues: { username: '', pin: '' },
  });
  const login = useMutation({
    mutationFn: (body: z.output<typeof childLoginSchema>) =>
      unwrap(publicApi.POST('/api/auth/child-login', { body })),
    onSuccess: signIn,
    // A wrong PIN clears the PIN, so the child can simply try again.
    onError: () => form.setValue('pin', ''),
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => login.mutate(values))}
      className="flex flex-col gap-5"
    >
      {login.error && <Alert tone="error">{childErrorMessage(login.error)}</Alert>}
      <TextField
        label="Your name"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="text-xl"
        error={errors.username?.message}
        {...form.register('username')}
      />
      <Controller
        control={form.control}
        name="pin"
        render={({ field, fieldState }) => (
          <PinPad value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
        )}
      />
      <Button type="submit" variant="sunny" size="xl" fullWidth loading={login.isPending}>
        <span aria-hidden="true">🚀</span> Let's go!
      </Button>
      <p className="text-center text-ink-soft">
        Forgot your PIN? Ask your grown-up to set a new one.
      </p>
    </form>
  );
}

function childErrorMessage(error: Error): string {
  if (error instanceof ApiError && error.code === 'invalid_credentials') {
    return "Hmm, that name or PIN isn't right. Try again!";
  }
  if (error instanceof ApiError && error.status === 429) {
    return 'Too many tries! Take a little break, then ask your grown-up for help.';
  }
  return describeError(error);
}
