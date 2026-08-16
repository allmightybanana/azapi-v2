import { AniZoneClient } from './client.js';
import { TtlCache } from './cache.js';
import { config } from './config.js';
import { AppError } from './errors.js';
import {
  extractLivewireComponent,
  parseAnimeDetail,
  parseCatalog,
  parseEpisodes,
  parseEpisodeStream,
  parseHome,
  parseLivewireCatalog,
  parseTags
} from './parsers.js';

import {
  calculateMatchScore,
  fetchAniListMediaById,
  matchAniListForAnime,
  searchAniListMedia
} from './anilist.js';
import { defaultMappingRegistry } from './mappings.js';

const SORTS = new Set(['title-asc', 'title-desc', 'release-asc', 'release-desc', 'added-asc', 'added-desc']);
const TYPES = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
const TYPE_NAMES = ['Unknown', 'Unknown', 'TV Series', 'OVA', 'Movie', 'Other', 'Web', 'TV Special', 'Music Video'];

const cleanText = (value, name, maxLength = 100) => {
  const text = String(value || '').trim();
  if (text.length > maxLength) {
    throw new AppError(`${name} must be ${maxLength} characters or fewer.`, 400, 'INVALID_QUERY');
  }
  return text;
};

const cleanSlug = (slug, name = 'ID') => {
  const value = String(slug || '').trim();
  if (!/^[a-z0-9-]{1,40}$/i.test(value)) {
    throw new AppError(`${name} is invalid.`, 400, 'INVALID_ID');
  }
  return value;
};

const cleanEpisodeNumber = (value, name = 'Episode number') => {
  const text = String(value || '').trim();
  if (!/^[a-z0-9_.-]{1,20}$/i.test(text)) {
    throw new AppError(`${name} is invalid.`, 400, 'INVALID_EPISODE_NUMBER');
  }
  return text;
};

const cleanServerKey = (value) => {
  if (value === undefined || value === null || value === '') return 0;
  const num = Number.parseInt(value, 10);
  if (!Number.isInteger(num) || num < 0 || num > 50) {
    throw new AppError('Server key is invalid.', 400, 'INVALID_SERVER_KEY');
  }
  return num;
};

const cleanAnilistId = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number.parseInt(String(value).replace(/^anilist:/i, '').trim(), 10);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError('AniList ID must be a positive integer.', 400, 'INVALID_ANILIST_ID');
  }
  return num;
};

const cleanCursor = (cursor) => {
  if (!cursor) return '';
  const value = String(cursor);
  if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new AppError('Cursor is invalid.', 400, 'INVALID_CURSOR');
  }
  return value;
};

export class AnimeService {
  constructor(options = {}) {
    this.client = options.client || new AniZoneClient();
    this.cache = options.cache || new TtlCache({
      ttlMs: config.cacheTtlMs,
      staleMs: config.cacheStaleMs
    });
  }

  async #cached(key, loader) {
    const fresh = this.cache.get(key);
    if (fresh) return { data: fresh.value, cache: 'hit', age: fresh.age };

    try {
      const value = await loader();
      this.cache.set(key, value);
      return { data: value, cache: 'miss', age: 0 };
    } catch (error) {
      const stale = this.cache.get(key, { allowStale: true });
      if (stale && error?.status !== 404) {
        return { data: stale.value, cache: 'stale', age: stale.age };
      }
      throw error;
    }
  }

  async home({ includeUnsafe = false } = {}) {
    return this.#cached(`home:${includeUnsafe}`, async () => {
      const document = await this.client.get('/');
      const data = parseHome(document.html);
      if (!includeUnsafe) {
        data.latestEpisodes = data.latestEpisodes.filter((episode) => !episode.isUnsafe);
      }
      return data;
    });
  }

  async catalog(query = {}) {
    const anilistId = cleanAnilistId(query.anilistId);
    const search = cleanText(query.search ?? query.q, 'Search');
    const sort = SORTS.has(String(query.sort)) ? String(query.sort) : 'added-desc';
    const type = TYPES.has(String(query.type)) ? String(query.type) : '0';
    const cursor = cleanCursor(query.cursor);
    const includeUnsafe = query.includeUnsafe === true || query.includeUnsafe === 'true';

    if (anilistId) {
      return this.#cached(`catalog:anilist:${anilistId}:${includeUnsafe}`, async () => {
        const anilistMedia = await fetchAniListMediaById(anilistId, this.cache);
        if (!anilistMedia) {
          throw new AppError('AniList title not found.', 404, 'ANILIST_NOT_FOUND');
        }

        const searchTitles = [
          anilistMedia.title?.english,
          anilistMedia.title?.romaji,
          anilistMedia.title?.userPreferred,
          ...(anilistMedia.synonyms || []).slice(0, 3)
        ].filter(Boolean);

        let candidates = [];
        for (const term of searchTitles) {
          const cleanTerm = term.replace(/[【】\[\]\"\'`]/g, '').trim();
          if (!cleanTerm) continue;
          try {
            const res = await this.client.get('/anime', { search: cleanTerm });
            const parsed = parseCatalog(res.html);
            for (const item of parsed.items) {
              if (!candidates.some((c) => c.id === item.id)) {
                candidates.push(item);
              }
            }
            if (candidates.length > 0) break;
          } catch {}
        }

        const scored = candidates.map((item) => {
          const match = calculateMatchScore(item, anilistMedia);
          return {
            ...item,
            anilistId: anilistMedia.id,
            anilist: {
              id: anilistMedia.id,
              idMal: anilistMedia.idMal || null,
              title: anilistMedia.title,
              format: anilistMedia.format,
              seasonYear: anilistMedia.seasonYear || anilistMedia.startDate?.year || null,
              episodes: anilistMedia.episodes,
              averageScore: anilistMedia.averageScore,
              status: anilistMedia.status,
              coverImage: anilistMedia.coverImage,
              siteUrl: anilistMedia.siteUrl,
              matchScore: match.score,
              confidence: match.confidence,
              breakdown: match.breakdown
            }
          };
        }).sort((a, b) => b.anilist.matchScore - a.anilist.matchScore);

        const items = includeUnsafe ? scored : scored.filter((i) => !i.isUnsafe);
        return {
          items,
          nextCursor: null,
          hasMore: false,
          partial: false,
          filters: { anilistId, includeUnsafe }
        };
      });
    }

    const key = `catalog:${search}:${sort}:${type}:${cursor}:${includeUnsafe}`;

    return this.#cached(key, async () => {
      let document;
      let partial = false;
      try {
        document = search
          ? await this.client.get('/anime', { search, sort, type }, { timeoutMs: 8_000 })
          : await this.client.get('/anime');
      } catch (error) {
        if (!search || !['UPSTREAM_TIMEOUT', 'UPSTREAM_UNAVAILABLE', 'UPSTREAM_ERROR'].includes(error.code)) throw error;
        document = await this.client.get('/anime');
        partial = true;
      }
      let page;

      if (cursor && !partial) {
        const livewire = extractLivewireComponent(document.html, 'pages.anime-index');
        const payload = await this.client.loadCatalogPage({
          csrfToken: livewire.token,
          cookies: document.cookies,
          referer: document.url,
          snapshot: livewire.snapshot,
          cursor
        });
        page = parseLivewireCatalog(payload);
      } else {
        page = parseCatalog(document.html);
      }

      if (partial) {
        const needle = search.toLocaleLowerCase();
        page.items = page.items.filter((anime) => [anime.title, anime.preferredTitle, ...Object.values(anime.titles || {})]
          .some((title) => String(title).toLocaleLowerCase().includes(needle)));
        page.nextCursor = null;
        page.hasMore = false;
      }
      if (type !== '0') page.items = page.items.filter((anime) => anime.type === TYPE_NAMES[Number(type)]);
      if (sort === 'title-asc') page.items.sort((a, b) => a.title.localeCompare(b.title));
      if (sort === 'title-desc') page.items.sort((a, b) => b.title.localeCompare(a.title));
      if (sort === 'release-asc') page.items.sort((a, b) => (a.year || 0) - (b.year || 0));
      if (sort === 'release-desc') page.items.sort((a, b) => (b.year || 0) - (a.year || 0));
      if (!includeUnsafe) page.items = page.items.filter((anime) => !anime.isUnsafe);
      return {
        ...page,
        partial,
        ...(partial ? { warning: 'AniZone search was slow, so results were filtered from the current catalog window.' } : {}),
        filters: { search, sort, type, includeUnsafe }
      };
    });
  }

  async anime(id, { includeUnsafe = false, matchAnilist = true } = {}) {
    const slug = cleanSlug(id, 'Anime ID');
    return this.#cached(`anime:${slug}:${includeUnsafe}:${matchAnilist}`, async () => {
      const document = await this.client.get(`/anime/${slug}`);
      const anime = parseAnimeDetail(document.html);
      if (anime.isUnsafe && !includeUnsafe) {
        throw new AppError('This title is hidden by the safe-search filter.', 403, 'CONTENT_FILTERED');
      }
      if (!includeUnsafe) anime.episodes = anime.episodes.filter((episode) => !episode.isUnsafe);

      if (matchAnilist) {
        const anilistMatch = await matchAniListForAnime(anime, this.cache);
        anime.anilistId = anilistMatch?.id || null;
        anime.anilist = anilistMatch;
      } else {
        anime.anilistId = null;
        anime.anilist = null;
      }

      return anime;
    });
  }

  async animeByAnilistId(anilistId, { includeUnsafe = false } = {}) {
    const cleanId = cleanAnilistId(anilistId);
    // Tier 1: Check verified mapping registry
    const registered = defaultMappingRegistry.getByAnilistId(cleanId);
    if (registered?.anizoneSlug) {
      return this.anime(registered.anizoneSlug, { includeUnsafe });
    }

    // Tier 2 & 3: Discovery and candidate resolution
    const catalogResult = await this.catalog({ anilistId: cleanId, includeUnsafe });
    const top = catalogResult.data?.items?.[0] || catalogResult.items?.[0];
    if (!top || (top.anilist?.matchScore != null && top.anilist.matchScore < 60)) {
      throw new AppError('No matching AniZone anime found for the requested AniList ID.', 404, 'ANIME_NOT_FOUND');
    }
    return this.anime(top.id, { includeUnsafe });
  }

  mappings() {
    return {
      items: defaultMappingRegistry.list(),
      total: defaultMappingRegistry.size()
    };
  }

  async episodes(query = {}) {
    const search = cleanText(query.search ?? query.q, 'Search');
    const sort = SORTS.has(String(query.sort)) ? String(query.sort) : 'added-desc';
    const type = TYPES.has(String(query.type)) ? String(query.type) : '0';
    const includeUnsafe = query.includeUnsafe === true || query.includeUnsafe === 'true';

    return this.#cached(`episodes:${search}:${sort}:${type}:${includeUnsafe}`, async () => {
      const document = await this.client.get('/episode');
      let items = parseEpisodes(document.html);
      if (search) {
        const needle = search.toLocaleLowerCase();
        items = items.filter((episode) => [episode.animeTitle, episode.title, episode.summary, episode.number]
          .some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
      }
      if (!includeUnsafe) items = items.filter((episode) => !episode.isUnsafe);
      return { items, filters: { search, sort, type, includeUnsafe } };
    });
  }

  async tags(query = {}) {
    const search = cleanText(query.search ?? query.q, 'Search');
    return this.#cached(`tags:${search}`, async () => {
      const document = await this.client.get('/tag');
      let items = parseTags(document.html);
      if (search) {
        const needle = search.toLocaleLowerCase();
        items = items.filter((tag) => tag.name.toLocaleLowerCase().includes(needle));
      }
      return { items, filters: { search } };
    });
  }

  async stream(animeId, episodeNumber, { server = 0, includeUnsafe = false } = {}) {
    const slug = cleanSlug(animeId, 'Anime ID');
    const epNum = cleanEpisodeNumber(episodeNumber, 'Episode number');
    const serverKey = cleanServerKey(server);
    const key = `stream:${slug}:${epNum}:${serverKey}:${includeUnsafe}`;

    return this.#cached(key, async () => {
      const document = await this.client.get(`/anime/${slug}/${epNum}`);
      let html = document.html;

      if (serverKey > 0) {
        const livewire = extractLivewireComponent(html, 'pages.episode-show');
        const payload = await this.client.switchEpisodeVideo({
          csrfToken: livewire.token,
          cookies: document.cookies,
          referer: document.url,
          snapshot: livewire.snapshot,
          videoKey: serverKey
        });
        const updatedHtml = payload?.components?.[0]?.effects?.html;
        if (updatedHtml) {
          html = updatedHtml;
        }
      }

      const streamData = parseEpisodeStream(html, { animeId: slug, episodeNumber: epNum, server: serverKey });
      if (streamData.isUnsafe && !includeUnsafe) {
        throw new AppError('This title is hidden by the safe-search filter.', 403, 'CONTENT_FILTERED');
      }

      const anilistMatch = await matchAniListForAnime({
        id: streamData.animeId,
        title: streamData.animeTitle || streamData.title
      }, this.cache);
      streamData.anilistId = anilistMatch?.id || null;
      streamData.anilist = anilistMatch;

      return streamData;
    });
  }

  stats() {
    return { cacheEntries: this.cache.size };
  }
}
