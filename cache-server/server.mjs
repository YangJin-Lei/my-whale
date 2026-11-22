import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CacheStore } from './cache-store.mjs'
import { runCachedFetch, runCachedSearch } from './tools.mjs'

const HOST = process.env.CACHE_HOST || '127.0.0.1'
const PORT = Number(process.env.CACHE_PORT || 8787)
const UPSTREAM_ORIGIN = (process.env.DEEPSEEK_API_ORIGIN || 'https://api.deepseek.com').replace(
  /\/+$/,
  ''
)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cacheStore = new CacheStore(path.join(__dirname, 'data'))

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(body)
}

function writeSse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function readRequestBuffer(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function extractUrls(text) {
  const matches = text.match(/https?:\/\/[^\s"'<>\]）)]+/gi) || []
  return Array.from(new Set(matches.slice(0, 3)))
}

function extractLastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i]
    if (msg?.role !== 'user') {
      continue
    }
    if (typeof msg.content === 'string') {
      return msg.content
    }
    if (Array.isArray(msg.content)) {
      return msg.content
        .filter((b) => b?.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n')
    }
  }
  return ''
}

function sanitizeSearchQuery(rawText) {
  return rawText
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/^(请|帮我|给我|麻烦)?(上网|联网)?(搜索|搜一下|查一下|查询)\s*/i, '')
    .replace(/[呢吗吧呀啊？?!！。.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

function getTurnText(msg) {
  if (typeof msg?.content === 'string') {
    return msg.content
  }
  if (Array.isArray(msg?.content)) {
    return msg.content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

function makeTurnKey(sessionKey, rawText) {
  if (!sessionKey || !rawText) {
    return ''
  }
  return `${sessionKey}::${crypto.createHash('sha256').update(rawText).digest('hex').slice(0, 24)}`
}

/**
 * 客户端会把历史轮次里的 `latest_reminder` 快照原样回放以保证前缀逐字节稳定，
 * 这里只做浅拷贝，绝不再改动消息顺序或删除任何历史消息。
 */
function stabilizeMessagesForPrefixCache(messages) {
  if (!Array.isArray(messages)) {
    return []
  }
  return messages.map((msg) => (msg && typeof msg === 'object' ? { ...msg } : msg))
}

function appendGroundingToLastUserMessage(messages, groundingNote) {
  if (!groundingNote) {
    return messages
  }
  const cloned = messages.map((m) => ({ ...m }))
  for (let i = cloned.length - 1; i >= 0; i -= 1) {
    const msg = cloned[i]
    if (msg.role !== 'user') {
      continue
    }
    if (typeof msg.content === 'string') {
      msg.content = `${msg.content}\n\n${groundingNote}`
    } else if (Array.isArray(msg.content)) {
      msg.content = [...msg.content, { type: 'text', text: `\n\n${groundingNote}` }]
    }
    break
  }
  return cloned
}

function siteNameOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

async function handleMessagesProxy(req, res) {
  const rawBuf = await readRequestBuffer(req)
  let body
  try {
    body = JSON.parse(rawBuf.toString('utf8'))
  } catch {
    sendJson(res, 400, { error: { message: 'Invalid JSON request body' } })
    return
  }

  const incomingTools = Array.isArray(body.tools) ? body.tools : []
  const wantsSearch = incomingTools.some(
    (t) => t?.name === 'deepseek_web_search' || t?.type === 'deepseek_web_search'
  )
  const wantsReadUrl = incomingTools.some(
    (t) => t?.name === 'deepseek_read_url' || t?.type === 'deepseek_read_url'
  )

  const sessionKey = req.headers['x-session-id'] ? String(req.headers['x-session-id']) : ''
  const stableMessages = stabilizeMessagesForPrefixCache(body.messages || []).map((m) => ({ ...m }))
  if (sessionKey) {
    let lastUserIdx = -1
    for (let i = stableMessages.length - 1; i >= 0; i -= 1) {
      if (stableMessages[i]?.role === 'user') {
        lastUserIdx = i
        break
      }
    }
    for (let i = 0; i < lastUserIdx; i += 1) {
      const m = stableMessages[i]
      if (m?.role !== 'user') {
        continue
      }
      const rawText = getTurnText(m)
      const savedNote = await cacheStore.getAugmentedTurn(makeTurnKey(sessionKey, rawText))
      if (savedNote) {
        if (typeof m.content === 'string') {
          m.content = `${m.content}\n\n${savedNote}`
        } else if (Array.isArray(m.content)) {
          m.content = [...m.content, { type: 'text', text: `\n\n${savedNote}` }]
        }
      }
    }
  }
  const lastUserText = extractLastUserText(stableMessages)
  const urls = wantsReadUrl ? extractUrls(lastUserText) : []

  const syntheticBlocks = []
  const groundingParts = []
  let officialSearchFallback = false

  for (const targetUrl of urls) {
    const fetched = await runCachedFetch(cacheStore, targetUrl)
    const toolId = `srvtoolu_rl_${crypto.randomBytes(8).toString('hex')}`
    syntheticBlocks.push({
      type: 'server_tool_use',
      id: toolId,
      name: 'deepseek_read_url',
      input: { action: 'read_link', url: targetUrl },
      caller: { type: 'direct' },
      kind: 'read_link',
    })
    if (fetched.ok) {
      syntheticBlocks.push({
        type: 'web_fetch_tool_result',
        tool_use_id: toolId,
        kind: 'read_link',
        content: {
          type: 'web_fetch_result',
          url: targetUrl,
          content: {
            type: 'document',
            source: { type: 'text', media_type: 'text/plain', data: '' },
            title: fetched.title || null,
          },
          published_at: null,
        },
      })
      groundingParts.push(
        `[内置缓存抓取: ${fetched.title || targetUrl}${fetched.cached ? ' (命中缓存)' : ''}]\n${fetched.content}`
      )
    } else {
      syntheticBlocks.push({
        type: 'web_fetch_tool_result',
        tool_use_id: toolId,
        kind: 'read_link',
        content: {
          type: 'web_fetch_tool_result_error',
          error_code: 'url_not_accessible',
        },
      })
    }
  }

  if (wantsSearch) {
    const query = sanitizeSearchQuery(lastUserText)
    if (query) {
      const searchOut = await runCachedSearch(cacheStore, query, 6)
      if (searchOut.results?.length > 0) {
        const toolId = `srvtoolu_s_${crypto.randomBytes(8).toString('hex')}`
        syntheticBlocks.push({
          type: 'server_tool_use',
          id: toolId,
          name: 'deepseek_web_search',
          input: { action: 'search', query, queries: [query] },
          caller: { type: 'direct' },
          kind: 'search',
        })
        syntheticBlocks.push({
          type: 'web_search_tool_result',
          tool_use_id: toolId,
          kind: 'search',
          content: searchOut.results.map((r) => ({
            type: 'web_search_result',
            title: r.title,
            url: r.url,
            snippet: r.snippet || '',
            site_name: siteNameOf(r.url),
            site_icon: null,
            encrypted_content: '',
            page_age: null,
          })),
        })
        const lines = searchOut.results.map(
          (r, idx) => `${idx + 1}. ${r.title}\nURL: ${r.url}\n摘要: ${r.snippet}`
        )
        groundingParts.push(
          `【系统已通过内置缓存搜索工具(${searchOut.backend}${searchOut.cached ? ', 命中缓存' : ''})获取以下实时结果，请直接结合这些结果回答用户，不要说自己没有搜索工具或无法联网】\n关键词: ${query}\n${lines.join('\n\n')}`
        )
      } else {
        officialSearchFallback = true
      }
    }
  }

  const groundingText = groundingParts.join('\n\n')
  if (sessionKey && groundingText && lastUserText) {
    await cacheStore.saveAugmentedTurn(makeTurnKey(sessionKey, lastUserText), groundingText)
  }

  const upstreamBody = {
    ...body,
    messages: appendGroundingToLastUserMessage(stableMessages, groundingText),
    tools: officialSearchFallback
      ? incomingTools
      : incomingTools.filter(
          (t) =>
            t?.name !== 'deepseek_web_search' &&
            t?.name !== 'deepseek_read_url' &&
            t?.type !== 'deepseek_web_search' &&
            t?.type !== 'deepseek_read_url'
        ),
  }
  if (upstreamBody.tools.length === 0) {
    delete upstreamBody.tools
  }

  if (sessionKey) {
    void cacheStore.recordSessionTurn(sessionKey, stableMessages)
  }

  const upstreamHeaders = {
    'Content-Type': 'application/json',
    Accept: body.stream === false ? 'application/json' : 'text/event-stream',
  }
  if (req.headers['x-api-key']) {
    upstreamHeaders['x-api-key'] = String(req.headers['x-api-key'])
  }
  if (req.headers['authorization']) {
    upstreamHeaders['authorization'] = String(req.headers['authorization'])
  }
  if (req.headers['anthropic-beta']) {
    upstreamHeaders['anthropic-beta'] = String(req.headers['anthropic-beta'])
  }

  const abort = new AbortController()
  req.on('close', () => abort.abort())

  let upstreamRes
  try {
    upstreamRes = await fetch(`${UPSTREAM_ORIGIN}/anthropic/v1/messages`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamBody),
      signal: abort.signal,
    })
  } catch (error) {
    sendJson(res, 502, {
      error: { message: error instanceof Error ? error.message : String(error) },
    })
    return
  }

  if (!upstreamRes.ok || body.stream === false) {
    const respBuf = Buffer.from(await upstreamRes.arrayBuffer())
    res.writeHead(upstreamRes.status, {
      ...CORS_HEADERS,
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
    })
    res.end(respBuf)
    cacheStore.recordUsage(null)
    return
  }

  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  if (syntheticBlocks.length > 0) {
    writeSse(res, 'message_start', {
      type: 'message_start',
      message: {
        id: `msg_cache_${crypto.randomBytes(6).toString('hex')}`,
        model: upstreamBody.model || 'deepseek-flash',
      },
    })
    for (let i = 0; i < syntheticBlocks.length; i += 1) {
      const idx = 1000 + i
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: idx,
        content_block: syntheticBlocks[i],
      })
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: idx })
    }
  }

  if (!upstreamRes.body) {
    res.end()
    return
  }

  const reader = upstreamRes.body.getReader()
  const decoder = new TextDecoder()
  let sseBuffer = ''
  let emittedStart = syntheticBlocks.length > 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      sseBuffer += decoder.decode(value, { stream: true })
      const frames = sseBuffer.split('\n\n')
      sseBuffer = frames.pop() ?? ''
      for (const frame of frames) {
        if (!frame.trim()) {
          continue
        }
        const dataLines = frame
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
        const rawData = dataLines.join('\n')
        if (rawData) {
          try {
            const parsed = JSON.parse(rawData)
            if (parsed.type === 'message_start') {
              if (emittedStart) {
                continue
              }
              emittedStart = true
            }
            if (parsed.type === 'message_delta' && parsed.usage) {
              cacheStore.recordUsage(parsed.usage)
            }
          } catch {
            // Pass unparsed frames cleanly
          }
        }
        res.write(`${frame}\n\n`)
      }
    }
    if (sseBuffer.trim()) {
      res.write(`${sseBuffer}\n\n`)
    }
  } finally {
    reader.releaseLock()
    res.end()
  }
}

async function handleGenericProxy(req, res) {
  const targetUrl = req.headers['x-target-url'] ? String(req.headers['x-target-url']).trim() : ''
  let parsed
  try {
    parsed = new URL(targetUrl)
  } catch {
    sendJson(res, 400, { error: { message: 'Invalid X-Target-Url' } })
    return
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.pathname === '/api/proxy'
  ) {
    sendJson(res, 400, { error: { message: 'Unsupported proxy target URL' } })
    return
  }

  const method = req.method || 'POST'
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBuffer(req)
  const headers = {}
  for (const key of [
    'authorization',
    'x-api-key',
    'anthropic-version',
    'anthropic-beta',
    'content-type',
    'accept',
  ]) {
    if (req.headers[key]) {
      headers[key] = String(req.headers[key])
    }
  }

  try {
    const upstreamRes = await fetch(targetUrl, { method, headers, body })
    const ct = upstreamRes.headers.get('content-type') || 'application/json; charset=utf-8'
    res.writeHead(upstreamRes.status, {
      ...CORS_HEADERS,
      'Content-Type': ct,
      ...(ct.includes('text/event-stream') ? { 'Cache-Control': 'no-cache' } : {}),
    })
    if (!upstreamRes.body) {
      res.end()
      return
    }
    for await (const chunk of upstreamRes.body) {
      res.write(chunk)
    }
    res.end()
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 502, {
        error: { message: error instanceof Error ? error.message : String(error) },
      })
    } else {
      res.end()
    }
  }
}

async function handlePassthrough(req, res, targetPath) {
  const method = req.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readRequestBuffer(req)
  const headers = {}
  for (const key of ['authorization', 'x-api-key', 'anthropic-beta', 'content-type', 'accept']) {
    if (req.headers[key]) {
      headers[key] = String(req.headers[key])
    }
  }

  try {
    const upstreamRes = await fetch(`${UPSTREAM_ORIGIN}${targetPath}`, {
      method,
      headers,
      body,
    })
    const buf = Buffer.from(await upstreamRes.arrayBuffer())
    res.writeHead(upstreamRes.status, {
      ...CORS_HEADERS,
      'Content-Type': upstreamRes.headers.get('content-type') || 'application/json',
    })
    res.end(buf)
  } catch (error) {
    sendJson(res, 502, {
      error: { message: error instanceof Error ? error.message : String(error) },
    })
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS)
    res.end()
    return
  }

  const reqUrl = new URL(req.url || '/', `http://${HOST}:${PORT}`)
  const pathname = reqUrl.pathname

  if (req.method === 'GET' && (pathname === '/health' || pathname === '/api/cache/stats')) {
    const stats = await cacheStore.getStats()
    sendJson(res, 200, { ok: true, mode: 'node-cache-backend', ...stats })
    return
  }

  if (req.method === 'POST' && pathname === '/api/cache/clear') {
    await cacheStore.clear()
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && pathname === '/api/search') {
    const body = JSON.parse((await readRequestBuffer(req)).toString('utf8') || '{}')
    const result = await runCachedSearch(cacheStore, body.query, body.limit)
    sendJson(res, 200, result)
    return
  }

  if (req.method === 'POST' && pathname === '/api/fetch') {
    const body = JSON.parse((await readRequestBuffer(req)).toString('utf8') || '{}')
    const result = await runCachedFetch(cacheStore, body.url)
    sendJson(res, 200, result)
    return
  }

  if (pathname === '/api/proxy') {
    await handleGenericProxy(req, res)
    return
  }

  if (req.method === 'POST' && pathname === '/anthropic/v1/messages') {
    await handleMessagesProxy(req, res)
    return
  }

  if (
    pathname === '/models' ||
    pathname === '/user/balance' ||
    pathname === '/anthropic/v1/files' ||
    pathname.startsWith('/anthropic/v1/files/')
  ) {
    await handlePassthrough(req, res, `${pathname}${reqUrl.search}`)
    return
  }

  sendJson(res, 404, { error: { message: 'Not Found' } })
})

server.listen(PORT, HOST, () => {
  console.log(`my-whale cache backend listening on http://${HOST}:${PORT}`)
})
