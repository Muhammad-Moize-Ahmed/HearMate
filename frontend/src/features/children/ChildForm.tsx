import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, type ReactNode } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { ChipGroup, SegmentedChoice, SelectField, TextAreaField } from '../../components/ui/fields';
import { TextField } from '../../components/ui/TextField';
import { browserTimeZone, todayISO } from '../../lib/dates';
import {
  ATTENTION_SPANS,
  AVATARS,
  ENVIRONMENTS,
  FOCUS_AREAS,
  GENDERS,
  HEARING_DIFFICULTIES,
  INTERESTS,
  LEARNING_STYLES,
  SESSION_LENGTHS,
  SPEECH_CHALLENGES,
} from './options';
import type { Child } from './queries';
import { childSchema, toChildBody, type ChildFormValues } from './schemas';

type ChildFormProps = {
  /** The child being edited; omit to add a new one. */
  child?: Child;
  onSubmit: (body: ReturnType<typeof toChildBody>) => void;
  pending: boolean;
  error: Error | null;
  cancelTo: string;
};

function initialValues(child: Child | undefined): ChildFormValues {
  // Stored option lists are plain strings in the API output; the form only knows today's keys.
  const known = <V extends string>(values: string[] | undefined, options: { value: V }[]) =>
    (values ?? []).filter((v): v is V => options.some((o) => o.value === v));
  const one = <V extends string>(value: string | null | undefined, options: { value: V }[]) =>
    options.find((o) => o.value === value)?.value ?? '';

  return {
    display_name: child?.display_name ?? '',
    date_of_birth: child?.date_of_birth ?? '',
    avatar: AVATARS.find((a) => a.value === child?.avatar)?.value ?? 'bear',
    gender: one(child?.gender, GENDERS),
    hearing_difficulties: known(child?.hearing_difficulties, HEARING_DIFFICULTIES),
    speech_challenges: known(child?.speech_challenges, SPEECH_CHALLENGES),
    focus_areas: known(child?.focus_areas, FOCUS_AREAS),
    interests: known(child?.interests, INTERESTS),
    learning_environment: one(child?.learning_environment, ENVIRONMENTS),
    attention_span: one(child?.attention_span, ATTENTION_SPANS),
    preferred_learning_style: one(child?.preferred_learning_style, LEARNING_STYLES),
    session_length_minutes: (SESSION_LENGTHS.find((m) => m === child?.session_length_minutes) ??
      0) as ChildFormValues['session_length_minutes'],
    notes: child?.notes ?? '',
    // A new child gets this device's time zone, so "today" and streaks match the family's day.
    timezone: child ? (child.timezone ?? '') : browserTimeZone(),
  };
}

function timeZoneOptions(current: string): { value: string; label: string }[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  const all = current && !zones.includes(current) ? [current, ...zones] : zones;
  return all.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }));
}

export function ChildForm({ child, onSubmit, pending, error, cancelTo }: ChildFormProps) {
  const form = useForm({
    resolver: zodResolver(childSchema),
    defaultValues: initialValues(child),
  });
  const { errors } = form.formState;
  const name = useWatch({ control: form.control, name: 'display_name' }).trim() || 'your child';
  const timezone = useWatch({ control: form.control, name: 'timezone' });
  const zones = useMemo(() => timeZoneOptions(timezone), [timezone]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => onSubmit(toChildBody(values)))}
      className="flex flex-col gap-8"
    >
      {error && <Alert tone="error">{describeError(error)}</Alert>}

      <Section title="The basics">
        <TextField
          label="Name"
          hint="The name HearMate shows. A first name or nickname is enough."
          autoComplete="off"
          error={errors.display_name?.message}
          {...form.register('display_name')}
        />
        <TextField
          label="Date of birth"
          type="date"
          max={todayISO()}
          error={errors.date_of_birth?.message}
          {...form.register('date_of_birth')}
        />
        <Controller
          control={form.control}
          name="avatar"
          render={({ field }) => (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">Pick a buddy for {name}</legend>
              <div className="grid grid-cols-5 gap-2">
                {AVATARS.map((avatar) => (
                  <label
                    key={avatar.value}
                    className={`grid aspect-square cursor-pointer place-items-center rounded-2xl border-2 text-3xl transition has-focus-visible:ring-4 has-focus-visible:ring-brand-300 sm:text-4xl ${
                      field.value === avatar.value
                        ? 'border-brand-500 bg-sun-200'
                        : 'border-brand-100 bg-white hover:border-brand-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name={field.name}
                      value={avatar.value}
                      checked={field.value === avatar.value}
                      onChange={() => field.onChange(avatar.value)}
                      aria-label={avatar.label}
                      className="sr-only"
                    />
                    <span aria-hidden="true">{avatar.emoji}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        />
        <SelectField
          label="Gender (optional)"
          options={GENDERS}
          emptyLabel="Not set"
          {...form.register('gender')}
        />
      </Section>

      <details className="group rounded-3xl bg-brand-50 p-4 sm:p-6" open={child !== undefined}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-xl font-black">
          <span>About {name} (optional)</span>
          <span aria-hidden="true" className="transition group-open:rotate-180">
            ▾
          </span>
        </summary>
        <p className="mt-1 mb-5 text-ink-soft">
          This helps you and {name}'s therapist choose the right practice. You can fill it in later.
        </p>
        <div className="flex flex-col gap-6">
          <Controller
            control={form.control}
            name="hearing_difficulties"
            render={({ field }) => (
              <ChipGroup
                legend="What is hard for them when listening?"
                options={HEARING_DIFFICULTIES}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="speech_challenges"
            render={({ field }) => (
              <ChipGroup
                legend="Anything hard when speaking?"
                options={SPEECH_CHALLENGES}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="focus_areas"
            render={({ field }) => (
              <ChipGroup
                legend="What would you like to work on?"
                options={FOCUS_AREAS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="interests"
            render={({ field }) => (
              <ChipGroup
                legend={`What does ${name} love?`}
                hint="Used to pick words and stories they'll enjoy."
                options={INTERESTS}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            control={form.control}
            name="session_length_minutes"
            render={({ field }) => (
              <SegmentedChoice
                legend="How long should a practice session be?"
                name={field.name}
                options={[
                  { value: 0, label: 'Not sure' },
                  ...SESSION_LENGTHS.map((m) => ({ value: m, label: `${m} min` })),
                ]}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <div className="grid gap-5 sm:grid-cols-3">
            <SelectField
              label="Attention span"
              options={ATTENTION_SPANS}
              emptyLabel="Not sure"
              {...form.register('attention_span')}
            />
            <SelectField
              label="Learns best by"
              options={LEARNING_STYLES}
              emptyLabel="Not sure"
              {...form.register('preferred_learning_style')}
            />
            <SelectField
              label="Practises mostly"
              options={ENVIRONMENTS}
              emptyLabel="Not sure"
              {...form.register('learning_environment')}
            />
          </div>
          <TextAreaField
            label="Notes"
            hint={`Seen by you and therapists you invite, never by ${name}.`}
            error={errors.notes?.message}
            {...form.register('notes')}
          />
          <SelectField
            label="Time zone"
            hint="Decides when each day starts, for streaks and goals."
            options={zones}
            emptyLabel="HearMate default"
            {...form.register('timezone')}
          />
        </div>
      </details>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <LinkButton to={cancelTo} variant="secondary">
          Cancel
        </LinkButton>
        <Button type="submit" size="lg" loading={pending}>
          {child ? 'Save changes' : `Add ${name === 'your child' ? 'child' : name}`}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="text-xl font-black">{title}</h2>
      {children}
    </section>
  );
}
