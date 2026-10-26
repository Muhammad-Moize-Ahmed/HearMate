import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';

import { forgetPendingSignup } from '../auth/pending';
import { resetSessionForTests } from '../auth/session';

afterEach(() => {
  cleanup();
  // Each test starts like a fresh page load: signed out, nothing in memory.
  resetSessionForTests();
  forgetPendingSignup();
  vi.unstubAllGlobals();
});
