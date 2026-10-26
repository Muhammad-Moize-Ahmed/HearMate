import { Link } from 'react-router';

import { ApiError, describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';

export function BackLink({ to, children }: { to: string; children: string }) {
  return (
    <Link
      to={to}
      className="mb-4 inline-flex min-h-11 items-center gap-1 rounded-xl font-bold text-brand-700 hover:underline"
    >
      <span aria-hidden="true">←</span> {children}
    </Link>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-ink-soft">
      <Spinner className="size-8 text-brand-600" />
      {label}
    </div>
  );
}

/** Why a child's page couldn't load; a 404 means it doesn't exist or isn't yours. */
export function ChildLoadError({ error }: { error: Error }) {
  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/parent">All children</BackLink>
      <Alert tone="error">
        {error instanceof ApiError && error.status === 404
          ? "We couldn't find that child. They may have been removed."
          : describeError(error)}
      </Alert>
    </div>
  );
}
