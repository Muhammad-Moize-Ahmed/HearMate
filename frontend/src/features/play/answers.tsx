import { useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import type { Prompt } from './api';
import { soundEmoji } from './meta';
import { useRecorder, type RecorderStatus } from './useRecorder';

type Option = Prompt['options'][number];

/** Tap the one you heard. Sound Detective options get pictures; word games show the word. */
export function ChoiceAnswer({
  options,
  disabled,
  onAnswer,
}: {
  options: Option[];
  disabled: boolean;
  onAnswer: (choice: string) => void;
}) {
  return (
    <ul
      className={`grid w-full gap-3 ${options.length > 4 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}
    >
      {options.map((option) => {
        const emoji = soundEmoji(option.id);
        return (
          <li key={option.id}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(option.id)}
              className="flex min-h-24 w-full flex-col items-center justify-center gap-1 rounded-3xl bg-white p-3 text-2xl font-black shadow-[0_6px_0_var(--color-brand-200)] transition active:translate-y-1 active:shadow-[0_2px_0_var(--color-brand-200)] disabled:opacity-60 sm:text-3xl"
            >
              {emoji && (
                <span className="text-5xl" aria-hidden="true">
                  {emoji}
                </span>
              )}
              <span className={emoji ? 'text-base sm:text-lg' : ''}>{option.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Tap the words in the order you heard them; one slot per word when the length is known. */
export function SequenceAnswer({
  options,
  length,
  disabled,
  onAnswer,
}: {
  options: Option[];
  length: number | null;
  disabled: boolean;
  onAnswer: (sequence: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const full = length !== null ? picked.length === length : picked.length > 0;
  const labelOf = (id: string) => options.find((o) => o.id === id)?.label ?? id;
  const slots = length ?? Math.max(picked.length, 1);

  return (
    <div className="flex w-full flex-col gap-4">
      <ol aria-label="Your order" className="flex flex-wrap justify-center gap-2">
        {Array.from({ length: slots }, (_, i) => (
          <li
            key={i}
            className={`flex min-h-14 min-w-24 items-center justify-center rounded-2xl border-4 border-dashed px-3 text-xl font-black ${
              picked[i] ? 'border-brand-500 bg-white' : 'border-brand-200 text-brand-300'
            }`}
          >
            {picked[i] ? labelOf(picked[i]) : i + 1}
          </li>
        ))}
      </ol>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {options.map((option) => {
          const used = picked.includes(option.id);
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={disabled || used || full}
                onClick={() => setPicked((p) => [...p, option.id])}
                className="min-h-20 w-full rounded-3xl bg-white p-3 text-2xl font-black shadow-[0_6px_0_var(--color-brand-200)] transition active:translate-y-1 disabled:opacity-40"
              >
                {option.label}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap justify-center gap-3">
        <Button
          variant="secondary"
          disabled={disabled || picked.length === 0}
          onClick={() => setPicked((p) => p.slice(0, -1))}
        >
          <span aria-hidden="true">↩️</span> Undo
        </Button>
        <Button
          variant="sunny"
          size="lg"
          disabled={disabled || !full}
          loading={disabled}
          onClick={() => onAnswer(picked)}
        >
          Done!
        </Button>
      </div>
    </div>
  );
}

const RECORD_MAX_MS = 10_000;

/** Say it out loud: record, then the server listens and scores it. */
export function SpeechAnswer({
  disabled,
  onRecorded,
  onGiveUp,
}: {
  disabled: boolean;
  onRecorded: (recording: Blob) => void;
  /** For when the microphone can't be used: leave this game. */
  onGiveUp: () => void;
}) {
  const recorder = useRecorder({ maxMs: RECORD_MAX_MS, onRecorded });

  if (disabled) {
    return (
      <p role="status" className="flex items-center gap-3 text-xl font-bold">
        <Spinner className="size-8 text-brand-600" /> Listening to you…
      </p>
    );
  }
  const problem = MIC_PROBLEMS[recorder.status];
  if (problem) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 rounded-3xl bg-white p-5 text-center"
      >
        <span className="text-5xl" aria-hidden="true">
          🎙️
        </span>
        <p className="text-lg font-bold">{problem.title}</p>
        <p className="text-ink-soft">{problem.help}</p>
        <div className="flex flex-wrap justify-center gap-3">
          {recorder.status !== 'unsupported' && (
            <Button onClick={() => void recorder.start()}>Try again</Button>
          )}
          <Button variant="secondary" onClick={onGiveUp}>
            Choose another game
          </Button>
        </div>
      </div>
    );
  }

  const recording = recorder.status === 'recording';
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => (recording ? recorder.stop() : void recorder.start())}
        disabled={recorder.status === 'requesting'}
        aria-label={recording ? 'Stop recording' : 'Record your answer'}
        className={`grid size-28 place-items-center rounded-full text-5xl text-white transition active:translate-y-1 disabled:opacity-60 ${
          recording
            ? 'bg-rose-600 shadow-[0_6px_0_#9f1239] motion-safe:animate-pulse'
            : 'bg-brand-600 shadow-[0_6px_0_var(--color-brand-800)]'
        }`}
      >
        <span aria-hidden="true">{recording ? '⏹️' : '🎤'}</span>
      </button>
      <p className="text-lg font-bold" aria-live="polite">
        {recorder.status === 'requesting'
          ? 'Allow the microphone…'
          : recording
            ? 'Say it now! Tap when you are done.'
            : 'Tap the microphone and say it'}
      </p>
    </div>
  );
}

const MIC_PROBLEMS: Partial<Record<RecorderStatus, { title: string; help: string }>> = {
  denied: {
    title: "We can't hear you yet.",
    help: 'Ask a grown-up to allow the microphone for HearMate in the browser settings, then try again.',
  },
  'no-mic': {
    title: "We can't find a microphone.",
    help: 'Plug one in or use a device with a microphone, then try again.',
  },
  unsupported: {
    title: "This browser can't record.",
    help: 'Ask a grown-up to open HearMate in an up-to-date Chrome, Edge, Firefox or Safari.',
  },
  error: {
    title: 'The microphone did not start.',
    help: 'Try again in a moment.',
  },
};
