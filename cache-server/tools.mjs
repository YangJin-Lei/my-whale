import {
  decodeHtmlEntities,
  decodeTextBuffer,
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

function canonicalizeSearchUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    const dropParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'spm', 'from', 'ref', 'fbclid', 'gclid']
    for (const p of dropParams) {
      parsed.searchParams.delete(p)
    }
    const cleanPath = parsed.pathname.replace(/\/+$/, '') || '/'
    const searchStr = parsed.searchParams.toString()
    return `${parsed.protocol}//${host}${cleanPath}${searchStr ? `?${searchStr}` : ''}`
  } catch {
    return rawUrl.trim()
  }
}

function isOpaqueRedirectUrl(rawUrl) {
  return /baidu\.com\/link\?/i.test(rawUrl) || /bing\.com\/ck\//i.test(rawUrl)
}

function isLowSignalDictHit(rawUrl, cleanQuery = '') {
  if (cleanQuery.length <= 2) {
    return false
  }
  return /dict\.revised\.moe\.edu\.tw|hanyuguoxue\.com|hancibao\.com|zdic\.net/i.test(rawUrl)
}

function parseBingHtml(html, limit = 10) {
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

function parseBaiduHtml(html, limit = 10) {
  const containerBlocks = collectMatches(
    /<div[^>]*class="[^"]*\bresult\b[^"]*\bc-container\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bresult\b[^"]*\bc-container\b|<div\s+id="page")/gi,
    html
  )
  const results = []
  for (const block of containerBlocks) {
    if (results.length >= limit) {
      break
    }
    const body = block[1] || ''
    const link =
      /<h3[^>]*class="[^"]*\bt\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(
        body
      )
    if (!link) {
      continue
    }
    const url = link[1] || ''
    const title = stripTags(link[2] || '')
    if (!title || !url.startsWith('http')) {
      continue
    }
    const snipMatch =
      /<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(body) ||
      /<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(body) ||
      /<div[^>]*class="[^"]*c-span-last[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(body)
    let snippet = snipMatch ? stripTags(snipMatch[1] || '') : ''
    if (!snippet) {
      const textOnly = stripTags(body.replace(/<h3[\s\S]*?<\/h3>/i, ''))
      snippet = textOnly.slice(0, 220)
    }
    results.push({ title, url, snippet, source: 'baidu' })
  }

  if (results.length > 0) {
    return results
  }

  const blocks = collectMatches(
    /<h3[^>]*class="[^"]*\bt\b[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    html
  )
  for (const match of blocks) {
    if (results.length >= limit) {
      break
    }
    const url = match[1] || ''
    const title = stripTags(match[2] || '')
    if (title && url.startsWith('http')) {
      results.push({ title, url, snippet: '', source: 'baidu' })
    }
  }
  return results
}

function parseDuckDuckGoHtml(html, limit = 10) {
  const links = collectMatches(
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
    html
  )
  const snippets = collectMatches(
    /<(?:a|div)[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/gi,
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

function shouldQueryGitHub(query) {
  return /\b(github|repo|cli|mcp|sdk|agent|api)\b|开源|仓库|源码|项目|框架/i.test(query)
}

async function searchGitHubRepos(query) {
  try {
    const cleaned = query.replace(/github|开源|仓库|源码|项目/gi, '').trim() || query
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(cleaned)}&sort=stars&per_page=4`
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github+json',
      },
      timeoutMs: 6_500,
    })
    if (!res.ok) {
      return []
    }
    const json = JSON.parse(res.buffer.toString('utf8'))
    return (Array.isArray(json.items) ? json.items : []).map((repo) => ({
      title: `${String(repo.full_name || '')} (GitHub ★${Number(repo.stargazers_count || 0)})`,
      url: String(repo.html_url || ''),
      snippet: decodeHtmlEntities(
        `${repo.language ? `[${repo.language}] ` : ''}${String(repo.description || '')}`
      ).trim(),
      source: 'github',
    }))
  } catch {
    return []
  }
}

async function searchWikipedia(query) {
  try {
    const url = `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=1&format=json&srlimit=3`
    const res = await fetchWithTimeout(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeoutMs: 6_000,
    })
    if (!res.ok) {
      return []
    }
    const json = JSON.parse(res.buffer.toString('utf8'))
    const list = json?.query?.search
    if (!Array.isArray(list)) {
      return []
    }
    return list.map((item) => {
      const title = decodeHtmlEntities(String(item.title || ''))
      const snippet = stripTags(String(item.snippet || ''))
      return {
        title: `${title} - 维基百科`,
        url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`,
        snippet,
        source: 'wikipedia',
      }
    })
  } catch {
    return []
  }
}

export function mergeSearchResultsWithRrf(sourceLists, cleanQuery = '', limit = 8) {
  const byCanon = new Map()
  for (const list of sourceLists) {
    for (let rank = 0; rank < list.length; rank += 1) {
      const raw = list[rank]
      if (!raw?.url || !raw?.title) {
        continue
      }
      const canon = canonicalizeSearchUrl(raw.url)
      const rrfScore = 1 / (60 + rank)
      const title = decodeHtmlEntities(raw.title).trim()
      const snippet = decodeHtmlEntities(raw.snippet || '').trim()
      const qualityBonus =
        (snippet.length >= 30 ? 0.008 : 0) +
        (!isOpaqueRedirectUrl(raw.url) ? 0.004 : 0) -
        (isLowSignalDictHit(raw.url, cleanQuery) ? 0.025 : 0)

      const existing = byCanon.get(canon)
      if (existing) {
        existing.score += rrfScore
        if (snippet.length > existing.item.snippet.length) {
          existing.item.snippet = snippet
        }
        if (isOpaqueRedirectUrl(existing.item.url) && !isOpaqueRedirectUrl(raw.url)) {
          existing.item.url = raw.url
        }
      } else {
        byCanon.set(canon, {
          score: rrfScore + qualityBonus,
          item: {
            title,
            url: raw.url,
            snippet,
            source: raw.source || 'web',
          },
        })
      }
    }
  }
  return Array.from(byCanon.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item)
}

async function fetchEngineSearch(engine, cleanQuery, count = 10) {
  try {
    const url =
      engine === 'bing'
        ? `https://cn.bing.com/search?q=${encodeURIComponent(cleanQuery)}&count=${count}`
        : engine === 'baidu'
          ? `https://www.baidu.com/s?wd=${encodeURIComponent(cleanQuery)}&rn=${count}`
          : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
      timeoutMs: 8_000,
    })
    if (!res.ok) {
      return []
    }
    const html = decodeTextBuffer(res.buffer, res.contentType)
    if (engine === 'bing') {
      return parseBingHtml(html, count)
    }
    if (engine === 'baidu') {
      return parseBaiduHtml(html, count)
    }
    return parseDuckDuckGoHtml(html, count)
  } catch {
    return []
  }
}

export async function runCachedSearch(cacheStore, query, limit = 8, options = {}) {
  const cleanQuery = String(query || '').trim()
  if (!cleanQuery) {
    return { ok: false, query: '', results: [], cached: false, error: 'query 不能为空' }
  }
  const safeLimit = Math.max(1, Math.min(10, Number(limit) || 8))
  const deepRead = Boolean(options.deepRead)
  const cacheKey = `${cleanQuery.toLowerCase()}::${safeLimit}`
  const cached = await cacheStore.getSearch(cacheKey)
  if (cached) {
    const out = { ...cached, cached: true }
    if (deepRead && out.results?.length) {
      out.results = await enrichResultsWithDeepRead(cacheStore, out.results, 2)
    }
    return out
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
        timeoutMs: 10_000,
      })
      if (res.ok) {
        const json = JSON.parse(res.buffer.toString('utf8'))
        const results = (Array.isArray(json.results) ? json.results : []).map((item) => ({
          title: decodeHtmlEntities(String(item.title || '')),
          url: String(item.url || ''),
          snippet: decodeHtmlEntities(String(item.content || '')),
          source: 'tavily',
        }))
        if (results.length > 0) {
          const outcome = { ok: true, query: cleanQuery, backend: 'tavily', results }
          await cacheStore.setSearch(cacheKey, outcome)
          const enriched = deepRead
            ? await enrichResultsWithDeepRead(cacheStore, outcome.results, 2)
            : outcome.results
          return { ...outcome, results: enriched, cached: false }
        }
      }
    } catch {
      // Fallback to multi-source RRF
    }
  }

  const tasks = [
    fetchEngineSearch('bing', cleanQuery, 10),
    fetchEngineSearch('baidu', cleanQuery, 10),
    fetchEngineSearch('duckduckgo', cleanQuery, 10),
  ]
  if (shouldQueryGitHub(cleanQuery)) {
    tasks.push(searchGitHubRepos(cleanQuery))
  } else {
    tasks.push(searchWikipedia(cleanQuery))
  }

  const lists = await Promise.all(tasks)
  const merged = mergeSearchResultsWithRrf(lists, cleanQuery, safeLimit)
  if (merged.length > 0) {
    const activeSources = Array.from(new Set(merged.map((r) => r.source))).join('+')
    const outcome = { ok: true, query: cleanQuery, backend: activeSources || 'rrf', results: merged }
    await cacheStore.setSearch(cacheKey, outcome)
    const enriched = deepRead
      ? await enrichResultsWithDeepRead(cacheStore, merged, 2)
      : merged
    return { ...outcome, results: enriched, cached: false }
  }

  return { ok: true, query: cleanQuery, backend: 'none', results: [], cached: false }
}

async function fetchViaJinaReader(cleanUrl) {
  try {
    const res = await fetchWithTimeout(`https://r.jina.ai/${cleanUrl}`, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/plain',
        'X-Return-Format': 'markdown',
      },
      timeoutMs: 6_500,
    })
    if (!res.ok) {
      return null
    }
    const md = decodeTextBuffer(res.buffer, res.contentType).trim()
    if (md.length < 120) {
      return null
    }
    const titleMatch = /^Title:\s*(.+)$/m.exec(md)
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]).trim() : ''
    return { title, content: md }
  } catch {
    return null
  }
}

export async function enrichResultsWithDeepRead(cacheStore, results, maxPages = 2) {
  const candidates = results.filter((r) => !isOpaqueRedirectUrl(r.url)).slice(0, maxPages)
  if (candidates.length === 0) {
    return results
  }
  const fetchedList = await Promise.all(
    candidates.map(async (item) => {
      try {
        const res = await runCachedFetch(cacheStore, item.url, { timeoutMs: 4_500 })
        if (res.ok && typeof res.content === 'string' && res.content.length >= 120) {
          return { url: item.url, excerpt: res.content.slice(0, 1400) }
        }
      } catch {
        // Keep snippet when single page read fails
      }
      return null
    })
  )
  const byUrl = new Map(fetchedList.filter(Boolean).map((x) => [x.url, x.excerpt]))
  return results.map((r) => {
    const excerpt = byUrl.get(r.url)
    return excerpt ? { ...r, pageContent: excerpt } : r
  })
}

export async function runCachedFetch(cacheStore, rawUrl, options = {}) {
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

  const timeoutMs = options.timeoutMs ?? 12_000
  try {
    const res = await fetchWithTimeout(cleanUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeoutMs,
    })
    let extracted = null
    let effectiveContentType = res.contentType
    if (res.ok) {
      extracted = extractWebContent(res.buffer, res.contentType, cleanUrl)
    }

    const needsJinaFallback =
      !res.ok ||
      (extracted && extracted.kind === 'html' && String(extracted.content || '').trim().length < 180)
    if (needsJinaFallback) {
      const jina = await fetchViaJinaReader(cleanUrl)
      if (jina) {
        extracted = {
          kind: 'text',
          title: jina.title || extracted?.title || '',
          byline: '',
          extractor: 'jina-reader',
          content: jina.content,
        }
        effectiveContentType = 'text/markdown; charset=utf-8'
      } else if (!res.ok) {
        return { ok: false, url: cleanUrl, status: res.status, error: `HTTP ${res.status}` }
      }
    }

    if (!extracted) {
      return { ok: false, url: cleanUrl, status: res.status, error: `HTTP ${res.status}` }
    }
    const contentLength = extracted.content.length
    const outcome = {
      ok: true,
      url: cleanUrl,
      status: res.ok ? res.status : 200,
      contentType: effectiveContentType,
      kind: extracted.kind,
      title: decodeHtmlEntities(extracted.title || ''),
      byline: decodeHtmlEntities(extracted.byline || ''),
      extractor: extracted.extractor,
      content: extracted.content.slice(0, MAX_CONTENT_CHARS),
      contentLength,
      truncated: contentLength > MAX_CONTENT_CHARS,
    }
    await cacheStore.setFetch(cleanUrl, outcome)
    return { ...outcome, cached: false }
  } catch (error) {
    const jina = await fetchViaJinaReader(cleanUrl)
    if (jina) {
      const outcome = {
        ok: true,
        url: cleanUrl,
        status: 200,
        contentType: 'text/markdown; charset=utf-8',
        kind: 'text',
        title: decodeHtmlEntities(jina.title || ''),
        byline: '',
        extractor: 'jina-reader',
        content: jina.content.slice(0, MAX_CONTENT_CHARS),
        contentLength: jina.content.length,
        truncated: jina.content.length > MAX_CONTENT_CHARS,
      }
      await cacheStore.setFetch(cleanUrl, outcome)
      return { ...outcome, cached: false }
    }
    return {
      ok: false,
      url: cleanUrl,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
