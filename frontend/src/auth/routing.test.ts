import { afterSignInPath, homePath } from './routing';

describe('afterSignInPath', () => {
  it.each([
    ['parent', undefined, '/parent'],
    ['parent', '/parent', '/parent'],
    ['parent', '/parent/children?tab=1', '/parent/children?tab=1'],
    ['parent', '/therapist', '/parent'], // another role's area
    ['parent', '/parents-evil', '/parent'], // only a real sub-path counts
    ['parent', '//evil.example/parent', '/parent'], // protocol-relative: off-site
    ['parent', 'https://evil.example', '/parent'],
    ['child', '/play', '/play'],
    ['admin', '/parent', '/admin'],
  ] as const)('%s coming from %s goes to %s', (kind, from, expected) => {
    expect(afterSignInPath(kind, from)).toBe(expected);
  });

  it('gives every kind of account a home', () => {
    expect(['parent', 'therapist', 'admin', 'child'].map((k) => homePath(k as never))).toEqual([
      '/parent',
      '/therapist',
      '/admin',
      '/play',
    ]);
  });
});
