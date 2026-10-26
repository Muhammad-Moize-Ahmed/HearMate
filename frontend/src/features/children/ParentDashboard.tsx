import { Link } from 'react-router';

import { usePrincipal } from '../../auth/context';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { describeError } from '../../api/client';
import { avatarEmoji } from '../../lib/avatars';
import type { components } from '../../api/schema';
import { Loading } from './common';
import { useChildren, useFamilyProgress, type Child } from './queries';

type Week = components['schemas']['FamilyMemberOut'];

export function ParentDashboard() {
  const principal = usePrincipal();
  const firstName = principal.kind === 'child' ? principal.display_name : principal.first_name;
  const children = useChildren();
  const family = useFamilyProgress();

  return (
    <>
      <title>My children · HearMate</title>
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-black sm:text-4xl">Hi, {firstName}!</h1>
        <p className="text-lg text-ink-soft">Here's how your children are getting on this week.</p>
      </div>

      {children.isPending && <Loading label="Loading your children…" />}
      {children.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">{describeError(children.error)}</Alert>
          <Button variant="secondary" onClick={() => void children.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {children.isSuccess && children.data.length === 0 && <EmptyState />}
      {children.isSuccess && children.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {children.data.map((child) => (
            <li key={child.id}>
              <ChildCard child={child} week={family.data?.find((m) => m.child_id === child.id)} />
            </li>
          ))}
          <li>
            <Link
              to="/parent/children/new"
              className="flex h-full min-h-48 flex-col items-center justify-center gap-2 rounded-3xl border-4 border-dashed border-brand-200 p-5 font-bold text-brand-700 transition hover:border-brand-300 hover:bg-white"
            >
              <span className="text-4xl" aria-hidden="true">
                ＋
              </span>
              Add a child
            </Link>
          </li>
        </ul>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-[2rem] bg-white p-8 text-center shadow-sm ring-2 ring-brand-100">
      <span className="text-6xl" aria-hidden="true">
        🧸
      </span>
      <h2 className="text-2xl font-black">Let's add your first child</h2>
      <p className="max-w-md text-ink-soft">
        Create a profile, then give them their own username and PIN so they can play on their own.
      </p>
      <LinkButton to="/parent/children/new" size="lg">
        Add a child
      </LinkButton>
    </div>
  );
}

function ChildCard({ child, week }: { child: Child; week: Week | undefined }) {
  return (
    <Link
      to={`/parent/children/${child.id}`}
      className="flex h-full flex-col gap-4 rounded-3xl bg-white p-5 shadow-sm ring-2 ring-brand-100 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-300"
    >
      <div className="flex items-center gap-3">
        <span
          className="grid size-16 shrink-0 place-items-center rounded-full bg-sun-200 text-4xl"
          aria-hidden="true"
        >
          {avatarEmoji(child.avatar)}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-xl font-black">{child.display_name}</h2>
          <p className="text-ink-soft">
            {child.age_years} {child.age_years === 1 ? 'year' : 'years'} old
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="games this week" value={week?.this_week.sessions} />
        <Stat label="minutes" value={week?.this_week.minutes} />
        <Stat label="day streak" value={week?.current_streak} emoji="🔥" />
      </dl>
      <p
        className={`mt-auto w-fit rounded-full px-3 py-1 text-sm font-bold ${
          child.login ? 'bg-mint-200 text-emerald-900' : 'bg-sun-200 text-amber-900'
        }`}
      >
        {child.login ? `Signs in as ${child.login.username}` : 'Sign-in not set up yet'}
      </p>
    </Link>
  );
}

function Stat({
  label,
  value,
  emoji,
}: {
  label: string;
  value: number | undefined;
  emoji?: string;
}) {
  return (
    <div className="flex flex-col-reverse rounded-2xl bg-brand-50 p-2">
      <dt className="text-xs text-ink-soft">{label}</dt>
      <dd className="text-2xl font-black">
        {value ?? '–'}
        {emoji && value ? (
          <span className="ml-0.5 text-lg" aria-hidden="true">
            {emoji}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
