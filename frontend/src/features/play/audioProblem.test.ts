import { ApiError } from '../../api/client';
import { audioProblemKind } from './audioProblem';

const apiError = (status: number) => new ApiError(status, 'code', 'message');

describe('audioProblemKind', () => {
  it('treats 503 as a sound that is not set up', () => {
    expect(audioProblemKind(apiError(503))).toBe('missing');
  });

  it.each([400, 401, 403, 404, 409, 422, 429])('never retries a %i', (status) => {
    expect(audioProblemKind(apiError(status))).toBe('refused');
  });

  it('retries network failures and passing server errors', () => {
    expect(audioProblemKind(new TypeError('Failed to fetch'))).toBe('retry');
    expect(audioProblemKind(apiError(500))).toBe('retry');
    expect(audioProblemKind(apiError(504))).toBe('retry');
  });
});
