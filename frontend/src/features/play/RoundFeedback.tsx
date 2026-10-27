import { useEffect, useRef } from 'react';

import { Button } from '../../components/ui/Button';
import type { AnswerResult, Prompt } from './api';
import type { AnswerKind } from './meta';
import { soundEmoji, soundLetters } from './meta';

/** After each answer: right or not, and what it was. Kind and short, then "Next". */
export function RoundFeedback({
  result,
  prompt,
  kind,
  onNext,
}: {
  result: AnswerResult;
  prompt: Prompt;
  kind: AnswerKind;
  onNext: () => void;
}) {
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus(), []);
  const labelOf = (id: string) => prompt.options.find((o) => o.id === id)?.label ?? id;
  const { correct_answer: correct, feedback } = result;

  return (
    <div
      role="status"
      className={`flex w-full animate-pop-in flex-col items-center gap-4 rounded-[2rem] p-6 text-center ${
        result.is_correct ? 'bg-mint-200' : 'bg-sun-200'
      }`}
    >
      <span className="text-6xl" aria-hidden="true">
        {result.is_correct ? '🎉' : '💪'}
      </span>
      <p className="text-3xl font-black">{result.is_correct ? 'Yes! Well done!' : 'Nice try!'}</p>

      {kind === 'choice' && correct.choice && !result.is_correct && (
        <p className="text-xl">
          It was{' '}
          <strong>
            {soundEmoji(correct.choice) && (
              <span aria-hidden="true">{soundEmoji(correct.choice)} </span>
            )}
            {labelOf(correct.choice)}
          </strong>
        </p>
      )}

      {kind === 'sequence' && correct.sequence && (
        <>
          {!result.is_correct && feedback.in_place != null && feedback.length != null && (
            <p className="text-xl">
              {feedback.in_place} of {feedback.length} in the right place.
            </p>
          )}
          <p className="text-lg">The order was:</p>
          <ol className="flex flex-wrap justify-center gap-2">
            {correct.sequence.map((id, i) => (
              <li key={`${id}-${i}`} className="rounded-2xl bg-white px-4 py-2 text-xl font-black">
                {labelOf(id)}
              </li>
            ))}
          </ol>
        </>
      )}

      {kind === 'speech' && <SpeechFeedback result={result} />}

      <Button ref={next} variant="primary" size="xl" onClick={onNext}>
        {result.rounds_remaining === 0 ? 'See my stars ⭐' : 'Next ➜'}
      </Button>
    </div>
  );
}

function SpeechFeedback({ result }: { result: AnswerResult }) {
  const { feedback } = result;
  const sounds = [...new Set((feedback.practise_sounds ?? []).map(soundLetters))];
  return (
    <div className="flex flex-col items-center gap-3">
      {typeof feedback.heard === 'string' && (
        <p className="text-xl">
          I heard: <strong>“{feedback.heard || '…'}”</strong>
        </p>
      )}
      {feedback.words && feedback.words.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-2" aria-label="Word by word">
          {feedback.words.map((word, i) => {
            const good = word.score >= 75;
            return (
              <li
                key={`${word.expected}-${i}`}
                className={`rounded-2xl px-3 py-1.5 text-lg font-bold ${good ? 'bg-white' : 'bg-coral-200'}`}
              >
                <span aria-hidden="true">{good ? '✅ ' : '🔁 '}</span>
                {word.expected}
                <span className="sr-only">{good ? ', good' : ', practise this one'}</span>
              </li>
            );
          })}
        </ul>
      )}
      {!result.is_correct && sounds.length > 0 && (
        <p className="text-lg">
          Let's practise the {sounds.map((s) => `“${s}”`).join(' and ')}{' '}
          {sounds.length === 1 ? 'sound' : 'sounds'}.
        </p>
      )}
    </div>
  );
}
