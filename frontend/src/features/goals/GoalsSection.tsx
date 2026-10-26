import { useState } from 'react';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { formatDate, todayISO } from '../../lib/dates';
import { GoalForm } from './GoalForm';
import { useCreateGoal, useDeleteGoal, useGoals, useUpdateGoal, type Goal } from './queries';
import { CATEGORIES } from './schemas';

/** A child's goals: the parent sets them; progress fills in as the child plays. */
export function GoalsSection({ childId, childName }: { childId: string; childName: string }) {
  const goals = useGoals(childId);
  const create = useCreateGoal(childId);
  const [adding, setAdding] = useState(false);

  if (goals.isPending) return <p className="text-ink-soft">Loading goals…</p>;
  if (goals.isError) return <Alert tone="error">{describeError(goals.error)}</Alert>;

  const active = goals.data.filter((g) => g.status === 'active');
  const achieved = goals.data.filter((g) => g.status === 'achieved');
  const archived = goals.data.filter((g) => g.status === 'archived');

  return (
    <div className="flex flex-col gap-4">
      {adding ? (
        <GoalForm
          childName={childName}
          pending={create.isPending}
          error={create.error}
          onCancel={() => {
            create.reset();
            setAdding(false);
          }}
          onSubmit={(body) => create.mutate(body, { onSuccess: () => setAdding(false) })}
        />
      ) : (
        <Button className="self-start" onClick={() => setAdding(true)}>
          <span aria-hidden="true">🎯</span> Add a goal
        </Button>
      )}

      {goals.data.length === 0 && !adding && (
        <p className="text-ink-soft">
          No goals yet. A goal like "5 listening games this week" gives {childName} something to aim
          for.
        </p>
      )}

      {active.length + achieved.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {[...active, ...achieved].map((goal) => (
            <li key={goal.id}>
              <GoalCard goal={goal} childId={childId} childName={childName} />
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details className="rounded-2xl bg-white/60 p-3">
          <summary className="min-h-11 cursor-pointer content-center font-bold text-ink-soft">
            Archived goals ({archived.length})
          </summary>
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {archived.map((goal) => (
              <li key={goal.id}>
                <GoalCard goal={goal} childId={childId} childName={childName} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  childId,
  childName,
}: {
  goal: Goal;
  childId: string;
  childName: string;
}) {
  const update = useUpdateGoal(childId);
  const remove = useDeleteGoal(childId);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const category = CATEGORIES.find((c) => c.value === (goal.category ?? ''));
  const done = goal.status === 'achieved';
  const overdue = goal.status === 'active' && goal.due_date !== null && goal.due_date < todayISO();

  if (editing) {
    return (
      <GoalForm
        goal={goal}
        childName={childName}
        pending={update.isPending}
        error={update.error}
        onCancel={() => {
          update.reset();
          setEditing(false);
        }}
        onSubmit={(body) =>
          update.mutate({ goalId: goal.id, body }, { onSuccess: () => setEditing(false) })
        }
      />
    );
  }

  return (
    <article
      className={`flex h-full flex-col gap-3 rounded-3xl p-4 ring-2 ${
        done ? 'bg-mint-200/50 ring-mint-300' : 'bg-white ring-brand-100'
      } ${goal.status === 'archived' ? 'opacity-75' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-lg font-bold">
          {done && <span aria-hidden="true">🏆 </span>}
          {goal.title}
        </h3>
        {category && (
          <span className="shrink-0 rounded-full bg-brand-100 px-2.5 py-0.5 text-sm font-semibold">
            <span aria-hidden="true">{category.emoji} </span>
            {category.label}
          </span>
        )}
      </div>
      <ProgressBar
        value={goal.current_value}
        max={goal.target_value}
        label={`Progress on ${goal.title}`}
      />
      <p className="text-ink-soft">
        <strong className="text-ink">
          {goal.current_value} of {goal.target_value}
        </strong>{' '}
        {goal.target_value === 1 ? 'game' : 'games'}
        {done && ' · Goal reached!'}
        {goal.due_date && (
          <span className={overdue ? 'font-semibold text-rose-700' : ''}>
            {' · '}
            {overdue ? 'Ended' : 'By'} {formatDate(goal.due_date)}
          </span>
        )}
      </p>
      {goal.notes && <p className="text-sm text-ink-soft">{goal.notes}</p>}
      {update.error && <Alert tone="error">{describeError(update.error)}</Alert>}

      {/* Each label names the goal, so a screen reader's list of buttons says which goal it acts on. */}
      <div className="mt-auto flex flex-wrap gap-2">
        {goal.status !== 'archived' && (
          <Button
            variant="ghost"
            aria-label={`Edit ${goal.title}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
        <Button
          variant="ghost"
          aria-label={`${goal.status === 'archived' ? 'Restore' : 'Archive'} ${goal.title}`}
          loading={update.isPending}
          onClick={() =>
            update.mutate({
              goalId: goal.id,
              body: { status: goal.status === 'archived' ? 'active' : 'archived' },
            })
          }
        >
          {goal.status === 'archived' ? 'Restore' : 'Archive'}
        </Button>
        <Button
          variant="ghost"
          aria-label={`Delete ${goal.title}`}
          onClick={() => setConfirmingDelete(true)}
        >
          Delete
        </Button>
      </div>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete this goal?"
          confirmLabel="Delete goal"
          pending={remove.isPending}
          error={remove.error && <Alert tone="error">{describeError(remove.error)}</Alert>}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => remove.mutate(goal.id, { onSuccess: () => setConfirmingDelete(false) })}
        >
          <p>
            "{goal.title}" will be removed for good. To keep it out of the way but remember it,
            archive it instead.
          </p>
        </ConfirmDialog>
      )}
    </article>
  );
}
