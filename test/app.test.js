import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';

const result = (data) => ({ data, cache: 'hit', age: 12 });

const fakeService = {
  home: async () => result({ latestAnime: [], latestEpisodes: [], topTags: [] }),
  catalog: async (query = {}) => result({ items: [{ id: 'test1234', title: 'Test Anime', anilistId: query.anilistId ? Number(query.anilistId) : null }], nextCursor: null, hasMore: false }),
  anime: async (id) => result({ id, title: 'Test Anime', anilistId: 150672, anilist: { id: 150672, matchScore: 100, confidence: 'high' }, episodes: [] }),
  animeByAnilistId: async (anilistId) => result({ id: 'test1234', title: 'Test Anime', anilistId: Number(anilistId), anilist: { id: Number(anilistId), matchScore: 100, confidence: 'high' }, episodes: [] }),
  episodes: async () => result({ items: [] }),
  tags: async () => result({ items: [] }),
  stream: async (animeId, episodeNumber) => result({
    id: `${animeId}-${episodeNumber}`,
    animeId,
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    anilistId: 150672,
    hls: { url: 'https://suzaku.xin-cdn.xyz/test/master.m3u8', subtitles: [] },
    servers: [{ key: 0, name: 'Gecko', isDefault: true }]
  }),
  stats: () => ({ cacheEntries: 1 })
};

test('API responds with a consistent envelope and security headers', async (t) => {
  const server = createApp({ service: fakeService }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/anime/test1234`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.id, 'test1234');
  assert.equal(payload.meta.cache, 'hit');
  assert.ok(response.headers.get('x-request-id'));
  assert.ok(response.headers.get('content-security-policy'));
});

test('stream endpoint returns HLS master and proxy information', async (t) => {
  const server = createApp({ service: fakeService }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/anime/test1234/episodes/1/stream`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data.id, 'test1234-1');
  assert.equal(payload.data.hls.url, 'https://suzaku.xin-cdn.xyz/test/master.m3u8');
  assert.ok(payload.data.hls.proxyUrl.includes('/api/v1/stream/proxy?url='));

  // Test alias
  const aliasResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/stream/test1234/1`);
  const aliasPayload = await aliasResponse.json();
  assert.equal(aliasResponse.status, 200);
  assert.equal(aliasPayload.data.id, 'test1234-1');
  assert.equal(aliasPayload.data.anilistId, 150672);
});

test('anime by AniList ID and stream by AniList ID endpoints respond correctly', async (t) => {
  const server = createApp({ service: fakeService }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));

  // Test GET /api/v1/anime/anilist/:anilistId and /api/v1/anilist/:anilistId
  const animeRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/anime/anilist/150672`);
  const animePayload = await animeRes.json();
  assert.equal(animeRes.status, 200);
  assert.equal(animePayload.success, true);
  assert.equal(animePayload.data.anilistId, 150672);
  assert.equal(animePayload.data.anilist.matchScore, 100);

  const shortAnimeRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/anilist/150672`);
  assert.equal(shortAnimeRes.status, 200);

  // Test GET /api/v1/anime/anilist/:anilistId/stream/:episode and aliases
  for (const path of [
    '/api/v1/anime/anilist/150672/stream/1',
    '/api/v1/anime/anilist/150672/episodes/1/stream',
    '/api/v1/stream/anilist/150672/1',
    '/api/v1/anilist/150672/stream/1'
  ]) {
    const streamRes = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    const streamPayload = await streamRes.json();
    assert.equal(streamRes.status, 200, `Expected 200 for ${path}`);
    assert.equal(streamPayload.success, true);
    assert.equal(streamPayload.data.id, 'test1234-1');
    assert.equal(streamPayload.data.anilistId, 150672);
  }

  // Test catalog search by anilistId
  const catalogRes = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/anime?anilistId=150672`);
  const catalogPayload = await catalogRes.json();
  assert.equal(catalogRes.status, 200);
  assert.equal(catalogPayload.data.items[0].anilistId, 150672);
});

test('unknown API routes return JSON 404 errors', async (t) => {
  const server = createApp({ service: fakeService }).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/nope`);
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.error.code, 'ROUTE_NOT_FOUND');
});
