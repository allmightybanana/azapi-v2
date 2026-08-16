import assert from 'node:assert/strict';
import test from 'node:test';
import {
  crossCorrelateEpisodeTitles,
  diceCoefficient,
  extractCanonicalSeasonAndPart,
  gaussianYearScore,
  getBestSeasonAndPart,
  normalizeTitle,
  parseNumberOrWord,
  tokenSimilarity
} from '../src/nlp.js';

test('parseNumberOrWord converts Arabic, Roman, Kanji, and English ordinals', () => {
  assert.equal(parseNumberOrWord('2'), 2);
  assert.equal(parseNumberOrWord('II'), 2);
  assert.equal(parseNumberOrWord('iv'), 4);
  assert.equal(parseNumberOrWord('二'), 2);
  assert.equal(parseNumberOrWord('三'), 3);
  assert.equal(parseNumberOrWord('2nd'), 2);
  assert.equal(parseNumberOrWord('second'), 2);
});

test('extractCanonicalSeasonAndPart extracts uniform season and part structures', () => {
  assert.deepEqual(extractCanonicalSeasonAndPart('Slime Season 2 Part 2'), { season: 2, part: 2 });
  assert.deepEqual(extractCanonicalSeasonAndPart('Slime Season II'), { season: 2, part: null });
  assert.deepEqual(extractCanonicalSeasonAndPart('Slime (2021 Dai 2 Bu)'), { season: null, part: 2 });
  assert.deepEqual(extractCanonicalSeasonAndPart('Slime 第2期 第2部'), { season: 2, part: 2 });
  assert.deepEqual(extractCanonicalSeasonAndPart('Attack on Titan The Final Season Part 3'), { season: 99, part: 3 });
});

test('gaussianYearScore smoothly decays with year discrepancy', () => {
  assert.equal(gaussianYearScore(2021, 2021), 1.0);
  assert.ok(gaussianYearScore(2021, 2022) > 0.7);
  assert.ok(gaussianYearScore(2021, 2010) < 0.001);
});

test('crossCorrelateEpisodeTitles confirms matches based on episode title overlap', () => {
  const sourceEpisodes = [
    { number: '1', title: 'The Visitors' },
    { number: '2', title: 'A Meeting of Humans and Monsters' },
    { number: '3', title: 'Ramiris Warning' }
  ];

  const candidateEpisodes = [
    { title: 'Episode 37 The Visitors' },
    { title: 'Episode 38 A Meeting of Humans and Monsters' },
    { title: 'Episode 39 Ramiris Warning' }
  ];

  const differentEpisodes = [
    { title: 'The Storm Dragon Veldora' },
    { title: 'Meeting the Goblins' }
  ];

  const match = crossCorrelateEpisodeTitles(sourceEpisodes, candidateEpisodes);
  assert.equal(match.isConfirmedMatch, true);
  assert.ok(match.matchRate >= 0.6);

  const mismatch = crossCorrelateEpisodeTitles(sourceEpisodes, differentEpisodes);
  assert.equal(mismatch.isConfirmedMatch, false);
});
