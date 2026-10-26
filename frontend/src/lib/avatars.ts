/** Child avatars (backend `Avatar` options) shown as emoji, so no image files are needed. */
const AVATARS: Record<string, string> = {
  bear: '🐻',
  cat: '🐱',
  dog: '🐶',
  fox: '🦊',
  lion: '🦁',
  owl: '🦉',
  panda: '🐼',
  rabbit: '🐰',
  robot: '🤖',
  rocket: '🚀',
};

export function avatarEmoji(avatar: string): string {
  return AVATARS[avatar] ?? '⭐';
}
