import { useState } from 'react';
import { Link } from 'react-router';

import { describeError } from '../../api/client';
import { usePrincipal } from '../../auth/context';
import { refreshSession } from '../../auth/session';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { avatarEmoji } from '../../lib/avatars';
import {
  useAcceptInvitation,
  useLeaveLink,
  useMyLinks,
  type TherapistLink,
} from '../careTeam/queries';
import { Loading } from '../children/common';

/**
 * The therapist's home. Until an admin approves the account it shows only that state: no
 * invitations and no children are requested. Once approved: invitations to accept, then the
 * children whose parents linked them (active links only).
 */
export function TherapistDashboard() {
  const principal = usePrincipal();
  if (principal.kind !== 'therapist') return null;
  const approved = principal.therapist_status === 'approved';

  return (
    <>
      <title>My patients · HearMate</title>
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="text-3xl font-black sm:text-4xl">Hi, {principal.first_name}!</h1>
        <p className="text-lg text-ink-soft">
          {approved ? 'Children whose parents shared them with you.' : 'Your therapist workspace.'}
        </p>
      </div>
      {approved ? (
        <Caseload />
      ) : (
        <AwaitingApproval
          rejected={principal.therapist_status === 'rejected'}
          reason={principal.therapist_rejection_reason ?? null}
        />
      )}
    </>
  );
}

function AwaitingApproval({ rejected, reason }: { rejected: boolean; reason: string | null }) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // A fresh token carries the account's current approval status; the page updates by itself.
  const checkAgain = async () => {
    setChecking(true);
    setError(null);
    try {
      await refreshSession();
      setChecked(true);
    } catch (e) {
      setError(e);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-4">
      {rejected ? (
        <Alert tone="error">
          <strong>Your account wasn't approved.</strong>{' '}
          {reason ? (
            <>
              The reason given: <q className="whitespace-pre-line">{reason}</q>
            </>
          ) : (
            "We've emailed you the reason."
          )}{' '}
          If you've sorted this out with HearMate, check again; otherwise please contact support.
          Until it's approved you can't see any child's information.
        </Alert>
      ) : (
        <Alert tone="info">
          <strong>Waiting for approval.</strong> An administrator checks every therapist account.
          Until yours is approved you can't see any child's information or accept invitations from
          parents. We'll email you when it's done.
        </Alert>
      )}
      <Button variant="secondary" loading={checking} onClick={() => void checkAgain()}>
        Check again
      </Button>
      {checked && !checking && (
        <p className="text-ink-soft" role="status">
          {rejected ? 'Still not approved.' : 'Still waiting.'} Try again later.
        </p>
      )}
      {error !== null && <Alert tone="error">{describeError(error)}</Alert>}
    </div>
  );
}

function Caseload() {
  const links = useMyLinks();

  if (links.isPending) return <Loading label="Loading your patients…" />;
  if (links.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="error">{describeError(links.error)}</Alert>
        <Button variant="secondary" onClick={() => void links.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const invitations = links.data.filter((l) => l.status === 'pending');
  const patients = links.data.filter((l) => l.status === 'active');

  return (
    <div className="flex flex-col gap-8">
      {invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl font-black">Invitations ({invitations.length})</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {invitations.map((link) => (
              <li key={link.id}>
                <Invitation link={link} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">Patients</h2>
        {patients.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-[2rem] bg-white p-8 text-center shadow-sm ring-2 ring-brand-100">
            <span className="text-5xl" aria-hidden="true">
              🩺
            </span>
            <p className="max-w-md text-ink-soft">
              No patients yet. When a parent invites you to their child's care team (using your
              sign-in email), the invitation appears here.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {patients.map((link) => (
              <li key={link.id}>
                <PatientCard link={link} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const parentName = (link: TherapistLink) =>
  `${link.parent.first_name} ${link.parent.last_name}`.trim();

function Invitation({ link }: { link: TherapistLink }) {
  const accept = useAcceptInvitation();
  const decline = useLeaveLink();
  const [confirming, setConfirming] = useState(false);
  const { child } = link;

  return (
    <article className="flex h-full flex-col gap-3 rounded-3xl bg-sun-200/40 p-4 ring-2 ring-sun-300">
      <div className="flex items-center gap-3">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-3xl"
          aria-hidden="true"
        >
          {avatarEmoji(child.avatar)}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-black">{child.display_name}</h3>
          <p className="text-sm text-ink-soft">
            {child.age_years} {child.age_years === 1 ? 'year' : 'years'} old · invited by{' '}
            {parentName(link)}
          </p>
        </div>
      </div>
      {accept.error && <Alert tone="error">{describeError(accept.error)}</Alert>}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          loading={accept.isPending}
          aria-label={`Accept invitation for ${child.display_name}`}
          onClick={() => accept.mutate(link.id)}
        >
          Accept
        </Button>
        <Button
          variant="ghost"
          aria-label={`Decline invitation for ${child.display_name}`}
          onClick={() => setConfirming(true)}
        >
          Decline
        </Button>
      </div>
      {confirming && (
        <ConfirmDialog
          title={`Decline the invitation for ${child.display_name}?`}
          confirmLabel="Decline"
          pending={decline.isPending}
          error={decline.error && <Alert tone="error">{describeError(decline.error)}</Alert>}
          onCancel={() => setConfirming(false)}
          onConfirm={() => decline.mutate(link.id)}
        >
          <p>
            {parentName(link)} would need to invite you again for you to follow {child.display_name}
            .
          </p>
        </ConfirmDialog>
      )}
    </article>
  );
}

function PatientCard({ link }: { link: TherapistLink }) {
  const { child } = link;
  return (
    <Link
      to={`/therapist/children/${child.id}`}
      className="flex h-full items-center gap-3 rounded-3xl bg-white p-5 shadow-sm ring-2 ring-brand-100 transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand-300"
    >
      <span
        className="grid size-16 shrink-0 place-items-center rounded-full bg-sun-200 text-4xl"
        aria-hidden="true"
      >
        {avatarEmoji(child.avatar)}
      </span>
      <div className="min-w-0">
        <h3 className="truncate text-xl font-black">{child.display_name}</h3>
        <p className="text-ink-soft">
          {child.age_years} {child.age_years === 1 ? 'year' : 'years'} old
        </p>
        <p className="text-sm text-ink-soft">Parent: {parentName(link)}</p>
      </div>
    </Link>
  );
}
