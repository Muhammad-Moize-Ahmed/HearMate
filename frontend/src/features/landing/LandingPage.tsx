import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';

import { publicApi, unwrap } from '../../api/client';
import { useAuth } from '../../auth/context';
import { homePath } from '../../auth/routing';
import { Logo } from '../../components/ui/Logo';

const LINK_BUTTON =
  'inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl px-6 text-lg font-bold transition';

export function LandingPage() {
  const auth = useAuth();

  return (
    <div className="flex w-full max-w-2xl animate-pop-in flex-col items-center gap-8 text-center">
      <title>HearMate · Listening games for children with APD</title>
      <Logo size="lg" showName={false} />
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-black sm:text-5xl">Listening practice that feels like play</h1>
        <p className="text-lg text-ink-soft sm:text-xl">
          Short, friendly games that help children with auditory processing difficulties hear the
          difference, follow along and speak up. Parents and therapists see how they're doing.
        </p>
      </div>

      {auth.status === 'signed-in' ? (
        <Link
          to={homePath(auth.principal.kind)}
          className={`${LINK_BUTTON} bg-brand-600 text-white shadow-[0_4px_0_var(--color-brand-800)] hover:bg-brand-700`}
        >
          Go to my space
        </Link>
      ) : (
        <div className="flex w-full flex-col gap-3 sm:w-auto">
          <Link
            to="/login?as=child"
            className={`${LINK_BUTTON} min-h-16 bg-sun-300 text-xl text-ink shadow-[0_4px_0_#ca8a04] hover:bg-sun-200`}
          >
            <span aria-hidden="true">🎧</span> I'm a kid, let's play!
          </Link>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/login"
              className={`${LINK_BUTTON} bg-brand-600 text-white shadow-[0_4px_0_var(--color-brand-800)] hover:bg-brand-700`}
            >
              Sign in
            </Link>
            <Link
              to="/signup"
              className={`${LINK_BUTTON} bg-white text-brand-700 ring-2 ring-brand-200 hover:bg-brand-50`}
            >
              Create an account
            </Link>
          </div>
        </div>
      )}

      <ApiStatus />
    </div>
  );
}

function ApiStatus() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => unwrap(publicApi.GET('/api/health')),
    retry: false,
  });
  const label = health.isPending
    ? 'Checking API…'
    : health.isSuccess
      ? 'API online'
      : 'API unreachable';
  const dot = health.isPending
    ? 'bg-slate-300'
    : health.isSuccess
      ? 'bg-emerald-500'
      : 'bg-rose-500';
  return (
    <p
      role="status"
      className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-1 text-sm shadow-sm"
    >
      <span className={`size-2.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </p>
  );
}
