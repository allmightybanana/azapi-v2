import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MAPPINGS_FILE = path.resolve(__dirname, '../data/mappings.json');

export class MappingRegistry {
  constructor(filePath = DEFAULT_MAPPINGS_FILE) {
    this.filePath = filePath;
    this.byAnilistId = new Map();
    this.byAnizoneSlug = new Map();
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.mappings)) {
          for (const item of data.mappings) {
            if (item.anilistId && item.anizoneSlug) {
              const entry = {
                anilistId: Number(item.anilistId),
                anizoneSlug: String(item.anizoneSlug).trim(),
                title: item.title || null,
                season: item.season || null,
                part: item.part || null,
                verified: Boolean(item.verified),
                updatedAt: item.updatedAt || new Date().toISOString()
              };
              this.byAnilistId.set(entry.anilistId, entry);
              this.byAnizoneSlug.set(entry.anizoneSlug, entry);
            }
          }
        }
      }
    } catch {
      // Graceful fallback to in-memory registry
    }
  }

  getByAnilistId(id) {
    const num = Number.parseInt(id, 10);
    if (!Number.isFinite(num)) return null;
    return this.byAnilistId.get(num) || null;
  }

  getByAnizoneSlug(slug) {
    if (!slug) return null;
    return this.byAnizoneSlug.get(String(slug).trim()) || null;
  }

  set(anilistId, anizoneSlug, metadata = {}) {
    const id = Number.parseInt(anilistId, 10);
    const slug = String(anizoneSlug || '').trim();
    if (!Number.isFinite(id) || !slug) return null;

    const entry = {
      anilistId: id,
      anizoneSlug: slug,
      title: metadata.title || null,
      season: metadata.season || null,
      part: metadata.part || null,
      verified: Boolean(metadata.verified),
      confidence: metadata.confidence || 'high',
      matchScore: metadata.matchScore || 100,
      updatedAt: new Date().toISOString()
    };

    this.byAnilistId.set(id, entry);
    this.byAnizoneSlug.set(slug, entry);
    return entry;
  }

  list() {
    return Array.from(this.byAnilistId.values());
  }

  size() {
    return this.byAnilistId.size;
  }
}

export const defaultMappingRegistry = new MappingRegistry();
