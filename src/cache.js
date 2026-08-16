export class TtlCache {
  #entries = new Map();

  constructor({ ttlMs, staleMs, maxEntries = 250 }) {
    this.ttlMs = ttlMs;
    this.staleMs = Math.max(staleMs, ttlMs);
    this.maxEntries = maxEntries;
  }

  get(key, { allowStale = false } = {}) {
    const entry = this.#entries.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.createdAt;
    if (age > this.staleMs) {
      this.#entries.delete(key);
      return null;
    }
    if (!allowStale && age > this.ttlMs) return null;

    return {
      value: entry.value,
      age,
      stale: age > this.ttlMs
    };
  }

  set(key, value) {
    if (this.#entries.size >= this.maxEntries) {
      const oldest = this.#entries.keys().next().value;
      if (oldest) this.#entries.delete(oldest);
    }
    this.#entries.set(key, { value, createdAt: Date.now() });
    return value;
  }

  delete(key) {
    return this.#entries.delete(key);
  }

  clear() {
    this.#entries.clear();
  }

  get size() {
    return this.#entries.size;
  }
}
