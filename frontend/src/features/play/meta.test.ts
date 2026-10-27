import { prompt } from '../../test/playFixtures';
import { achievementEmoji, answerKind, gameLook, soundLetters, starsFor } from './meta';

describe('answerKind', () => {
  it('works out how a round is answered from its prompt', () => {
    expect(answerKind('sound-detective', prompt())).toBe('choice');
    expect(answerKind('listening-in-noise', prompt())).toBe('choice');
    expect(answerKind('word-sequence', prompt())).toBe('sequence');
    expect(answerKind('new-game', prompt({ answer_length: 3 }))).toBe('sequence');
    expect(answerKind('speech-practice', prompt({ options: [], display_text: 'fish' }))).toBe(
      'speech',
    );
  });
});

describe('starsFor', () => {
  it.each([
    [100, 3],
    [90, 3],
    [89.9, 2],
    [70, 2],
    [40, 1],
    [39, 0],
    [0, 0],
  ])('%s%% earns %s stars', (accuracy, stars) => {
    expect(starsFor(accuracy)).toBe(stars);
  });
});

describe('display helpers', () => {
  it('gives an unknown game a tile from its icon', () => {
    expect(gameLook({ slug: 'sound-detective', icon: 'ear' }).emoji).toBe('🔍');
    expect(gameLook({ slug: 'brand-new', icon: 'mic' }).emoji).toBe('🎤');
    expect(gameLook({ slug: 'brand-new', icon: 'unknown' }).emoji).toBe('🎮');
  });

  it('turns ARPAbet sounds into letters a child knows', () => {
    expect(soundLetters('TH')).toBe('th');
    expect(soundLetters('AH0')).toBe('ah');
    expect(soundLetters('R')).toBe('r');
  });

  it('has a fallback badge icon', () => {
    expect(achievementEmoji('flame')).toBe('🔥');
    expect(achievementEmoji('something-new')).toBe('🏅');
  });
});
