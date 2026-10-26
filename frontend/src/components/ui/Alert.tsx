import type { ReactNode } from 'react';

type Tone = 'error' | 'success' | 'info';

const TONES: Record<Tone, { box: string; icon: string }> = {
  error: { box: 'bg-coral-200/60 text-rose-900 ring-coral-300', icon: '!' },
  success: { box: 'bg-mint-200/70 text-emerald-900 ring-mint-300', icon: '✓' },
  info: { box: 'bg-sky-soft/60 text-sky-950 ring-sky-300', icon: 'i' },
};

export function Alert({ tone = 'info', children }: { tone?: Tone; children: ReactNode }) {
  const style = TONES[tone];
  return (
    <div
      // Errors interrupt (they explain why nothing happened); other messages wait their turn.
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-2xl p-4 ring-2 ${style.box}`}
    >
      <span
        aria-hidden="true"
        className="grid size-6 shrink-0 place-items-center rounded-full bg-white/80 text-sm font-black"
      >
        {style.icon}
      </span>
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
    </div>
  );
}
