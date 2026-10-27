import { useState } from 'react';
import { useNavigate } from 'react-router';

import { describeError } from '../../api/client';
import { Alert } from '../../components/ui/Alert';
import { Button, LinkButton } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { avatarEmoji } from '../../lib/avatars';
import { useLeaveLink } from '../careTeam/queries';
import { Card, Profile } from '../children/ProfileDetails';
import { BackLink, ChildLoadError, Loading } from '../children/common';
import { useChild } from '../children/queries';
import { NotesSection } from '../notes/NotesSection';
import { PlansSection } from '../plans/PlansSection';
import { useLinkedChild } from './linkedChild';

/** A linked child, as their therapist sees them: plan, notes, profile, and links to progress. */
export function TherapistChildPage() {
  const link = useLinkedChild();
  const childId = link.child.id;
  const child = useChild(childId);

  if (child.isPending) return <Loading label="Loading profile…" />;
  if (child.isError) return <ChildLoadError error={child.error} />;
  const { data } = child;
  const name = data.display_name;
  const base = `/therapist/children/${childId}`;

  return (
    <div className="flex flex-col gap-6">
      <title>{`${name} · HearMate`}</title>
      <div>
        <BackLink to="/therapist">My patients</BackLink>
        <div className="flex flex-wrap items-center gap-4">
          <span
            className="grid size-20 shrink-0 place-items-center rounded-full bg-sun-200 text-5xl shadow-[0_4px_0_#ca8a04]"
            aria-hidden="true"
          >
            {avatarEmoji(data.avatar)}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl font-black sm:text-4xl">{name}</h1>
            <p className="text-lg text-ink-soft">
              {data.age_years} {data.age_years === 1 ? 'year' : 'years'} old · parent{' '}
              {`${link.parent.first_name} ${link.parent.last_name}`.trim()}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton to={`${base}/progress`}>
              <span aria-hidden="true">📈</span> Progress
            </LinkButton>
            <LinkButton to={`${base}/report`} variant="secondary">
              Report
            </LinkButton>
          </div>
        </div>
      </div>

      <Card title="Learning plan" emoji="🗺️">
        <PlansSection childId={childId} childName={name} canManage />
      </Card>

      <Card title="Notes" emoji="📝">
        <NotesSection childId={childId} childName={name} canWrite />
      </Card>

      <Card title={`About ${name}`} emoji="📋">
        <Profile child={data} />
      </Card>

      <StopFollowing linkId={link.id} name={name} />
    </div>
  );
}

function StopFollowing({ linkId, name }: { linkId: string; name: string }) {
  const navigate = useNavigate();
  const leave = useLeaveLink();
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="rounded-[2rem] p-5 ring-2 ring-coral-300 sm:p-6">
      <h2 className="mb-2 text-xl font-black">Stop following {name}</h2>
      <p className="mb-4 text-ink-soft">
        You'll lose access to {name}'s information straight away. Your notes stay with the family.
      </p>
      <Button variant="danger" onClick={() => setConfirming(true)}>
        Leave {name}'s care team
      </Button>
      {confirming && (
        <ConfirmDialog
          title={`Leave ${name}'s care team?`}
          confirmLabel="Leave care team"
          pending={leave.isPending}
          error={leave.error && <Alert tone="error">{describeError(leave.error)}</Alert>}
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            leave.mutate(linkId, {
              onSuccess: () => void navigate('/therapist', { replace: true }),
            })
          }
        >
          <p>The parent would need to invite you again for you to see {name}'s progress.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
