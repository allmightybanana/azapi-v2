import * as cheerio from 'cheerio';
import { AppError } from './errors.js';

const ANIME_TYPES = ['Unknown', 'TV Series', 'OVA', 'Movie', 'Other', 'Web', 'TV Special', 'Music Video'];

const compact = (value = '') => String(value).replace(/\s+/g, ' ').trim();

const decodeJsString = (value) => JSON.parse(
  `"${value
    .replace(/\\'/g, "'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')}"`
);

export const extractEmbeddedJson = (source, key) => {
  const pattern = new RegExp(`${key}:\\s*JSON\\.parse\\('([\\s\\S]*?)'\\)`);
  const match = String(source || '').match(pattern);
  if (!match) return null;

  try {
    return JSON.parse(decodeJsString(match[1]));
  } catch {
    return null;
  }
};

const normalizeSourceUrl = (value) => {
  if (!value) return null;
  try {
    const url = new URL(value, 'https://anizone.to');
    if (url.hostname !== 'anizone.to') return url.toString();
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
};

const pathParts = (href) => {
  try {
    return new URL(href, 'https://anizone.to').pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
};

const pickTitle = (titles, fallback = '') => {
  if (!titles || typeof titles !== 'object') return fallback;
  return titles['1'] || titles['5'] || Object.values(titles).find(Boolean) || fallback;
};

const normalizedTag = (tag) => ({
  id: tag.slug,
  name: tag.name,
  sourceUrl: normalizeSourceUrl(tag.url || `/tag/${tag.slug}`)
});

export const normalizeAnime = (anime) => ({
  id: anime.slug,
  title: anime.main_title,
  preferredTitle: pickTitle(anime.title_list, anime.main_title),
  titles: anime.title_list || {},
  type: anime.type || 'Unknown',
  status: anime.is_ongoing ? 'Ongoing' : 'Completed',
  year: anime.start_year ?? null,
  episodeCount: anime.episode_count ?? null,
  isUnsafe: Boolean(anime.is_unsafe),
  cover: normalizeSourceUrl(anime.cover),
  tags: Array.isArray(anime.tags) ? anime.tags.map(normalizedTag) : [],
  sourceUrl: normalizeSourceUrl(anime.url || `/anime/${anime.slug}`)
});

export const extractLivewireComponent = (html, componentName) => {
  const $ = cheerio.load(html);
  const token = $('meta[name="csrf-token"]').attr('content');
  let snapshot = null;

  $('[wire\\:snapshot]').each((_, element) => {
    const candidate = $(element).attr('wire:snapshot');
    if (!candidate || snapshot) return;
    try {
      const parsed = JSON.parse(candidate);
      if (parsed.memo?.name === componentName) snapshot = candidate;
    } catch {
      // Ignore unrelated malformed state.
    }
  });

  if (!token || !snapshot) {
    throw new AppError('AniZone page state could not be read.', 502, 'UPSTREAM_LAYOUT_CHANGED');
  }
  return { token, snapshot };
};

export const parseCatalog = (html) => {
  const $ = cheerio.load(html);
  const state = $('[x-data]')
    .map((_, element) => $(element).attr('x-data') || '')
    .get()
    .find((value) => value.includes('items: JSON.parse'));

  if (!state) {
    throw new AppError('AniZone catalog data was not found.', 502, 'UPSTREAM_LAYOUT_CHANGED');
  }

  const items = extractEmbeddedJson(state, 'items');
  if (!Array.isArray(items)) {
    throw new AppError('AniZone catalog data was invalid.', 502, 'UPSTREAM_INVALID_RESPONSE');
  }

  const cursorMatch = state.match(/nextCursor:\s*(?:null|'([^']+)')/);
  return {
    items: items.map(normalizeAnime),
    nextCursor: cursorMatch?.[1] || null,
    hasMore: /hasMore:\s*true/.test(state)
  };
};

const findPaginatedPayload = (node, seen = new Set()) => {
  if (!node || typeof node !== 'object' || seen.has(node)) return null;
  seen.add(node);
  if (Array.isArray(node.items) && Object.hasOwn(node, 'hasMore')) return node;
  for (const value of Object.values(node)) {
    const found = findPaginatedPayload(value, seen);
    if (found) return found;
  }
  return null;
};

export const parseLivewireCatalog = (payload) => {
  const found = findPaginatedPayload(payload);
  if (found) {
    return {
      items: found.items.map(normalizeAnime),
      nextCursor: found.nextCursor || null,
      hasMore: Boolean(found.hasMore)
    };
  }

  const html = payload?.components?.[0]?.effects?.html;
  if (html) return parseCatalog(html);
  throw new AppError('AniZone pagination data was not found.', 502, 'UPSTREAM_LAYOUT_CHANGED');
};

const exactLink = ($, container, kind, segments) => {
  const scope = typeof container?.find === 'function' ? container : $(container);
  return scope.find(`a[href*="/${kind}/"]`)
  .filter((_, element) => {
    const parts = pathParts($(element).attr('href'));
    return parts[0] === kind && parts.length === segments;
  });
};

const section = ($, headingText) => $('h2')
  .filter((_, element) => compact($(element).text()) === headingText)
  .first()
  .parent();

const parseAnimeLinks = ($, container) => {
  const seen = new Set();
  const items = [];
  exactLink($, container, 'anime', 2).each((_, anchor) => {
    const href = $(anchor).attr('href');
    const id = pathParts(href)[1];
    if (!id || seen.has(id)) return;
    const group = $(anchor).closest('[x-data]');
    const image = group.find('img').first();
    const xData = group.attr('x-data') || '';
    const titles = extractEmbeddedJson(xData, 'anmTitles') || {};
    const fallback = xData.match(/this\.anmTitles,\s*'([^']*)'/)?.[1]?.replace(/\\'/g, "'") || '';
    const title = compact($(anchor).text()) || image.attr('alt') || pickTitle(titles, fallback) || compact(group.find('a').last().text());
    if (!title) return;
    seen.add(id);
    items.push({
      id,
      title,
      preferredTitle: pickTitle(titles, title),
      titles,
      cover: normalizeSourceUrl(image.attr('src')),
      sourceUrl: normalizeSourceUrl(href)
    });
  });
  return items;
};

const parseEpisodeTitles = (xData) => {
  const titles = extractEmbeddedJson(xData, 'epsTitles');
  return titles && typeof titles === 'object' ? titles : {};
};

const animeTitleFromXData = (xData) => {
  const match = String(xData || '').match(/this\.animeDict\[this\.anmSlug\],\s*'([^']*)'/);
  return match?.[1]?.replace(/\\'/g, "'") || null;
};

const parseEpisodeItems = ($, container, fallbackAnimeTitle = null) => {
  const items = [];
  $(container).find('li').each((_, listItem) => {
    const anchor = $(listItem).find('a[href*="/anime/"]').filter((__, element) => {
      const parts = pathParts($(element).attr('href'));
      return parts[0] === 'anime' && parts.length === 3;
    }).first();
    if (!anchor.length) return;

    const parts = pathParts(anchor.attr('href'));
    const xData = $(listItem).attr('x-data') || '';
    const titles = parseEpisodeTitles(xData);
    const heading = compact($(listItem).find('h3').first().text());
    const animeAnchor = exactLink($, listItem, 'anime', 2).first();
    const text = compact($(listItem).text());
    const date = text.match(/\b(?:19|20)\d{2}-\d{2}-\d{2}\b/)?.[0] || null;
    const duration = text.match(/\b\d{1,2}:\d{2}\b/)?.[0] || null;
    const summary = compact($(listItem).find('span.text-slate-100.text-sm').first().text()) || null;
    const rawClean = heading.replace(/^Episode\s+[\w.-]+\s*:?\s*/i, '').trim();
    const title = pickTitle(titles, rawClean) || (rawClean ? rawClean : `Episode ${parts[2]}`);

    items.push({
      id: `${parts[1]}-${parts[2]}`,
      animeId: parts[1],
      animeTitle: compact(animeAnchor.text()) || animeTitleFromXData(xData) || fallbackAnimeTitle,
      number: parts[2],
      title,
      titles,
      summary,
      date,
      duration,
      isUnsafe: /isUnsafe:\s*true/.test(xData),
      thumbnail: normalizeSourceUrl($(listItem).find('img').first().attr('src')),
      sourceUrl: normalizeSourceUrl(anchor.attr('href'))
    });
  });
  return items;
};

const parseTagItems = ($, container) => {
  const seen = new Set();
  const items = [];
  $(container).find('li').each((_, listItem) => {
    const anchor = exactLink($, listItem, 'tag', 2).first();
    if (!anchor.length) return;
    const id = pathParts(anchor.attr('href'))[1];
    if (!id || seen.has(id)) return;
    const raw = compact(anchor.text());
    const count = Number.parseInt(raw.match(/\((\d+)\)\s*$/)?.[1] || '', 10);
    const name = (anchor.attr('title') || raw.replace(/\s*\(\d+\)\s*$/, '')).trim();
    seen.add(id);
    items.push({
      id,
      name,
      animeCount: Number.isFinite(count) ? count : null,
      image: normalizeSourceUrl($(listItem).find('img').first().attr('src')),
      sourceUrl: normalizeSourceUrl(anchor.attr('href'))
    });
  });
  return items;
};

export const parseHome = (html) => {
  const $ = cheerio.load(html);
  return {
    latestAnime: parseAnimeLinks($, section($, 'Latest Anime')),
    latestEpisodes: parseEpisodeItems($, section($, 'Latest Episodes')),
    topTags: parseTagItems($, section($, 'Top Tags'))
  };
};

export const parseEpisodes = (html) => {
  const $ = cheerio.load(html);
  return parseEpisodeItems($, $('main'));
};

export const parseTags = (html) => {
  const $ = cheerio.load(html);
  return parseTagItems($, $('main'));
};

export const parseAnimeDetail = (html) => {
  const $ = cheerio.load(html);
  const pageTitle = compact($('title').text()).replace(/\s+—\s+AniZone$/, '');
  const titleState = $('[x-data]')
    .map((_, element) => $(element).attr('x-data') || '')
    .get()
    .find((value) => value.includes('anmTitles:')) || '';
  const titles = extractEmbeddedJson(titleState, 'anmTitles') || {};
  const hero = $('h1').first().parent();
  const metadata = compact(hero.text());
  const type = ANIME_TYPES.find((candidate) => metadata.includes(candidate)) || 'Unknown';
  const status = metadata.match(/\b(Ongoing|Completed)\b/)?.[1] || null;
  const episodeCount = Number.parseInt(metadata.match(/(\d+)\s+Episodes?/i)?.[1] || '', 10);
  const year = Number.parseInt(metadata.match(/\b((?:19|20)\d{2})\b/)?.[1] || '', 10);
  const synopsisHeading = $('h3').filter((_, element) => compact($(element).text()) === 'Synopsis').first();
  const synopsis = compact(synopsisHeading.siblings('div').first().text()) || null;
  const animeImages = $('img[src*="/images/anime/"]');
  const officialSite = $('a[aria-label="Official Site"]').attr('href') || null;
  const tagLinks = exactLink($, $('main'), 'tag', 2);
  const seenTags = new Set();
  const tags = [];

  tagLinks.each((_, anchor) => {
    const id = pathParts($(anchor).attr('href'))[1];
    if (!id || seenTags.has(id)) return;
    seenTags.add(id);
    tags.push({ id, name: compact($(anchor).text()), sourceUrl: normalizeSourceUrl($(anchor).attr('href')) });
  });

  const id = pathParts($('a[href*="/anime/"]').filter((_, anchor) => pathParts($(anchor).attr('href')).length === 3).first().attr('href'))[1]
    || $('main [wire\\:key]').first().attr('wire:key')?.split('-')[0]
    || null;

  return {
    id,
    title: pageTitle,
    preferredTitle: pickTitle(titles, pageTitle),
    titles,
    type,
    status,
    year: Number.isFinite(year) ? year : null,
    episodeCount: Number.isFinite(episodeCount) ? episodeCount : null,
    isUnsafe: /isUnsafe:\s*true/.test(titleState),
    cover: normalizeSourceUrl(animeImages.eq(1).attr('src') || animeImages.first().attr('src')),
    banner: normalizeSourceUrl(animeImages.first().attr('src')),
    synopsis,
    tags,
    officialSite,
    sourceUrl: id ? normalizeSourceUrl(`/anime/${id}`) : null,
    episodes: parseEpisodeItems($, $('main'), pageTitle)
  };
};

export const extractVidstackPlayer = (html) => {
  const match = String(html || '').match(/vidstackPlayer\s*\(\s*JSON\.parse\(\s*'([\s\S]*?)'\s*\)\s*\)/);
  if (!match) return null;
  try {
    return JSON.parse(decodeJsString(match[1]));
  } catch {
    return null;
  }
};

export const parseEpisodeServers = ($, activeKey = 0) => {
  const servers = [];
  $('[wire\\:click*="setVideo"]').each((_, el) => {
    const clickAttr = $(el).attr('wire:click') || '';
    const match = clickAttr.match(/setVideo\((\d+)\)/);
    if (!match) return;
    const key = Number.parseInt(match[1], 10);
    const text = compact($(el).text());
    const nameMatch = text.match(/^([A-Za-z0-9_-]+)/);
    const name = nameMatch ? nameMatch[1] : `Server ${key + 1}`;
    const sourceMatch = text.match(/Source:\s*([A-Za-z0-9_-]+)/i);
    const durationMatch = text.match(/Duration:\s*([0-9:]+)/i);
    const audioMatch = text.match(/Audio:\s*(.*?)(?=\s*Softsub:|$)/i);
    const audio = audioMatch ? audioMatch[1].split(/\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean) : [];
    const subMatch = text.match(/Softsub:\s*(.*?)$/i);
    const subtitles = subMatch ? subMatch[1].split(/\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean) : [];

    servers.push({
      key,
      name,
      source: sourceMatch ? sourceMatch[1] : 'Web',
      duration: durationMatch ? durationMatch[1] : null,
      audio,
      subtitles,
      isActive: key === activeKey
    });
  });
  return servers;
};

export const parseEpisodeStream = (html, options = {}) => {
  const $ = cheerio.load(html);
  const playerData = extractVidstackPlayer(html);
  if (!playerData || !playerData.src) {
    throw new AppError('AniZone stream sources were not found for this episode.', 404, 'STREAM_NOT_FOUND');
  }

  const pageTitle = compact($('title').text()).replace(/\s+—\s+AniZone$/, '');
  const titleParts = pageTitle.match(/^Episode\s+([\w.-]+)\s*[-:]\s*(.+)$/i);
  const animeAnchor = $('a[href*="/anime/"]').filter((_, el) => pathParts($(el).attr('href')).length === 2).first();
  const animeHref = animeAnchor.attr('href');
  const animeIdFromHref = animeHref ? pathParts(animeHref)[1] : null;

  let snapData = null;
  $('[wire\\:snapshot]').each((_, el) => {
    try {
      const parsed = JSON.parse($(el).attr('wire:snapshot'));
      if (parsed?.data?.anime_slug) snapData = parsed.data;
    } catch {}
  });

  const animeId = snapData?.anime_slug || animeIdFromHref || options.animeId || null;
  const episodeNumber = snapData?.episode_slug || String(options.episodeNumber || '').trim() || titleParts?.[1] || null;
  const animeAnchorText = compact(animeAnchor.text()) || null;
  const animeTitle = animeAnchorText || titleParts?.[2] || null;

  let episodeTitles = {};
  if (episodeNumber) {
    $('a[href*="/anime/"]').each((_, a) => {
      const parts = pathParts($(a).attr('href'));
      if (parts.length === 3 && parts[0] === 'anime' && (!animeId || parts[1] === animeId) && parts[2] === String(episodeNumber)) {
        const parent = $(a).closest('[x-data]');
        const x = parent.attr('x-data') || '';
        const titles = extractEmbeddedJson(x, 'epsTitles');
        if (titles && Object.keys(titles).length > 0) {
          episodeTitles = titles;
        }
      }
    });
  }

  const rawPickedTitle = pickTitle(episodeTitles, '');
  const episodeTitle = rawPickedTitle || (animeAnchorText && titleParts?.[2] && titleParts[2] !== animeAnchorText ? titleParts[2] : null) || (episodeNumber ? `Episode ${episodeNumber}` : pageTitle);
  const activeKey = Number.isInteger(options.server) ? options.server : (snapData?.videoKey ?? 0);
  const isUnsafe = $('[x-data]').map((_, el) => $(el).attr('x-data') || '').get().some((v) => /isUnsafe:\s*true/.test(v));

  const servers = parseEpisodeServers($, activeKey);
  const currentServer = servers.find((s) => s.key === activeKey) || servers[0] || null;

  return {
    id: animeId && episodeNumber ? `${animeId}-${episodeNumber}` : null,
    animeId,
    animeTitle,
    episodeNumber,
    title: episodeTitle,
    titles: episodeTitles,
    duration: currentServer?.duration || null,
    isUnsafe,
    server: activeKey,
    hls: {
      url: normalizeSourceUrl(playerData.src),
      storage: playerData.storage || null,
      snapshot: normalizeSourceUrl(playerData.snapshot),
      storyboard: normalizeSourceUrl(playerData.storyboard),
      chapters: normalizeSourceUrl(playerData.chapter),
      subtitles: Array.isArray(playerData.subtitles)
        ? playerData.subtitles.map((sub) => ({
            title: sub.title || null,
            format: sub.format || null,
            language: sub.language || null,
            default: Boolean(sub.default),
            forced: sub.forced === 'yes' || sub.forced === true,
            file: normalizeSourceUrl(sub.file)
          }))
        : [],
      fonts: Array.isArray(playerData.fonts) ? playerData.fonts.map(normalizeSourceUrl).filter(Boolean) : []
    },
    servers,
    sourceUrl: animeId && episodeNumber ? normalizeSourceUrl(`/anime/${animeId}/${episodeNumber}`) : null
  };
};

export const rewriteM3u8 = (content, baseUrl, proxyPrefix = '/api/v1/stream/proxy?url=') => {
  const lines = String(content || '').split(/\r?\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#EXT-X-KEY:')) {
      return line.replace(/URI="([^"]+)"/, (_, uri) => {
        const absolute = new URL(uri, baseUrl).toString();
        return `URI="${proxyPrefix}${encodeURIComponent(absolute)}"`;
      });
    }

    if (trimmed.startsWith('#EXT-X-MEDIA:')) {
      return line.replace(/URI="([^"]+)"/, (_, uri) => {
        const absolute = new URL(uri, baseUrl).toString();
        return `URI="${proxyPrefix}${encodeURIComponent(absolute)}"`;
      });
    }

    if (trimmed.startsWith('#')) return line;

    const absolute = new URL(trimmed, baseUrl).toString();
    return `${proxyPrefix}${encodeURIComponent(absolute)}`;
  });

  return rewritten.join('\n');
};
