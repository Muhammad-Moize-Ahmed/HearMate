import { usePrincipal } from '../../auth/context';
import { LinkButton } from '../../components/ui/Button';

/** The signed-in parent's or therapist's account: who they are, and deleting the account. */
export function AccountPage() {
  const principal = usePrincipal();
  if (principal.kind === 'child') return null; // the route guard never lets a child here
  const isTherapist = principal.kind === 'therapist';

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <title>Your account · HearMate</title>
      <h1 className="text-3xl font-black sm:text-4xl">Your account</h1>
      <section className="rounded-[2rem] bg-white p-5 shadow-sm sm:p-6">
        <dl className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <dt className="font-bold">Name</dt>
          <dd>{`${principal.first_name} ${principal.last_name}`.trim()}</dd>
          <dt className="font-bold">Email</dt>
          <dd className="break-all">{principal.email}</dd>
          <dt className="font-bold">Account</dt>
          <dd>{isTherapist ? 'Therapist' : 'Parent'}</dd>
        </dl>
      </section>
      <section className="rounded-[2rem] p-5 ring-2 ring-coral-300 sm:p-6">
        <h2 className="mb-2 text-xl font-black">Delete your account</h2>
        <p className="mb-4 text-ink-soft">
          {isTherapist
            ? 'Ends your access to every child and any invitations. The notes and learning plans you wrote stay with each child, shown as written by a former therapist.'
            : "Deletes your account and all of your children's profiles, games, progress, goals, notes and learning plans."}{' '}
          This can't be undone.
        </p>
        <LinkButton to="delete" variant="danger">
          Delete my account…
        </LinkButton>
      </section>
    </div>
  );
}
