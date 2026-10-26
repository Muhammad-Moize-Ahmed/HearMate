import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';

import { describeError, publicApi, unwrap } from '../../api/client';
import { rememberPendingSignup } from '../../auth/pending';
import { readAuthState, type AuthLocationState } from '../../auth/routing';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PasswordField, TextField } from '../../components/ui/TextField';
import { AuthCard } from './AuthCard';
import { MIN_PASSWORD_LENGTH, signupSchema } from './schemas';

type SignupValues = z.output<typeof signupSchema>;

const ROLES = [
  { id: 'parent', emoji: '👪', title: "I'm a parent", text: 'For my child’s practice at home' },
  {
    id: 'therapist',
    emoji: '🩺',
    title: "I'm a therapist",
    text: 'To support children I work with',
  },
] as const;

export function SignupPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const initialRole: SignupValues['role'] =
    params.get('role') === 'therapist' ? 'therapist' : 'parent';
  const form = useForm({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      role: initialRole,
      first_name: '',
      last_name: '',
      email: '',
      password: '',
      confirm: '',
      license_number: '',
      organization: '',
      specialization: '',
    },
  });
  const role = useWatch({ control: form.control, name: 'role' });
  const { errors } = form.formState;

  const signup = useMutation({
    mutationFn: (values: SignupValues) =>
      unwrap(
        publicApi.POST('/api/auth/signup', {
          body: {
            role: values.role,
            first_name: values.first_name,
            last_name: values.last_name,
            email: values.email,
            password: values.password,
            ...(values.role === 'therapist' && {
              therapist: {
                license_number: values.license_number || null,
                organization: values.organization || null,
                specialization: values.specialization || null,
              },
            }),
          },
        }),
      ),
    onSuccess: (_data, values) => {
      rememberPendingSignup(values.email, values.password);
      const state: AuthLocationState = {
        email: values.email,
        from: readAuthState(location.state).from,
      };
      void navigate('/verify-email', { state });
    },
  });

  return (
    <AuthCard title="Create your account" subtitle="It only takes a minute." emoji="✨">
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => signup.mutate(values))}
        className="flex flex-col gap-5"
      >
        {signup.error && <Alert tone="error">{describeError(signup.error)}</Alert>}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 font-semibold">Who are you?</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {ROLES.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 transition has-focus-visible:ring-4 has-focus-visible:ring-brand-300 sm:flex-col sm:text-center ${
                  role === option.id
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-brand-100 hover:border-brand-300'
                }`}
              >
                <input
                  type="radio"
                  value={option.id}
                  className="sr-only"
                  {...form.register('role')}
                />
                <span className="text-3xl" aria-hidden="true">
                  {option.emoji}
                </span>
                <span>
                  <span className="block font-bold">{option.title}</span>
                  <span className="block text-sm text-ink-soft">{option.text}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <TextField
            label="First name"
            autoComplete="given-name"
            error={errors.first_name?.message}
            {...form.register('first_name')}
          />
          <TextField
            label="Last name"
            autoComplete="family-name"
            error={errors.last_name?.message}
            {...form.register('last_name')}
          />
        </div>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <PasswordField
          label="Password"
          autoComplete="new-password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. A short sentence is easy to remember.`}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <PasswordField
          label="Type the password again"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...form.register('confirm')}
        />

        {role === 'therapist' && (
          <fieldset className="flex flex-col gap-4 rounded-2xl bg-brand-50 p-4">
            <legend className="sr-only">Professional details</legend>
            <p className="text-sm text-ink-soft">
              An administrator reviews every therapist account before it can see children’s data.
              These details help them (all optional).
            </p>
            <TextField
              label="Licence number"
              error={errors.license_number?.message}
              {...form.register('license_number')}
            />
            <TextField
              label="Organisation"
              autoComplete="organization"
              error={errors.organization?.message}
              {...form.register('organization')}
            />
            <TextField
              label="Specialisation"
              error={errors.specialization?.message}
              {...form.register('specialization')}
            />
          </fieldset>
        )}

        <Button type="submit" size="lg" fullWidth loading={signup.isPending}>
          Create account
        </Button>
        <p className="text-center text-ink-soft">
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-brand-700 underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
