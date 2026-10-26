import type { ReactNode } from 'react';

type AuthCardProps = {
  title: string;
  subtitle?: ReactNode;
  emoji?: string;
  children: ReactNode;
};

export function AuthCard({ title, subtitle, emoji, children }: AuthCardProps) {
  return (
    <section className="w-full max-w-md animate-pop-in rounded-[2rem] bg-white p-5 shadow-xl ring-4 ring-white/60 sm:p-8">
      <title>{`${title} · HearMate`}</title>
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        {emoji && (
          <span className="text-5xl" aria-hidden="true">
            {emoji}
          </span>
        )}
        <h1 className="text-3xl font-black">{title}</h1>
        {subtitle && <p className="text-ink-soft">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
