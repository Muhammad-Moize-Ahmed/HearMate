import { usePrincipal } from '../../auth/context';
import { homePath } from '../../auth/routing';

/**
 * Where a child's pages live for the signed-in adult: parents under `/parent/children/:id`,
 * linked therapists under `/therapist/children/:id`. Pages shared by both (progress, report)
 * build their links from this, so each account stays in its own area.
 */
export function useChildArea() {
  const principal = usePrincipal();
  const home = homePath(principal.kind);
  return {
    home,
    isParent: principal.kind === 'parent',
    childPath: (childId: string) => `${home}/children/${childId}`,
  };
}
