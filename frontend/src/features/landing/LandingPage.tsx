import { useQuery } from '@tanstack/react-query';

import { publicApi, unwrap } from '../../api/client';
import { useAuth } from '../../auth/context';
import { homePath } from '../../auth/routing';
import { LinkButton } from '../../components/ui/Button';
import { Logo } from '../../components/ui/Logo';

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
        <LinkButton to={homePath(auth.principal.kind)} size="lg">
          Go to my space
        </LinkButton>
      ) : (
        <div className="flex w-full flex-col gap-3 sm:w-auto">
          <LinkButton to="/login?as=child" variant="sunny" size="xl">
            <span aria-hidden="true">🎧</span> I'm a kid, let's play!
          </LinkButton>
          <div className="grid gap-3 sm:grid-cols-2">
            <LinkButton to="/login" size="lg">
              Sign in
            </LinkButton>
            <LinkButton to="/signup" variant="secondary" size="lg">
              Create an account
            </LinkButton>
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
