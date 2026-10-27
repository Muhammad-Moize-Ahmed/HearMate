import { Outlet, useParams } from 'react-router';

import { describeError } from '../../api/client';
import { usePrincipal } from '../../auth/context';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { useMyLinks, type TherapistLink } from '../careTeam/queries';
import { BackLink, Loading } from '../children/common';

/**
 * Every `/therapist/children/:childId/...` page sits behind this. It renders the page only for an
 * approved therapist with an *active* link to that child, so no request about any other child is
 * ever sent. (The backend enforces the same rule and answers 404; this keeps the UI honest too.)
 */
export function LinkedChildGate() {
  const principal = usePrincipal();
  const { childId = '' } = useParams();
  const approved = principal.kind === 'therapist' && principal.therapist_status === 'approved';
  const links = useMyLinks({ enabled: approved });

  if (!approved) {
    return (
      <Blocked>
        Your account is waiting for admin approval, so you can't see children's information yet.
      </Blocked>
    );
  }
  if (links.isPending) return <Loading label="Checking access…" />;
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
  const link = links.data.find((l) => l.status === 'active' && l.child.id === childId);
  if (!link) {
    return (
      <Blocked>
        You don't have access to this child. A parent has to invite you to their child's care team,
        and you have to accept, before you can see anything about them.
      </Blocked>
    );
  }
  return <Outlet context={link satisfies TherapistLink} />;
}

function Blocked({ children }: { children: string }) {
  return (
    <div className="flex flex-col gap-4">
      <BackLink to="/therapist">My patients</BackLink>
      <Alert tone="error">{children}</Alert>
    </div>
  );
}
