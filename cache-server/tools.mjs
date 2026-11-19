import {
  extractWebContent,
  MAX_CONTENT_CHARS,
  MAX_DOWNLOAD_BYTES,
  stripTags,
} from './extractors.mjs'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[::1\])/i

function normalizeUrl(raw) {
  try {
    return encodeURI(decodeURI(raw))
  } catch {
    return encodeURI(raw)
  }
}

async function readLimitedBuffer(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length') || 0)
  if (contentLength > maxBytes) {
    throw new Error(`文件过大（${Math.round(contentLength / 1024)} KB），超出 ${Math.round(maxBytes / 1024)} KB 上限`)
  }
  if (!response.body) {
    return Buffer.alloc(0)
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      total += value.byteLength
      if (total > maxBytes) {
        throw new Error(`响应体超出 ${Math.round(maxBytes / 1024)} KB 上限`)
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

export async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 15_000
  const timer = setTimeout(() => controller.abort(new Error(`请求超时（${timeoutMs}ms）`)), timeoutMs)
  try {
    const response = await fetch(normalizeUrl(url), {
      method: options.method || 'GET',
      headers: options.headers,
      body: options.body,
      redirect: 'follow',
      signal: controller.signal,
    })
    const buffer = await readLimitedBuffer(response, options.maxBytes ?? MAX_DOWNLOAD_BYTES)
    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      contentType: response.headers.get('content-type') || '',
      buffer,
    }
  } finally {
    clearTimeout(timer)
  }
}

function decodeBingTrackingUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.hostname.endsWith('bing.com') && parsed.pathname.startsWith('/ck/')) {
      const u = parsed.searchParams.get('u') || ''
      const encoded = u.startsWith('a1') ? u.slice(2) : u
      if (encoded) {
        const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
        const decoded = Buffer.from(b64, 'base64').toString('utf8')
        if (decoded.startsWith('http://') || decoded.startsWith('https://')) {
          return decoded
        }
      }
    }
  } catch {
    // Keep original URL if unparseable
  }
  return rawUrl
}

function collectMatches(regex, input) {
  const matches = []
  let m
  while ((m = regex.exec(input)) !== null) {
    matches.push(m)
  }
  return matches
}

function parseBingHtml(html, limit = 8) {
  const blocks = collectMatches(/<li[^>]*class="[^"]*b_algo[^"]*"[^>]*>([\s\S]*?)<\/li>/gi, html)
  const results = []
  for (const block of blocks) {
    if (results.length >= limit) {
      break
    }
    const body = block[1] || ''
    const link = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(body)
    if (!link) {
      continue
    }
    const title = stripTags(link[2] || '')
    const url = decodeBingTrackingUrl(link[1] || '')
    if (!title || !url.startsWith('http')) {
      continue
    }
    const snippetMatch =
      /<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(body) ||
      /<div[^>]*class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i.exec(body)
    const snippet = snippetMatch ? stripTags(snippetMatch[1] || '') : ''
    results.push({ title, url, snippet, source: 'bing' })
  }
  return results
}

function extractDdgRealUrl(ddgUrl) {
  if (!ddgUrl.includes('uddg=')) {
    return ddgUrl
  }
  const normalized = ddgUrl.startsWith('//') ? `https:${ddgUrl}` : ddgUrl
  const match = /[?&]uddg=([^&]+)/.exec(normalized)
  if (!match) {
    return ddgUrl
  }
  try {
    return decodeURIComponent(match[1]) || ddgUrl
  } catch {
    return ddgUrl
  }
}

function parseDuckDuckGoHtml(html, limit = 8) {
  const links = collectMatches(
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    html
  )
  const snippets = collectMatches(
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi,
    html
  )
  const results = []
  for (let i = 0; i < links.length && results.length < limit; i += 1) {
    const title = stripTags(links[i][2] || '')
    const url = extractDdgRealUrl(links[i][1] || '')
    const snippet = i < snippets.length ? stripTags(snippets[i][1] || '') : ''
    if (title && url.startsWith('http')) {
      results.push({ title, url, snippet, source: 'duckduckgo' })
    }
  }
  return results
}

export async function runCachedSearch(cacheStore, query, limit = 6) {
  const cleanQuery = String(query || '').trim()
  if (!cleanQuery) {
    return { ok: false, query: '', results: [], cached: false, error: 'query 不能为空' }
  }
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 6))
  const cacheKey = `${cleanQuery.toLowerCase()}::${safeLimit}`
  const cached = await cacheStore.getSearch(cacheKey)
  if (cached) {
    return { ...cached, cached: true }
  }

  const tavilyKey = process.env.TAVILY_API_KEY?.trim()
  if (tavilyKey) {
    try {
      const res = await fetchWithTimeout('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: cleanQuery,
          max_results: safeLimit,
          search_depth: 'basic',
        }),
        timeoutMs: 12_000,
      })
      if (res.ok) {
        const json = JSON.parse(res.buffer.toString('utf8'))
        const results = (Array.isArray(json.results) ? json.results : []).map((item) => ({
          title: String(item.title || ''),
          url: String(item.url || ''),
          snippet: String(item.content || ''),
          source: 'tavily',
        }))
        if (results.length > 0) {
          const outcome = { ok: true, query: cleanQuery, backend: 'tavily', results }
          await cacheStore.setSearch(cacheKey, outcome)
          return { ...outcome, cached: false }
        }
      }
    } catch {
      // Fallback to Bing / DuckDuckGo
    }
  }

  for (const engine of ['bing', 'duckduckgo']) {
    try {
      const url =
        engine === 'bing'
          ? `https://cn.bing.com/search?q=${encodeURIComponent(cleanQuery)}&count=${safeLimit}`
          : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`
      const res = await fetchWithTimeout(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        timeoutMs: 12_000,
      })
      if (!res.ok) {
        continue
      }
      const html = res.buffer.toString('utf8')
      const results =
        engine === 'bing' ? parseBingHtml(html, safeLimit) : parseDuckDuckGoHtml(html, safeLimit)
      if (results.length > 0) {
        const outcome = { ok: true, query: cleanQuery, backend: engine, results }
        await cacheStore.setSearch(cacheKey, outcome)
        return { ...outcome, cached: false }
      }
    } catch {
      // Continue failover chain
    }
  }

  return { ok: true, query: cleanQuery, backend: 'none', results: [], cached: false }
}

export async function runCachedFetch(cacheStore, rawUrl) {
  const cleanUrl = String(rawUrl || '').trim()
  let parsed
  try {
    parsed = new URL(cleanUrl)
  } catch {
    return { ok: false, url: cleanUrl, error: 'URL 不合法' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, url: cleanUrl, error: '仅支持 http/https 协议' }
  }
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    return { ok: false, url: cleanUrl, error: '禁止抓取本地内网地址' }
  }

  const cached = await cacheStore.getFetch(cleanUrl)
  if (cached) {
    return { ...cached, cached: true }
  }

  try {
    const res = await fetchWithTimeout(cleanUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeoutMs: 15_000,
    })
    if (!res.ok) {
      return { ok: false, url: cleanUrl, status: res.status, error: `HTTP ${res.status}` }
    }
    const extracted = extractWebContent(res.buffer, res.contentType, cleanUrl)
    const contentLength = extracted.content.length
    const outcome = {
      ok: true,
      url: cleanUrl,
      status: res.status,
      contentType: res.contentType,
      kind: extracted.kind,
      title: extracted.title,
      byline: extracted.byline,
      extractor: extracted.extractor,
      content: extracted.content.slice(0, MAX_CONTENT_CHARS),
      contentLength,
      truncated: contentLength > MAX_CONTENT_CHARS,
    }
    await cacheStore.setFetch(cleanUrl, outcome)
    return { ...outcome, cached: false }
  } catch (error) {
    return {
      ok: false,
      url: cleanUrl,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
