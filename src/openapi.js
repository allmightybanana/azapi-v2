export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'AniAtlas Metadata & Stream API',
    version: '1.1.0',
    description: 'Public AniZone catalog metadata, episode index, and HLS streaming endpoints normalized as JSON.'
  },
  servers: [{ url: '/', description: 'Current server' }],
  tags: [
    { name: 'Discovery', description: 'Catalog and home discovery' },
    { name: 'Anime', description: 'Anime metadata and episode listings' },
    { name: 'Stream', description: 'HLS stream sources, subtitles, and playback' },
    { name: 'Taxonomy', description: 'AniZone tags' },
    { name: 'System', description: 'Service health and schema' }
  ],
  paths: {
    '/api/v1/health': {
      get: { tags: ['System'], summary: 'Check API and upstream health', responses: { 200: { description: 'Healthy' }, 503: { description: 'Upstream unavailable' } } }
    },
    '/api/v1/home': {
      get: { tags: ['Discovery'], summary: 'Get latest anime, latest episodes, and top tags', responses: { 200: { description: 'Home discovery data' } } }
    },
    '/api/v1/anime': {
      get: {
        tags: ['Discovery'],
        summary: 'Search and browse anime (supports AniList ID lookup)',
        parameters: [
          { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'anilistId', in: 'query', description: 'Look up AniZone anime matching this AniList ID', schema: { type: 'integer' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['title-asc', 'title-desc', 'release-asc', 'release-desc', 'added-asc', 'added-desc'], default: 'added-desc' } },
          { name: 'type', in: 'query', description: '0 all, 1 unknown, 2 TV, 3 OVA, 4 movie, 5 other, 6 web, 7 TV special, 8 music video', schema: { type: 'string', default: '0' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'includeUnsafe', in: 'query', schema: { type: 'boolean', default: false } }
        ],
        responses: { 200: { description: 'A cursor-paginated anime list with AniList match referencing' }, 400: { description: 'Invalid query' } }
      }
    },
    '/api/v1/anime/anilist/{anilistId}': {
      get: {
        tags: ['Anime'],
        summary: 'Get anime details resolved by AniList ID',
        parameters: [{ name: 'anilistId', in: 'path', required: true, description: 'AniList media ID', schema: { type: 'integer' } }],
        responses: { 200: { description: 'Anime details matched to the AniList ID' }, 404: { description: 'No match found' } }
      }
    },
    '/api/v1/anime/anilist/{anilistId}/stream/{episode}': {
      get: {
        tags: ['Stream'],
        summary: 'Get HLS stream metadata resolved directly by AniList ID and episode number',
        parameters: [
          { name: 'anilistId', in: 'path', required: true, description: 'AniList media ID', schema: { type: 'integer' } },
          { name: 'episode', in: 'path', required: true, description: 'Episode number', schema: { type: 'string' } },
          { name: 'server', in: 'query', schema: { type: 'integer', default: 0 } }
        ],
        responses: { 200: { description: 'HLS stream sources, subtitles, and server options' }, 404: { description: 'No match found' } }
      }
    },
    '/api/v1/anime/{id}': {
      get: {
        tags: ['Anime'], summary: 'Get anime details and episode metadata (includes AniList mapping)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'Anime details with AniList referencing' }, 404: { description: 'Anime not found' } }
      }
    },
    '/api/v1/anime/{id}/episodes/{episode}/stream': {
      get: {
        tags: ['Stream'],
        summary: 'Get HLS video stream, subtitles, fonts, and servers for an episode',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Anime ID / slug', schema: { type: 'string' } },
          { name: 'episode', in: 'path', required: true, description: 'Episode number', schema: { type: 'string' } },
          { name: 'server', in: 'query', description: 'Video server key index', schema: { type: 'integer', default: 0 } },
          { name: 'includeUnsafe', in: 'query', schema: { type: 'boolean', default: false } }
        ],
        responses: {
          200: { description: 'HLS stream sources, subtitles, and server options' },
          404: { description: 'Episode or stream not found' }
        }
      }
    },
    '/api/v1/stream/{id}/{episode}': {
      get: {
        tags: ['Stream'],
        summary: 'Convenience route for episode HLS stream details',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Anime ID / slug', schema: { type: 'string' } },
          { name: 'episode', in: 'path', required: true, description: 'Episode number', schema: { type: 'string' } },
          { name: 'server', in: 'query', description: 'Video server key index', schema: { type: 'integer', default: 0 } }
        ],
        responses: {
          200: { description: 'HLS stream sources, subtitles, and server options' }
        }
      }
    },
    '/api/v1/stream/proxy': {
      get: {
        tags: ['Stream'],
        summary: 'CORS proxy for HLS master playlists, media segments, and encryption keys',
        parameters: [
          { name: 'url', in: 'query', required: true, description: 'Absolute target media URL', schema: { type: 'string' } }
        ],
        responses: {
          200: { description: 'Rewritten HLS manifest or media stream with CORS enabled' }
        }
      }
    },
    '/api/v1/episodes': {
      get: { tags: ['Anime'], summary: 'Browse the public episode index', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Episode metadata' } } }
    },
    '/api/v1/tags': {
      get: { tags: ['Taxonomy'], summary: 'Browse AniZone tags', parameters: [{ name: 'search', in: 'query', schema: { type: 'string' } }], responses: { 200: { description: 'Tag metadata' } } }
    },
    '/api/v1/mappings': {
      get: { tags: ['System'], summary: 'List verified AniList ID to AniZone slug mappings', responses: { 200: { description: 'Verified mapping registry list' } } }
    },
    '/api/v1/openapi.json': {
      get: { tags: ['System'], summary: 'Download the OpenAPI schema', responses: { 200: { description: 'OpenAPI 3.1 document' } } }
    }
  }
};
