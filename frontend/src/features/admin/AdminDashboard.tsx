import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';

import { describeError } from '../../api/client';
import { usePrincipal } from '../../auth/context';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { SegmentedChoice, TextAreaField } from '../../components/ui/fields';
import { TextField } from '../../components/ui/TextField';
import { Loading } from '../children/common';
import {
  useAdminStats,
  useApproveTherapist,
  useRejectTherapist,
  useTherapists,
  type ApprovalStatus,
  type Stats,
  type Therapist,
} from './queries';

const STATUS: Record<ApprovalStatus, { label: string; badge: string }> = {
  pending: { label: 'Waiting', badge: 'bg-sun-200 text-amber-900' },
  approved: { label: 'Approved', badge: 'bg-mint-200 text-emerald-900' },
  rejected: { label: 'Not approved', badge: 'bg-coral-200 text-rose-900' },
};

type Filter = ApprovalStatus | 'all';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Waiting' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Not approved' },
];

function readFilter(value: string | null): Filter {
  return FILTERS.some((f) => f.value === value) ? (value as Filter) : 'all';
}

const fullName = (t: Therapist) => `${t.first_name} ${t.last_name}`.trim();
const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/** Case-insensitive match on name, email, organisation, licence or specialisation. */
function matches(therapist: Therapist, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    fullName(therapist),
    therapist.email,
    therapist.organization,
    therapist.license_number,
    therapist.specialization,
  ].some((field) => field?.toLowerCase().includes(q));
}

/**
 * Administration: counts, therapist approvals and the therapist account list. Admins manage
 * accounts only; they have no access to children's data (children appear only as counts).
 */
export function AdminDashboard() {
  const principal = usePrincipal();
  const name = principal.kind === 'child' ? principal.display_name : principal.first_name;
  const therapists = useTherapists();

  return (
    <>
      <title>Administration · HearMate</title>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-black sm:text-4xl">Hi, {name}!</h1>
          <p className="text-lg text-ink-soft">HearMate administration.</p>
        </div>
        <LinkButton to="/admin/users" variant="secondary">
          <span aria-hidden="true">👥</span> All accounts
        </LinkButton>
      </div>

      <div className="mb-8">
        <StatsPanel />
      </div>

      {therapists.isPending && <Loading label="Loading therapist accounts…" />}
      {therapists.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">{describeError(therapists.error)}</Alert>
          <Button variant="secondary" onClick={() => void therapists.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {therapists.isSuccess && <Overview therapists={therapists.data} />}
    </>
  );
}

/** Counts from the server: accounts, children and recent games. Never names or details. */
function StatsPanel() {
  const stats = useAdminStats();
  if (stats.isPending) return <Loading label="Loading counts…" />;
  if (stats.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <Alert tone="error">We couldn't load the counts. {describeError(stats.error)}</Alert>
        <Button variant="secondary" onClick={() => void stats.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return <Counts stats={stats.data} />;
}

function Counts({ stats }: { stats: Stats }) {
  const { therapists } = stats;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Count label="Parents" value={stats.parents} />
      <Count label="Children" value={stats.children} />
      <Count
        label="Therapists"
        value={therapists.total}
        note={`${therapists.approved} approved · ${therapists.rejected} not approved`}
      />
      <Count label="Waiting for approval" value={therapists.pending} />
      <Count label="Games, last 7 days" value={stats.sessions_completed_last_7_days} />
      <Count label="Games, last 30 days" value={stats.sessions_completed_last_30_days} />
      <Count label="Admins" value={stats.admins} />
      <Count label="Turned-off accounts" value={stats.disabled_accounts} />
    </dl>
  );
}

function Overview({ therapists }: { therapists: Therapist[] }) {
  const pending = therapists.filter((t) => t.approval_status === 'pending');

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-black">Waiting for approval</h2>
        {pending.length === 0 ? (
          <p className="rounded-2xl bg-white p-4 text-ink-soft ring-2 ring-brand-100">
            Nothing to review. New therapist sign-ups appear here.
          </p>
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {pending.map((t) => (
              <li key={t.id}>
                <TherapistCard therapist={t} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <AccountList therapists={therapists} />
    </div>
  );
}

function Count({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="flex flex-col-reverse gap-1 rounded-3xl bg-white p-4 ring-2 ring-brand-100">
      {note && <dd className="text-xs text-ink-soft">{note}</dd>}
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-3xl font-black tabular-nums">{value}</dd>
    </div>
  );
}

function AccountList({ therapists }: { therapists: Therapist[] }) {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const filter = readFilter(params.get('status'));
  const resultsId = useId();
  // Kept in the URL, so a filtered list can be reloaded or shared with another admin.
  const update = (next: { q?: string; status?: Filter }) => {
    const merged = { q: query, status: filter, ...next };
    const out = new URLSearchParams();
    if (merged.q) out.set('q', merged.q);
    if (merged.status !== 'all') out.set('status', merged.status);
    setParams(out, { replace: true });
  };

  const shown = therapists.filter(
    (t) => (filter === 'all' || t.approval_status === filter) && matches(t, query),
  );

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-2xl font-black">Therapist accounts</h2>
      <div className="grid gap-4 rounded-3xl bg-white p-4 ring-2 ring-brand-100 sm:p-5">
        <TextField
          label="Search"
          type="search"
          placeholder="Name, email, organisation or licence"
          value={query}
          aria-controls={resultsId}
          onChange={(event) => update({ q: event.target.value })}
        />
        <SegmentedChoice
          legend="Status"
          name="status"
          options={FILTERS}
          value={filter}
          onChange={(status) => update({ status })}
        />
      </div>
      <p className="text-ink-soft" role="status">
        {shown.length === 1 ? '1 account' : `${shown.length} accounts`}
      </p>
      {shown.length === 0 ? (
        <p id={resultsId} className="rounded-2xl bg-brand-50 p-4 text-ink-soft">
          {therapists.length === 0
            ? 'No therapist accounts yet.'
            : 'No accounts match. Try another search or status.'}
        </p>
      ) : (
        <ul id={resultsId} className="grid gap-3 md:grid-cols-2">
          {shown.map((t) => (
            <li key={t.id}>
              <TherapistCard therapist={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TherapistCard({ therapist }: { therapist: Therapist }) {
  const approve = useApproveTherapist();
  const reject = useRejectTherapist();
  const [rejecting, setRejecting] = useState(false);
  const name = fullName(therapist);
  const status = STATUS[therapist.approval_status];
  const details: [string, string | null][] = [
    ['Licence', therapist.license_number],
    ['Organisation', therapist.organization],
    ['Specialisation', therapist.specialization],
  ];

  return (
    <article className="flex h-full flex-col gap-3 rounded-3xl bg-white p-4 ring-2 ring-brand-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-bold">{name}</h3>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${status.badge}`}>
          {status.label}
        </span>
      </div>
      <p className="break-all text-sm text-ink-soft">
        {therapist.email}
        {!therapist.email_verified && (
          <span className="ml-2 rounded-full bg-sun-200 px-2 py-0.5 text-xs font-bold text-amber-900">
            Email not verified
          </span>
        )}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {details.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold">{label}</dt>
            <dd className="text-ink-soft">{value || 'Not given'}</dd>
          </div>
        ))}
        <dt className="font-semibold">Signed up</dt>
        <dd className="text-ink-soft">{dateOnly(therapist.created_at)}</dd>
        {therapist.reviewed_at && (
          <>
            <dt className="font-semibold">Reviewed</dt>
            <dd className="text-ink-soft">{dateOnly(therapist.reviewed_at)}</dd>
          </>
        )}
        {therapist.rejection_reason && (
          <>
            <dt className="font-semibold">Reason</dt>
            <dd className="whitespace-pre-line text-ink-soft">{therapist.rejection_reason}</dd>
          </>
        )}
      </dl>
      {approve.error && <Alert tone="error">{describeError(approve.error)}</Alert>}
      <div className="mt-auto flex flex-wrap gap-2">
        {therapist.approval_status !== 'approved' && (
          <Button
            loading={approve.isPending}
            aria-label={`Approve ${name}`}
            onClick={() => approve.mutate(therapist.id)}
          >
            Approve
          </Button>
        )}
        {therapist.approval_status !== 'rejected' && (
          <Button
            variant="ghost"
            aria-label={`${therapist.approval_status === 'approved' ? 'Withdraw approval for' : 'Reject'} ${name}`}
            onClick={() => {
              reject.reset();
              setRejecting(true);
            }}
          >
            {therapist.approval_status === 'approved' ? 'Withdraw approval' : 'Reject'}
          </Button>
        )}
      </div>
      {rejecting && (
        <RejectDialog
          therapist={therapist}
          pending={reject.isPending}
          error={reject.error}
          onCancel={() => setRejecting(false)}
          onConfirm={(reason) =>
            reject.mutate(
              { therapistId: therapist.id, reason },
              { onSuccess: () => setRejecting(false) },
            )
          }
        />
      )}
    </article>
  );
}

const MAX_REASON = 500;

function RejectDialog({
  therapist,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  therapist: Therapist;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | undefined>();
  const name = fullName(therapist);
  const approved = therapist.approval_status === 'approved';

  return (
    <ConfirmDialog
      title={approved ? `Withdraw ${name}'s approval?` : `Reject ${name}?`}
      confirmLabel={approved ? 'Withdraw approval' : 'Reject account'}
      pending={pending}
      error={error && <Alert tone="error">{describeError(error)}</Alert>}
      onCancel={onCancel}
      onConfirm={() => {
        const trimmed = reason.trim();
        if (!trimmed) return setProblem('Give a reason. It is emailed to the therapist.');
        if (trimmed.length > MAX_REASON) {
          return setProblem(`Please keep the reason under ${MAX_REASON} characters.`);
        }
        onConfirm(trimmed);
      }}
    >
      <p>
        {approved
          ? `${name} will immediately lose access to every child they follow.`
          : `${name} won't be able to see any child's information or accept invitations.`}{' '}
        You can approve the account later.
      </p>
      <TextAreaField
        label="Reason"
        hint="Sent to the therapist by email."
        maxLength={MAX_REASON}
        value={reason}
        error={problem}
        onChange={(event) => {
          setReason(event.target.value);
          setProblem(undefined);
        }}
      />
    </ConfirmDialog>
  );
}
