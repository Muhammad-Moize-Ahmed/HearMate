/** The HearMate mark: a friendly round face with sound waves, and the name beside it. */
export function Logo({ size = 'md', showName = true }: { size?: 'md' | 'lg'; showName?: boolean }) {
  const box = size === 'lg' ? 'size-16' : 'size-10';
  const text = size === 'lg' ? 'text-4xl' : 'text-2xl';
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg className={box} viewBox="0 0 64 64" aria-hidden="true">
        <circle cx="28" cy="34" r="22" fill="var(--color-sun-300)" />
        <circle cx="21" cy="31" r="3" fill="var(--color-ink)" />
        <circle cx="34" cy="31" r="3" fill="var(--color-ink)" />
        <path
          d="M20 41c4 4 11 4 15 0"
          stroke="var(--color-ink)"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="13" cy="39" r="3" fill="var(--color-coral-300)" />
        <circle cx="42" cy="39" r="3" fill="var(--color-coral-300)" />
        <path
          d="M50 20a14 14 0 0 1 0 20M56 14a22 22 0 0 1 0 32"
          stroke="var(--color-brand-600)"
          strokeWidth="4"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {showName && (
        <span className={`${text} font-black tracking-tight text-brand-700`}>HearMate</span>
      )}
    </span>
  );
}
