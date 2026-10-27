import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SelectField, TextAreaField } from '../../components/ui/fields';
import { TextField } from '../../components/ui/TextField';
import type { Game } from '../play/api';
import type { Plan } from './queries';
import { DIFFICULTIES, planFormValues, planSchema, toPlanBody } from './schemas';

export type PlanBody = ReturnType<typeof toPlanBody>;

type PlanFormProps = {
  games: Game[];
  childName: string;
  pending: boolean;
  /** Already worded for the user. */
  error: string | null;
  onCancel: () => void;
} & (
  | { plan?: undefined; replacing: boolean; onSubmit: (body: PlanBody) => void }
  /** Editing: only the fields that changed are passed. */
  | { plan: Plan; replacing?: undefined; onSubmit: (body: Partial<PlanBody>) => void }
);

export function PlanForm(props: PlanFormProps) {
  const { games, plan, childName, pending, error, onCancel } = props;
  const defaults = useMemo(() => planFormValues(games, plan), [games, plan]);
  const form = useForm({ resolver: zodResolver(planSchema), defaultValues: defaults });
  const rows = useWatch({ control: form.control, name: 'items' });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    const body = toPlanBody(values);
    if (props.plan === undefined) return props.onSubmit(body);
    const before = toPlanBody(planSchema.parse(defaults));
    const changed = Object.fromEntries(
      Object.entries(body).filter(
        ([field, value]) =>
          JSON.stringify(value) !== JSON.stringify(before[field as keyof PlanBody]),
      ),
    ) as Partial<PlanBody>;
    if (Object.keys(changed).length === 0) return onCancel();
    props.onSubmit(changed);
  });

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-5 rounded-3xl bg-brand-50 p-4 sm:p-5"
    >
      {error && <Alert tone="error">{error}</Alert>}
      <TextField
        label="Plan name"
        placeholder={`e.g. ${childName}'s listening focus`}
        error={errors.title?.message}
        {...form.register('title')}
      />
      <TextAreaField
        label="Notes for the family (optional)"
        rows={3}
        error={errors.notes?.message}
        {...form.register('notes')}
      />

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 font-semibold">Games to practise</legend>
        <p className="-mt-1 text-sm text-ink-soft">
          Difficulty is a suggestion; HearMate still sets {childName}'s level from how they play.
        </p>
        {errors.items?.root?.message && (
          <p className="text-sm font-semibold text-rose-700">{errors.items.root.message}</p>
        )}
        <ul className="flex flex-col gap-3">
          {defaults.items.map((row, index) => {
            const included = rows?.[index]?.included ?? row.included;
            const rowErrors = errors.items?.[index];
            return (
              <li
                key={row.game}
                className={`flex flex-col gap-4 rounded-2xl p-4 ring-2 ${
                  included ? 'bg-white ring-brand-300' : 'bg-white/60 ring-brand-100'
                }`}
              >
                <label className="flex min-h-11 cursor-pointer items-center gap-3 font-bold">
                  <input
                    type="checkbox"
                    className="size-5 accent-brand-600"
                    {...form.register(`items.${index}.included`)}
                  />
                  {row.title}
                </label>
                {included && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      label="Times a week"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={21}
                      error={rowErrors?.sessions_per_week?.message}
                      {...form.register(`items.${index}.sessions_per_week`, {
                        valueAsNumber: true,
                      })}
                    />
                    <SelectField
                      label="Suggested difficulty"
                      options={DIFFICULTIES}
                      {...form.register(`items.${index}.difficulty`)}
                    />
                    <div className="sm:col-span-2">
                      <TextField
                        label="Tip for this game (optional)"
                        error={rowErrors?.notes?.message}
                        {...form.register(`items.${index}.notes`)}
                      />
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      {props.replacing && (
        <p className="text-sm text-ink-soft">
          Saving starts this plan now. The current plan is archived and stays readable as history.
        </p>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {plan ? 'Save plan' : 'Start plan'}
        </Button>
      </div>
    </form>
  );
}
