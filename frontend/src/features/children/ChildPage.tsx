import { useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { avatarEmoji } from '../../lib/avatars';
import { formatDate } from '../../lib/dates';
import { GoalsSection } from '../goals/GoalsSection';
import { ChildLoginCard } from './ChildLoginCard';
import { BackLink, ChildLoadError, Loading } from './common';
import {
  ATTENTION_LABELS,
  ENVIRONMENT_LABELS,
  FOCUS_LABELS,
  GENDER_LABELS,
  HEARING_LABELS,
  INTEREST_LABELS,
  labelFor,
  LEARNING_STYLE_LABELS,
  SPEECH_LABELS,
} from './options';
import { useChild, useDeleteChild, useFamilyProgress, type Child } from './queries';

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

      <Card title={`About ${name}`} emoji="📋">
        <Profile child={data} />
      </Card>

      <DeleteChild child={data} />
    </div>
  );
}

function Card({ title, emoji, children }: { title: string; emoji: string; children: ReactNode }) {
  return (
    <section className="rounded-[2rem] bg-white p-5 shadow-sm ring-2 ring-brand-100 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 text-2xl font-black">
        <span aria-hidden="true">{emoji}</span>
        {title}
      </h2>
      {children}
    </section>
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

function Profile({ child }: { child: Child }) {
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Date of birth', value: formatDate(child.date_of_birth) },
    { label: 'Gender', value: child.gender && labelFor(GENDER_LABELS, child.gender) },
    {
      label: 'Hard when listening',
      value: <Tags keys={child.hearing_difficulties} labels={HEARING_LABELS} />,
    },
    {
      label: 'Hard when speaking',
      value: <Tags keys={child.speech_challenges} labels={SPEECH_LABELS} />,
    },
    { label: 'Working on', value: <Tags keys={child.focus_areas} labels={FOCUS_LABELS} /> },
    { label: 'Loves', value: <Tags keys={child.interests} labels={INTEREST_LABELS} /> },
    {
      label: 'Session length',
      value: child.session_length_minutes && `${child.session_length_minutes} minutes`,
    },
    {
      label: 'Attention span',
      value: child.attention_span && labelFor(ATTENTION_LABELS, child.attention_span),
    },
    {
      label: 'Learns best by',
      value:
        child.preferred_learning_style &&
        labelFor(LEARNING_STYLE_LABELS, child.preferred_learning_style),
    },
    {
      label: 'Practises mostly',
      value: child.learning_environment && labelFor(ENVIRONMENT_LABELS, child.learning_environment),
    },
    { label: 'Time zone', value: child.timezone?.replaceAll('_', ' ') ?? 'HearMate default' },
    { label: 'Notes', value: child.notes },
  ];
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-[minmax(10rem,auto)_1fr]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="font-semibold">{row.label}</dt>
          <dd className="-mt-3 whitespace-pre-line text-ink-soft sm:mt-0">
            {row.value || 'Not set'}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Tags({
  keys,
  labels,
}: {
  keys: string[];
  labels: Record<string, string | [string, string]>;
}) {
  if (keys.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {keys.map((key) => (
        <li
          key={key}
          className="rounded-full bg-brand-50 px-3 py-0.5 text-ink ring-1 ring-brand-100"
        >
          {labelFor(labels, key)}
        </li>
      ))}
    </ul>
  );
}

function DeleteChild({ child }: { child: Child }) {
  const navigate = useNavigate();
  const remove = useDeleteChild(child.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="rounded-[2rem] p-5 ring-2 ring-coral-300 sm:p-6">
      <h2 className="mb-2 text-xl font-black">Remove {child.display_name}</h2>
      <p className="mb-4 text-ink-soft">
        Permanently deletes this profile and all of {child.display_name}'s games, progress, goals
        and therapist access. This can't be undone.
      </p>
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Delete {child.display_name}'s profile
      </Button>
      {confirming && (
        <ConfirmDialog
          title={`Delete ${child.display_name}'s profile?`}
          confirmLabel="Delete forever"
          typeToConfirm={child.display_name}
          pending={remove.isPending}
          error={remove.error && <Alert tone="error">{describeError(remove.error)}</Alert>}
          onCancel={() => setConfirming(false)}
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => void navigate('/parent') })}
        >
          <p>
            All of {child.display_name}'s games, progress, badges, goals and sign-in will be deleted
            for good.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
