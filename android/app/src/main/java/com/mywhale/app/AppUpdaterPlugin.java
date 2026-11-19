package com.mywhale.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
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
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.zip.ZipFile;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String ALLOWED_PREFIX = "https://github.com/YangJin-Lei/my-whale/";
    private static final String ALLOWED_RELEASE_PATH =
        "https://github.com/YangJin-Lei/my-whale/releases/download/";
    private static final String APK_MIME = "application/vnd.android.package-archive";
    private static final int MAX_REDIRECTS = 6;
    private static final long MIN_VALID_APK_BYTES = 1_000_000L;

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
        if (url.endsWith("-android-debug.apk")) {
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

    private static String sanitizeTag(String tag) {
        if (tag == null || tag.trim().isEmpty()) {
            return "latest";
        }
        return tag.trim().replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private File getUpdatesDir() {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private void cleanupOldApkFiles(File keepFile) {
        File legacy = new File(getContext().getCacheDir(), "my-whale-update.apk");
        if (legacy.exists()) {
            //noinspection ResultOfMethodCallIgnored
            legacy.delete();
        }
        File[] files = getUpdatesDir().listFiles();
        if (files == null) {
            return;
        }
        for (File f : files) {
            if (keepFile == null || !f.getAbsolutePath().equals(keepFile.getAbsolutePath())) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
    }

    @SuppressWarnings("deprecation")
    private long getLongVersionCode(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return info.getLongVersionCode();
        }
        return info.versionCode;
    }

    @SuppressWarnings("deprecation")
    private Set<String> getSigningCertSha256Set(PackageInfo info) {
        Set<String> certs = new HashSet<>();
        if (info == null) {
            return certs;
        }
        Signature[] signatures = null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            SigningInfo signingInfo = info.signingInfo;
            if (signingInfo != null) {
                signatures = signingInfo.hasMultipleSigners()
                    ? signingInfo.getApkContentsSigners()
                    : signingInfo.getSigningCertificateHistory();
            }
        } else {
            signatures = info.signatures;
        }
        if (signatures != null) {
            for (Signature sig : signatures) {
                try {
                    MessageDigest md = MessageDigest.getInstance("SHA-256");
                    byte[] digest = md.digest(sig.toByteArray());
                    certs.add(toHex(digest));
                } catch (Exception ignored) {
                }
            }
        }
        return certs;
    }

    @SuppressWarnings("deprecation")
    private PackageInfo getInstalledPackageInfo(Context context) throws PackageManager.NameNotFoundException {
        PackageManager pm = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageInfo(
                context.getPackageName(),
                PackageManager.PackageInfoFlags.of(flags)
            );
        }
        return pm.getPackageInfo(context.getPackageName(), flags);
    }

    @SuppressWarnings("deprecation")
    private PackageInfo getArchivePackageInfo(Context context, String apkPath) {
        PackageManager pm = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return pm.getPackageArchiveInfo(
                apkPath,
                PackageManager.PackageInfoFlags.of(flags)
            );
        }
        return pm.getPackageArchiveInfo(apkPath, flags);
    }

    private static String toHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format(Locale.US, "%02x", b));
        }
        return sb.toString();
    }

    private static String computeFileSha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buf = new byte[16 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) {
                md.update(buf, 0, n);
            }
        }
        return toHex(md.digest());
    }

    private void verifyApkBeforeInstall(File apkFile, String expectedSha256) throws Exception {
        if (apkFile == null || !apkFile.exists() || apkFile.length() < MIN_VALID_APK_BYTES) {
            throw new IllegalStateException("APK_INCOMPLETE: 安装包大小异常");
        }

        if (expectedSha256 != null && !expectedSha256.trim().isEmpty()) {
            String actualHash = computeFileSha256(apkFile);
            if (!actualHash.equalsIgnoreCase(expectedSha256.trim())) {
                throw new IllegalStateException("APK_HASH_MISMATCH: 安装包 SHA-256 校验失败，可能已被篡改或损坏");
            }
        }

        try (ZipFile zip = new ZipFile(apkFile)) {
            if (zip.getEntry("AndroidManifest.xml") == null) {
                throw new IllegalStateException("APK_PARSE_FAILED: 安装包缺少 AndroidManifest.xml");
            }
        } catch (IllegalStateException err) {
            throw err;
        } catch (Exception err) {
            throw new IllegalStateException("APK_PARSE_FAILED: 安装包 ZIP 结构损坏");
        }

        Context context = getContext();
        PackageInfo archiveInfo = getArchivePackageInfo(context, apkFile.getAbsolutePath());
        if (archiveInfo == null) {
            throw new IllegalStateException("APK_PARSE_FAILED: 系统无法解析此安装包");
        }
        if (!context.getPackageName().equals(archiveInfo.packageName)) {
            throw new IllegalStateException("PACKAGE_MISMATCH: 安装包包名不匹配 (" + archiveInfo.packageName + ")");
        }

        PackageInfo installedInfo = getInstalledPackageInfo(context);
        long installedCode = getLongVersionCode(installedInfo);
        long archiveCode = getLongVersionCode(archiveInfo);
        if (archiveCode == installedCode) {
            throw new IllegalStateException(
                "SAME_VERSION: 下载包与当前已安装版本一致 (" + archiveInfo.versionName + " / code " + archiveCode + ")"
            );
        }
        if (archiveCode < installedCode) {
            throw new IllegalStateException(
                "DOWNGRADE_BLOCKED: 下载包版本 (" + archiveInfo.versionName + ") 低于当前版本 (" + installedInfo.versionName + ")"
            );
        }

        Set<String> installedCerts = getSigningCertSha256Set(installedInfo);
        Set<String> archiveCerts = getSigningCertSha256Set(archiveInfo);
        if (installedCerts.isEmpty() || archiveCerts.isEmpty()) {
            throw new IllegalStateException("SIGNATURE_UNREADABLE: 无法读取安装包签名证书");
        }
        boolean matches = false;
        for (String cert : archiveCerts) {
            if (installedCerts.contains(cert)) {
                matches = true;
                break;
            }
        }
        if (!matches) {
            String curShort = installedCerts.iterator().next().substring(0, 8);
            String newShort = archiveCerts.iterator().next().substring(0, 8);
            throw new IllegalStateException(
                "SIGNATURE_MISMATCH: 安装包签名不一致（当前=" + curShort + ", 新包=" + newShort + "），请先导出完整加密备份后再卸载重装正式版"
            );
        }
    }

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            Context context = getContext();
            PackageInfo info = getInstalledPackageInfo(context);
            Set<String> certs = getSigningCertSha256Set(info);
            String currentCert = certs.isEmpty() ? "" : certs.iterator().next();
            JSObject ret = new JSObject();
            ret.put("packageName", info.packageName);
            ret.put("versionCode", getLongVersionCode(info));
            ret.put("versionName", info.versionName != null ? info.versionName : "");
            ret.put("signingCertSha256", currentCert);
            ret.put("expectedReleaseCertSha256", BuildConfig.RELEASE_CERT_SHA256);
            ret.put("isFormalReleaseCert", BuildConfig.RELEASE_CERT_SHA256.equalsIgnoreCase(currentCert));
            ret.put("gitCommitSha", BuildConfig.GIT_COMMIT_SHA);
            ret.put("buildTimeUtc", BuildConfig.BUILD_TIME_UTC);
            call.resolve(ret);
        } catch (Exception err) {
            call.reject("Failed to inspect app info: " + err.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        if (!downloading.compareAndSet(false, true)) {
            call.reject("An update download is already in progress");
            return;
        }

        String tag = call.getString("tag", "latest");
        String expectedSha256 = call.getString("expectedSha256", "");
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
            String safeTag = sanitizeTag(tag);
            File updatesDir = getUpdatesDir();
            File outFile = new File(updatesDir, "my-whale-" + safeTag + ".apk");
            File tmpFile = new File(updatesDir, "my-whale-" + safeTag + ".apk.part");
            try {
                cleanupOldApkFiles(null);
                pendingApkFile = null;
                Exception lastError = null;

                for (String candidate : candidates) {
                    try {
                        downloadFileFollowingRedirects(candidate, tmpFile);
                        verifyApkBeforeInstall(tmpFile, expectedSha256);
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
                        String msg = err.getMessage() != null ? err.getMessage() : "";
                        if (msg.startsWith("SIGNATURE_MISMATCH:")
                            || msg.startsWith("SAME_VERSION:")
                            || msg.startsWith("DOWNGRADE_BLOCKED:")
                            || msg.startsWith("PACKAGE_MISMATCH:")) {
                            break;
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
        if (file == null || !file.exists()) {
            call.reject("No downloaded APK available");
            return;
        }
        try {
            verifyApkBeforeInstall(file, "");
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
                conn.setConnectTimeout(10_000);
                conn.setReadTimeout(35_000);
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

                String contentType = conn.getContentType();
                if (contentType != null) {
                    String lowerCt = contentType.toLowerCase(Locale.US);
                    if (lowerCt.startsWith("text/") || lowerCt.contains("application/json")) {
                        throw new IllegalStateException("Mirror returned unexpected content-type: " + contentType);
                    }
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

                if (totalBytes > 0 && receivedBytes != totalBytes) {
                    throw new IllegalStateException(
                        "APK_INCOMPLETE: 下载未完成 (" + receivedBytes + "/" + totalBytes + " bytes)"
                    );
                }
                if (receivedBytes < MIN_VALID_APK_BYTES) {
                    throw new IllegalStateException("APK_INCOMPLETE: 下载文件过小 (" + receivedBytes + " bytes)");
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
