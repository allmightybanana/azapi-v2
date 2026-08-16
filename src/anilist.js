import { config } from './config.js';
import { defaultMappingRegistry } from './mappings.js';
import { getOutboundDispatcher } from './proxy.js';
import {
  calculateTitleScore,
  crossCorrelateEpisodeTitles,
  diceCoefficient,
  extractCanonicalSeasonAndPart,
  gaussianYearScore,
  getBestSeasonAndPart,
  normalizeTitle,
  tokenSimilarity
} from './nlp.js';

export {
  calculateTitleScore,
  crossCorrelateEpisodeTitles,
  diceCoefficient,
  extractCanonicalSeasonAndPart,
  gaussianYearScore,
  getBestSeasonAndPart,
  normalizeTitle,
  tokenSimilarity
};

export const formatMatches = (sourceType, candidateFormat) => {
  const normType = String(sourceType || '').toLowerCase();
  const format = String(candidateFormat || '').toUpperCase();

  if (normType.includes('tv') || normType.includes('series')) {
    if (format === 'TV' || format === 'TV_SHORT') return 1.0;
    if (format === 'ONA') return 0.7;
    if (format === 'SPECIAL') return 0.4;
    return 0.0;
  }
  if (normType.includes('movie')) {
    if (format === 'MOVIE') return 1.0;
    if (format === 'SPECIAL' || format === 'OVA') return 0.5;
    return 0.0;
  }
  if (normType.includes('ova')) {
    if (format === 'OVA' || format === 'ONA') return 1.0;
    if (format === 'SPECIAL') return 0.7;
    return 0.0;
  }
  if (normType.includes('web')) {
    if (format === 'ONA') return 1.0;
    if (format === 'TV' || format === 'TV_SHORT') return 0.7;
    return 0.0;
  }
  return 0.5;
};

export const calculateMatchScore = (source, candidate) => {
  // Check Tier 1: Verified Mapping Registry
  const knownMapping = defaultMappingRegistry.getByAnilistId(candidate.id);
  if (knownMapping && source.id && knownMapping.anizoneSlug === source.id) {
    return {
      score: 100,
      confidence: 'high',
      isVerified: true,
      breakdown: {
        titlePoints: 50,
        yearPoints: 20,
        formatPoints: 15,
        epPoints: 15,
        seasonPartPoints: 0,
        tier: 'registry'
      }
    };
  }

  // Check Tier 2: Episode Title Set Cross-Correlation
  if (Array.isArray(source.episodes) && Array.isArray(candidate.streamingEpisodes) && source.episodes.length > 0 && candidate.streamingEpisodes.length > 0) {
    const correlation = crossCorrelateEpisodeTitles(source.episodes, candidate.streamingEpisodes);
    if (correlation.isConfirmedMatch) {
      return {
        score: 100,
        confidence: 'high',
        isEpisodeConfirmed: true,
        breakdown: {
          titlePoints: 50,
          yearPoints: 20,
          formatPoints: 15,
          epPoints: 15,
          seasonPartPoints: 0,
          tier: 'episode_correlation'
        }
      };
    }
  }

  // Tier 3: Generalized NLP & Continuous Distance Feature Vector
  const sourceTitles = [
    source.title,
    source.preferredTitle,
    ...Object.values(source.titles || {})
  ].filter(Boolean);

  const candidateTitles = [
    candidate.title?.romaji,
    candidate.title?.english,
    candidate.title?.native,
    candidate.title?.userPreferred,
    ...(candidate.synonyms || [])
  ].filter(Boolean);

  // 1. Title Similarity (0 to 50 points)
  const titleSimilarity = calculateTitleScore(sourceTitles, candidateTitles);
  const titlePoints = titleSimilarity * 50;

  // 2. Continuous Gaussian Year Score (0 to 20 points / -10 penalty)
  let yearPoints = 0;
  const sourceYear = source.year;
  const candidateYear = candidate.startDate?.year || candidate.seasonYear;
  if (sourceYear && candidateYear) {
    const diff = Math.abs(sourceYear - candidateYear);
    if (diff === 0) {
      yearPoints = 20;
    } else if (diff === 1) {
      yearPoints = 10;
    } else {
      const gScore = gaussianYearScore(sourceYear, candidateYear, 1.5);
      yearPoints = Math.round(gScore * 20) - 10;
    }
  } else {
    yearPoints = 5;
  }

  // 3. Format Alignment (0 to 15 points / -10 penalty)
  let formatPoints = 0;
  if (source.type && candidate.format) {
    const fScore = formatMatches(source.type, candidate.format);
    formatPoints = fScore * 15;
    if (fScore === 0) formatPoints = -10;
  } else {
    formatPoints = 5;
  }

  // 4. Episode Count Ratio Alignment (0 to 15 points / -15 penalty)
  let epPoints = 0;
  const sEp = source.episodeCount || (Array.isArray(source.episodes) ? source.episodes.length : null);
  const cEp = candidate.episodes;
  if (sEp && cEp) {
    const diff = Math.abs(sEp - cEp);
    if (diff === 0) epPoints = 15;
    else if (diff <= 1) epPoints = 10;
    else if (diff <= 3) epPoints = 5;
    else epPoints = -15;
  } else {
    epPoints = 5;
  }

  // 5. Canonical Season & Part / Cour Analysis
  const sMeta = getBestSeasonAndPart(sourceTitles);
  const cMeta = getBestSeasonAndPart(candidateTitles);
  let seasonPartPoints = 0;

  if (sMeta.part !== null && cMeta.part !== null) {
    if (sMeta.part === cMeta.part) {
      seasonPartPoints += 15;
    } else {
      seasonPartPoints -= 25;
    }
  } else if ((sMeta.part === 2 && cMeta.part !== 2) || (sMeta.part !== 2 && cMeta.part === 2)) {
    seasonPartPoints -= 25;
  }

  if (sMeta.season !== null && cMeta.season !== null) {
    if (sMeta.season === cMeta.season) {
      seasonPartPoints += 10;
    } else {
      seasonPartPoints -= 30;
    }
  }

  const totalScore = Math.max(0, Math.min(100, Math.round(titlePoints + yearPoints + formatPoints + epPoints + seasonPartPoints)));
  const confidence = totalScore >= 80 ? 'high' : (totalScore >= 60 ? 'medium' : 'low');

  return {
    score: totalScore,
    confidence,
    breakdown: {
      titlePoints: Math.round(titlePoints),
      yearPoints: Math.round(yearPoints),
      formatPoints: Math.round(formatPoints),
      epPoints: Math.round(epPoints),
      seasonPartPoints,
      tier: 'nlp_vector'
    }
  };
};

const queryAniList = async (query, variables, timeoutMs = 8_000) => {
  const dispatcher = getOutboundDispatcher();
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': config.userAgent
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
    ...(dispatcher ? { dispatcher } : {})
  });

  if (!response.ok) {
    throw new Error(`AniList returned HTTP ${response.status}`);
  }
  return response.json();
};

export const fetchAniListMediaById = async (id, cache = null) => {
  const anilistId = Number.parseInt(id, 10);
  if (!Number.isFinite(anilistId) || anilistId <= 0) return null;

  const cacheKey = `anilist:id:${anilistId}`;
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached.value;
  }

  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        idMal
        title { romaji english native userPreferred }
        synonyms
        format
        episodes
        seasonYear
        startDate { year month day }
        averageScore
        status
        genres
        coverImage { extraLarge large medium }
        siteUrl
        streamingEpisodes {
          title
          thumbnail
          url
          site
        }
      }
    }
  `;

  try {
    const payload = await queryAniList(query, { id: anilistId });
    const media = payload?.data?.Media || null;
    if (cache && media) {
      cache.set(cacheKey, media);
    }
    return media;
  } catch {
    return null;
  }
};

export const searchAniListMedia = async (searchQuery, cache = null) => {
  const cleaned = String(searchQuery || '').trim();
  if (!cleaned) return [];

  const cacheKey = `anilist:search:${cleaned.toLowerCase()}`;
  if (cache) {
    const cached = cache.get(cacheKey);
    if (cached) return cached.value;
  }

  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 8) {
        media(search: $search, type: ANIME) {
          id
          idMal
          title { romaji english native userPreferred }
          synonyms
          format
          episodes
          seasonYear
          startDate { year month day }
          averageScore
          status
          genres
          coverImage { extraLarge large medium }
          siteUrl
        }
      }
    }
  `;

  try {
    const payload = await queryAniList(query, { search: cleaned });
    const list = payload?.data?.Page?.media || [];
    if (cache && list.length > 0) {
      cache.set(cacheKey, list);
    }
    return list;
  } catch {
    return [];
  }
};

export const matchAniListForAnime = async (anizoneAnime, cache = null) => {
  if (!anizoneAnime || typeof anizoneAnime !== 'object') return null;

  // Tier 1: Check Mapping Registry by AniZone slug
  if (anizoneAnime.id) {
    const registered = defaultMappingRegistry.getByAnizoneSlug(anizoneAnime.id);
    if (registered) {
      const media = await fetchAniListMediaById(registered.anilistId, cache);
      if (media) {
        return {
          id: media.id,
          idMal: media.idMal || null,
          title: media.title,
          format: media.format || null,
          seasonYear: media.seasonYear || media.startDate?.year || null,
          episodes: media.episodes || null,
          averageScore: media.averageScore || null,
          status: media.status || null,
          genres: media.genres || [],
          coverImage: media.coverImage || null,
          siteUrl: media.siteUrl || `https://anilist.co/anime/${media.id}`,
          matchScore: 100,
          confidence: 'high',
          verified: true,
          breakdown: { tier: 'registry', isVerified: true }
        };
      }
    }
  }

  // Tier 2 & 3: Discovery & Scored Candidate Matching
  const searchTitles = [
    anizoneAnime.preferredTitle,
    anizoneAnime.title,
    ...Object.values(anizoneAnime.titles || {})
  ].filter(Boolean);

  let candidates = [];
  for (const title of searchTitles) {
    const clean = title.replace(/[【】\[\]\"\'`]/g, '').trim();
    if (!clean) continue;
    const found = await searchAniListMedia(clean, cache);
    for (const c of found) {
      if (!candidates.some((existing) => existing.id === c.id)) {
        candidates.push(c);
      }
    }
    if (candidates.length >= 8) break;
  }

  if (candidates.length === 0) return null;

  const scored = candidates.map((candidate) => ({
    candidate,
    match: calculateMatchScore(anizoneAnime, candidate)
  })).sort((a, b) => b.match.score - a.match.score);

  const best = scored[0];
  if (!best || best.match.score < 60) return null;

  // Auto-record high confidence matches into mapping registry
  if (best.match.score >= 90 && anizoneAnime.id) {
    defaultMappingRegistry.set(best.candidate.id, anizoneAnime.id, {
      title: anizoneAnime.title,
      confidence: best.match.confidence,
      matchScore: best.match.score
    });
  }

  return {
    id: best.candidate.id,
    idMal: best.candidate.idMal || null,
    title: best.candidate.title,
    format: best.candidate.format || null,
    seasonYear: best.candidate.seasonYear || best.candidate.startDate?.year || null,
    episodes: best.candidate.episodes || null,
    averageScore: best.candidate.averageScore || null,
    status: best.candidate.status || null,
    genres: best.candidate.genres || [],
    coverImage: best.candidate.coverImage || null,
    siteUrl: best.candidate.siteUrl || `https://anilist.co/anime/${best.candidate.id}`,
    matchScore: best.match.score,
    confidence: best.match.confidence,
    breakdown: best.match.breakdown
  };
};
