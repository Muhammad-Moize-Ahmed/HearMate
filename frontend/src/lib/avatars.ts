import type { components } from '../api/schema';

/** Child avatars (backend `Avatar` options) shown as emoji, so no image files are needed. */
export const AVATAR_LABELS: Record<components['schemas']['Avatar'], [emoji: string, name: string]> =
  {
    bear: ['🐻', 'Bear'],
    cat: ['🐱', 'Cat'],
    dog: ['🐶', 'Dog'],
    fox: ['🦊', 'Fox'],
    lion: ['🦁', 'Lion'],
    owl: ['🦉', 'Owl'],
    panda: ['🐼', 'Panda'],
    rabbit: ['🐰', 'Rabbit'],
    robot: ['🤖', 'Robot'],
    rocket: ['🚀', 'Rocket'],
  };

export function avatarEmoji(avatar: string): string {
  return (AVATAR_LABELS as Record<string, [string, string]>)[avatar]?.[0] ?? '⭐';
}
