export type LoginTab = 'parent' | 'child' | 'therapist';

export const LOGIN_TABS: { id: LoginTab; label: string; emoji: string }[] = [
  { id: 'parent', label: 'Parent', emoji: '👪' },
  { id: 'child', label: 'Child', emoji: '🧒' },
  { id: 'therapist', label: 'Therapist', emoji: '🩺' },
];

export const tabId = (tab: LoginTab) => `login-tab-${tab}`;
export const panelId = (tab: LoginTab) => `login-panel-${tab}`;
