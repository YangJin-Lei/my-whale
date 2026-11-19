import fs from 'node:fs'
import path from 'node:path'

const SEARCH_TTL_MS = 20 * 60 * 1000
const FETCH_TTL_MS = 60 * 60 * 1000
const MAX_ENTRIES = 300

export class CacheStore {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.jsonPath = path.join(dataDir, 'cache.json')
    this.db = null
    this.state = {
      search: {},
      fetch: {},
      sessions: {},
      stats: {
        searchHits: 0,
        fetchHits: 0,
        prefixReadTokens: 0,
        prefixCreateTokens: 0,
        upstreamCalls: 0,
      },
    }
    this.initPromise = this.init()
  }

  async init() {
    fs.mkdirSync(this.dataDir, { recursive: true })
    try {
      const sqlite = await import('node:sqlite')
      if (sqlite?.DatabaseSync) {
        const db = new sqlite.DatabaseSync(path.join(this.dataDir, 'cache.db'))
        db.exec(`
          CREATE TABLE IF NOT EXISTS kv_cache (
            namespace TEXT NOT NULL,
            cache_key TEXT NOT NULL,
            payload TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (namespace, cache_key)
          );
          CREATE TABLE IF NOT EXISTS chat_sessions (
            session_id TEXT PRIMARY KEY NOT NULL,
            messages_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
          );
        `)
        this.db = db
        return
      }
    } catch {
      // Fallback gracefully to atomic JSON persistence
    }

    try {
      if (fs.existsSync(this.jsonPath)) {
        const raw = JSON.parse(fs.readFileSync(this.jsonPath, 'utf8'))
        if (raw && typeof raw === 'object') {
          this.state = {
            search: raw.search || {},
            fetch: raw.fetch || {},
            sessions: raw.sessions || {},
            stats: { ...this.state.stats, ...(raw.stats || {}) },
          }
        }
      }
    } catch {
      // Ignore corrupt cache file and start clean
    }
  }

  flushJson() {
    if (this.db) {
      return
    }
    try {
      const tmp = `${this.jsonPath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.state), 'utf8')
      fs.renameSync(tmp, this.jsonPath)
    } catch {
      // Non-fatal persistence error
    }
  }

  async getSearch(key) {
    await this.initPromise
    const now = Date.now()
    if (this.db) {
      const row = this.db
        .prepare('SELECT payload, expires_at FROM kv_cache WHERE namespace = ? AND cache_key = ?')
        .get('search', key)
      if (!row || Number(row.expires_at) <= now) {
        return null
      }
      this.state.stats.searchHits += 1
      return JSON.parse(row.payload)
    }
    const entry = this.state.search[key]
    if (!entry || entry.expiresAt <= now) {
      return null
    }
    this.state.stats.searchHits += 1
    return entry.payload
  }

  async setSearch(key, payload) {
    await this.initPromise
    const now = Date.now()
    const expiresAt = now + SEARCH_TTL_MS
    if (this.db) {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO kv_cache (namespace, cache_key, payload, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run('search', key, JSON.stringify(payload), expiresAt, now)
      return
    }
    this.state.search[key] = { payload, expiresAt, updatedAt: now }
    this.pruneMap(this.state.search)
    this.flushJson()
  }

  async getFetch(url) {
    await this.initPromise
    const now = Date.now()
    if (this.db) {
      const row = this.db
        .prepare('SELECT payload, expires_at FROM kv_cache WHERE namespace = ? AND cache_key = ?')
        .get('fetch', url)
      if (!row || Number(row.expires_at) <= now) {
        return null
      }
      this.state.stats.fetchHits += 1
      return JSON.parse(row.payload)
    }
    const entry = this.state.fetch[url]
    if (!entry || entry.expiresAt <= now) {
      return null
    }
    this.state.stats.fetchHits += 1
    return entry.payload
  }

  async setFetch(url, payload) {
    await this.initPromise
    const now = Date.now()
    const expiresAt = now + FETCH_TTL_MS
    if (this.db) {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO kv_cache (namespace, cache_key, payload, expires_at, updated_at) VALUES (?, ?, ?, ?, ?)'
        )
        .run('fetch', url, JSON.stringify(payload), expiresAt, now)
      return
    }
    this.state.fetch[url] = { payload, expiresAt, updatedAt: now }
    this.pruneMap(this.state.fetch)
    this.flushJson()
  }

  async recordSessionTurn(sessionId, messages) {
    await this.initPromise
    if (!sessionId) {
      return
    }
    const now = Date.now()
    if (this.db) {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO chat_sessions (session_id, messages_json, updated_at) VALUES (?, ?, ?)'
        )
        .run(sessionId, JSON.stringify(messages), now)
      return
    }
    this.state.sessions[sessionId] = { messages, updatedAt: now }
    this.flushJson()
  }

  recordUsage(usage) {
    this.state.stats.upstreamCalls += 1
    if (usage && typeof usage === 'object') {
      if (typeof usage.cache_read_input_tokens === 'number') {
        this.state.stats.prefixReadTokens += usage.cache_read_input_tokens
      }
      if (typeof usage.cache_creation_input_tokens === 'number') {
        this.state.stats.prefixCreateTokens += usage.cache_creation_input_tokens
      }
    }
  }

  async getStats() {
    await this.initPromise
    let searchCached = Object.keys(this.state.search).length
    let fetchCached = Object.keys(this.state.fetch).length
    if (this.db) {
      const s = this.db
        .prepare("SELECT COUNT(*) as c FROM kv_cache WHERE namespace = 'search'")
        .get()
      const f = this.db
        .prepare("SELECT COUNT(*) as c FROM kv_cache WHERE namespace = 'fetch'")
        .get()
      searchCached = Number(s?.c || 0)
      fetchCached = Number(f?.c || 0)
    }
    return {
      searchCached,
      fetchCached,
      ...this.state.stats,
    }
  }

  async clear() {
    await this.initPromise
    if (this.db) {
      this.db.exec('DELETE FROM kv_cache; DELETE FROM chat_sessions;')
    }
    this.state.search = {}
    this.state.fetch = {}
    this.state.sessions = {}
    this.state.stats = {
      searchHits: 0,
      fetchHits: 0,
      prefixReadTokens: 0,
      prefixCreateTokens: 0,
      upstreamCalls: 0,
    }
    this.flushJson()
  }

  pruneMap(mapObj) {
    const keys = Object.keys(mapObj)
    if (keys.length <= MAX_ENTRIES) {
      return
    }
    keys
      .sort((a, b) => (mapObj[a]?.updatedAt || 0) - (mapObj[b]?.updatedAt || 0))
      .slice(0, keys.length - MAX_ENTRIES)
      .forEach((k) => {
        delete mapObj[k]
      })
  }
}
