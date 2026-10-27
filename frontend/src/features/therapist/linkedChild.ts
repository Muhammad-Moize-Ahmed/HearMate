import { useOutletContext } from 'react-router';

import type { TherapistLink } from '../careTeam/queries';

/** The active link `LinkedChildGate` checked, for the pages under it. */
export function useLinkedChild(): TherapistLink {
  return useOutletContext<TherapistLink>();
}
