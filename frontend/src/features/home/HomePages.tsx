import type { ReactNode } from 'react';

import { usePrincipal } from '../../auth/context';
import { Alert } from '../../components/ui/Alert';
import { ComingSoon } from './ComingSoon';

function Greeting({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-2">
      <h1 className="text-3xl font-black sm:text-4xl">Hi, {name}!</h1>
      <p className="text-lg text-ink-soft">{children}</p>
    </div>
  );
}

export function TherapistHome() {
  const principal = usePrincipal();
  if (principal.kind === 'child') return null;
  const status = principal.therapist_status;
  return (
    <>
      <Greeting name={principal.first_name}>Your therapist workspace.</Greeting>
      <div className="mb-6">
        {status === 'pending' && (
          <Alert tone="info">
            <strong>Waiting for approval.</strong> An administrator checks every therapist account.
            Once yours is approved, you can accept invitations from parents. Reload this page to
            check again.
          </Alert>
        )}
        {status === 'rejected' && (
          <Alert tone="error">
            <strong>Your account wasn't approved.</strong> Please contact support if you think this
            is a mistake.
          </Alert>
        )}
      </div>
      <ComingSoon
        features={[
          { emoji: '👧', title: 'Patients', text: 'Children whose parents invited you.' },
          { emoji: '📝', title: 'Notes', text: 'Keep session notes for each child.' },
          { emoji: '🗺️', title: 'Learning plans', text: 'Choose games and weekly practice.' },
          { emoji: '📊', title: 'Reports', text: 'Accuracy in noise, speech sounds and more.' },
        ]}
      />
    </>
  );
}

export function AdminHome() {
  const principal = usePrincipal();
  const name = principal.kind === 'child' ? principal.display_name : principal.first_name;
  return (
    <>
      <Greeting name={name}>HearMate administration.</Greeting>
      <ComingSoon
        features={[
          { emoji: '✅', title: 'Approve therapists', text: 'Review new therapist accounts.' },
        ]}
      />
    </>
  );
}

export function ChildHome() {
  const principal = usePrincipal();
  const name = principal.kind === 'child' ? principal.display_name : '';
  return (
    <div className="flex flex-col items-center gap-6 pt-6 text-center">
      <h1 className="text-4xl font-black sm:text-5xl">Hi {name}!</h1>
      <p className="text-2xl">Ready to listen and play?</p>
      <div className="grid w-full max-w-2xl grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          { emoji: '🔍', label: 'Sound Detective' },
          { emoji: '👂', label: 'Same or different?' },
          { emoji: '🔢', label: 'Word Sequence' },
          { emoji: '🌧️', label: 'Listen in noise' },
          { emoji: '🗣️', label: 'Say it!' },
        ].map((game) => (
          <div
            key={game.label}
            className="flex aspect-square flex-col items-center justify-center gap-2 rounded-3xl bg-white/90 p-3 opacity-80 shadow-[0_6px_0_var(--color-brand-200)]"
          >
            <span className="text-5xl" aria-hidden="true">
              {game.emoji}
            </span>
            <span className="font-bold">{game.label}</span>
          </div>
        ))}
      </div>
      <p className="rounded-full bg-white/80 px-5 py-2 text-lg font-bold">
        <span aria-hidden="true">🚧 </span>Games are coming very soon!
      </p>
    </div>
  );
}
