import { customRangeError, defaultCustom, rangeParams, rangeQuery, readRange } from './range';

const TODAY = '2026-10-27';
const params = (query: string) => new URLSearchParams(query);

describe('readRange', () => {
  it('reads a preset, or falls back to the page default', () => {
    expect(readRange(params('range=week'), TODAY, 'month')).toEqual({ kind: 'week', days: 7 });
    expect(readRange(params('range=quarter'), TODAY, 'month')).toEqual({
      kind: 'quarter',
      days: 90,
    });
    expect(readRange(params(''), TODAY, 'month')).toEqual({ kind: 'month', days: 30 });
    expect(readRange(params('range=decade'), TODAY, 'week')).toEqual({ kind: 'week', days: 7 });
  });

  it('reads a custom range with its length in days, counting both ends', () => {
    expect(readRange(params('range=custom&from=2026-10-01&to=2026-10-14'), TODAY, 'month')).toEqual(
      { kind: 'custom', from: '2026-10-01', to: '2026-10-14', days: 14 },
    );
  });

  it('ignores a custom range the server would refuse', () => {
    const month = { kind: 'month', days: 30 };
    for (const query of [
      'range=custom&from=2026-10-10&to=2026-10-12', // too short
      'range=custom&from=2026-10-20&to=2026-10-10', // backwards
      'range=custom&from=2026-10-20&to=2026-11-10', // ends in the future
      'range=custom&from=2025-01-01&to=2026-10-01', // over a year
      'range=custom&from=nonsense',
    ]) {
      expect(readRange(params(query), TODAY, 'month')).toEqual(month);
    }
  });
});

describe('customRangeError', () => {
  it.each([
    ['', TODAY, 'Choose a start and an end date.'],
    ['2026-10-01', '2026-10-28', "The end date can't be in the future."],
    ['2026-10-20', '2026-10-01', 'The start date must be before the end date.'],
    ['2026-10-21', '2026-10-26', 'Choose at least 7 days.'],
    ['2025-10-26', '2026-10-26', 'Choose a year or less.'],
  ])('%s to %s: %s', (from, to, message) => {
    expect(customRangeError(from, to, TODAY)).toBe(message);
  });

  it('accepts 7 days up to a year, ending today', () => {
    expect(customRangeError('2026-10-21', TODAY, TODAY)).toBeNull();
    expect(customRangeError('2025-10-28', TODAY, TODAY)).toBeNull();
  });
});

describe('the range in requests and URLs', () => {
  it('sends presets as a length (the server knows the child’s today) and custom with an end', () => {
    expect(rangeQuery({ kind: 'week', days: 7 })).toEqual({ days: 7 });
    expect(rangeQuery({ kind: 'custom', days: 14, from: '2026-10-01', to: '2026-10-14' })).toEqual({
      days: 14,
      end: '2026-10-14',
    });
  });

  it('round-trips through the URL', () => {
    const custom = { kind: 'custom', days: 14, from: '2026-10-01', to: '2026-10-14' } as const;
    expect(readRange(new URLSearchParams(rangeParams(custom)), TODAY, 'week')).toEqual(custom);
    expect(rangeParams({ kind: 'month', days: 30 })).toEqual({ range: 'month' });
  });

  it('starts a custom form from the period on screen', () => {
    expect(defaultCustom({ kind: 'week', days: 7 }, TODAY)).toEqual({
      from: '2026-10-21',
      to: TODAY,
    });
  });
});
