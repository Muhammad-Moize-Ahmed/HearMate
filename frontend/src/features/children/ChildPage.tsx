import { useLocation, useParams } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { LinkButton } from '../../components/ui/Button';
import { avatarEmoji } from '../../lib/avatars';
import { CareTeamSection } from '../careTeam/CareTeamSection';
import { GoalsSection } from '../goals/GoalsSection';
import { NotesSection } from '../notes/NotesSection';
import { PlansSection } from '../plans/PlansSection';
import { ChildLoginCard } from './ChildLoginCard';
import { BackLink, ChildLoadError, Loading } from './common';
import { Card, Profile } from './ProfileDetails';
import { useChild, useFamilyProgress, type Child } from './queries';

export function ChildPage() {
  const { childId = '' } = useParams();
  const location = useLocation();
  const child = useChild(childId);
  const justCreated = (location.state as { created?: boolean } | null)?.created === true;

  if (child.isPending) return <Loading label="Loading profile…" />;
  if (child.isError) return <ChildLoadError error={child.error} />;
  const { data } = child;
  const name = data.display_name;

  return (
    <div className="flex flex-col gap-6">
      <title>{`${name} · HearMate`}</title>
      <div>
        <BackLink to="/parent">All children</BackLink>
        <div className="flex flex-wrap items-center gap-4">
          <span
            className="grid size-20 shrink-0 place-items-center rounded-full bg-sun-200 text-5xl shadow-[0_4px_0_#ca8a04]"
            aria-hidden="true"
          >
            {avatarEmoji(data.avatar)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-black sm:text-4xl">{name}</h1>
            <p className="text-lg text-ink-soft">
              {data.age_years} {data.age_years === 1 ? 'year' : 'years'} old
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`/parent/children/${data.id}/progress`}>
              <span aria-hidden="true">📈</span> Progress
            </LinkButton>
            <LinkButton to={`/parent/children/${data.id}/report`} variant="secondary">
              Report
            </LinkButton>
            <LinkButton to={`/parent/children/${data.id}/edit`} variant="secondary">
              Edit profile
            </LinkButton>
          </div>
        </div>
      </div>

      {justCreated && (
        <Alert tone="success">
          {name}'s profile is ready! Next, set up their sign-in so they can play on their own.
        </Alert>
      )}

      <ThisWeek childId={data.id} />

      <Card title={`${name}'s sign-in`} emoji="🔑">
        <ChildLoginCard child={data} />
      </Card>

      <Card title="Goals" emoji="🎯">
        <GoalsSection childId={data.id} childName={name} />
      </Card>

      <Card title="Care team" emoji="🩺">
        <CareTeamSection childId={data.id} childName={name} />
      </Card>

      <Card title="Learning plan" emoji="🗺️">
        <PlansSection childId={data.id} childName={name} canManage={false} />
      </Card>

      <Card title="Therapist notes" emoji="📝">
        <NotesSection childId={data.id} childName={name} canWrite={false} />
      </Card>

      <Card title={`About ${name}`} emoji="📋">
        <Profile child={data} />
      </Card>

      <DeleteChild child={data} />
    </div>
  );
}

function ThisWeek({ childId }: { childId: string }) {
  const family = useFamilyProgress();
  const week = family.data?.find((m) => m.child_id === childId);
  if (!week) return null;
  const stats = [
    { label: 'Games this week', value: week.this_week.sessions, emoji: '🎮' },
    { label: 'Minutes practised', value: week.this_week.minutes, emoji: '⏱️' },
    { label: 'Day streak', value: week.current_streak, emoji: '🔥' },
    { label: 'Badges', value: week.achievements_unlocked, emoji: '🏅' },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex flex-col-reverse gap-1 rounded-3xl bg-white p-4 ring-2 ring-brand-100"
        >
          <dt className="text-sm text-ink-soft">{stat.label}</dt>
          <dd className="text-3xl font-black">
            <span className="mr-1 text-2xl" aria-hidden="true">
              {stat.emoji}
            </span>
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DeleteChild({ child }: { child: Child }) {
  return (
    <section className="rounded-[2rem] p-5 ring-2 ring-coral-300 sm:p-6">
      <h2 className="mb-2 text-xl font-black">Remove {child.display_name}</h2>
      <p className="mb-4 text-ink-soft">
        Permanently deletes this profile and all of {child.display_name}'s games, progress, goals
        and therapist access. This can't be undone.
      </p>
      <LinkButton to={`/parent/children/${child.id}/delete`} variant="danger">
        Delete {child.display_name}'s profile…
      </LinkButton>
    </section>
  );
}
