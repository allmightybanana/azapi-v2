const numberFromEnv = (name, fallback, minimum = 1) => {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
};

export const config = Object.freeze({
  port: numberFromEnv('PORT', 3100),
  baseUrl: (process.env.ANIZONE_BASE_URL || 'https://anizone.to').replace(/\/$/, ''),
  requestTimeoutMs: numberFromEnv('REQUEST_TIMEOUT_MS', 25_000, 1000),
  cacheTtlMs: numberFromEnv('CACHE_TTL_MS', 300_000, 1000),
  cacheStaleMs: numberFromEnv('CACHE_STALE_MS', 3_600_000, 1000),
  rateLimitWindowMs: numberFromEnv('RATE_LIMIT_WINDOW_MS', 60_000, 1000),
  rateLimitMax: numberFromEnv('RATE_LIMIT_MAX', 90),
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 AniAtlas/1.0',
  proxyUrl: process.env.ANIZONE_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || null
});
