import { createApp } from '../src/app.js';

const server = createApp().listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
  let sampleEpisode = null;
  for (const path of ['/', '/api/v1/home', '/api/v1/anime', '/api/v1/tags', '/api/v1/openapi.json']) {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    console.log(`PASS ${response.status} ${path} (${response.headers.get('content-type')})`);
    if (path === '/api/v1/home') {
      const homeData = await response.json();
      sampleEpisode = homeData.data?.latestEpisodes?.[0];
    }
  }

  if (sampleEpisode) {
    const streamPath = `/api/v1/anime/${sampleEpisode.animeId}/episodes/${sampleEpisode.number}/stream`;
    const streamRes = await fetch(`${baseUrl}${streamPath}`, { signal: AbortSignal.timeout(45_000) });
    if (!streamRes.ok) throw new Error(`${streamPath} returned HTTP ${streamRes.status}`);
    const streamJson = await streamRes.json();
    if (!streamJson.data?.hls?.url) throw new Error('Stream response missing HLS URL');
    console.log(`PASS ${streamRes.status} ${streamPath} (HLS: ${streamJson.data.hls.url.slice(0, 40)}...)`);
  }

  // Verify AniList ID lookup and scoring
  const anilistPath = '/api/v1/anime/anilist/150672';
  const anilistRes = await fetch(`${baseUrl}${anilistPath}`, { signal: AbortSignal.timeout(45_000) });
  if (!anilistRes.ok) throw new Error(`${anilistPath} returned HTTP ${anilistRes.status}`);
  const anilistJson = await anilistRes.json();
  if (anilistJson.data?.anilistId !== 150672) throw new Error('AniList lookup ID mismatch');
  console.log(`PASS ${anilistRes.status} ${anilistPath} (Matched: "${anilistJson.data.title}", Score: ${anilistJson.data.anilist?.matchScore}%)`);

  console.log('AniAtlas verification passed.');
} finally {
  server.close();
}
