import { useState } from 'react';
import { Outlet } from 'react-router';

import { useAuth, usePrincipal } from '../../auth/context';
import { Button } from '../../components/ui/Button';
import { Logo } from '../../components/ui/Logo';
import { avatarEmoji } from '../../lib/avatars';

/** The child's area: big, bright and simple, with very little text. */
export function ChildLayout() {
  const principal = usePrincipal();
  const { signOut } = useAuth();
  const [leaving, setLeaving] = useState(false);
  if (principal.kind !== 'child') return null; // the route guard only lets children in

  return (
    <div className="flex min-h-dvh flex-col bg-linear-to-b from-sky-soft via-brand-50 to-sun-200/60">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-4">
        <Logo showName={false} />
        <div className="flex items-center gap-2 rounded-full bg-white/80 py-1 pr-4 pl-1 shadow-sm">
          <span
            className="grid size-12 place-items-center rounded-full bg-sun-200 text-3xl"
            aria-hidden="true"
          >
            {avatarEmoji(principal.avatar)}
          </span>
          <span className="text-lg font-black">{principal.display_name}</span>
        </div>
        <Button
          variant="secondary"
          loading={leaving}
          onClick={() => {
            setLeaving(true);
            void signOut();
          }}
        >
          <span aria-hidden="true">👋</span> Bye
        </Button>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-10">
        <Outlet />
      </main>
    </div>
  );
}
