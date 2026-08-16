import { config } from './config.js';
import { AppError } from './errors.js';
import { getOutboundDispatcher } from './proxy.js';

const readCookies = (headers) => {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);

  return values
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
};

export class AniZoneClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || config.baseUrl;
    this.timeoutMs = options.timeoutMs || config.requestTimeoutMs;
    this.userAgent = options.userAgent || config.userAgent;
    this.proxyUrl = options.proxyUrl || config.proxyUrl;
  }

  buildUrl(pathname, search = {}) {
    if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) {
      throw new AppError('Invalid upstream path.', 400, 'INVALID_PATH');
    }

    const url = new URL(pathname, `${this.baseUrl}/`);
    if (url.origin !== new URL(this.baseUrl).origin) {
      throw new AppError('Upstream host is not allowed.', 400, 'INVALID_UPSTREAM');
    }

    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  async get(pathname, search = {}, options = {}) {
    const url = this.buildUrl(pathname, search);
    const response = await this.#request(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': this.userAgent
      }
    }, options.timeoutMs);

    return {
      html: await response.text(),
      url: response.url,
      cookies: readCookies(response.headers)
    };
  }

  async loadCatalogPage({ csrfToken, cookies, referer, snapshot, cursor }) {
    const url = this.buildUrl('/livewire/update');
    const response = await this.#request(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: cookies,
        referer,
        'user-agent': this.userAgent,
        'x-livewire': ''
      },
      body: JSON.stringify({
        _token: csrfToken,
        components: [{
          snapshot,
          updates: {},
          calls: [{ path: '', method: 'loadPage', params: [cursor] }]
        }]
      })
    }, this.timeoutMs);

    try {
      return await response.json();
    } catch {
      throw new AppError('AniZone returned an invalid pagination response.', 502, 'UPSTREAM_INVALID_RESPONSE');
    }
  }

  async switchEpisodeVideo({ csrfToken, cookies, referer, snapshot, videoKey }) {
    const url = this.buildUrl('/livewire/update');
    const response = await this.#request(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        cookie: cookies,
        referer,
        'user-agent': this.userAgent,
        'x-livewire': ''
      },
      body: JSON.stringify({
        _token: csrfToken,
        components: [{
          snapshot,
          updates: {},
          calls: [{ path: '', method: 'setVideo', params: [videoKey] }]
        }]
      })
    }, this.timeoutMs);

    try {
      return await response.json();
    } catch {
      throw new AppError('AniZone returned an invalid video response.', 502, 'UPSTREAM_INVALID_RESPONSE');
    }
  }

  async #request(url, options, timeoutMs = this.timeoutMs) {
    let response;
    const dispatcher = getOutboundDispatcher(this.proxyUrl);
    try {
      response = await fetch(url, {
        ...options,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        ...(dispatcher ? { dispatcher } : {})
      });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError';
      throw new AppError(
        timedOut ? 'AniZone did not respond in time.' : 'AniZone is currently unreachable.',
        502,
        timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE'
      );
    }

    if (response.status === 404) {
      throw new AppError('The requested anime was not found.', 404, 'NOT_FOUND');
    }
    if (!response.ok) {
      throw new AppError(
        `AniZone returned HTTP ${response.status}.`,
        502,
        'UPSTREAM_ERROR',
        { upstreamStatus: response.status }
      );
    }
    return response;
  }
}
