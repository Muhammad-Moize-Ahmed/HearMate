import { useRef, type KeyboardEvent } from 'react';

import { LOGIN_TABS, panelId, tabId, type LoginTab } from './loginTabs';

/** WAI-ARIA tabs: arrow keys, Home and End move between them. */
export function RoleTabs({
  value,
  onChange,
}: {
  value: LoginTab;
  onChange: (tab: LoginTab) => void;
}) {
  const refs = useRef<Partial<Record<LoginTab, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent) => {
    const index = LOGIN_TABS.findIndex((t) => t.id === value);
    const last = LOGIN_TABS.length - 1;
    const next = {
      ArrowRight: index === last ? 0 : index + 1,
      ArrowLeft: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = LOGIN_TABS[next]!.id;
    onChange(tab);
    refs.current[tab]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Who is signing in?"
      onKeyDown={onKeyDown}
      className="mb-6 grid grid-cols-3 gap-1.5 rounded-3xl bg-brand-100 p-1.5"
    >
      {LOGIN_TABS.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[tab.id] = el;
            }}
            id={tabId(tab.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`flex min-h-14 flex-col items-center justify-center rounded-2xl px-1 font-bold transition sm:flex-row sm:gap-1.5 ${
              selected ? 'bg-white text-brand-700 shadow' : 'text-brand-800 hover:bg-white/60'
            }`}
          >
            <span className="text-xl" aria-hidden="true">
              {tab.emoji}
            </span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
