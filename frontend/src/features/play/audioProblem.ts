import { ApiError } from '../../api/client';

/**
 * Why a round's sound couldn't be fetched:
 * - `missing`: 503, the sound file or speech voice isn't set up (a grown-up's job).
 * - `refused`: any other 4xx; the server's answer won't change by asking again.
 * - `retry`: the request never got an answer (network), or a passing server error.
 */
export type AudioProblemKind = 'missing' | 'refused' | 'retry';

export function audioProblemKind(error: Error): AudioProblemKind {
  if (!(error instanceof ApiError)) return 'retry';
  if (error.status === 503) return 'missing';
  return error.status >= 400 && error.status < 500 ? 'refused' : 'retry';
}
