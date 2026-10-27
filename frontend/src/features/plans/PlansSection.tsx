import { useState } from 'react';

import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useGames } from '../play/api';
import { TIER_LABEL } from '../play/meta';
import { skillLabel } from '../progress/transform';
import { PlanForm } from './PlanForm';
import { useArchivePlan, useCreatePlan, usePlans, useUpdatePlan, type Plan } from './queries';

/** Words for the plan errors a therapist can run into; anything else falls back to the default. */
function planError(error: Error | null): string | null {
  if (error === null) return null;
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'plan_changed':
        return 'Another therapist changed the plan at the same moment. The latest version is shown; please try again.';
      case 'plan_archived':
        return 'This plan was archived in the meantime, so it can no longer be changed.';
      case 'game_not_found':
        return "One of the games isn't available any more. Untick it and save again.";
    }
  }
  return describeError(error);
}

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * A child's learning plan (UC-7): the active plan, then archived ones. Linked therapists start,
 * edit and archive plans; the parent reads them. The child's own screens never show this.
 */
export function PlansSection({
  childId,
  childName,
  canManage,
}: {
  childId: string;
  childName: string;
  canManage: boolean;
}) {
  const plans = usePlans(childId);
  const games = useGames();
  const create = useCreatePlan(childId);
  const [starting, setStarting] = useState(false);

  if (plans.isPending) return <p className="text-ink-soft">Loading learning plans…</p>;
  if (plans.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="error">
          We couldn't load the learning plans. {describeError(plans.error)}
        </Alert>
        <Button variant="secondary" onClick={() => void plans.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const active = plans.data.find((p) => p.is_active);
  const archived = plans.data.filter((p) => !p.is_active);

  return (
    <div className="flex flex-col gap-4">
      {starting && games.data ? (
        <PlanForm
          games={games.data}
          childName={childName}
          replacing={active !== undefined}
          pending={create.isPending}
          error={planError(create.error)}
          onCancel={() => {
            create.reset();
            setStarting(false);
          }}
          onSubmit={(body) => create.mutate(body, { onSuccess: () => setStarting(false) })}
        />
      ) : (
        <>
          {active ? (
            <PlanCard plan={active} childId={childId} childName={childName} canManage={canManage} />
          ) : (
            <p className="text-ink-soft">
              {canManage
                ? `No active plan. A plan tells ${childName}'s family which games to practise and how often.`
                : `No learning plan yet. A therapist on ${childName}'s care team can set one.`}
            </p>
          )}
          {canManage && (
            <Button
              variant={active ? 'secondary' : 'primary'}
              className="self-start"
              loading={starting && games.isPending}
              onClick={() => setStarting(true)}
            >
              <span aria-hidden="true">🗺️</span> {active ? 'Start a new plan' : 'Start a plan'}
            </Button>
          )}
          {starting && games.isError && (
            <Alert tone="error">We couldn't load the games. {describeError(games.error)}</Alert>
          )}
        </>
      )}

      {archived.length > 0 && (
        <details className="rounded-2xl bg-white/60 p-3">
          <summary className="min-h-11 cursor-pointer content-center font-bold text-ink-soft">
            Earlier plans ({archived.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {archived.map((plan) => (
              <li key={plan.id}>
                <PlanCard plan={plan} childId={childId} childName={childName} canManage={false} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  childId,
  childName,
  canManage,
}: {
  plan: Plan;
  childId: string;
  childName: string;
  canManage: boolean;
}) {
  const games = useGames();
  const update = useUpdatePlan(childId);
  const archive = useArchivePlan(childId);
  const [editing, setEditing] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const author = plan.created_by
    ? `${plan.created_by.first_name} ${plan.created_by.last_name}`.trim()
    : 'a former therapist';

  if (editing && games.data) {
    return (
      <PlanForm
        plan={plan}
        games={games.data}
        childName={childName}
        pending={update.isPending}
        error={planError(update.error)}
        onCancel={() => {
          update.reset();
          setEditing(false);
        }}
        onSubmit={(body) =>
          update.mutate({ planId: plan.id, body }, { onSuccess: () => setEditing(false) })
        }
      />
    );
  }

  return (
    <article
      className={`flex flex-col gap-3 rounded-3xl p-4 ring-2 sm:p-5 ${
        plan.is_active ? 'bg-white ring-brand-200' : 'bg-white/70 ring-brand-100'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-black">{plan.title}</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
            plan.is_active ? 'bg-mint-200 text-emerald-900' : 'bg-slate-200 text-slate-800'
          }`}
        >
          {plan.is_active ? 'In use' : 'Archived'}
        </span>
      </div>
      <p className="text-sm text-ink-soft">
        Started by {author} on {dateOnly(plan.created_at)}
        {plan.updated_at !== plan.created_at && ` · updated ${dateOnly(plan.updated_at)}`}
      </p>
      {plan.notes && <p className="whitespace-pre-line">{plan.notes}</p>}
      {plan.items.length === 0 ? (
        <p className="text-ink-soft">No games chosen yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {plan.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-0.5 rounded-2xl bg-brand-50 p-3">
              <span className="font-bold">{item.game.title}</span>
              <span className="text-sm text-ink-soft">
                {skillLabel(item.game.category)} · {item.sessions_per_week}{' '}
                {item.sessions_per_week === 1 ? 'time' : 'times'} a week
                {item.difficulty && ` · ${TIER_LABEL[item.difficulty]?.label ?? item.difficulty}`}
              </span>
              {item.notes && <span className="text-sm">{item.notes}</span>}
            </li>
          ))}
        </ul>
      )}

      {(update.error || archive.error) && !editing && (
        <Alert tone="error">{planError(update.error ?? archive.error)}</Alert>
      )}
      {editing && games.isError && (
        <Alert tone="error">We couldn't load the games. {describeError(games.error)}</Alert>
      )}

      {canManage && plan.is_active && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            aria-label={`Edit ${plan.title}`}
            loading={editing && games.isPending}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            aria-label={`Archive ${plan.title}`}
            onClick={() => setConfirmingArchive(true)}
          >
            Archive
          </Button>
        </div>
      )}

      {confirmingArchive && (
        <ConfirmDialog
          title="Archive this plan?"
          confirmLabel="Archive plan"
          pending={archive.isPending}
          error={archive.error && <Alert tone="error">{planError(archive.error)}</Alert>}
          onCancel={() => setConfirmingArchive(false)}
          onConfirm={() =>
            archive.mutate(plan.id, { onSuccess: () => setConfirmingArchive(false) })
          }
        >
          <p>
            "{plan.title}" will stop being {childName}'s current plan. It stays in the history, but
            archived plans can't be changed.
          </p>
        </ConfirmDialog>
      )}
    </article>
  );
}
