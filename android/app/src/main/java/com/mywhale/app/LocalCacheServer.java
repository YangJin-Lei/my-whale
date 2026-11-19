package com.mywhale.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.util.Base64;
import com.getcapacitor.JSObject;
import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONArray;
import org.json.JSONObject;

public class LocalCacheServer {
    private static final String UPSTREAM_ORIGIN = "https://api.deepseek.com";
    private static final int MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
    private static final int MAX_CONTENT_CHARS = 6000;
    private static final long SEARCH_TTL_MS = 20L * 60L * 1000L;
    private static final long FETCH_TTL_MS = 60L * 60L * 1000L;
    private static final String UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36";

    private static volatile LocalCacheServer instance;

    private final CacheDbHelper dbHelper;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final AtomicInteger searchHits = new AtomicInteger(0);
    private final AtomicInteger fetchHits = new AtomicInteger(0);
    private final AtomicInteger upstreamCalls = new AtomicInteger(0);
    private final AtomicLong prefixReadTokens = new AtomicLong(0);
    private final AtomicLong prefixCreateTokens = new AtomicLong(0);
    private final AtomicLong prefixInputTokens = new AtomicLong(0);

    private volatile ServerSocket serverSocket;
    private volatile boolean running = false;
    private volatile int port = 8787;

    private LocalCacheServer(Context context) {
        this.dbHelper = new CacheDbHelper(context.getApplicationContext());
    }

    public static synchronized LocalCacheServer getInstance(Context context) {
        if (instance == null) {
            instance = new LocalCacheServer(context);
        }
        return instance;
    }

    public synchronized void start(int listenPort) throws IOException {
        if (running && serverSocket != null && !serverSocket.isClosed()) {
            return;
        }
        this.port = listenPort > 0 ? listenPort : 8787;
        ServerSocket ss = new ServerSocket(this.port, 50, InetAddress.getByName("127.0.0.1"));
        ss.setReuseAddress(true);
        this.serverSocket = ss;
        this.running = true;

        pool.execute(() -> {
            while (running && !ss.isClosed()) {
                try {
                    Socket client = ss.accept();
                    pool.execute(() -> handleClient(client));
                } catch (IOException ignored) {
                    if (!running) {
                        break;
                    }
                }
            }
        });
    }

    public synchronized void stop() {
        running = false;
        if (serverSocket != null) {
            try {
                serverSocket.close();
            } catch (IOException ignored) {
            }
            serverSocket = null;
        }
    }

    public boolean isRunning() {
        return running && serverSocket != null && !serverSocket.isClosed();
    }

    public JSObject getStatsJson() {
        JSObject obj = new JSObject();
        obj.put("ok", true);
        obj.put("running", isRunning());
        obj.put("mode", "android-builtin-cache");
        obj.put("port", port);
        obj.put("searchCached", dbHelper.countNamespace("search"));
        obj.put("fetchCached", dbHelper.countNamespace("fetch"));
        obj.put("searchHits", searchHits.get());
        obj.put("fetchHits", fetchHits.get());
        obj.put("upstreamCalls", upstreamCalls.get());
        obj.put("prefixReadTokens", prefixReadTokens.get());
        obj.put("prefixCreateTokens", prefixCreateTokens.get());
        obj.put("prefixInputTokens", prefixInputTokens.get());
        return obj;
    }

    private void handleClient(Socket socket) {
        try (Socket s = socket) {
            s.setSoTimeout(120_000);
            BufferedInputStream in = new BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) {
                return;
            }
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) {
                return;
            }
            String method = parts[0].toUpperCase(Locale.ROOT);
            String fullPath = parts[1];
            String pathOnly = fullPath.contains("?") ? fullPath.substring(0, fullPath.indexOf('?')) : fullPath;

            Map<String, String> headers = new HashMap<>();
            int contentLength = 0;
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    String k = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                    String v = line.substring(colon + 1).trim();
                    headers.put(k, v);
                    if ("content-length".equals(k)) {
                        try {
                            contentLength = Integer.parseInt(v);
                        } catch (NumberFormatException ignored) {
                        }
                    }
                }
            }

            byte[] reqBody = contentLength > 0 ? readExactBytes(in, contentLength) : new byte[0];

            if ("OPTIONS".equals(method)) {
                writeCorsOptions(out);
                return;
            }

            if ("GET".equals(method) && ("/health".equals(pathOnly) || "/api/cache/stats".equals(pathOnly))) {
                sendJson(out, 200, getStatsJson().toString());
                return;
            }

            if ("POST".equals(method) && "/api/cache/clear".equals(pathOnly)) {
                dbHelper.clearAll();
                searchHits.set(0);
                fetchHits.set(0);
                upstreamCalls.set(0);
                prefixReadTokens.set(0);
                prefixCreateTokens.set(0);
                prefixInputTokens.set(0);
                sendJson(out, 200, "{\"ok\":true}");
                return;
            }

            if ("POST".equals(method) && "/api/search".equals(pathOnly)) {
                JSONObject req = new JSONObject(new String(reqBody, StandardCharsets.UTF_8));
                JSONObject res = runCachedSearch(req.optString("query", ""), req.optInt("limit", 6));
                sendJson(out, 200, res.toString());
                return;
            }

            if ("POST".equals(method) && "/api/fetch".equals(pathOnly)) {
                JSONObject req = new JSONObject(new String(reqBody, StandardCharsets.UTF_8));
                JSONObject res = runCachedFetch(req.optString("url", ""));
                sendJson(out, 200, res.toString());
                return;
            }

            if ("POST".equals(method) && "/anthropic/v1/messages".equals(pathOnly)) {
                handleMessagesProxy(headers, reqBody, out);
                return;
            }

            if ("/models".equals(pathOnly)
                || "/user/balance".equals(pathOnly)
                || "/anthropic/v1/files".equals(pathOnly)
                || pathOnly.startsWith("/anthropic/v1/files/")) {
                handlePassthrough(method, fullPath, headers, reqBody, out);
                return;
            }

            sendJson(out, 404, "{\"error\":{\"message\":\"Not Found\"}}");
        } catch (Exception ignored) {
        }
    }

    private void handleMessagesProxy(Map<String, String> headers, byte[] reqBody, OutputStream out)
        throws Exception {
        JSONObject body = new JSONObject(new String(reqBody, StandardCharsets.UTF_8));
        JSONArray incomingTools = body.optJSONArray("tools");
        boolean wantsSearch = hasTool(incomingTools, "deepseek_web_search");
        boolean wantsReadUrl = hasTool(incomingTools, "deepseek_read_url");

        String sessionKey = headers.getOrDefault("x-session-id", "");
        JSONArray stableMessages = stabilizePrefixMessages(body.optJSONArray("messages"));
        replayHistoricalTurns(sessionKey, stableMessages);
        String lastUserText = extractLastUserText(stableMessages);

        List<JSONObject> syntheticBlocks = new ArrayList<>();
        StringBuilder grounding = new StringBuilder();

        if (wantsReadUrl) {
            for (String url : extractUrls(lastUserText)) {
                JSONObject fetched = runCachedFetch(url);
                String toolId = "srvtoolu_rl_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);

                JSONObject useBlock = new JSONObject();
                useBlock.put("type", "server_tool_use");
                useBlock.put("id", toolId);
                useBlock.put("name", "deepseek_read_url");
                JSONObject inputObj = new JSONObject();
                inputObj.put("action", "read_link");
                inputObj.put("url", url);
                useBlock.put("input", inputObj);
                useBlock.put("caller", new JSONObject().put("type", "direct"));
                useBlock.put("kind", "read_link");
                syntheticBlocks.add(useBlock);

                JSONObject resultBlock = new JSONObject();
                resultBlock.put("type", "web_fetch_tool_result");
                resultBlock.put("tool_use_id", toolId);
                resultBlock.put("kind", "read_link");

                if (fetched.optBoolean("ok", false)) {
                    JSONObject docSource = new JSONObject()
                        .put("type", "text")
                        .put("media_type", "text/plain")
                        .put("data", "");
                    JSONObject docContent = new JSONObject()
                        .put("type", "document")
                        .put("source", docSource)
                        .put("title", fetched.optString("title", "").isEmpty() ? JSONObject.NULL : fetched.optString("title"));
                    resultBlock.put(
                        "content",
                        new JSONObject()
                            .put("type", "web_fetch_result")
                            .put("url", url)
                            .put("content", docContent)
                            .put("published_at", JSONObject.NULL)
                    );
                    grounding.append("[内置缓存抓取: ")
                        .append(fetched.optString("title", url))
                        .append(fetched.optBoolean("cached", false) ? " (命中缓存)" : "")
                        .append("]\n")
                        .append(fetched.optString("content", ""))
                        .append("\n\n");
                } else {
                    resultBlock.put(
                        "content",
                        new JSONObject()
                            .put("type", "web_fetch_tool_result_error")
                            .put("error_code", "url_not_accessible")
                    );
                }
                syntheticBlocks.add(resultBlock);
            }
        }

        if (wantsSearch) {
            String query = sanitizeSearchQuery(lastUserText);
            if (!query.isEmpty()) {
                JSONObject searchOut = runCachedSearch(query, 6);
                String toolId = "srvtoolu_s_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16);

                JSONObject useBlock = new JSONObject();
                useBlock.put("type", "server_tool_use");
                useBlock.put("id", toolId);
                useBlock.put("name", "deepseek_web_search");
                useBlock.put(
                    "input",
                    new JSONObject()
                        .put("action", "search")
                        .put("query", query)
                        .put("queries", new JSONArray().put(query))
                );
                useBlock.put("caller", new JSONObject().put("type", "direct"));
                useBlock.put("kind", "search");
                syntheticBlocks.add(useBlock);

                JSONArray items = searchOut.optJSONArray("results");
                JSONArray mappedResults = new JSONArray();
                if (items != null) {
                    for (int i = 0; i < items.length(); i++) {
                        JSONObject r = items.getJSONObject(i);
                        String rUrl = r.optString("url", "");
                        String rTitle = r.optString("title", "");
                        String rSnippet = r.optString("snippet", "");
                        mappedResults.put(
                            new JSONObject()
                                .put("type", "web_search_result")
                                .put("title", rTitle)
                                .put("url", rUrl)
                                .put("snippet", rSnippet)
                                .put("site_name", siteHost(rUrl))
                                .put("site_icon", JSONObject.NULL)
                                .put("encrypted_content", "")
                                .put("page_age", JSONObject.NULL)
                        );
                    }
                    if (items.length() > 0) {
                        grounding
                            .append("【系统已通过内置缓存搜索工具(")
                            .append(searchOut.optString("backend", "search"))
                            .append(searchOut.optBoolean("cached", false) ? ", 命中缓存" : "")
                            .append(")获取以下实时结果，请直接结合这些结果回答用户，不要说自己没有搜索工具或无法联网】\n关键词: ")
                            .append(query)
                            .append('\n');
                        for (int i = 0; i < items.length(); i++) {
                            JSONObject r = items.getJSONObject(i);
                            grounding
                                .append(i + 1)
                                .append(". ")
                                .append(r.optString("title", ""))
                                .append("\nURL: ")
                                .append(r.optString("url", ""))
                                .append("\n摘要: ")
                                .append(r.optString("snippet", ""))
                                .append("\n\n");
                        }
                    }
                }
                syntheticBlocks.add(
                    new JSONObject()
                        .put("type", "web_search_tool_result")
                        .put("tool_use_id", toolId)
                        .put("kind", "search")
                        .put("content", mappedResults)
                );
            }
        }

        String groundingStr = grounding.toString().trim();
        if (!sessionKey.isEmpty() && !groundingStr.isEmpty() && !lastUserText.isEmpty()) {
            dbHelper.put("turn", makeTurnKey(sessionKey, lastUserText), groundingStr, System.currentTimeMillis() + 30L * 86400_000L);
        }
        appendGroundingToLastUser(stableMessages, groundingStr);
        body.put("messages", stableMessages);

        JSONArray filteredTools = filterTools(incomingTools);
        if (filteredTools.length() > 0) {
            body.put("tools", filteredTools);
        } else {
            body.remove("tools");
        }

        boolean isStream = body.optBoolean("stream", true);
        HttpURLConnection conn = (HttpURLConnection) new URL(UPSTREAM_ORIGIN + "/anthropic/v1/messages").openConnection();
        conn.setRequestMethod("POST");
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(120_000);
        conn.setDoOutput(true);
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Accept", isStream ? "text/event-stream" : "application/json");
        copyHeader(headers, conn, "x-api-key");
        copyHeader(headers, conn, "authorization");
        copyHeader(headers, conn, "anthropic-beta");

        byte[] payloadBytes = body.toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(payloadBytes);
        }

        upstreamCalls.incrementAndGet();
        int status = conn.getResponseCode();
        InputStream respStream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();

        if (status >= 400 || !isStream) {
            byte[] respBytes = respStream != null ? readAllBytes(respStream, 4 * 1024 * 1024) : new byte[0];
            String ct = conn.getContentType() != null ? conn.getContentType() : "application/json";
            writeHttpResponse(out, status, ct, respBytes);
            conn.disconnect();
            return;
        }

        String header =
            "HTTP/1.1 200 OK\r\n"
                + "Content-Type: text/event-stream; charset=utf-8\r\n"
                + "Cache-Control: no-cache\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Expose-Headers: *\r\n"
                + "\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.flush();

        boolean emittedStart = false;
        if (!syntheticBlocks.isEmpty()) {
            emittedStart = true;
            JSONObject startMsg = new JSONObject()
                .put("type", "message_start")
                .put(
                    "message",
                    new JSONObject()
                        .put("id", "msg_cache_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12))
                        .put("model", body.optString("model", "deepseek-flash"))
                );
            writeSseFrame(out, "message_start", startMsg.toString());
            for (int i = 0; i < syntheticBlocks.size(); i++) {
                int idx = 1000 + i;
                writeSseFrame(
                    out,
                    "content_block_start",
                    new JSONObject()
                        .put("type", "content_block_start")
                        .put("index", idx)
                        .put("content_block", syntheticBlocks.get(i))
                        .toString()
                );
                writeSseFrame(
                    out,
                    "content_block_stop",
                    new JSONObject().put("type", "content_block_stop").put("index", idx).toString()
                );
            }
        }

        if (respStream != null) {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(respStream, StandardCharsets.UTF_8))) {
                StringBuilder frame = new StringBuilder();
                String sseLine;
                while ((sseLine = reader.readLine()) != null) {
                    if (sseLine.isEmpty()) {
                        String rawFrame = frame.toString();
                        frame.setLength(0);
                        if (!rawFrame.trim().isEmpty()) {
                            if (emittedStart && rawFrame.contains("\"message_start\"")) {
                                continue;
                            }
                            recordSseUsage(rawFrame);
                            out.write((rawFrame + "\n\n").getBytes(StandardCharsets.UTF_8));
                            out.flush();
                        }
                    } else {
                        frame.append(sseLine).append('\n');
                    }
                }
            }
        }
        conn.disconnect();
    }

    private void handlePassthrough(
        String method,
        String fullPath,
        Map<String, String> headers,
        byte[] reqBody,
        OutputStream out
    ) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(UPSTREAM_ORIGIN + fullPath).openConnection();
        conn.setRequestMethod(method);
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(60_000);
        copyHeader(headers, conn, "authorization");
        copyHeader(headers, conn, "x-api-key");
        copyHeader(headers, conn, "anthropic-beta");
        copyHeader(headers, conn, "content-type");
        copyHeader(headers, conn, "accept");

        if (reqBody.length > 0 && ("POST".equals(method) || "PUT".equals(method))) {
            conn.setDoOutput(true);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(reqBody);
            }
        }

        int status = conn.getResponseCode();
        InputStream is = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
        byte[] respBytes = is != null ? readAllBytes(is, 8 * 1024 * 1024) : new byte[0];
        String ct = conn.getContentType() != null ? conn.getContentType() : "application/json";
        writeHttpResponse(out, status, ct, respBytes);
        conn.disconnect();
    }

    private JSONObject runCachedSearch(String query, int limit) {
        JSONObject res = new JSONObject();
        String clean = query == null ? "" : query.trim();
        if (clean.isEmpty()) {
            try {
                res.put("ok", false).put("results", new JSONArray()).put("error", "query empty");
            } catch (Exception ignored) {
            }
            return res;
        }
        int safeLimit = Math.max(1, Math.min(10, limit));
        String key = clean.toLowerCase(Locale.ROOT) + "::" + safeLimit;
        String cachedStr = dbHelper.get("search", key);
        if (cachedStr != null) {
            try {
                searchHits.incrementAndGet();
                JSONObject obj = new JSONObject(cachedStr);
                obj.put("cached", true);
                return obj;
            } catch (Exception ignored) {
            }
        }

        JSONArray results = searchBing(clean, safeLimit);
        String backend = "bing";
        if (results.length() == 0) {
            results = searchBaidu(clean, safeLimit);
            backend = "baidu";
        }
        if (results.length() == 0) {
            results = searchDuckDuckGo(clean, safeLimit);
            backend = results.length() > 0 ? "duckduckgo" : "none";
        }
        try {
            res.put("ok", true).put("query", clean).put("backend", backend).put("results", results).put("cached", false);
            if (results.length() > 0) {
                dbHelper.put("search", key, res.toString(), System.currentTimeMillis() + SEARCH_TTL_MS);
            }
        } catch (Exception ignored) {
        }
        return res;
    }

    private JSONArray searchBaidu(String query, int limit) {
        JSONArray results = new JSONArray();
        try {
            String url = "https://www.baidu.com/s?wd=" + URLEncoder.encode(query, "UTF-8") + "&rn=" + limit;
            String html = new String(httpGet(url).bytes, StandardCharsets.UTF_8);
            Pattern pat = Pattern.compile("<h3[^>]*class=\"[^\"]*\\bt\\b[^\"]*\"[^>]*>[\\s\\S]*?<a[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>", Pattern.CASE_INSENSITIVE);
            Matcher m = pat.matcher(html);
            while (m.find() && results.length() < limit) {
                String targetUrl = m.group(1);
                String title = stripTags(m.group(2));
                if (!title.isEmpty() && targetUrl.startsWith("http")) {
                    results.put(new JSONObject().put("title", title).put("url", targetUrl).put("snippet", "").put("source", "baidu"));
                }
            }
        } catch (Exception ignored) {
        }
        return results;
    }

    private JSONArray searchBing(String query, int limit) {
        JSONArray results = new JSONArray();
        try {
            String url = "https://cn.bing.com/search?q=" + URLEncoder.encode(query, "UTF-8") + "&count=" + limit;
            byte[] body = httpGet(url).bytes;
            String html = new String(body, StandardCharsets.UTF_8);
            Pattern blockPat = Pattern.compile("<li[^>]*class=\"[^\"]*b_algo[^\"]*\"[^>]*>([\\s\\S]*?)</li>", Pattern.CASE_INSENSITIVE);
            Pattern linkPat = Pattern.compile("<h2[^>]*>\\s*<a[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>", Pattern.CASE_INSENSITIVE);
            Pattern snipPat = Pattern.compile("<p[^>]*class=\"[^\"]*b_lineclamp[^\"]*\"[^>]*>([\\s\\S]*?)</p>|<div[^>]*class=\"[^\"]*b_caption[^\"]*\"[^>]*>[\\s\\S]*?<p[^>]*>([\\s\\S]*?)</p>", Pattern.CASE_INSENSITIVE);
            Matcher bm = blockPat.matcher(html);
            while (bm.find() && results.length() < limit) {
                String block = bm.group(1);
                Matcher lm = linkPat.matcher(block);
                if (!lm.find()) {
                    continue;
                }
                String targetUrl = decodeBingUrl(lm.group(1));
                String title = stripTags(lm.group(2));
                if (title.isEmpty() || !targetUrl.startsWith("http")) {
                    continue;
                }
                String snippet = "";
                Matcher sm = snipPat.matcher(block);
                if (sm.find()) {
                    snippet = stripTags(sm.group(1) != null ? sm.group(1) : sm.group(2));
                }
                results.put(new JSONObject().put("title", title).put("url", targetUrl).put("snippet", snippet).put("source", "bing"));
            }
        } catch (Exception ignored) {
        }
        return results;
    }

    private JSONArray searchDuckDuckGo(String query, int limit) {
        JSONArray results = new JSONArray();
        try {
            String url = "https://html.duckduckgo.com/html/?q=" + URLEncoder.encode(query, "UTF-8");
            String html = new String(httpGet(url).bytes, StandardCharsets.UTF_8);
            Pattern linkPat = Pattern.compile("<a[^>]*class=\"[^\"]*result__a[^\"]*\"[^>]*href=\"([^\"]+)\"[^>]*>([\\s\\S]*?)</a>", Pattern.CASE_INSENSITIVE);
            Matcher lm = linkPat.matcher(html);
            while (lm.find() && results.length() < limit) {
                String targetUrl = decodeDdgUrl(lm.group(1));
                String title = stripTags(lm.group(2));
                if (!title.isEmpty() && targetUrl.startsWith("http")) {
                    results.put(new JSONObject().put("title", title).put("url", targetUrl).put("snippet", "").put("source", "duckduckgo"));
                }
            }
        } catch (Exception ignored) {
        }
        return results;
    }

    private JSONObject runCachedFetch(String rawUrl) {
        JSONObject res = new JSONObject();
        String cleanUrl = rawUrl == null ? "" : rawUrl.trim();
        try {
            URL parsed = new URL(cleanUrl);
            String proto = parsed.getProtocol().toLowerCase(Locale.ROOT);
            String host = parsed.getHost().toLowerCase(Locale.ROOT);
            if (!"http".equals(proto) && !"https".equals(proto)) {
                return res.put("ok", false).put("url", cleanUrl).put("error", "unsupported scheme");
            }
            if ("localhost".equals(host) || host.startsWith("127.") || host.startsWith("192.168.") || host.startsWith("10.")) {
                return res.put("ok", false).put("url", cleanUrl).put("error", "private host blocked");
            }
            String cachedStr = dbHelper.get("fetch", cleanUrl);
            if (cachedStr != null) {
                fetchHits.incrementAndGet();
                return new JSONObject(cachedStr).put("cached", true);
            }
            HttpResult hr = httpGet(cleanUrl);
            String ct = hr.contentType.toLowerCase(Locale.ROOT);
            String title = "";
            String content;
            if (isImageContent(hr.bytes, ct)) {
                title = "图片资源";
                content = "[图片资源 (" + ct + ", " + (hr.bytes.length / 1024) + " KB): " + cleanUrl + "]";
            } else if (isPdfContent(hr.bytes, ct, cleanUrl)) {
                title = "PDF 文档";
                content = "[PDF 文档 (" + (hr.bytes.length / 1024) + " KB): 如需解析内容请直接通过附件上传]";
            } else if (isZipContent(hr.bytes, ct, cleanUrl)) {
                title = "ZIP 压缩包清单";
                content = inspectZipEntries(hr.bytes);
            } else if (ct.contains("html") || ct.contains("xml")) {
                String html = new String(hr.bytes, StandardCharsets.UTF_8);
                title = extractHtmlTitle(html);
                content = extractReadableHtml(html);
            } else {
                content = new String(hr.bytes, StandardCharsets.UTF_8);
            }
            if (content.length() > MAX_CONTENT_CHARS) {
                content = content.substring(0, MAX_CONTENT_CHARS);
            }
            res.put("ok", true).put("url", cleanUrl).put("title", title).put("content", content).put("cached", false);
            dbHelper.put("fetch", cleanUrl, res.toString(), System.currentTimeMillis() + FETCH_TTL_MS);
            return res;
        } catch (Exception e) {
            try {
                res.put("ok", false).put("url", cleanUrl).put("error", e.getMessage());
            } catch (Exception ignored) {
            }
            return res;
        }
    }

    private static final class HttpResult {
        final String contentType;
        final byte[] bytes;

        HttpResult(String contentType, byte[] bytes) {
            this.contentType = contentType;
            this.bytes = bytes;
        }
    }

    private HttpResult httpGet(String url) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setInstanceFollowRedirects(true);
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(15_000);
        conn.setRequestProperty("User-Agent", UA);
        conn.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
        int code = conn.getResponseCode();
        if (code >= 400) {
            conn.disconnect();
            throw new IOException("HTTP " + code);
        }
        String ct = conn.getContentType() != null ? conn.getContentType() : "";
        byte[] bytes = readAllBytes(conn.getInputStream(), MAX_DOWNLOAD_BYTES);
        conn.disconnect();
        return new HttpResult(ct, bytes);
    }

    private static String inspectZipEntries(byte[] zipBytes) {
        StringBuilder sb = new StringBuilder("ZIP 压缩包目录（体积 ").append(zipBytes.length / 1024).append(" KB）：\n");
        int count = 0;
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipBytes))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null && count < 80) {
                count++;
                sb.append("- ").append(entry.getName()).append(" (").append(entry.getSize()).append(" B)\n");
            }
        } catch (Exception ignored) {
            sb.append("[读取 ZIP 条目结束]\n");
        }
        return sb.toString();
    }

    private static boolean isImageContent(byte[] b, String ct) {
        if (ct.startsWith("image/")) {
            return true;
        }
        return b.length >= 4 && ((b[0] == (byte) 0x89 && b[1] == 0x50) || (b[0] == (byte) 0xFF && b[1] == (byte) 0xD8));
    }

    private static boolean isPdfContent(byte[] b, String ct, String url) {
        if (ct.contains("application/pdf") || url.toLowerCase(Locale.ROOT).endsWith(".pdf")) {
            return true;
        }
        return b.length >= 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-';
    }

    private static boolean isZipContent(byte[] b, String ct, String url) {
        if (ct.contains("application/zip") || url.toLowerCase(Locale.ROOT).endsWith(".zip")) {
            return true;
        }
        return b.length >= 4 && b[0] == 'P' && b[1] == 'K' && (b[2] == 3 || b[2] == 5);
    }

    private static String extractHtmlTitle(String html) {
        Matcher m = Pattern.compile("<title[^>]*>([\\s\\S]*?)</title>", Pattern.CASE_INSENSITIVE).matcher(html);
        return m.find() ? stripTags(m.group(1)) : "";
    }

    private static String extractReadableHtml(String html) {
        String cleaned = html
            .replaceAll("<!--[\\s\\S]*?-->", "")
            .replaceAll("(?is)<(script|style|noscript|svg|iframe|template|form|nav|header|footer|aside)\\b[\\s\\S]*?</\\1>", "");
        cleaned = cleaned
            .replaceAll("(?i)<(br|hr)\\s*/?>", "\n")
            .replaceAll("(?i)</(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>", "\n");
        return stripTagsKeepNewlines(cleaned);
    }

    private static String stripTags(String html) {
        return html.replaceAll("<[^>]+>", " ").replace("&nbsp;", " ").replace("&amp;", "&").replaceAll("\\s+", " ").trim();
    }

    private static String stripTagsKeepNewlines(String html) {
        return html.replaceAll("<[^>]+>", " ").replace("&nbsp;", " ").replace("&amp;", "&").replaceAll("[ \\t]+", " ").replaceAll("\\n{3,}", "\n\n").trim();
    }

    private static String decodeBingUrl(String raw) {
        try {
            URL u = new URL(raw);
            if (u.getHost().endsWith("bing.com") && u.getPath().startsWith("/ck/")) {
                String q = u.getQuery();
                if (q != null) {
                    for (String kv : q.split("&")) {
                        if (kv.startsWith("u=")) {
                            String val = URLDecoder.decode(kv.substring(2), "UTF-8");
                            String b64 = val.startsWith("a1") ? val.substring(2) : val;
                            String padded = b64.replace('-', '+').replace('_', '/');
                            int rem = padded.length() % 4;
                            if (rem > 0) {
                                padded += "====".substring(rem);
                            }
                            String decoded = new String(Base64.decode(padded, Base64.DEFAULT), StandardCharsets.UTF_8);
                            if (decoded.startsWith("http")) {
                                return decoded;
                            }
                        }
                    }
                }
            }
        } catch (Exception ignored) {
        }
        return raw;
    }

    private static String decodeDdgUrl(String raw) {
        int idx = raw.indexOf("uddg=");
        if (idx < 0) {
            return raw;
        }
        String sub = raw.substring(idx + 5);
        int amp = sub.indexOf('&');
        if (amp > 0) {
            sub = sub.substring(0, amp);
        }
        try {
            return URLDecoder.decode(sub, "UTF-8");
        } catch (Exception ignored) {
            return raw;
        }
    }

    private static boolean hasTool(JSONArray tools, String name) {
        if (tools == null) {
            return false;
        }
        for (int i = 0; i < tools.length(); i++) {
            JSONObject t = tools.optJSONObject(i);
            if (t != null && (name.equals(t.optString("name")) || name.equals(t.optString("type")))) {
                return true;
            }
        }
        return false;
    }

    private static JSONArray filterTools(JSONArray tools) {
        JSONArray out = new JSONArray();
        if (tools == null) {
            return out;
        }
        for (int i = 0; i < tools.length(); i++) {
            JSONObject t = tools.optJSONObject(i);
            if (t == null) {
                continue;
            }
            String n = t.optString("name");
            String tp = t.optString("type");
            if (!"deepseek_web_search".equals(n) && !"deepseek_read_url".equals(n)
                && !"deepseek_web_search".equals(tp) && !"deepseek_read_url".equals(tp)) {
                out.put(t);
            }
        }
        return out;
    }

    private static JSONArray stabilizePrefixMessages(JSONArray messages) {
        JSONArray out = new JSONArray();
        if (messages == null) {
            return out;
        }
        int lastUser = -1;
        for (int i = messages.length() - 1; i >= 0; i--) {
            JSONObject m = messages.optJSONObject(i);
            if (m != null && "user".equals(m.optString("role"))) {
                lastUser = i;
                break;
            }
        }
        for (int i = 0; i < messages.length(); i++) {
            JSONObject m = messages.optJSONObject(i);
            if (m == null) {
                continue;
            }
            if ("latest_reminder".equals(m.optString("role")) && i < lastUser - 1) {
                continue;
            }
            out.put(m);
        }
        return out;
    }

    private static String extractLastUserText(JSONArray messages) {
        for (int i = messages.length() - 1; i >= 0; i--) {
            JSONObject m = messages.optJSONObject(i);
            if (m == null || !"user".equals(m.optString("role"))) {
                continue;
            }
            Object c = m.opt("content");
            if (c instanceof String) {
                return (String) c;
            }
            if (c instanceof JSONArray) {
                StringBuilder sb = new StringBuilder();
                JSONArray arr = (JSONArray) c;
                for (int j = 0; j < arr.length(); j++) {
                    JSONObject b = arr.optJSONObject(j);
                    if (b != null && "text".equals(b.optString("type"))) {
                        sb.append(b.optString("text", "")).append('\n');
                    }
                }
                return sb.toString();
            }
        }
        return "";
    }

    private static void appendGroundingToLastUser(JSONArray messages, String note) {
        if (note.isEmpty()) {
            return;
        }
        for (int i = messages.length() - 1; i >= 0; i--) {
            JSONObject m = messages.optJSONObject(i);
            if (m == null || !"user".equals(m.optString("role"))) {
                continue;
            }
            Object c = m.opt("content");
            try {
                if (c instanceof String) {
                    m.put("content", c + "\n\n" + note);
                } else if (c instanceof JSONArray) {
                    ((JSONArray) c).put(new JSONObject().put("type", "text").put("text", "\n\n" + note));
                }
            } catch (Exception ignored) {
            }
            break;
        }
    }

    private static List<String> extractUrls(String text) {
        Set<String> urls = new LinkedHashSet<>();
        Matcher m = Pattern.compile("https?://[^\\s\"'<>\\]）)]+", Pattern.CASE_INSENSITIVE).matcher(text);
        while (m.find() && urls.size() < 3) {
            urls.add(m.group());
        }
        return new ArrayList<>(urls);
    }

    private void recordSseUsage(String rawFrame) {
        if (!rawFrame.contains("\"usage\"")) {
            return;
        }
        for (String line : rawFrame.split("\n")) {
            if (!line.startsWith("data:")) {
                continue;
            }
            try {
                JSONObject evt = new JSONObject(line.substring(5).trim());
                JSONObject usage = evt.optJSONObject("usage");
                if (usage != null) {
                    prefixInputTokens.addAndGet(usage.optLong("input_tokens", 0));
                    prefixReadTokens.addAndGet(usage.optLong("cache_read_input_tokens", 0));
                    prefixCreateTokens.addAndGet(usage.optLong("cache_creation_input_tokens", 0));
                }
            } catch (Exception ignored) {
            }
        }
    }

    private void replayHistoricalTurns(String sessionKey, JSONArray messages) {
        if (sessionKey == null || sessionKey.isEmpty() || messages == null) {
            return;
        }
        int lastUserIdx = -1;
        for (int i = messages.length() - 1; i >= 0; i--) {
            JSONObject m = messages.optJSONObject(i);
            if (m != null && "user".equals(m.optString("role"))) {
                lastUserIdx = i;
                break;
            }
        }
        for (int i = 0; i < lastUserIdx; i++) {
            JSONObject m = messages.optJSONObject(i);
            if (m == null || !"user".equals(m.optString("role"))) {
                continue;
            }
            String rawText = extractSingleUserText(m);
            if (rawText.isEmpty()) {
                continue;
            }
            String saved = dbHelper.get("turn", makeTurnKey(sessionKey, rawText));
            if (saved == null || saved.isEmpty()) {
                continue;
            }
            try {
                Object c = m.opt("content");
                if (c instanceof String) {
                    m.put("content", c + "\n\n" + saved);
                } else if (c instanceof JSONArray) {
                    ((JSONArray) c).put(new JSONObject().put("type", "text").put("text", "\n\n" + saved));
                }
            } catch (Exception ignored) {
            }
        }
    }

    private static String extractSingleUserText(JSONObject m) {
        Object c = m.opt("content");
        if (c instanceof String) {
            return (String) c;
        }
        if (c instanceof JSONArray) {
            StringBuilder sb = new StringBuilder();
            JSONArray arr = (JSONArray) c;
            for (int j = 0; j < arr.length(); j++) {
                JSONObject b = arr.optJSONObject(j);
                if (b != null && "text".equals(b.optString("type"))) {
                    sb.append(b.optString("text", "")).append('\n');
                }
            }
            return sb.toString();
        }
        return "";
    }

    private static String makeTurnKey(String sessionKey, String rawText) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] dig = md.digest(rawText.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (int i = 0; i < Math.min(12, dig.length); i++) {
                hex.append(String.format(Locale.ROOT, "%02x", dig[i]));
            }
            return sessionKey + "::" + hex;
        } catch (Exception ignored) {
            return sessionKey + "::" + rawText.hashCode();
        }
    }

    private static String sanitizeSearchQuery(String text) {
        String cleaned = text
            .replaceAll("https?://\\S+", " ")
            .replaceFirst("^(?:请|帮我|给我|麻烦)?(?:上网|联网)?(?:搜索|搜一下|查一下|查询)\\s*", "")
            .replaceAll("[呢吗吧呀啊？?!！。.\\s]+$", "")
            .replaceAll("\\s+", " ")
            .trim();
        return cleaned.length() > 140 ? cleaned.substring(0, 140) : cleaned;
    }

    private static Object siteHost(String url) {
        try {
            return new URL(url).getHost();
        } catch (Exception ignored) {
            return JSONObject.NULL;
        }
    }

    private static void copyHeader(Map<String, String> headers, HttpURLConnection conn, String key) {
        String val = headers.get(key);
        if (val != null && !val.isEmpty()) {
            conn.setRequestProperty(key, val);
        }
    }

    private static void writeCorsOptions(OutputStream out) throws IOException {
        String resp =
            "HTTP/1.1 204 No Content\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Allow-Methods: GET,POST,DELETE,OPTIONS\r\n"
                + "Access-Control-Allow-Headers: *\r\n"
                + "Content-Length: 0\r\n\r\n";
        out.write(resp.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private static void sendJson(OutputStream out, int status, String json) throws IOException {
        writeHttpResponse(out, status, "application/json; charset=utf-8", json.getBytes(StandardCharsets.UTF_8));
    }

    private static void writeHttpResponse(OutputStream out, int status, String ct, byte[] body) throws IOException {
        String header =
            "HTTP/1.1 "
                + status
                + " OK\r\n"
                + "Content-Type: "
                + ct
                + "\r\n"
                + "Content-Length: "
                + body.length
                + "\r\n"
                + "Access-Control-Allow-Origin: *\r\n"
                + "Access-Control-Expose-Headers: *\r\n\r\n";
        out.write(header.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static void writeSseFrame(OutputStream out, String event, String data) throws IOException {
        String frame = "event: " + event + "\ndata: " + data + "\n\n";
        out.write(frame.getBytes(StandardCharsets.UTF_8));
        out.flush();
    }

    private static String readLine(BufferedInputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int b;
        while ((b = in.read()) != -1) {
            if (b == '\n') {
                break;
            }
            if (b != '\r') {
                buf.write(b);
            }
        }
        if (b == -1 && buf.size() == 0) {
            return null;
        }
        return buf.toString("UTF-8");
    }

    private static byte[] readExactBytes(InputStream in, int length) throws IOException {
        byte[] buf = new byte[length];
        int offset = 0;
        while (offset < length) {
            int read = in.read(buf, offset, length - offset);
            if (read == -1) {
                break;
            }
            offset += read;
        }
        if (offset == length) {
            return buf;
        }
        byte[] trimmed = new byte[offset];
        System.arraycopy(buf, 0, trimmed, 0, offset);
        return trimmed;
    }

    private static byte[] readAllBytes(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        int total = 0;
        while ((n = in.read(chunk)) != -1) {
            total += n;
            if (total > limit) {
                break;
            }
            out.write(chunk, 0, n);
        }
        return out.toByteArray();
    }

    private static class CacheDbHelper extends SQLiteOpenHelper {
        CacheDbHelper(Context ctx) {
            super(ctx, "mywhale_cache.db", null, 1);
        }

        @Override
        public void onCreate(SQLiteDatabase db) {
            db.execSQL(
                "CREATE TABLE IF NOT EXISTS kv_cache (namespace TEXT NOT NULL, cache_key TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (namespace, cache_key))"
            );
        }

        @Override
        public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

        synchronized String get(String ns, String key) {
            SQLiteDatabase db = getReadableDatabase();
            try (Cursor c = db.rawQuery(
                "SELECT payload, expires_at FROM kv_cache WHERE namespace=? AND cache_key=?",
                new String[] {ns, key}
            )) {
                if (c.moveToFirst()) {
                    long exp = c.getLong(1);
                    if (exp > System.currentTimeMillis()) {
                        return c.getString(0);
                    }
                }
            }
            return null;
        }

        synchronized void put(String ns, String key, String payload, long expiresAt) {
            SQLiteDatabase db = getWritableDatabase();
            ContentValues cv = new ContentValues();
            cv.put("namespace", ns);
            cv.put("cache_key", key);
            cv.put("payload", payload);
            cv.put("expires_at", expiresAt);
            db.insertWithOnConflict("kv_cache", null, cv, SQLiteDatabase.CONFLICT_REPLACE);
        }

        synchronized int countNamespace(String ns) {
            SQLiteDatabase db = getReadableDatabase();
            try (Cursor c = db.rawQuery("SELECT COUNT(*) FROM kv_cache WHERE namespace=?", new String[] {ns})) {
                if (c.moveToFirst()) {
                    return c.getInt(0);
                }
            }
            return 0;
        }

        synchronized void clearAll() {
            getWritableDatabase().delete("kv_cache", null, null);
        }
    }
}
