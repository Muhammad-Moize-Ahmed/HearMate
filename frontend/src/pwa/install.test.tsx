import { act, screen, within } from '@testing-library/react';

import { mockParentApi } from '../test/fixtures';
import { mockChildApi } from '../test/playFixtures';
import { renderApp } from '../test/renderApp';
import { installPromptMode, isIosSafari, listenForInstallPrompt, wasDismissed } from './install';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP_MODE =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

const PARENT_ON_DASHBOARD = {
  kind: 'parent' as const,
  pathname: '/parent',
  standalone: false,
  dismissed: false,
  canPrompt: true,
  iosSafari: false,
};

beforeAll(() => listenForInstallPrompt(window));

/** What Chrome/Edge send when the app can be installed. */
function fireInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('Install prompt rules', () => {
  it('is offered to parents only', () => {
    expect(installPromptMode(PARENT_ON_DASHBOARD)).toBe('native');
    for (const kind of ['child', 'therapist', 'admin', null] as const) {
      expect(installPromptMode({ ...PARENT_ON_DASHBOARD, kind })).toBeNull();
    }
  });

  it('never appears in the child play area', () => {
    for (const pathname of ['/play', '/play/', '/play/games/sound-detective', '/play/progress']) {
      expect(installPromptMode({ ...PARENT_ON_DASHBOARD, pathname })).toBeNull();
      expect(
        installPromptMode({ ...PARENT_ON_DASHBOARD, pathname, canPrompt: false, iosSafari: true }),
      ).toBeNull();
    }
  });

  it('stays away once installed or dismissed', () => {
    expect(installPromptMode({ ...PARENT_ON_DASHBOARD, standalone: true })).toBeNull();
    expect(installPromptMode({ ...PARENT_ON_DASHBOARD, dismissed: true })).toBeNull();
  });

  it('gives instructions on iPhone/iPad Safari, and nothing where install is impossible', () => {
    const noEvent = { ...PARENT_ON_DASHBOARD, canPrompt: false };
    expect(installPromptMode({ ...noEvent, iosSafari: true })).toBe('ios');
    expect(installPromptMode(noEvent)).toBeNull();
  });

  it('recognises Safari on iPhone and iPad', () => {
    expect(isIosSafari(IPHONE_SAFARI, 5)).toBe(true);
    expect(isIosSafari(IPAD_DESKTOP_MODE, 5)).toBe(true);
    expect(isIosSafari(IPAD_DESKTOP_MODE, 0)).toBe(false); // a real Mac
    expect(isIosSafari(IPHONE_CHROME, 5)).toBe(false);
    expect(isIosSafari(ANDROID_CHROME, 5)).toBe(false);
  });
});

describe('Install prompt on screen', () => {
  it('lets a parent install from the dashboard', async () => {
    mockParentApi();
    const { user } = renderApp('/parent');
    await screen.findByRole('link', { name: /Ali/ });
    expect(screen.queryByRole('complementary', { name: 'Install HearMate' })).toBeNull();

    const event = fireInstallPrompt();
    expect(event.defaultPrevented).toBe(true); // no browser mini-infobar
    const card = screen.getByRole('complementary', { name: 'Install HearMate' });
    await user.click(within(card).getByRole('button', { name: 'Install' }));

    expect(event.prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole('complementary', { name: 'Install HearMate' })).toBeNull();
  });

  it('"Not now" hides it and remembers that on this device', async () => {
    mockParentApi();
    const { user, unmount } = renderApp('/parent');
    await screen.findByRole('link', { name: /Ali/ });
    fireInstallPrompt();

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('complementary', { name: 'Install HearMate' })).toBeNull();
    expect(wasDismissed()).toBe(true);

    unmount();
    renderApp('/parent');
    await screen.findByRole('link', { name: /Ali/ });
    fireInstallPrompt();
    expect(screen.queryByRole('complementary', { name: 'Install HearMate' })).toBeNull();
  });

  it('explains Add to Home Screen on iPhone Safari', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_SAFARI);
    mockParentApi();
    renderApp('/parent');

    const card = await screen.findByRole('complementary', { name: 'Install HearMate' });
    expect(card).toHaveTextContent('In Safari, tap Share , then Add to Home Screen.');
    expect(within(card).queryByRole('button', { name: 'Install' })).toBeNull();
    vi.restoreAllMocks();
  });

  it('is never shown to a child, even when the browser offers to install', async () => {
    mockChildApi();
    renderApp('/play');
    await screen.findByRole('heading', { name: 'Hi Ali!' });

    fireInstallPrompt();
    expect(screen.queryByRole('complementary', { name: 'Install HearMate' })).toBeNull();
    expect(screen.queryByText(/Install HearMate/)).toBeNull();
  });
});
