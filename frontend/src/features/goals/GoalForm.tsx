import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SegmentedChoice, TextAreaField } from '../../components/ui/fields';
import { TextField } from '../../components/ui/TextField';
import { todayISO } from '../../lib/dates';
import type { Goal } from './queries';
import {
  CATEGORIES,
  goalSchemaFor,
  toGoalBody,
  type GoalBody,
  type GoalFormValues,
} from './schemas';

type GoalFormProps = {
  childName: string;
  onCancel: () => void;
  pending: boolean;
  error: Error | null;
} & (
  | { goal?: undefined; onSubmit: (body: GoalBody) => void }
  /** Editing: only the fields that changed are passed. */
  | { goal: Goal; onSubmit: (body: Partial<GoalBody>) => void }
);

export function GoalForm(props: GoalFormProps) {
  const { goal, childName, onCancel, pending, error } = props;
  const schema = useMemo(() => goalSchemaFor(goal?.due_date), [goal?.due_date]);
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title: goal?.title ?? '',
      target_value: goal?.target_value ?? 5,
      category: goal?.category ?? '',
      due_date: goal?.due_date ?? '',
      notes: goal?.notes ?? '',
    } satisfies GoalFormValues,
  });
  const { errors, dirtyFields } = form.formState;

  const submit = form.handleSubmit((values) => {
    const body = toGoalBody(values);
    if (props.goal === undefined) return props.onSubmit(body);
    const changed = Object.fromEntries(
      Object.entries(body).filter(([field]) => dirtyFields[field as keyof GoalFormValues]),
    ) as Partial<GoalBody>;
    if (Object.keys(changed).length === 0) return onCancel();
    props.onSubmit(changed);
  });

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-3xl bg-brand-50 p-4 sm:p-5"
    >
      {error && <Alert tone="error">{describeError(error)}</Alert>}
      <TextField
        label="Goal"
        placeholder={`e.g. ${childName}'s listening week`}
        error={errors.title?.message}
        {...form.register('title')}
      />
      <Controller
        control={form.control}
        name="category"
        render={({ field }) => (
          <SegmentedChoice
            legend="Which games count?"
            name={field.name}
            options={CATEGORIES}
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="How many games?"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          error={errors.target_value?.message}
          {...form.register('target_value', { valueAsNumber: true })}
        />
        <TextField
          label="By (optional)"
          type="date"
          min={todayISO()}
          hint="Leave empty for no end date."
          error={errors.due_date?.message}
          {...form.register('due_date')}
        />
      </div>
      <TextAreaField
        label="Notes (optional)"
        rows={2}
        error={errors.notes?.message}
        {...form.register('notes')}
      />
      {!goal && (
        <p className="text-sm text-ink-soft">
          Progress counts games {childName} finishes from today. HearMate updates it after each
          game.
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {goal ? 'Save goal' : 'Add goal'}
        </Button>
      </div>
    </form>
  );
}
