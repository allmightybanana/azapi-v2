import assert from 'node:assert/strict';
import test from 'node:test';
import { extractEmbeddedJson, parseAnimeDetail, parseCatalog, parseEpisodeStream, parseHome, rewriteM3u8 } from '../src/parsers.js';

test('extractEmbeddedJson decodes AniZone unicode-escaped JSON safely', () => {
  const source = String.raw`items: JSON.parse('[{\u0022slug\u0022:\u0022abc12345\u0022,\u0022main_title\u0022:\u0022Oshi no Ko\u0022}]')`;
  assert.deepEqual(extractEmbeddedJson(source, 'items'), [{ slug: 'abc12345', main_title: 'Oshi no Ko' }]);
});

test('parseCatalog normalizes source records and cursor state', () => {
  const records = JSON.stringify([{
    slug: 'abc12345', url: 'http://anizone.to/anime/abc12345', cover: 'https://anizone.to/cover.jpg',
    main_title: 'Main Title', title_list: { 1: 'English Title' }, type: 'TV Series', is_ongoing: true,
    is_unsafe: false, start_year: 2026, episode_count: 12, tags: [{ slug: 'tag12345', name: 'Action', url: 'http://anizone.to/tag/tag12345' }]
  }]).replaceAll('"', '\\u0022').replaceAll('/', '\\/');
  const html = `<main x-data="{ items: JSON.parse('${records}'), nextCursor: 'next_123', hasMore: true }"></main>`;
  const result = parseCatalog(html);
  assert.equal(result.items[0].id, 'abc12345');
  assert.equal(result.items[0].preferredTitle, 'English Title');
  assert.equal(result.items[0].sourceUrl, 'https://anizone.to/anime/abc12345');
  assert.equal(result.items[0].status, 'Ongoing');
  assert.equal(result.nextCursor, 'next_123');
  assert.equal(result.hasMore, true);
});

test('parseHome separates latest titles, episodes, and tags', () => {
  const titles = JSON.stringify({ 1: 'Hero Name' }).replaceAll('"', '\\u0022');
  const episodeTitles = JSON.stringify({ 1: 'First Light' }).replaceAll('"', '\\u0022');
  const html = `
    <main>
      <div><h2>Latest Anime</h2><div x-data="{ anmTitles: JSON.parse('${titles}'), get displayAnimeTitle() { return window.getTitle(this.anmTitles, 'Fallback'); } }"><a href="https://anizone.to/anime/abc12345"><img src="https://anizone.to/cover.jpg"></a><a href="https://anizone.to/anime/abc12345"><span></span></a></div></div>
      <div><h2>Latest Episodes</h2><ul><li x-data="{ isUnsafe: false, epsTitles: JSON.parse('${episodeTitles}') }"><a href="https://anizone.to/anime/abc12345/1"><img src="https://anizone.to/snap.jpg"><h3>Episode 1</h3><span>2026-08-16</span></a><a href="https://anizone.to/anime/abc12345">Hero Name</a></li></ul></div>
      <div><h2>Top Tags</h2><ul><li><a href="https://anizone.to/tag/tag12345" title="Action"><img src="https://anizone.to/tag.jpg">Action (42)</a></li></ul></div>
    </main>`;
  const result = parseHome(html);
  assert.equal(result.latestAnime[0].title, 'Hero Name');
  assert.equal(result.latestEpisodes[0].title, 'First Light');
  assert.equal(result.topTags[0].animeCount, 42);
});

test('parseAnimeDetail returns metadata without exposing media sources', () => {
  const titles = JSON.stringify({ 1: 'English Title', 5: 'Main Title' }).replaceAll('"', '\\u0022');
  const html = `
    <title>Main Title — AniZone</title><main>
      <div x-data="{ isUnsafe: false, anmTitles: JSON.parse('${titles}') }">
        <img src="https://anizone.to/images/anime/banner.jpg"><img src="https://anizone.to/images/anime/cover.jpg">
        <div><h1></h1><div>TV Series Completed 12 Episodes 2024 <a aria-label="Official Site" href="https://example.com">Official Site</a></div></div>
        <div><h3>Synopsis</h3><div>A concise synopsis.</div></div>
        <a href="https://anizone.to/tag/tag12345">Action</a>
        <ul><li x-data="{ isUnsafe: false, epsTitles: JSON.parse('{\\u00221\\u0022:\\u0022Pilot\\u0022}') }"><a href="https://anizone.to/anime/abc12345/1"><h3>Episode 1</h3></a></li></ul>
      </div>
    </main>`;
  const result = parseAnimeDetail(html);
  assert.equal(result.id, 'abc12345');
  assert.equal(result.preferredTitle, 'English Title');
  assert.equal(result.episodeCount, 12);
  assert.equal(result.episodes[0].title, 'Pilot');
  assert.equal('stream' in result.episodes[0], false);
});

test('parseEpisodeStream extracts HLS source, tracks, and available servers', () => {
  const playerPayload = JSON.stringify({
    src: 'https://suzaku.xin-cdn.xyz/214acf5d-6e4d-49d1-9fd8-1ba4ef9016b4/master.m3u8',
    storage: 'v-214acf5d-6e4d-49d1-9fd8-1ba4ef9016b4',
    snapshot: 'https://suzaku.xin-cdn.xyz/214acf5d-6e4d-49d1-9fd8-1ba4ef9016b4/snapshot.webp',
    storyboard: 'https://suzaku.xin-cdn.xyz/214acf5d-6e4d-49d1-9fd8-1ba4ef9016b4/storyboard.vtt',
    chapter: 'https://suzaku.xin-cdn.xyz/214acf5d-6e4d-49d1-9fd8-1ba4ef9016b4/chapters.vtt',
    subtitles: [
      { title: 'English', format: 'ass', language: 'en', default: true, forced: 'no', file: 'https://suzaku.xin-cdn.xyz/.../0_en.ass' }
    ],
    fonts: ['https://anizone.to/fonts/font1.woff2']
  }).replaceAll('"', '\\u0022').replaceAll('/', '\\/');

  const snap = JSON.stringify({
    data: { anime_slug: 'abc12345', episode_slug: '1', videoKey: 0 }
  }).replaceAll('"', '&quot;');

  const html = `
    <title>Episode 1 - Pilot Title — AniZone</title>
    <main wire:snapshot="${snap}">
      <a href="https://anizone.to/anime/abc12345">Show Name</a>
      <div x-data="vidstackPlayer(JSON.parse('${playerPayload}'))"></div>
      <button wire:click="setVideo(0)">Gecko Source: Web Duration: 24:00 Audio: Japanese Softsub: English</button>
      <button wire:click="setVideo(1)">VARYG Source: Web Duration: 24:00 Audio: English Softsub: English</button>
    </main>`;

  const result = parseEpisodeStream(html);
  assert.equal(result.id, 'abc12345-1');
  assert.equal(result.animeId, 'abc12345');
  assert.equal(result.episodeNumber, '1');
  assert.equal(result.title, 'Pilot Title');
  assert.equal(result.hls.url, 'https://suzaku.xin-cdn.xyz/214acf5d-6e4d-49d1-9fd8-1ba4ef9016b4/master.m3u8');
  assert.equal(result.hls.subtitles[0].language, 'en');
  assert.equal(result.hls.subtitles[0].default, true);
  assert.equal(result.hls.fonts[0], 'https://anizone.to/fonts/font1.woff2');
  assert.equal(result.servers.length, 2);
  assert.equal(result.servers[0].name, 'Gecko');
  assert.equal(result.servers[1].name, 'VARYG');
});

test('rewriteM3u8 updates relative playlist URIs and encryption keys', () => {
  const master = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=909543\nvideo/360/playlist.m3u8`;
  const rewritten = rewriteM3u8(master, 'https://example.com/stream/master.m3u8', '/api/proxy?url=');
  assert.ok(rewritten.includes('/api/proxy?url=https%3A%2F%2Fexample.com%2Fstream%2Fvideo%2F360%2Fplaylist.m3u8'));
});
