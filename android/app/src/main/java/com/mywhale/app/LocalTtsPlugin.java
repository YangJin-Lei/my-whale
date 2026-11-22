package com.mywhale.app;

import android.content.res.AssetManager;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.k2fsa.sherpa.onnx.GeneratedAudio;
import com.k2fsa.sherpa.onnx.OfflineTts;
import com.k2fsa.sherpa.onnx.OfflineTtsConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsKokoroModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsModelConfig;
import com.k2fsa.sherpa.onnx.OfflineTtsVitsModelConfig;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;
import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream;
import org.apache.commons.compress.compressors.bzip2.BZip2CompressorInputStream;

@CapacitorPlugin(name = "LocalTts")
public class LocalTtsPlugin extends Plugin {
    private static final String DEFAULT_MODEL_ID = "default-zh";
    private static final String ASSET_DEFAULT_DIR = "tts/default-zh";
    private static final Pattern SAFE_MODEL_ID = Pattern.compile("^[a-zA-Z0-9_-]{1,64}$");

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Object ttsLock = new Object();
    private OfflineTts activeTts = null;
    private String activeModelId = "";

    @Override
    protected void handleOnDestroy() {
        synchronized (ttsLock) {
            if (activeTts != null) {
                try {
                    activeTts.release();
                } catch (Throwable ignored) {
                }
                activeTts = null;
                activeModelId = "";
            }
        }
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        executor.execute(() -> {
            try {
                boolean builtInReady = hasBuiltInAssets();
                JSArray ids = buildInstalledIdsArray(builtInReady);
                JSObject result = new JSObject();
                result.put("nativeSupported", true);
                result.put("builtInReady", builtInReady);
                result.put("installedIds", ids);
                result.put("activeModelId", activeModelId);
                call.resolve(result);
            } catch (Throwable t) {
                JSObject result = new JSObject();
                result.put("nativeSupported", false);
                result.put("builtInReady", false);
                result.put("installedIds", new JSArray());
                result.put("activeModelId", "");
                result.put("error", t.getMessage() != null ? t.getMessage() : t.toString());
                call.resolve(result);
            }
        });
    }

    @PluginMethod
    public void synthesize(PluginCall call) {
        String text = call.getString("text", "");
        String requestedId = call.getString("modelId", DEFAULT_MODEL_ID);
        float speed = call.getFloat("speed", 1.0f);
        int sid = call.getInt("sid", 0);

        if (text == null || text.trim().isEmpty()) {
            call.reject("Empty speech text");
            return;
        }
        final String cleanModelId = isSafeModelId(requestedId) ? requestedId : DEFAULT_MODEL_ID;
        final float safeSpeed = Math.max(0.5f, Math.min(2.0f, speed));

        executor.execute(() -> {
            try {
                GeneratedAudio audio;
                synchronized (ttsLock) {
                    OfflineTts tts = ensureLoadedLocked(cleanModelId);
                    int numSpeakers = tts.numSpeakers();
                    int safeSid = sid;
                    if (numSpeakers > 0 && (safeSid < 0 || safeSid >= numSpeakers)) {
                        safeSid = 0;
                    }
                    audio = tts.generate(text, safeSid, safeSpeed);
                }
                float[] samples = audio.getSamples();
                int sampleRate = audio.getSampleRate();
                if (samples == null || samples.length == 0) {
                    call.reject("Synthesized audio is empty");
                    return;
                }
                ByteBuffer buf = ByteBuffer.allocate(samples.length * 2).order(ByteOrder.LITTLE_ENDIAN);
                for (float sample : samples) {
                    float clamped = Math.max(-1.0f, Math.min(1.0f, sample));
                    short pcm = (short) Math.round(clamped * 32767.0f);
                    buf.putShort(pcm);
                }
                String base64 = Base64.encodeToString(buf.array(), Base64.NO_WRAP);
                JSObject result = new JSObject();
                result.put("pcmBase64", base64);
                result.put("sampleRate", sampleRate > 0 ? sampleRate : 22050);
                call.resolve(result);
            } catch (Throwable t) {
                call.reject(
                    t.getMessage() != null ? t.getMessage() : "Local sherpa-onnx synthesis failed",
                    t instanceof Exception ? (Exception) t : null
                );
            }
        });
    }

    @PluginMethod
    public void downloadModel(PluginCall call) {
        String modelId = call.getString("modelId", "");
        JSArray urlsJson = call.getArray("urls");
        if (!isSafeModelId(modelId) || DEFAULT_MODEL_ID.equals(modelId)) {
            call.reject("Invalid downloadable model id");
            return;
        }
        List<String> urls = new ArrayList<>();
        if (urlsJson != null) {
            for (int i = 0; i < urlsJson.length(); i++) {
                String u = urlsJson.optString(i, "").trim();
                if (u.startsWith("https://") || u.startsWith("http://")) {
                    urls.add(u);
                }
            }
        }
        if (urls.isEmpty()) {
            call.reject("No valid download URL provided");
            return;
        }

        executor.execute(() -> {
            File modelsRoot = getModelsRootDir();
            if (!modelsRoot.exists() && !modelsRoot.mkdirs()) {
                call.reject("Failed to create tts-models directory");
                return;
            }
            File targetDir = new File(modelsRoot, modelId);
            File stagingDir = new File(modelsRoot, modelId + ".staging");
            File tempArchive = new File(getContext().getCacheDir(), "tts-" + modelId + ".tar.bz2");
            String lastError = "Download failed";

            for (String candidateUrl : urls) {
                deleteRecursive(stagingDir);
                if (tempArchive.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempArchive.delete();
                }
                try {
                    downloadToFile(candidateUrl, tempArchive);
                    if (!stagingDir.mkdirs() && !stagingDir.exists()) {
                        throw new IOException("Cannot create staging dir");
                    }
                    extractTarBz2(tempArchive, stagingDir);
                    flattenSingleRootDir(stagingDir);
                    if (findFirstBySuffix(stagingDir, ".onnx") == null) {
                        throw new IOException("Downloaded pack has no .onnx model");
                    }
                    if (findNamedFile(stagingDir, "tokens.txt") == null) {
                        throw new IOException("Downloaded pack has no tokens.txt");
                    }
                    synchronized (ttsLock) {
                        if (modelId.equals(activeModelId) && activeTts != null) {
                            activeTts.release();
                            activeTts = null;
                            activeModelId = "";
                        }
                    }
                    deleteRecursive(targetDir);
                    if (!stagingDir.renameTo(targetDir)) {
                        throw new IOException("Failed to activate downloaded voice pack");
                    }
                    JSObject result = new JSObject();
                    result.put("ok", true);
                    result.put("installedIds", buildInstalledIdsArray(hasBuiltInAssets()));
                    call.resolve(result);
                    return;
                } catch (Throwable t) {
                    lastError = t.getMessage() != null ? t.getMessage() : t.toString();
                } finally {
                    if (tempArchive.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        tempArchive.delete();
                    }
                    deleteRecursive(stagingDir);
                }
            }
            call.reject("Voice pack download failed across all mirrors: " + lastError);
        });
    }

    @PluginMethod
    public void deleteModel(PluginCall call) {
        String modelId = call.getString("modelId", "");
        if (!isSafeModelId(modelId) || DEFAULT_MODEL_ID.equals(modelId)) {
            call.reject("Built-in model cannot be deleted");
            return;
        }
        executor.execute(() -> {
            synchronized (ttsLock) {
                if (modelId.equals(activeModelId) && activeTts != null) {
                    try {
                        activeTts.release();
                    } catch (Throwable ignored) {
                    }
                    activeTts = null;
                    activeModelId = "";
                }
            }
            deleteRecursive(new File(getModelsRootDir(), modelId));
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("installedIds", buildInstalledIdsArray(hasBuiltInAssets()));
            call.resolve(result);
        });
    }

    private OfflineTts ensureLoadedLocked(String modelId) throws IOException {
        if (activeTts != null && modelId.equals(activeModelId)) {
            return activeTts;
        }
        String resolvedId = modelId;
        File externalDir = new File(getModelsRootDir(), resolvedId);
        boolean useExternal = !DEFAULT_MODEL_ID.equals(resolvedId)
            && externalDir.isDirectory()
            && findFirstBySuffix(externalDir, ".onnx") != null
            && findNamedFile(externalDir, "tokens.txt") != null;

        if (!useExternal) {
            resolvedId = DEFAULT_MODEL_ID;
            if (activeTts != null && DEFAULT_MODEL_ID.equals(activeModelId)) {
                return activeTts;
            }
        }

        if (activeTts != null) {
            try {
                activeTts.release();
            } catch (Throwable ignored) {
            }
            activeTts = null;
            activeModelId = "";
        }

        int numThreads = Math.min(4, Math.max(2, Runtime.getRuntime().availableProcessors() / 2));
        OfflineTts nextTts;
        if (useExternal) {
            nextTts = createExternalTts(externalDir, numThreads);
        } else {
            nextTts = createBuiltInTts(numThreads);
        }
        activeTts = nextTts;
        activeModelId = resolvedId;
        return activeTts;
    }

    private OfflineTts createBuiltInTts(int numThreads) throws IOException {
        AssetManager assets = getContext().getAssets();
        if (!hasBuiltInAssets()) {
            throw new IOException("Built-in default-zh TTS assets missing");
        }
        String[] rawEntries = assets.list(ASSET_DEFAULT_DIR);
        if (rawEntries == null) {
            throw new IOException("Empty built-in default-zh assets");
        }
        List<String> entries = new ArrayList<>();
        Collections.addAll(entries, rawEntries);
        Collections.sort(entries);

        String onnxName = null;
        boolean hasVoices = false;
        boolean hasUsEnLexicon = entries.contains("lexicon-us-en.txt");
        List<String> lexicons = new ArrayList<>();
        for (String name : entries) {
            if (onnxName == null && name.endsWith(".onnx")) {
                onnxName = name;
            } else if ("voices.bin".equals(name)) {
                hasVoices = true;
            } else if ("lexicon.txt".equals(name) || (name.startsWith("lexicon-") && name.endsWith(".txt"))) {
                if (hasUsEnLexicon && "lexicon-gb-en.txt".equals(name)) {
                    continue;
                }
                lexicons.add(ASSET_DEFAULT_DIR + "/" + name);
            }
        }
        if (onnxName == null) {
            throw new IOException("Missing .onnx in built-in default-zh assets");
        }

        StringBuilder lexiconJoined = new StringBuilder();
        for (String lex : lexicons) {
            if (lexiconJoined.length() > 0) {
                lexiconJoined.append(',');
            }
            lexiconJoined.append(lex);
        }

        String[] fstCandidates = {
            "phone-zh.fst",
            "date-zh.fst",
            "number-zh.fst",
            "phone.fst",
            "date.fst",
            "number.fst",
            "new_heteronym.fst",
        };
        StringBuilder fstsJoined = new StringBuilder();
        for (String fst : fstCandidates) {
            if (entries.contains(fst)) {
                if (fstsJoined.length() > 0) {
                    fstsJoined.append(',');
                }
                fstsJoined.append(ASSET_DEFAULT_DIR).append('/').append(fst);
            }
        }

        OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
        modelConfig.setNumThreads(numThreads);
        modelConfig.setDebug(false);
        modelConfig.setProvider("cpu");

        if (hasVoices) {
            OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
            kokoro.setModel(ASSET_DEFAULT_DIR + "/" + onnxName);
            kokoro.setVoices(ASSET_DEFAULT_DIR + "/voices.bin");
            kokoro.setTokens(ASSET_DEFAULT_DIR + "/tokens.txt");
            kokoro.setDataDir("");
            kokoro.setLexicon(lexiconJoined.toString());
            kokoro.setLang("");
            kokoro.setDictDir("");
            modelConfig.setKokoro(kokoro);
        } else {
            OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
            vits.setModel(ASSET_DEFAULT_DIR + "/" + onnxName);
            vits.setLexicon(lexiconJoined.toString());
            vits.setTokens(ASSET_DEFAULT_DIR + "/tokens.txt");
            vits.setDataDir("");
            modelConfig.setVits(vits);
        }

        OfflineTtsConfig config = new OfflineTtsConfig();
        config.setModel(modelConfig);
        config.setRuleFsts(fstsJoined.toString());
        if (entries.contains("rule.far")) {
            config.setRuleFars(ASSET_DEFAULT_DIR + "/rule.far");
        }
        config.setMaxNumSentences(1);
        return new OfflineTts(assets, config);
    }

    private OfflineTts createExternalTts(File dir, int numThreads) throws IOException {
        File onnxFile = findFirstBySuffix(dir, ".onnx");
        File tokensFile = findNamedFile(dir, "tokens.txt");
        if (onnxFile == null || tokensFile == null) {
            throw new IOException("Missing .onnx or tokens.txt in " + dir.getAbsolutePath());
        }
        File voicesFile = findNamedFile(dir, "voices.bin");
        File espeakDir = findNamedDir(dir, "espeak-ng-data");
        File ruleFar = findNamedFile(dir, "rule.far");
        List<File> lexicons = collectLexicons(dir);
        String lexiconJoined = joinPaths(lexicons);
        String fstsJoined = joinExistingPaths(
            findNamedFile(dir, "phone-zh.fst"),
            findNamedFile(dir, "date-zh.fst"),
            findNamedFile(dir, "number-zh.fst"),
            findNamedFile(dir, "phone.fst"),
            findNamedFile(dir, "date.fst"),
            findNamedFile(dir, "number.fst"),
            findNamedFile(dir, "new_heteronym.fst")
        );

        OfflineTtsModelConfig modelConfig = new OfflineTtsModelConfig();
        modelConfig.setNumThreads(numThreads);
        modelConfig.setDebug(false);
        modelConfig.setProvider("cpu");

        if (voicesFile != null) {
            OfflineTtsKokoroModelConfig kokoro = new OfflineTtsKokoroModelConfig();
            kokoro.setModel(onnxFile.getAbsolutePath());
            kokoro.setVoices(voicesFile.getAbsolutePath());
            kokoro.setTokens(tokensFile.getAbsolutePath());
            kokoro.setDataDir(espeakDir != null ? espeakDir.getAbsolutePath() : "");
            kokoro.setLexicon(lexiconJoined);
            kokoro.setLang("");
            kokoro.setDictDir("");
            modelConfig.setKokoro(kokoro);
        } else {
            OfflineTtsVitsModelConfig vits = new OfflineTtsVitsModelConfig();
            vits.setModel(onnxFile.getAbsolutePath());
            vits.setTokens(tokensFile.getAbsolutePath());
            vits.setLexicon(lexiconJoined);
            vits.setDataDir(espeakDir != null ? espeakDir.getAbsolutePath() : "");
            modelConfig.setVits(vits);
        }

        OfflineTtsConfig config = new OfflineTtsConfig();
        config.setModel(modelConfig);
        config.setRuleFsts(fstsJoined);
        if (ruleFar != null) {
            config.setRuleFars(ruleFar.getAbsolutePath());
        }
        config.setMaxNumSentences(1);
        return new OfflineTts(null, config);
    }

    private boolean hasBuiltInAssets() {
        try {
            String[] entries = getContext().getAssets().list(ASSET_DEFAULT_DIR);
            if (entries == null) {
                return false;
            }
            boolean hasOnnx = false;
            boolean hasTokens = false;
            for (String entry : entries) {
                if (entry.endsWith(".onnx")) {
                    hasOnnx = true;
                } else if ("tokens.txt".equals(entry)) {
                    hasTokens = true;
                }
            }
            return hasOnnx && hasTokens;
        } catch (IOException ignored) {
            return false;
        }
    }

    private JSArray buildInstalledIdsArray(boolean builtInReady) {
        JSArray ids = new JSArray();
        if (builtInReady) {
            ids.put(DEFAULT_MODEL_ID);
        }
        File root = getModelsRootDir();
        File[] children = root.listFiles();
        if (children != null) {
            List<String> names = new ArrayList<>();
            for (File child : children) {
                String name = child.getName();
                if (child.isDirectory() && isSafeModelId(name) && !DEFAULT_MODEL_ID.equals(name)) {
                    if (findFirstBySuffix(child, ".onnx") != null
                        && findNamedFile(child, "tokens.txt") != null) {
                        names.add(name);
                    }
                }
            }
            Collections.sort(names);
            for (String name : names) {
                ids.put(name);
            }
        }
        return ids;
    }

    private File getModelsRootDir() {
        return new File(getContext().getFilesDir(), "tts-models");
    }

    private static boolean isSafeModelId(String id) {
        return id != null && SAFE_MODEL_ID.matcher(id).matches();
    }

    private static void downloadToFile(String initialUrl, File outFile) throws IOException {
        IOException lastIo = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                downloadToFileOnce(initialUrl, outFile);
                return;
            } catch (IOException err) {
                lastIo = err;
            }
        }
        throw lastIo != null ? lastIo : new IOException("Download failed");
    }

    private static void downloadToFileOnce(String initialUrl, File outFile) throws IOException {
        String currentUrl = initialUrl;
        HttpURLConnection conn = null;
        long existingBytes = outFile.exists() ? outFile.length() : 0L;
        for (int hops = 0; hops <= 6; hops++) {
            URL url = new URL(currentUrl);
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(45000);
            conn.setRequestProperty("User-Agent", "my-whale-tts-downloader");
            if (existingBytes > 0) {
                conn.setRequestProperty("Range", "bytes=" + existingBytes + "-");
            }
            int status = conn.getResponseCode();
            if (status >= 300 && status < 400) {
                String location = conn.getHeaderField("Location");
                conn.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new IOException("Redirect without Location header");
                }
                currentUrl = new URL(url, location).toString();
                continue;
            }
            boolean appendMode = status == HttpURLConnection.HTTP_PARTIAL && existingBytes > 0;
            if (!appendMode && status != HttpURLConnection.HTTP_OK) {
                conn.disconnect();
                throw new IOException("HTTP " + status + " from " + currentUrl);
            }
            String contentType = conn.getContentType();
            if (contentType != null) {
                String lower = contentType.toLowerCase(Locale.ROOT);
                if (lower.startsWith("text/") || lower.contains("application/json")) {
                    conn.disconnect();
                    throw new IOException("Unexpected mirror Content-Type: " + contentType);
                }
            }
            long expectedLength = conn.getContentLengthLong();
            long written = 0;
            try (InputStream in = conn.getInputStream();
                 FileOutputStream out = new FileOutputStream(outFile, appendMode)) {
                byte[] buf = new byte[32768];
                int read;
                while ((read = in.read(buf)) != -1) {
                    out.write(buf, 0, read);
                    written += read;
                }
            } finally {
                conn.disconnect();
            }
            if (expectedLength > 0 && written != expectedLength) {
                throw new IOException("Truncated download: " + written + " / " + expectedLength);
            }
            return;
        }
        if (conn != null) {
            conn.disconnect();
        }
        throw new IOException("Too many redirects");
    }

    private static void extractTarBz2(File archiveFile, File destDir) throws IOException {
        String destCanonical = destDir.getCanonicalPath() + File.separator;
        try (InputStream fis = new FileInputStream(archiveFile);
             BufferedInputStream bis = new BufferedInputStream(fis);
             BZip2CompressorInputStream bzIn = new BZip2CompressorInputStream(bis, true);
             TarArchiveInputStream tarIn = new TarArchiveInputStream(bzIn)) {
            TarArchiveEntry entry;
            byte[] buf = new byte[32768];
            while ((entry = tarIn.getNextEntry()) != null) {
                String name = entry.getName();
                if (name == null || name.isEmpty()) {
                    continue;
                }
                File outFile = new File(destDir, name);
                if (!outFile.getCanonicalPath().startsWith(destCanonical)) {
                    throw new IOException("Blocked unsafe tar path: " + name);
                }
                if (entry.isDirectory()) {
                    if (!outFile.exists() && !outFile.mkdirs()) {
                        throw new IOException("Cannot create dir: " + name);
                    }
                    continue;
                }
                File parent = outFile.getParentFile();
                if (parent != null && !parent.exists() && !parent.mkdirs()) {
                    throw new IOException("Cannot create parent dir: " + parent.getName());
                }
                try (FileOutputStream out = new FileOutputStream(outFile)) {
                    int len;
                    while ((len = tarIn.read(buf)) != -1) {
                        out.write(buf, 0, len);
                    }
                }
            }
        }
    }

    private static void flattenSingleRootDir(File dir) {
        File[] children = dir.listFiles();
        if (children == null || children.length != 1 || !children[0].isDirectory()) {
            return;
        }
        File nested = children[0];
        File[] grandChildren = nested.listFiles();
        if (grandChildren != null) {
            for (File item : grandChildren) {
                File dest = new File(dir, item.getName());
                //noinspection ResultOfMethodCallIgnored
                item.renameTo(dest);
            }
        }
        deleteRecursive(nested);
    }

    private static File findFirstBySuffix(File dir, String suffix) {
        File[] children = dir.listFiles();
        if (children == null) {
            return null;
        }
        for (File f : children) {
            if (f.isFile() && f.getName().endsWith(suffix)) {
                return f;
            }
        }
        for (File f : children) {
            if (f.isDirectory() && !f.getName().startsWith(".")) {
                File hit = findFirstBySuffix(f, suffix);
                if (hit != null) {
                    return hit;
                }
            }
        }
        return null;
    }

    private static File findNamedFile(File dir, String exactName) {
        File[] children = dir.listFiles();
        if (children == null) {
            return null;
        }
        for (File f : children) {
            if (f.isFile() && exactName.equals(f.getName())) {
                return f;
            }
        }
        for (File f : children) {
            if (f.isDirectory() && !f.getName().startsWith(".")) {
                File hit = findNamedFile(f, exactName);
                if (hit != null) {
                    return hit;
                }
            }
        }
        return null;
    }

    private static File findNamedDir(File dir, String exactName) {
        File[] children = dir.listFiles();
        if (children == null) {
            return null;
        }
        for (File f : children) {
            if (f.isDirectory() && exactName.equals(f.getName())) {
                return f;
            }
        }
        return null;
    }

    private static List<File> collectLexicons(File dir) {
        List<File> out = new ArrayList<>();
        File[] children = dir.listFiles();
        if (children == null) {
            return out;
        }
        for (File f : children) {
            if (f.isFile()) {
                String name = f.getName();
                if ("lexicon.txt".equals(name) || (name.startsWith("lexicon-") && name.endsWith(".txt"))) {
                    out.add(f);
                }
            }
        }
        boolean hasUsEn = false;
        for (File f : out) {
            if ("lexicon-us-en.txt".equals(f.getName())) {
                hasUsEn = true;
                break;
            }
        }
        if (hasUsEn) {
            out.removeIf(f -> "lexicon-gb-en.txt".equals(f.getName()));
        }
        Collections.sort(out, (a, b) -> a.getName().compareTo(b.getName()));
        return out;
    }

    private static String joinPaths(List<File> files) {
        StringBuilder sb = new StringBuilder();
        for (File f : files) {
            if (sb.length() > 0) {
                sb.append(',');
            }
            sb.append(f.getAbsolutePath());
        }
        return sb.toString();
    }

    private static String joinExistingPaths(File... files) {
        StringBuilder sb = new StringBuilder();
        for (File f : files) {
            if (f != null && f.exists()) {
                if (sb.length() > 0) {
                    sb.append(',');
                }
                sb.append(f.getAbsolutePath());
            }
        }
        return sb.toString();
    }

    private static void deleteRecursive(File target) {
        if (target == null || !target.exists()) {
            return;
        }
        if (target.isDirectory()) {
            File[] children = target.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursive(child);
                }
            }
        }
        //noinspection ResultOfMethodCallIgnored
        target.delete();
    }
}
