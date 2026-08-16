const ROMAN_NUMERALS = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5,
  vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15,
  xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20
};

const KANJI_NUMERALS = {
  '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
};

const ORDINAL_WORDS = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10
};

export const normalizeTitle = (str) => {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[【】\[\]\(\)\"\'`]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const parseNumberOrWord = (token) => {
  if (!token) return null;
  const lower = String(token).toLowerCase().trim();
  if (/^\d+$/.test(lower)) return Number.parseInt(lower, 10);
  if (ROMAN_NUMERALS[lower]) return ROMAN_NUMERALS[lower];
  if (KANJI_NUMERALS[lower]) return KANJI_NUMERALS[lower];
  if (ORDINAL_WORDS[lower]) return ORDINAL_WORDS[lower];
  const ordMatch = lower.match(/^(\d+)(?:st|nd|rd|th)$/);
  if (ordMatch) return Number.parseInt(ordMatch[1], 10);
  return null;
};

export const extractCanonicalSeasonAndPart = (title) => {
  if (!title) return { season: null, part: null };
  const raw = String(title).toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  let season = null;
  let part = null;

  // Season detection (e.g. Season 2, 2nd Season, S2, Season II, 第2期, 2期, Final Season)
  const seasonPatterns = [
    /season\s*([0-9a-z]+)/i,
    /([0-9a-z]+)(?:st|nd|rd|th)?\s*season/i,
    /\bs([0-9]+)\b/i,
    /第\s*([0-9\u4e00-\u9fa5]+)\s*期/i,
    /\b([0-9]+)\s*期/i
  ];

  for (const pat of seasonPatterns) {
    const match = raw.match(pat);
    if (match) {
      const num = parseNumberOrWord(match[1]);
      if (num !== null) {
        season = num;
        break;
      }
    }
  }

  if (season === null && (raw.includes('final season') || raw.includes('the final'))) {
    season = 99;
  }

  // Part / Cour / Dai X Bu / Sono X detection (e.g. Part 2, Cour 2, Dai 2 Bu, 第2部, Sono Ni, Sono 2, Part II)
  const partPatterns = [
    /part\s*([0-9a-z]+)/i,
    /cour\s*([0-9a-z]+)/i,
    /dai\s*([0-9a-z]+)\s*bu/i,
    /第\s*([0-9\u4e00-\u9fa5]+)\s*部/i,
    /sono\s*([0-9a-z]+)/i,
    /\b([0-9]+)\s*部/i
  ];

  for (const pat of partPatterns) {
    const match = raw.match(pat);
    if (match) {
      const token = match[1];
      if (token === 'ni' || token === 'sono ni') {
        part = 2;
        break;
      }
      const num = parseNumberOrWord(token);
      if (num !== null) {
        part = num;
        break;
      }
    }
  }

  return { season, part };
};

export const getBestSeasonAndPart = (titles) => {
  let bestSeason = null;
  let bestPart = null;

  for (const t of titles) {
    if (!t) continue;
    const { season, part } = extractCanonicalSeasonAndPart(t);
    if (season !== null && bestSeason === null) bestSeason = season;
    if (part !== null && bestPart === null) bestPart = part;
  }

  return { season: bestSeason, part: bestPart };
};

export const diceCoefficient = (str1, str2) => {
  const s1 = normalizeTitle(str1);
  const s2 = normalizeTitle(str2);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.length < 2 || s2.length < 2) return s1 === s2 ? 1.0 : 0.0;

  const bigrams1 = new Map();
  for (let i = 0; i < s1.length - 1; i++) {
    const bigram = s1.substring(i, i + 2);
    bigrams1.set(bigram, (bigrams1.get(bigram) || 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < s2.length - 1; i++) {
    const bigram = s2.substring(i, i + 2);
    const count = bigrams1.get(bigram) || 0;
    if (count > 0) {
      bigrams1.set(bigram, count - 1);
      intersection++;
    }
  }

  return (2.0 * intersection) / ((s1.length - 1) + (s2.length - 1));
};

export const tokenSimilarity = (str1, str2) => {
  const t1 = new Set(normalizeTitle(str1).split(' ').filter(Boolean));
  const t2 = new Set(normalizeTitle(str2).split(' ').filter(Boolean));
  if (t1.size === 0 || t2.size === 0) return 0;

  let intersection = 0;
  for (const token of t1) {
    if (t2.has(token)) intersection++;
  }
  return (2 * intersection) / (t1.size + t2.size);
};

export const calculateTitleScore = (sourceTitles, candidateTitles) => {
  let maxScore = 0;
  for (const sTitle of sourceTitles) {
    if (!sTitle) continue;
    const normSource = normalizeTitle(sTitle);
    for (const cTitle of candidateTitles) {
      if (!cTitle) continue;
      const normCand = normalizeTitle(cTitle);
      if (normSource === normCand) return 1.0;

      const dice = diceCoefficient(sTitle, cTitle);
      const token = tokenSimilarity(sTitle, cTitle);
      const score = Math.max(dice, token, (dice + token) / 2);
      if (score > maxScore) maxScore = score;
    }
  }
  return maxScore;
};

export const gaussianYearScore = (year1, year2, sigma = 1.5) => {
  if (!year1 || !year2) return 0.5; // neutral
  const diff = Math.abs(year1 - year2);
  return Math.exp(-Math.pow(diff, 2) / (2 * Math.pow(sigma, 2)));
};

export const crossCorrelateEpisodeTitles = (sourceEpisodes = [], candidateEpisodes = []) => {
  if (!Array.isArray(sourceEpisodes) || !Array.isArray(candidateEpisodes) || sourceEpisodes.length === 0 || candidateEpisodes.length === 0) {
    return { isConfirmedMatch: false, matchRate: 0 };
  }

  const sTitles = sourceEpisodes.map((e) => normalizeTitle(e.title || '')).filter((t) => t && !/^episode\s+\d+$/i.test(t));
  const cTitles = candidateEpisodes.map((e) => {
    const raw = normalizeTitle(e.title || '');
    return raw.replace(/^episode\s+\d+\s+/i, '').trim();
  }).filter((t) => t && !/^episode\s+\d+$/i.test(t));

  if (sTitles.length === 0 || cTitles.length === 0) {
    return { isConfirmedMatch: false, matchRate: 0 };
  }

  let matches = 0;
  for (const sTitle of sTitles) {
    for (const cTitle of cTitles) {
      if (sTitle === cTitle || diceCoefficient(sTitle, cTitle) >= 0.75 || tokenSimilarity(sTitle, cTitle) >= 0.75) {
        matches++;
        break;
      }
    }
  }

  const matchRate = matches / Math.min(sTitles.length, cTitles.length, 5);
  return {
    isConfirmedMatch: matchRate >= 0.5,
    matchRate
  };
};
