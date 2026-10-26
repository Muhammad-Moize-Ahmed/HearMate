/** Every backend error has the shape {"error": {code, message, details?, request_id}}. */
type ErrorBody = {
  error?: { code?: string; message?: string; details?: unknown; request_id?: string };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Seconds to wait, for rate-limited (429) responses. */
  get retryAfterSeconds(): number | undefined {
    const details = this.details as { retry_after_seconds?: unknown } | undefined;
    const seconds = details?.retry_after_seconds;
    return typeof seconds === 'number' ? seconds : undefined;
  }
}

export function toApiError(response: Response, body: unknown): ApiError {
  const error = (body as ErrorBody | undefined)?.error;
  return new ApiError(
    response.status,
    error?.code ?? 'error',
    error?.message ?? (response.statusText || 'Something went wrong'),
    error?.details,
    error?.request_id,
  );
}

/** Await an openapi-fetch call and return its data, or throw an ApiError. */
export async function unwrap<D>(
  request: Promise<{ data?: D; error?: unknown; response: Response }>,
): Promise<D> {
  const { data, error, response } = await request;
  if (!response.ok) {
    throw toApiError(response, error);
  }
  return data as D;
}

function minutes(seconds: number): string {
  const n = Math.max(1, Math.ceil(seconds / 60));
  return n === 1 ? '1 minute' : `${n} minutes`;
}

/**
 * A short, friendly sentence for errors any form can hit. Forms handle their own specific codes
 * (like `invalid_credentials`) first and fall back to this.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "We couldn't reach HearMate. Check your internet connection and try again.";
  }
  if (error.status === 429) {
    const wait = error.retryAfterSeconds;
    return wait
      ? `Too many tries. Please wait ${minutes(wait)} and try again.`
      : 'Too many tries. Please wait a little and try again.';
  }
  if (error.code === 'account_disabled') {
    return 'This account has been turned off. Please contact support.';
  }
  if (error.status >= 500) {
    return 'Something went wrong on our side. Please try again in a moment.';
  }
  return error.message;
}
