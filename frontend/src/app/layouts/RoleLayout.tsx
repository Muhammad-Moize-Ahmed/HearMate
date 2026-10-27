import { useState } from 'react';
import { Link, Outlet } from 'react-router';

import { useAuth, usePrincipal } from '../../auth/context';
import { Button, LinkButton } from '../../components/ui/Button';
import { Logo } from '../../components/ui/Logo';
import { InstallPrompt } from '../../pwa/InstallPrompt';

type RoleLayoutProps = {
  /** Shown as a badge next to the logo, e.g. "Parent". */
  roleLabel: string;
  /** Background of the badge. */
  badgeClass: string;
  home: string;
  /** The account page (parents and therapists); admins have none. */
  account?: string;
};

/** The frame for adult areas (parent, therapist, admin): a header with the user and sign out. */
export function RoleLayout({ roleLabel, badgeClass, home, account }: RoleLayoutProps) {
  const principal = usePrincipal();
  const { signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const name = principal.kind === 'child' ? principal.display_name : principal.first_name;

  return (
    <div className="flex min-h-dvh flex-col pb-safe">
      <header className="sticky top-0 z-10 pt-safe print:hidden border-b-2 border-brand-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link to={home} className="rounded-2xl" aria-label="Home">
              <Logo />
            </Link>
            <span className={`rounded-full px-3 py-1 text-sm font-bold ${badgeClass}`}>
              {roleLabel}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-ink-soft sm:inline">{name}</span>
            {account && (
              <LinkButton to={account} variant="ghost">
                Account
              </LinkButton>
            )}
            <Button
              variant="secondary"
              loading={signingOut}
              onClick={() => {
                setSigningOut(true);
                void signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10 print:max-w-none print:p-0">
        {principal.kind === 'parent' && <InstallPrompt />}
        <Outlet />
      </main>
    </div>
  );
}
