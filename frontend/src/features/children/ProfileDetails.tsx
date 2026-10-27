import type { ReactNode } from 'react';

import { formatDate } from '../../lib/dates';
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
import type { Child } from './queries';

/** A titled white card, as used on the child pages. */
export function Card({
  title,
  emoji,
  children,
}: {
  title: string;
  emoji: string;
  children: ReactNode;
}) {
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

/** A child's profile in plain words, for the parent's and the therapist's child pages. */
export function Profile({ child }: { child: Child }) {
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
