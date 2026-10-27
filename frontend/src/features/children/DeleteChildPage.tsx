import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { DeletionConfirm } from '../account/DeletionConfirm';
import { BackLink, ChildLoadError, Loading } from './common';
import { useChild, useDeleteChild } from './queries';

/** The warning screen for deleting one child's profile, with the parent's password. */
export function DeleteChildPage() {
  const { childId = '' } = useParams();
  const navigate = useNavigate();
  // While deleting, the child isn't fetched again (their data is being removed from the cache)
  // and the name already shown is kept.
  const [deleting, setDeleting] = useState<string | null>(null);
  const child = useChild(childId, { enabled: deleting === null });
  const remove = useDeleteChild(childId);
  const back = `/parent/children/${childId}`;

  const name = deleting ?? child.data?.display_name;
  if (name === undefined) {
    return child.isError ? (
      <ChildLoadError error={child.error} />
    ) : (
      <Loading label="Loading profile…" />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <title>{`Delete ${name}'s profile · HearMate`}</title>
      <div>
        <BackLink to={back}>{name}</BackLink>
        <h1 className="text-3xl font-black sm:text-4xl">Delete {name}'s profile?</h1>
      </div>
      <DeletionConfirm
        confirmLabel={`Delete ${name}'s profile forever`}
        cancelTo={back}
        pending={remove.isPending}
        error={remove.error}
        onConfirm={(password) => {
          setDeleting(name);
          remove.mutate(password, {
            // No name in router state: browsers keep history state on disk.
            onSuccess: () =>
              void navigate('/parent', { replace: true, state: { notice: 'child-deleted' } }),
            onError: () => setDeleting(null),
          });
        }}
      >
        <p>This removes, for good:</p>
        <ul className="list-disc pl-6">
          <li>{name}'s profile and sign-in (they are signed out on every device);</li>
          <li>all of their games, progress, levels, streaks, badges and goals;</li>
          <li>their therapists' access, notes and learning plans.</li>
        </ul>
        <p>Your account and your other children stay. We'll email you to confirm.</p>
      </DeletionConfirm>
    </div>
  );
}
