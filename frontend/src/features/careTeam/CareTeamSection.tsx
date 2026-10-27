import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { TextField } from '../../components/ui/TextField';
import { email } from '../auth/schemas';
import {
  useChildTherapists,
  useInviteTherapist,
  useRevokeTherapist,
  type ParentLink,
} from './queries';

const inviteSchema = z.object({ email });

/**
 * The parent's side of a child's care team: invite a therapist by email, see whether they've
 * accepted, and cancel the invitation or remove their access. Access is per child.
 */
export function CareTeamSection({ childId, childName }: { childId: string; childName: string }) {
  const links = useChildTherapists(childId);
  const [inviting, setInviting] = useState(false);
  const [invited, setInvited] = useState<string | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-ink-soft">
        A therapist you invite can see {childName}'s profile, progress and reports, and write notes
        and a learning plan, once they accept. They never see your other children.
      </p>
      {invited && (
        <Alert tone="success">
          Invitation sent to {invited}. They'll get access when they accept it.
        </Alert>
      )}
      {removed && (
        <Alert tone="success">
          {removed} no longer has access to {childName}.
        </Alert>
      )}

      {inviting ? (
        <InviteForm
          childId={childId}
          onCancel={() => setInviting(false)}
          onDone={(to) => {
            setInviting(false);
            setRemoved(null);
            setInvited(to);
          }}
        />
      ) : (
        <Button
          className="self-start"
          onClick={() => {
            setInvited(null);
            setRemoved(null);
            setInviting(true);
          }}
        >
          <span aria-hidden="true">✉️</span> Invite a therapist
        </Button>
      )}

      {links.isPending && <p className="text-ink-soft">Loading the care team…</p>}
      {links.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">We couldn't load the care team. {describeError(links.error)}</Alert>
          <Button variant="secondary" onClick={() => void links.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {links.isSuccess && links.data.length === 0 && !inviting && (
        <p className="text-ink-soft">No therapists yet.</p>
      )}
      {links.isSuccess && links.data.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {links.data.map((link) => (
            <li key={link.id}>
              <LinkCard
                link={link}
                childId={childId}
                childName={childName}
                onRemoved={(name) => {
                  setInvited(null);
                  setRemoved(name);
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InviteForm({
  childId,
  onCancel,
  onDone,
}: {
  childId: string;
  onCancel: () => void;
  onDone: (email: string) => void;
}) {
  const invite = useInviteTherapist(childId);
  const form = useForm({ resolver: zodResolver(inviteSchema), defaultValues: { email: '' } });
  const fieldError = (error: Error | null) => {
    if (!(error instanceof ApiError)) return null;
    if (error.code === 'therapist_not_found') {
      return 'No therapist account uses that email. Ask them to sign up as a therapist on HearMate first.';
    }
    if (error.code === 'already_linked') return 'This therapist is already invited or linked.';
    return null;
  };
  const known = fieldError(invite.error);

  const submit = form.handleSubmit((values) =>
    invite.mutate(values.email, { onSuccess: () => onDone(values.email) }),
  );

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4 rounded-3xl bg-brand-50 p-4 sm:p-5"
    >
      {invite.error && !known && <Alert tone="error">{describeError(invite.error)}</Alert>}
      <TextField
        label="Therapist's email"
        type="email"
        autoComplete="off"
        hint="The email they use to sign in to HearMate."
        error={form.formState.errors.email?.message ?? known ?? undefined}
        {...form.register('email', { onChange: () => invite.reset() })}
      />
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={invite.isPending}>
          Send invitation
        </Button>
      </div>
    </form>
  );
}

function LinkCard({
  link,
  childId,
  childName,
  onRemoved,
}: {
  link: ParentLink;
  childId: string;
  childName: string;
  onRemoved: (name: string) => void;
}) {
  const revoke = useRevokeTherapist(childId);
  const [confirming, setConfirming] = useState(false);
  const { therapist } = link;
  const name = `${therapist.first_name} ${therapist.last_name}`.trim();
  const active = link.status === 'active';
  const detail = [therapist.specialization, therapist.organization].filter(Boolean).join(' · ');

  return (
    <article className="flex h-full flex-col gap-2 rounded-3xl bg-white p-4 ring-2 ring-brand-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-bold">{name}</h3>
        <span
          className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
            active ? 'bg-mint-200 text-emerald-900' : 'bg-sun-200 text-amber-900'
          }`}
        >
          {active ? 'Has access' : 'Invited'}
        </span>
      </div>
      <p className="break-all text-sm text-ink-soft">{therapist.email}</p>
      {detail && <p className="text-sm text-ink-soft">{detail}</p>}
      <p className="text-sm text-ink-soft">
        {active && link.accepted_at
          ? `Accepted ${new Date(link.accepted_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`
          : `Invited ${new Date(link.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}`}
        {!active &&
          therapist.approval_status !== 'approved' &&
          ' · their account is waiting for HearMate approval, so they can’t accept yet'}
      </p>
      <Button
        variant="ghost"
        className="mt-auto self-start"
        aria-label={active ? `Remove ${name}'s access` : `Cancel invitation to ${name}`}
        onClick={() => setConfirming(true)}
      >
        {active ? 'Remove access' : 'Cancel invitation'}
      </Button>
      {confirming && (
        <ConfirmDialog
          title={active ? `Remove ${name}'s access?` : `Cancel the invitation to ${name}?`}
          confirmLabel={active ? 'Remove access' : 'Cancel invitation'}
          pending={revoke.isPending}
          error={revoke.error && <Alert tone="error">{describeError(revoke.error)}</Alert>}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            revoke.mutate(link.id, {
              onSuccess: () => {
                setConfirming(false);
                onRemoved(name);
              },
            })
          }
        >
          <p>
            {active
              ? `${name} will immediately stop seeing ${childName}'s profile, progress and reports. The notes they wrote stay visible to you.`
              : `${name} won't be able to accept it. You can invite them again later.`}
          </p>
        </ConfirmDialog>
      )}
    </article>
  );
}
