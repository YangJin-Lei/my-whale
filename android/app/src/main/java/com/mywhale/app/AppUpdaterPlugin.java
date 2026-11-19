package com.mywhale.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String ALLOWED_PREFIX = "https://github.com/YangJin-Lei/my-whale/";
    private static final String ALLOWED_RELEASE_PATH =
        "https://github.com/YangJin-Lei/my-whale/releases/download/";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final int MAX_REDIRECTS = 6;
    private static final long MIN_VALID_APK_BYTES = 500_000L;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private volatile File pendingApkFile;

    private boolean isAllowedReleaseUrl(String raw) {
        if (raw == null || raw.isEmpty()) {
            return false;
        }
        String url = raw.trim();
        if (!url.startsWith("https://") || url.contains("?") || url.contains(" ")) {
            return false;
        }
        if (url.startsWith(ALLOWED_PREFIX)) {
            return url.endsWith(".apk");
        }
        int idx = url.indexOf(ALLOWED_RELEASE_PATH);
        return idx > "https://".length()
            && url.charAt(idx - 1) == '/'
            && url.endsWith(".apk");
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        if (!downloading.compareAndSet(false, true)) {
            call.reject("An update download is already in progress");
            return;
        }

        JSArray urlArray = call.getArray("urls");
        List<String> candidates = new ArrayList<>();
        if (urlArray != null) {
            for (int i = 0; i < urlArray.length(); i++) {
                String item = urlArray.optString(i, "").trim();
                if (isAllowedReleaseUrl(item)) {
                    candidates.add(item);
                }
            }
        }
        String singleUrl = call.getString("url");
        if (candidates.isEmpty() && isAllowedReleaseUrl(singleUrl)) {
            candidates.add(singleUrl.trim());
        }

        if (candidates.isEmpty()) {
            downloading.set(false);
            call.reject("No valid release download URL provided");
            return;
        }

        executor.execute(() -> {
            try {
                File outFile = new File(getContext().getCacheDir(), "my-whale-update.apk");
                File tmpFile = new File(getContext().getCacheDir(), "my-whale-update.apk.part");
                Exception lastError = null;

                for (String candidate : candidates) {
                    try {
                        downloadFileFollowingRedirects(candidate, tmpFile);
                        if (tmpFile.length() < MIN_VALID_APK_BYTES) {
                            throw new IllegalStateException("Downloaded APK is smaller than expected");
                        }
                        if (outFile.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            outFile.delete();
                        }
                        if (!tmpFile.renameTo(outFile)) {
                            throw new IllegalStateException("Failed to prepare downloaded APK");
                        }
                        pendingApkFile = outFile;
                        String status = launchApkInstaller(outFile);
                        JSObject result = new JSObject();
                        result.put("status", status);
                        call.resolve(result);
                        return;
                    } catch (Exception err) {
                        lastError = err;
                        if (tmpFile.exists()) {
                            //noinspection ResultOfMethodCallIgnored
                            tmpFile.delete();
                        }
                    }
                }

                call.reject(lastError != null && lastError.getMessage() != null
                    ? lastError.getMessage()
                    : "Failed to download APK");
            } finally {
                downloading.set(false);
            }
        });
    }

    @PluginMethod
    public void installPending(PluginCall call) {
        File file = pendingApkFile;
        if (file == null || !file.exists() || file.length() < MIN_VALID_APK_BYTES) {
            call.reject("No downloaded APK available");
            return;
        }
        try {
            String status = launchApkInstaller(file);
            JSObject result = new JSObject();
            result.put("status", status);
            call.resolve(result);
        } catch (Exception err) {
            call.reject(err.getMessage() != null ? err.getMessage() : "Failed to open installer");
        }
    }

    @PluginMethod
    public void openDeepSeekApp(PluginCall call) {
        try {
            Intent launch = getContext().getPackageManager().getLaunchIntentForPackage("com.deepseek.chat");
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(launch);
                JSObject res = new JSObject();
                res.put("launched", true);
                call.resolve(res);
                return;
            }
        } catch (Exception ignored) {
        }
        JSObject res = new JSObject();
        res.put("launched", false);
        call.resolve(res);
    }

    private void downloadFileFollowingRedirects(String initialUrl, File targetFile) throws Exception {
        String currentUrl = initialUrl;
        HttpURLConnection conn = null;

        try {
            for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
                URL parsed = new URL(currentUrl);
                conn = (HttpURLConnection) parsed.openConnection();
                conn.setInstanceFollowRedirects(false);
                conn.setConnectTimeout(8_000);
                conn.setReadTimeout(25_000);
                conn.setRequestProperty("User-Agent", "my-whale-android-updater");

                int code = conn.getResponseCode();
                if (code >= 300 && code < 400) {
                    String location = conn.getHeaderField("Location");
                    conn.disconnect();
                    conn = null;
                    if (location == null || location.isEmpty()) {
                        throw new IllegalStateException("Redirect location missing");
                    }
                    URL resolved = new URL(parsed, location);
                    if (!"https".equalsIgnoreCase(resolved.getProtocol())) {
                        throw new SecurityException("Blocked non-HTTPS redirect");
                    }
                    currentUrl = resolved.toString();
                    continue;
                }

                if (code != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("HTTP " + code);
                }

                long totalBytes = conn.getContentLengthLong();
                long receivedBytes = 0L;
                int lastPercent = -1;

                try (InputStream in = new BufferedInputStream(conn.getInputStream());
                     FileOutputStream out = new FileOutputStream(targetFile, false)) {
                    byte[] buffer = new byte[16 * 1024];
                    int read;
                    while ((read = in.read(buffer)) != -1) {
                        out.write(buffer, 0, read);
                        receivedBytes += read;
                        if (totalBytes > 0) {
                            int percent = (int) Math.min(100L, (receivedBytes * 100L) / totalBytes);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                emitProgress(percent, receivedBytes, totalBytes);
                            }
                        } else if (receivedBytes % (256 * 1024) < buffer.length) {
                            emitProgress(-1, receivedBytes, totalBytes);
                        }
                    }
                    out.flush();
                }

                emitProgress(100, receivedBytes, totalBytes > 0 ? totalBytes : receivedBytes);
                return;
            }
            throw new IllegalStateException("Too many redirects");
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private void emitProgress(int progress, long received, long total) {
        JSObject payload = new JSObject();
        payload.put("progress", progress);
        payload.put("received", received);
        payload.put("total", total);
        notifyListeners("downloadProgress", payload);
    }

    private String launchApkInstaller(File apkFile) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && !context.getPackageManager().canRequestPackageInstalls()) {
            Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            permIntent.setData(Uri.parse("package:" + context.getPackageName()));
            permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(permIntent);
            return "needs_permission";
        }

        Uri apkUri = FileProvider.getUriForFile(
            context,
            context.getPackageName() + ".fileprovider",
            apkFile
        );
        Intent installIntent = new Intent(Intent.ACTION_VIEW);
        installIntent.setDataAndType(apkUri, APK_MIME);
        installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(installIntent);
        return "installer_opened";
    }
}
