import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateMatchScore,
  calculateTitleScore,
  diceCoefficient,
  formatMatches,
  normalizeTitle,
  tokenSimilarity
} from '../src/anilist.js';

test('normalizeTitle cleans diacritics, brackets, and extra spaces', () => {
  assert.equal(normalizeTitle('【推しの子】 "Oshi no Ko" (2023)'), 'oshi no ko 2023');
  assert.equal(normalizeTitle('Pokémon: Sun & Moon'), 'pokemon sun moon');
});

test('diceCoefficient measures character bigram similarity', () => {
  assert.equal(diceCoefficient('Oshi no Ko', 'Oshi no Ko'), 1.0);
  assert.ok(diceCoefficient('Oshi no Ko', 'Oshi no Ko Season 2') > 0.5);
  assert.ok(diceCoefficient('Attack on Titan', 'Death Note') < 0.2);
});

test('tokenSimilarity measures word overlap', () => {
  assert.ok(tokenSimilarity('Frieren Beyond Journeys End', 'Beyond Journeys End') > 0.8);
});

test('calculateTitleScore searches all available title variations', () => {
  const sourceTitles = ['My Hero Academia', 'Boku no Hero Academia', '僕のヒーローアカデミア'];
  const candidateTitles = ['Boku no Hero Academia', 'My Hero Academia'];
  assert.equal(calculateTitleScore(sourceTitles, candidateTitles), 1.0);
});

test('formatMatches correctly scores format compatibility', () => {
  assert.equal(formatMatches('TV Series', 'TV'), 1.0);
  assert.equal(formatMatches('Movie', 'MOVIE'), 1.0);
  assert.equal(formatMatches('TV Series', 'MOVIE'), 0.0);
});

test('calculateMatchScore gives 100% to exact multi-reference matches and penalizes mismatches', () => {
  const source = {
    title: 'Oshi no Ko',
    preferredTitle: 'Oshi no Ko',
    titles: { '1': 'My Idol\'s Child' },
    type: 'TV Series',
    year: 2023,
    episodeCount: 11
  };

  const exactCandidate = {
    id: 150672,
    title: { romaji: '[Oshi no Ko]', english: 'OSHI NO KO', native: '【推しの子】' },
    synonyms: ["My Idol's Child"],
    format: 'TV',
    episodes: 11,
    seasonYear: 2023,
    startDate: { year: 2023 }
  };

  const sequelCandidate = {
    id: 166531,
    title: { romaji: '[Oshi no Ko] 2nd Season', english: 'OSHI NO KO Season 2' },
    format: 'TV',
    episodes: 13,
    seasonYear: 2024,
    startDate: { year: 2024 }
  };

  const unrelatedCandidate = {
    id: 99999,
    title: { romaji: 'Completely Different Anime', english: 'Different' },
    format: 'MOVIE',
    episodes: 1,
    seasonYear: 2010,
    startDate: { year: 2010 }
  };

  const exactMatch = calculateMatchScore(source, exactCandidate);
  assert.equal(exactMatch.score, 100);
  assert.equal(exactMatch.confidence, 'high');
  assert.equal(exactMatch.breakdown.titlePoints, 50);
  assert.equal(exactMatch.breakdown.yearPoints, 20);
  assert.equal(exactMatch.breakdown.formatPoints, 15);
  assert.equal(exactMatch.breakdown.epPoints, 15);

  const sequelMatch = calculateMatchScore(source, sequelCandidate);
  assert.ok(sequelMatch.score < exactMatch.score);
  assert.equal(sequelMatch.confidence, 'medium');

  const unrelatedMatch = calculateMatchScore(source, unrelatedCandidate);
  assert.ok(unrelatedMatch.score < 20);
  assert.equal(unrelatedMatch.confidence, 'low');
});
