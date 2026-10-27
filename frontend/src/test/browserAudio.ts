/**
 * Stand-ins for browser audio APIs that jsdom doesn't have: playing audio, blob URLs, and a
 * microphone + MediaRecorder whose behaviour each test chooses.
 */

/** Make <audio> playable and blob URLs creatable. Called once from the test setup. */
export function installAudioPlayback(): void {
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: function play(this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    },
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: function pause() {},
  });
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
  }
}

class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type.startsWith('audio/webm');
  state: 'inactive' | 'recording' = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['fake-audio'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

/**
 * A microphone for this test: `allow` records "fake-audio"; otherwise getUserMedia fails with
 * the given DOMException name (e.g. "NotAllowedError" when permission is refused).
 */
export function fakeMicrophone(outcome: 'allow' | 'NotAllowedError' | 'NotFoundError') {
  const track = { stop: vi.fn() };
  const getUserMedia = vi.fn(async () => {
    if (outcome !== 'allow') throw new DOMException('microphone', outcome);
    return { getTracks: () => [track] } as unknown as MediaStream;
  });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  return { getUserMedia, track };
}
