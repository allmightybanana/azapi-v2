import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { AnimeService } from './service.js';
import { asyncRoute } from './errors.js';
import { openApiDocument } from './openapi.js';
import { rewriteM3u8 } from './parsers.js';
import { getOutboundDispatcher, maskProxyUrl } from './proxy.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const createRateLimit = () => {
  const clients = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    const current = clients.get(key);
    const entry = !current || now >= current.resetAt
      ? { count: 0, resetAt: now + config.rateLimitWindowMs }
      : current;
    entry.count += 1;
    clients.set(key, entry);

    res.set('RateLimit-Limit', String(config.rateLimitMax));
    res.set('RateLimit-Remaining', String(Math.max(0, config.rateLimitMax - entry.count)));
    res.set('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > config.rateLimitMax) {
      return res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' } });
    }
    if (clients.size > 10_000) {
      for (const [client, value] of clients) if (now >= value.resetAt) clients.delete(client);
    }
    next();
  };
};

const includeUnsafe = (query) => query.includeUnsafe === 'true';

const sendData = (res, result, startedAt) => {
  res.set('X-Cache', result.cache);
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=240');
  res.json({
    success: true,
    data: result.data,
    meta: {
      cache: result.cache,
      cacheAgeMs: result.age,
      responseTimeMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString()
    }
  });
};

export const createApp = ({ service = new AnimeService() } = {}) => {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://anizone.to', 'https://*.vid-cdn.xyz', 'https://*.xin-cdn.xyz'],
        mediaSrc: ["'self'", 'blob:', 'data:', 'https://anizone.to', 'https://*.vid-cdn.xyz', 'https://*.xin-cdn.xyz'],
        connectSrc: ["'self'", 'https://anizone.to', 'https://*.vid-cdn.xyz', 'https://*.xin-cdn.xyz'],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    }
  }));
  app.use(cors({ origin: true, methods: ['GET', 'OPTIONS'], maxAge: 86400 }));
  app.use(compression());
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    req.id = crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    next();
  });
  app.use('/api', createRateLimit());

  const handleStream = async (req, res, animeId, episodeNumber) => {
    const startedAt = Date.now();
    const result = await service.stream(animeId, episodeNumber, {
      server: req.query.server ?? req.query.video,
      includeUnsafe: includeUnsafe(req.query)
    });
    if (result.data?.hls) {
      const hls = result.data.hls;
      if (hls.url) {
        hls.proxyUrl = `/api/v1/stream/proxy?url=${encodeURIComponent(hls.url)}`;
      }
      if (Array.isArray(hls.subtitles)) {
        hls.subtitles = hls.subtitles.map((sub) => ({
          ...sub,
          proxyFile: sub.file ? `/api/v1/stream/proxy?url=${encodeURIComponent(sub.file)}` : null
        }));
      }
      if (Array.isArray(hls.fonts)) {
        hls.proxyFonts = hls.fonts.map((f) => `/api/v1/stream/proxy?url=${encodeURIComponent(f)}`);
      }
      if (hls.storyboard) {
        hls.proxyStoryboard = `/api/v1/stream/proxy?url=${encodeURIComponent(hls.storyboard)}`;
      }
      if (hls.chapters) {
        hls.proxyChapters = `/api/v1/stream/proxy?url=${encodeURIComponent(hls.chapters)}`;
      }
      if (hls.snapshot) {
        hls.proxySnapshot = `/api/v1/stream/proxy?url=${encodeURIComponent(hls.snapshot)}`;
      }
    }
    sendData(res, result, startedAt);
  };

  app.get('/api/v1/health', asyncRoute(async (_req, res) => {
    const startedAt = Date.now();
    try {
      const result = await service.home();
      res.json({
        success: true,
        data: {
          status: 'healthy',
          upstream: 'reachable',
          cache: result.cache,
          proxy: {
            enabled: Boolean(config.proxyUrl),
            url: maskProxyUrl(config.proxyUrl)
          },
          ...service.stats()
        },
        meta: { responseTimeMs: Date.now() - startedAt }
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        data: {
          status: 'degraded',
          upstream: 'unreachable',
          proxy: {
            enabled: Boolean(config.proxyUrl),
            url: maskProxyUrl(config.proxyUrl)
          }
        },
        error: { code: error.code || 'UPSTREAM_UNAVAILABLE', message: error.message }
      });
    }
  }));

  app.get('/api/v1/home', asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    sendData(res, await service.home({ includeUnsafe: includeUnsafe(req.query) }), startedAt);
  }));

  app.get('/api/v1/anime', asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    sendData(res, await service.catalog(req.query), startedAt);
  }));

  const handleAnilistStream = async (req, res, anilistId, episode) => {
    const animeResult = await service.animeByAnilistId(anilistId, { includeUnsafe: includeUnsafe(req.query) });
    const anime = animeResult.data || animeResult;
    await handleStream(req, res, anime.id, episode);
  };

  // Direct AniList ID lookup routes
  app.get(['/api/v1/anime/anilist/:anilistId', '/api/v1/anilist/:anilistId'], asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    sendData(res, await service.animeByAnilistId(req.params.anilistId, { includeUnsafe: includeUnsafe(req.query) }), startedAt);
  }));

  // Direct AniList ID stream routes (supports all common route formats)
  app.get([
    '/api/v1/anime/anilist/:anilistId/stream/:episode',
    '/api/v1/anime/anilist/:anilistId/episodes/:episode/stream',
    '/api/v1/stream/anilist/:anilistId/:episode',
    '/api/v1/anilist/:anilistId/stream/:episode',
    '/api/v1/anilist/:anilistId/episodes/:episode/stream'
  ], asyncRoute(async (req, res) => {
    await handleAnilistStream(req, res, req.params.anilistId, req.params.episode);
  }));

  app.get('/api/v1/anime/:id', asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    sendData(res, await service.anime(req.params.id, { includeUnsafe: includeUnsafe(req.query) }), startedAt);
  }));

  app.get('/api/v1/anime/:id/episodes/:episode/stream', asyncRoute(async (req, res) => {
    await handleStream(req, res, req.params.id, req.params.episode);
  }));

  app.get('/api/v1/anime/:id/episodes/:episode/hls/master.m3u8', asyncRoute(async (req, res) => {
    const result = await service.stream(req.params.id, req.params.episode, {
      server: req.query.server ?? req.query.video,
      includeUnsafe: includeUnsafe(req.query)
    });
    const masterUrl = result.data?.hls?.url;
    if (!masterUrl) {
      return res.status(404).json({ success: false, error: { code: 'STREAM_NOT_FOUND', message: 'HLS stream not available.' } });
    }
    const response = await fetch(masterUrl, {
      headers: { 'user-agent': config.userAgent, referer: `${config.baseUrl}/` },
      signal: AbortSignal.timeout(config.requestTimeoutMs)
    });
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: { code: 'UPSTREAM_ERROR', message: `Upstream returned HTTP ${response.status}.` } });
    }
    const text = await response.text();
    const rewritten = rewriteM3u8(text, masterUrl, '/api/v1/stream/proxy?url=');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', 'application/vnd.apple.mpegurl');
    res.set('Cache-Control', 'public, max-age=60');
    res.send(rewritten);
  }));

  app.get('/api/v1/stream/:id/:episode', asyncRoute(async (req, res) => {
    await handleStream(req, res, req.params.id, req.params.episode);
  }));

  app.get('/api/v1/episodes/:id/stream', asyncRoute(async (req, res) => {
    const id = req.params.id;
    const lastDash = id.lastIndexOf('-');
    let animeId = id;
    let episode = req.query.episode || req.query.ep || '1';
    if (lastDash > 0) {
      animeId = id.slice(0, lastDash);
      episode = id.slice(lastDash + 1);
    }
    await handleStream(req, res, animeId, episode);
  }));

  app.get('/api/v1/episodes', asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    sendData(res, await service.episodes(req.query), startedAt);
  }));

  app.get('/api/v1/tags', asyncRoute(async (req, res) => {
    const startedAt = Date.now();
    sendData(res, await service.tags(req.query), startedAt);
  }));

  app.get('/api/v1/mappings', asyncRoute(async (_req, res) => {
    const startedAt = Date.now();
    const data = service.mappings ? service.mappings() : { items: [], total: 0 };
    res.json({
      success: true,
      data,
      meta: {
        cache: 'hit',
        responseTimeMs: Date.now() - startedAt,
        generatedAt: new Date().toISOString()
      }
    });
  }));

  app.get('/api/v1/stream/proxy', asyncRoute(async (req, res) => {
    const rawUrl = req.query.url;
    if (!rawUrl || typeof rawUrl !== 'string') {
      return res.status(400).json({ success: false, error: { code: 'INVALID_QUERY', message: 'Target URL query parameter is required.' } });
    }

    let targetUrl;
    try {
      targetUrl = new URL(rawUrl);
    } catch {
      return res.status(400).json({ success: false, error: { code: 'INVALID_URL', message: 'Target URL is invalid.' } });
    }

    const allowed = targetUrl.hostname.endsWith('xin-cdn.xyz') ||
      targetUrl.hostname.endsWith('vid-cdn.xyz') ||
      targetUrl.hostname === 'anizone.to' ||
      targetUrl.hostname.endsWith('.anizone.to');

    if (!allowed || !['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(403).json({ success: false, error: { code: 'UPSTREAM_FORBIDDEN', message: 'Target host is not allowed.' } });
    }

    const dispatcher = getOutboundDispatcher();
    const upstreamRes = await fetch(targetUrl.toString(), {
      headers: {
        'user-agent': config.userAgent,
        referer: `${config.baseUrl}/`
      },
      signal: AbortSignal.timeout(config.requestTimeoutMs),
      ...(dispatcher ? { dispatcher } : {})
    });

    if (!upstreamRes.ok) {
      return res.status(upstreamRes.status).json({
        success: false,
        error: { code: 'UPSTREAM_ERROR', message: `Upstream media server returned HTTP ${upstreamRes.status}.` }
      });
    }

    let contentType = upstreamRes.headers.get('content-type') || 'application/octet-stream';
    const pathname = targetUrl.pathname.toLowerCase();
    if (pathname.endsWith('.ass') || pathname.endsWith('.ssa')) {
      contentType = 'text/x-ssa; charset=utf-8';
    } else if (pathname.endsWith('.vtt')) {
      contentType = 'text/vtt; charset=utf-8';
    } else if (pathname.endsWith('.srt')) {
      contentType = 'text/plain; charset=utf-8';
    } else if (pathname.endsWith('.woff2')) {
      contentType = 'font/woff2';
    } else if (pathname.endsWith('.ttf')) {
      contentType = 'font/ttf';
    }

    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');

    const isPlaylist = contentType.includes('mpegurl') || contentType.includes('m3u8') || pathname.endsWith('.m3u8');
    if (isPlaylist) {
      const text = await upstreamRes.text();
      const rewritten = rewriteM3u8(text, targetUrl.toString(), '/api/v1/stream/proxy?url=');
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'public, max-age=60');
      return res.send(rewritten);
    }

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    const buffer = Buffer.from(await upstreamRes.arrayBuffer());
    return res.send(buffer);
  }));

  app.get('/api/v1/openapi.json', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(openApiDocument);
  });

  app.use(express.static(publicDir, { extensions: ['html'], maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));

  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: `No API route matches ${req.method} ${req.originalUrl}.` } });
  });

  app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

  app.use((error, req, res, _next) => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(`[${req.id}]`, error);
    res.status(status).json({
      success: false,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: status >= 500 && !error.code ? 'Something went wrong.' : error.message,
        ...(error.details ? { details: error.details } : {})
      },
      meta: { requestId: req.id }
    });
  });

  return app;
};
