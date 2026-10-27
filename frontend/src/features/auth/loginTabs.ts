/**
 * Parents and therapists share one email sign-in (the account's role decides where it goes);
 * children have their own. `?as=therapist` only changes the wording of the shared form.
 */
export type LoginTab = 'adult' | 'child';

export const LOGIN_TABS: { id: LoginTab; label: string; emoji: string }[] = [
  { id: 'adult', label: 'Parent or therapist', emoji: '👪' },
  { id: 'child', label: 'Child', emoji: '🧒' },
];

export const tabId = (tab: LoginTab) => `login-tab-${tab}`;
export const panelId = (tab: LoginTab) => `login-panel-${tab}`;
