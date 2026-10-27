import { dayOut, played, trend } from '../../test/progressFixtures';
import {
  activityPerBucket,
  bucketDays,
  describeSeries,
  levelSeries,
  longestRun,
  scoreSeries,
  SKILLS,
  streakRuns,
  totalStars,
} from './transform';

const skills = SKILLS.map((s) => ({ key: s.value, label: s.label }));

describe('bucketDays', () => {
  it('keeps one point per day up to a month', () => {
    const buckets = bucketDays(trend('2026-10-27', 30));
    expect(buckets).toHaveLength(30);
    expect(buckets[0]).toMatchObject({ start: '2026-09-28', end: '2026-09-28' });
  });

  it('groups longer periods into weeks, counted back from the last day', () => {
    const buckets = bucketDays(trend('2026-10-27', 90));
    expect(buckets).toHaveLength(13); // 12 full weeks and the 6 oldest days
    expect(buckets.at(-1)).toMatchObject({ start: '2026-10-21', end: '2026-10-27' });
    expect(buckets[0]!.days).toHaveLength(6);
  });
});

describe('scoreSeries', () => {
  const days = [
    dayOut('2026-10-25', [played('similar-sounds', 40), played('sound-detective', 100, 3)]),
    dayOut('2026-10-26'),
    dayOut('2026-10-27', [played('word-sequence', 50)]),
  ];

  it('averages each skill per day, weighting each game by its sessions', () => {
    const series = scoreSeries(bucketDays(days), 'skill', skills);
    expect(series).toEqual([
      { key: 'listening', label: 'Listening', values: [85, null, null] },
      { key: 'memory', label: 'Memory', values: [null, null, 50] },
    ]);
  });

  it('can split by game, leaving out games with no play', () => {
    const games = [
      { key: 'sound-detective', label: 'Sound Detective' },
      { key: 'similar-sounds', label: 'Similar Sounds' },
      { key: 'speech-practice', label: 'Speech Practice' },
    ];
    expect(scoreSeries(bucketDays(days), 'game', games).map((s) => [s.key, s.values])).toEqual([
      ['sound-detective', [100, null, null]],
      ['similar-sounds', [40, null, null]],
    ]);
  });

  it('weights a week by every session in it', () => {
    const long = trend('2026-10-27', 35, {
      '2026-10-21': [played('similar-sounds', 100)],
      '2026-10-27': [played('similar-sounds', 40, 3)],
    });
    const listening = scoreSeries(bucketDays(long), 'skill', skills)[0]!;
    expect(listening.values.at(-1)).toBe(55);
    expect(listening.values.slice(0, -1).every((v) => v === null)).toBe(true);
  });
});

describe('levelSeries', () => {
  it('takes the level at the end of each point, for every skill', () => {
    const days = trend('2026-10-27', 35, {}, (date) => ({
      listening: date >= '2026-10-25' ? 3 : 2,
    }));
    const series = levelSeries(bucketDays(days));
    expect(series.map((s) => s.key)).toEqual(['listening', 'memory', 'speech']);
    expect(series[0]!.values).toEqual([2, 2, 2, 2, 3]);
    expect(series[2]!.values).toEqual([1, 1, 1, 1, 1]);
  });
});

describe('activity and streaks', () => {
  const days = trend('2026-10-27', 10, {
    '2026-10-18': [played('similar-sounds', 50)],
    '2026-10-19': [played('similar-sounds', 50, 2)],
    '2026-10-20': [played('word-sequence', 50)],
    '2026-10-26': [played('similar-sounds', 50)],
  });

  it('adds up games and minutes per point', () => {
    const activity = activityPerBucket(bucketDays(days));
    expect(activity.map((a) => a.sessions)).toEqual([1, 2, 1, 0, 0, 0, 0, 0, 1, 0]);
    expect(activity[1]!.minutes).toBe(10);
  });

  it('finds runs of days in a row and the longest one', () => {
    const runs = streakRuns(days);
    expect(runs).toEqual([
      { start: '2026-10-18', end: '2026-10-20', length: 3 },
      { start: '2026-10-26', end: '2026-10-26', length: 1 },
    ]);
    expect(longestRun(runs)).toEqual(runs[0]);
    expect(longestRun([])).toBeNull();
  });
});

describe('describeSeries', () => {
  it('says where each line starts and ends, for screen readers', () => {
    const percent = (v: number) => `${v}%`;
    expect(
      describeSeries(
        [
          { key: 'a', label: 'Listening', values: [null, 40, 60, 80] },
          { key: 'b', label: 'Memory', values: [50, null] },
          { key: 'c', label: 'Speaking', values: [null, null] },
        ],
        percent,
      ),
    ).toBe('Listening 40% to 80%; Memory 50%; Speaking: no games');
  });
});

describe('totalStars', () => {
  it('adds up the stars of each best result', () => {
    expect(
      totalStars([{ best_accuracy: 95 }, { best_accuracy: 72 }, { best_accuracy: null }]),
    ).toBe(5);
  });
});
