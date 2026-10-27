import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, ApiError, unwrap } from '../../api/client';
import type { components } from '../../api/schema';

type S = components['schemas'];
export type Game = S['GameOut'];
export type Session = S['SessionOut'];
export type Round = S['RoundOut'];
export type Prompt = S['PromptOut'];
export type AnswerResult = S['AnswerOut'];
export type AnswerBody = S['AnswerIn']['answer'];
export type SessionResult = S['SessionResultOut'];
export type Achievement = S['AchievementOut'];

export const playKeys = {
  games: ['games'] as const,
  levels: (childId: string) => ['children', childId, 'levels'] as const,
  speechStatus: ['speech-status'] as const,
  family: ['family-progress'] as const,
  stimulus: (sessionId: string, index: number) => ['stimulus', sessionId, index] as const,
};

export function useGames() {
  return useQuery({ queryKey: playKeys.games, queryFn: () => unwrap(api.GET('/api/games')) });
}

export function useLevels(childId: string) {
  return useQuery({
    queryKey: playKeys.levels(childId),
    queryFn: () =>
      unwrap(
        api.GET('/api/children/{child_id}/levels', { params: { path: { child_id: childId } } }),
      ),
  });
}

/** Whether the server can recognise speech (needed for spoken answers). */
export function useSpeechStatus() {
  return useQuery({
    queryKey: playKeys.speechStatus,
    queryFn: () => unwrap(api.GET('/api/speech/status')),
    staleTime: 5 * 60_000,
  });
}

/** This week for the child and their siblings; the home screen shows the child's streak. */
export function useFamilyWeek() {
  return useQuery({
    queryKey: playKeys.family,
    queryFn: () => unwrap(api.GET('/api/family/progress')),
  });
}

function fetchStimulus(sessionId: string, index: number): Promise<Blob> {
  return unwrap(
    api.GET('/api/sessions/{session_id}/rounds/{index}/stimulus', {
      params: { path: { session_id: sessionId, index } },
      parseAs: 'blob',
    }),
  ) as Promise<Blob>;
}

/**
 * A round's audio (WAV, rendered by the server with any noise mixed in). It needs the bearer
 * token, so it is fetched as a blob rather than given to <audio src>. The next round's audio is
 * fetched in the background so it plays without a wait.
 */
export function useStimulus(sessionId: string, index: number, roundCount: number) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: playKeys.stimulus(sessionId, index),
    queryFn: async () => {
      const blob = await fetchStimulus(sessionId, index);
      if (index + 1 < roundCount) {
        void queryClient.prefetchQuery({
          queryKey: playKeys.stimulus(sessionId, index + 1),
          queryFn: () => fetchStimulus(sessionId, index + 1),
          staleTime: Infinity,
        });
      }
      return blob;
    },
    staleTime: Infinity,
    // An answer from the server (e.g. a missing sound file) won't change by asking again; a
    // network blip might.
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
  });
  return query;
}

export const startSession = (body: S['StartSessionIn']) =>
  unwrap(api.POST('/api/sessions', { body }));

export const getSession = (sessionId: string) =>
  unwrap(api.GET('/api/sessions/{session_id}', { params: { path: { session_id: sessionId } } }));

export const answerRound = (
  sessionId: string,
  index: number,
  answer: AnswerBody,
  responseTimeMs: number,
) =>
  unwrap(
    api.POST('/api/sessions/{session_id}/rounds/{index}/answer', {
      params: { path: { session_id: sessionId, index } },
      body: { answer, response_time_ms: responseTimeMs },
    }),
  );

/** Send a spoken answer: the raw recording is the body; the server transcribes and scores it. */
export const answerWithSpeech = (
  sessionId: string,
  index: number,
  recording: Blob,
  responseTimeMs: number,
) =>
  unwrap(
    api.POST('/api/sessions/{session_id}/rounds/{index}/speech', {
      params: {
        path: { session_id: sessionId, index },
        query: { response_time_ms: responseTimeMs },
      },
      // The schema describes binary audio as a string; the body really is the Blob, sent as-is.
      body: recording as unknown as string,
      bodySerializer: (body: unknown) => body as Blob,
      headers: { 'Content-Type': recording.type || 'audio/webm' },
    }),
  );

export const completeSession = (sessionId: string) =>
  unwrap(
    api.POST('/api/sessions/{session_id}/complete', {
      params: { path: { session_id: sessionId } },
    }),
  );

export const abandonSession = (sessionId: string) =>
  unwrap(
    api.POST('/api/sessions/{session_id}/abandon', { params: { path: { session_id: sessionId } } }),
  );
