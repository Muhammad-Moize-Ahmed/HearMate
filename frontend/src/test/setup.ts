import '@testing-library/jest-dom/vitest';
import { onlineManager } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';

import { forgetPendingSignup } from '../auth/pending';
import { resetSessionForTests } from '../auth/session';
import { setGameActive } from '../lib/gameActivity';
import { resetInstallPromptForTests } from '../pwa/install';
import { installAudioPlayback } from './browserAudio';

installAudioPlayback();

afterEach(() => {
  cleanup();
  // Each test starts like a fresh page load: signed out, nothing in memory.
  resetSessionForTests();
  forgetPendingSignup();
  onlineManager.setOnline(true);
  setGameActive(false);
  resetInstallPromptForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
});
