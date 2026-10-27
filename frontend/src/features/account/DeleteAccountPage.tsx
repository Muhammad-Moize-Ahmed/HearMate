import type { components } from '../../api/schema';
import { Alert } from '../../components/ui/Alert';
import { describeError } from '../../api/client';
import { usePrincipal } from '../../auth/context';
import { Spinner } from '../../components/ui/Spinner';
import { DeletionConfirm } from './DeletionConfirm';
import { useDeleteAccount, useDeletionSummary } from './queries';

type S = components['schemas'];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The warning screen: exactly what goes (or, for a therapist, ends and stays), then confirm. */
export function DeleteAccountPage() {
  const principal = usePrincipal();
  const summary = useDeletionSummary();
  const remove = useDeleteAccount();
  const home = principal.kind === 'therapist' ? '/therapist' : '/parent';

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <title>Delete your account · HearMate</title>
      <h1 className="text-3xl font-black sm:text-4xl">Delete your account?</h1>
      {summary.isPending && <Spinner className="size-10 text-brand-600" />}
      {summary.isError && <Alert tone="error">{describeError(summary.error)}</Alert>}
      {summary.data && (
        <DeletionConfirm
          confirmLabel="Delete my account forever"
          cancelTo={`${home}/account`}
          pending={remove.isPending}
          error={remove.error}
          onConfirm={(password) => remove.mutate(password)}
        >
          {summary.data.role === 'parent' ? (
            <ParentLosses summary={summary.data} />
          ) : (
            <TherapistLosses summary={summary.data} />
          )}
        </DeletionConfirm>
      )}
    </div>
  );
}

function ParentLosses({ summary }: { summary: S['ParentDeletionSummaryOut'] }) {
  return (
    <>
      <p>Deleting your account removes, for good:</p>
      <ul className="list-disc pl-6">
        <li>your account and sign-in;</li>
        <li>
          {summary.children.length === 0
            ? 'no child profiles (you have none)'
            : `${plural(summary.children.length, 'child profile', 'child profiles')}: ${summary.children.join(', ')}`}
          , with their sign-ins;
        </li>
        <li>
          {plural(summary.games_played, 'game played', 'games played')}, with all progress, levels,
          streaks, badges and goals;
        </li>
        <li>
          therapist notes, learning plans and access
          {summary.therapists > 0 &&
            ` (${plural(summary.therapists, 'therapist loses', 'therapists lose')} access)`}
          .
        </li>
      </ul>
      <p>Every device is signed out, including your children's. We'll email you to confirm.</p>
    </>
  );
}

function TherapistLosses({ summary }: { summary: S['TherapistDeletionSummaryOut'] }) {
  return (
    <>
      <p>Deleting your therapist account:</p>
      <ul className="list-disc pl-6">
        <li>removes your account and sign-in;</li>
        <li>
          ends your access to {plural(summary.linked_children, 'child', 'children')}, and any
          invitations; their parents are told by email;
        </li>
        <li>
          keeps {plural(summary.notes, 'note', 'notes')} and{' '}
          {plural(summary.learning_plans, 'learning plan', 'learning plans')} you wrote with each
          child, shown as written by a former therapist.
        </li>
      </ul>
      <p>Every device is signed out. We'll email you to confirm.</p>
    </>
  );
}
