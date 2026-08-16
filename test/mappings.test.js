import assert from 'node:assert/strict';
import test from 'node:test';
import { MappingRegistry } from '../src/mappings.js';

test('MappingRegistry loads verified seed mappings and provides O(1) lookups', () => {
  const registry = new MappingRegistry();
  assert.ok(registry.size() > 0);

  // Test lookup by AniList ID
  const slimeS2P2 = registry.getByAnilistId(116742);
  assert.ok(slimeS2P2);
  assert.equal(slimeS2P2.anizoneSlug, 'smntcyyv');
  assert.equal(slimeS2P2.verified, true);

  // Test reverse lookup by AniZone slug
  const reverse = registry.getByAnizoneSlug('smntcyyv');
  assert.ok(reverse);
  assert.equal(reverse.anilistId, 116742);
});

test('MappingRegistry supports dynamic registration and list retrieval', () => {
  const registry = new MappingRegistry();
  const registered = registry.set(999999, 'testslug', { title: 'Dynamic Anime', verified: false });
  assert.equal(registered.anilistId, 999999);
  assert.equal(registered.anizoneSlug, 'testslug');

  assert.equal(registry.getByAnilistId(999999)?.anizoneSlug, 'testslug');
  assert.equal(registry.getByAnizoneSlug('testslug')?.anilistId, 999999);
  assert.ok(registry.list().some(i => i.anilistId === 999999));
});
