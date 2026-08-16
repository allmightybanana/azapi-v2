import assert from 'node:assert/strict';
import test from 'node:test';
import { getOutboundDispatcher, maskProxyUrl } from '../src/proxy.js';

test('maskProxyUrl masks passwords safely in proxy URLs', () => {
  assert.equal(maskProxyUrl(null), null);
  assert.equal(maskProxyUrl(''), null);
  assert.equal(maskProxyUrl('http://103.173.178.124:4785'), 'http://103.173.178.124:4785/');
  assert.equal(
    maskProxyUrl('http://dainsleif:Sexybanana28@103.173.178.124:4785'),
    'http://dainsleif:******@103.173.178.124:4785/'
  );
});

test('getOutboundDispatcher returns valid ProxyAgent when proxyUrl is supplied', () => {
  const agent = getOutboundDispatcher('http://dainsleif:Sexybanana28@103.173.178.124:4785');
  assert.ok(agent);
  assert.equal(typeof agent.dispatch, 'function');
});
