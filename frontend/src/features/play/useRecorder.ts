import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStatus =
  | 'idle'
  | 'requesting' // waiting for the browser's microphone permission
  | 'recording'
  | 'denied' // permission refused (or blocked by the site settings)
  | 'no-mic' // no microphone found
  | 'unsupported' // this browser can't record audio
  | 'error';

/** Formats the server accepts, in order of preference (Safari records mp4, others webm/ogg). */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

function pickMimeType(): string | undefined {
  return MIME_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t));
}

export function canRecord(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

/**
 * Records one answer from the microphone. `onRecorded` gets the audio when recording stops
 * (by `stop()` or after `maxMs`). The microphone is released as soon as recording ends.
 */
export function useRecorder({
  maxMs,
  onRecorded,
}: {
  maxMs: number;
  onRecorded: (recording: Blob) => void;
}) {
  const [status, setStatus] = useState<RecorderStatus>(() =>
    canRecord() ? 'idle' : 'unsupported',
  );
  const media = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const done = useRef(onRecorded);
  useEffect(() => {
    done.current = onRecorded;
  });

  const stop = useCallback(() => {
    if (media.current?.state === 'recording') media.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (!canRecord()) return setStatus('unsupported');
    setStatus('requesting');
    let input: MediaStream;
    try {
      input = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') return setStatus('denied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return setStatus('no-mic');
      return setStatus('error');
    }
    stream.current = input;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(input, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      releaseMicrophone(stream, timer);
      setStatus('idle');
      done.current(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
    };
    media.current = recorder;
    recorder.start();
    setStatus('recording');
    timer.current = setTimeout(stop, maxMs);
  }, [maxMs, stop]);

  // Never leave the microphone on when the screen goes away.
  useEffect(
    () => () => {
      if (media.current?.state === 'recording') {
        media.current.onstop = null;
        media.current.stop();
      }
      releaseMicrophone(stream, timer);
    },
    [],
  );

  return { status, start, stop };
}

function releaseMicrophone(
  stream: { current: MediaStream | null },
  timer: { current: ReturnType<typeof setTimeout> | null },
) {
  if (timer.current) clearTimeout(timer.current);
  timer.current = null;
  stream.current?.getTracks().forEach((track) => track.stop());
  stream.current = null;
}
