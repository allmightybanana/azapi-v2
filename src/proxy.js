import { ProxyAgent } from 'undici';
import { config } from './config.js';

let cachedDispatcher = null;

export const maskProxyUrl = (proxyUrl) => {
  if (!proxyUrl) return null;
  try {
    const parsed = new URL(proxyUrl);
    if (parsed.password) parsed.password = '******';
    return parsed.toString();
  } catch {
    return 'invalid';
  }
};

export const getOutboundDispatcher = (proxyUrl = config.proxyUrl) => {
  if (!proxyUrl) return undefined;
  if (cachedDispatcher) return cachedDispatcher;

  try {
    cachedDispatcher = new ProxyAgent(proxyUrl);
    return cachedDispatcher;
  } catch (err) {
    console.error(`[Proxy] Failed to initialize ProxyAgent for "${maskProxyUrl(proxyUrl)}":`, err.message);
    return undefined;
  }
};

export const isProxyEnabled = () => Boolean(config.proxyUrl);
