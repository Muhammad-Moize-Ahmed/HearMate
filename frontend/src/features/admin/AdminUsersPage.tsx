import { useId } from 'react';
import { useSearchParams } from 'react-router';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { SegmentedChoice } from '../../components/ui/fields';
import { TextField } from '../../components/ui/TextField';
import { useDebounced } from '../../lib/useDebounced';
import { BackLink, Loading } from '../children/common';
import { useAdminUsers, type AdminUser, type UserRole, type UserStatus } from './queries';

const PAGE_SIZE = 25;

const ROLES: { value: UserRole | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'parent', label: 'Parents' },
  { value: 'therapist', label: 'Therapists' },
  { value: 'admin', label: 'Admins' },
];
const STATUSES: { value: UserStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'disabled', label: 'Turned off' },
];
const ROLE_LABEL: Record<UserRole, string> = {
  parent: 'Parent',
  therapist: 'Therapist',
  admin: 'Admin',
};
const APPROVAL_LABEL = { pending: 'Waiting', approved: 'Approved', rejected: 'Not approved' };

function pick<V extends string>(options: { value: V | '' }[], value: string | null): V | '' {
  return options.some((o) => o.value === value) ? (value as V) : '';
}

const dateOnly = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * Every adult account (parents, therapists, admins), read-only: search, filter and page through
 * them. Children are never listed; a parent's row only says how many children they have.
 */
export function AdminUsersPage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const role = pick(ROLES, params.get('role'));
  const status = pick(STATUSES, params.get('status'));
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const search = useDebounced(q.trim(), 300);
  const resultsId = useId();

  const users = useAdminUsers({
    q: search,
    role: role || null,
    status: status || null,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  // Kept in the URL, so a search can be reloaded or shared. A new search starts at page 1.
  const update = (next: { q?: string; role?: string; status?: string; page?: number }) => {
    const merged = { q, role, status, page: 1, ...next };
    const out = new URLSearchParams();
    if (merged.q) out.set('q', merged.q);
    if (merged.role) out.set('role', merged.role);
    if (merged.status) out.set('status', merged.status);
    if (merged.page > 1) out.set('page', String(merged.page));
    setParams(out, { replace: true });
  };

  const total = users.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const first = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(total, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-6">
      <title>All accounts · HearMate</title>
      <div>
        <BackLink to="/admin">Administration</BackLink>
        <h1 className="text-3xl font-black sm:text-4xl">All accounts</h1>
        <p className="text-lg text-ink-soft">
          Parents, therapists and admins. Read-only; children appear only as a count.
        </p>
      </div>

      <div className="grid gap-4 rounded-3xl bg-white p-4 ring-2 ring-brand-100 sm:p-5">
        <TextField
          label="Search"
          type="search"
          placeholder="Email or name"
          maxLength={100}
          value={q}
          aria-controls={resultsId}
          onChange={(event) => update({ q: event.target.value })}
        />
        <SegmentedChoice
          legend="Role"
          name="role"
          options={ROLES}
          value={role}
          onChange={(value) => update({ role: value })}
        />
        <SegmentedChoice
          legend="Account"
          name="status"
          options={STATUSES}
          value={status}
          onChange={(value) => update({ status: value })}
        />
      </div>

      {users.isPending && <Loading label="Loading accounts…" />}
      {users.isError && (
        <div className="flex flex-col items-start gap-3">
          <Alert tone="error">We couldn't load the accounts. {describeError(users.error)}</Alert>
          <Button variant="secondary" onClick={() => void users.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {users.data && (
        <div
          id={resultsId}
          className={`flex flex-col gap-4 transition-opacity ${users.isPlaceholderData ? 'opacity-60' : ''}`}
          aria-busy={users.isPlaceholderData}
        >
          <p className="text-ink-soft" role="status">
            {total === 0
              ? 'No accounts match.'
              : `Showing ${first}–${last} of ${total} ${total === 1 ? 'account' : 'accounts'}`}
          </p>
          {users.data.items.length > 0 && (
            <ul className="grid gap-3 md:grid-cols-2">
              {users.data.items.map((user) => (
                <li key={user.id}>
                  <UserCard user={user} />
                </li>
              ))}
            </ul>
          )}
          {pages > 1 && (
            <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3">
              <Button
                variant="secondary"
                disabled={page <= 1}
                onClick={() => update({ page: page - 1 })}
              >
                ← Newer
              </Button>
              <span className="text-ink-soft">
                Page {page} of {pages}
              </span>
              <Button
                variant="secondary"
                disabled={page >= pages}
                onClick={() => update({ page: page + 1 })}
              >
                Older →
              </Button>
            </nav>
          )}
        </div>
      )}
    </div>
  );
}

function UserCard({ user }: { user: AdminUser }) {
  const name = `${user.first_name} ${user.last_name}`.trim();
  const rows: [string, string][] = [
    ['Joined', dateOnly(user.created_at)],
    ['Last sign-in', user.last_login_at ? dateOnly(user.last_login_at) : 'Never'],
  ];
  if (user.therapist_status) rows.push(['Approval', APPROVAL_LABEL[user.therapist_status]]);
  if (user.children_count !== null) rows.push(['Children', String(user.children_count)]);

  return (
    <article className="flex h-full flex-col gap-2 rounded-3xl bg-white p-4 ring-2 ring-brand-100">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-lg font-bold">{name}</h2>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-sm font-bold">
            {ROLE_LABEL[user.role]}
          </span>
          {user.status === 'disabled' && (
            <span className="rounded-full bg-coral-200 px-2.5 py-0.5 text-sm font-bold text-rose-900">
              Turned off
            </span>
          )}
        </div>
      </div>
      <p className="text-sm break-all text-ink-soft">
        {user.email}
        {!user.email_verified && (
          <span className="ml-2 rounded-full bg-sun-200 px-2 py-0.5 text-xs font-bold text-amber-900">
            Email not verified
          </span>
        )}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold">{label}</dt>
            <dd className="text-ink-soft">{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
