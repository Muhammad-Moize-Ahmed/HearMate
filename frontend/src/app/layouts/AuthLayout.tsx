import { Link, Outlet } from 'react-router';

import { Logo } from '../../components/ui/Logo';

/** Sign-in screens: a playful background, the logo, and the screen's card in the middle. */
export function AuthLayout() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <Decorations />
      <header className="px-4 pt-5 sm:px-8">
        <Link to="/" className="inline-block rounded-2xl" aria-label="HearMate home">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-6 sm:items-center sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}

function Decorations() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -top-16 -left-16 size-56 animate-float rounded-full bg-sun-200/80 blur-sm" />
      <div className="absolute top-1/3 -right-20 size-64 animate-float rounded-full bg-mint-200/70 blur-sm [animation-delay:-2s]" />
      <div className="absolute -bottom-20 left-1/4 size-72 animate-float rounded-full bg-coral-200/60 blur-sm [animation-delay:-4s]" />
      <div className="absolute top-24 left-1/2 hidden size-24 animate-float rounded-full bg-sky-soft sm:block [animation-delay:-1s]" />
    </div>
  );
}
