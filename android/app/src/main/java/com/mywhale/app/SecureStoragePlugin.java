package com.mywhale.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureStorage")
public class SecureStoragePlugin extends Plugin {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String KEY_ALIAS = "mywhale_api_key_master_v1";
    private static final String PREFS_NAME = "mywhale_secure_prefs";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_IV_LEN = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final Pattern VALID_KEY_PATTERN = Pattern.compile("^[a-zA-Z0-9:_-]{1,64}$");

    private boolean isTrustedCaller() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return false;
        }
        String localUrl = getBridge().getLocalUrl();
        return localUrl == null || localUrl.startsWith("https://localhost") || localUrl.startsWith("http://localhost");
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
        keyStore.load(null);
        KeyStore.Entry entry = keyStore.getEntry(KEY_ALIAS, null);
        if (entry instanceof KeyStore.SecretKeyEntry) {
            return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
        }
        KeyGenerator keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            KEYSTORE_PROVIDER
        );
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", isTrustedCaller());
        ret.put("backend", "android-keystore-aes-gcm");
        call.resolve(ret);
    }

    @PluginMethod
    public void setSecret(PluginCall call) {
        if (!isTrustedCaller()) {
            call.reject("Untrusted WebView origin");
            return;
        }
        String key = call.getString("key");
        String value = call.getString("value");
        if (key == null || !VALID_KEY_PATTERN.matcher(key).matches()) {
            call.reject("Invalid secret key");
            return;
        }
        if (value == null || value.isEmpty()) {
            getPrefs().edit().remove(key).apply();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
            return;
        }
        try {
            SecretKey secretKey = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);
            String encoded = Base64.encodeToString(combined, Base64.NO_WRAP);
            getPrefs().edit().putString(key, encoded).apply();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception err) {
            call.reject("Failed to encrypt secret");
        }
    }

    @PluginMethod
    public void getSecret(PluginCall call) {
        if (!isTrustedCaller()) {
            call.reject("Untrusted WebView origin");
            return;
        }
        String key = call.getString("key");
        if (key == null || !VALID_KEY_PATTERN.matcher(key).matches()) {
            call.reject("Invalid secret key");
            return;
        }
        String encoded = getPrefs().getString(key, null);
        JSObject ret = new JSObject();
        ret.put("backend", "android-keystore-aes-gcm");
        if (encoded == null || encoded.isEmpty()) {
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
            return;
        }
        try {
            byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
            if (combined.length <= GCM_IV_LEN) {
                ret.put("value", JSObject.NULL);
                call.resolve(ret);
                return;
            }
            byte[] iv = new byte[GCM_IV_LEN];
            byte[] cipherBytes = new byte[combined.length - GCM_IV_LEN];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_LEN);
            System.arraycopy(combined, GCM_IV_LEN, cipherBytes, 0, cipherBytes.length);
            SecretKey secretKey = getOrCreateSecretKey();
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] plain = cipher.doFinal(cipherBytes);
            ret.put("value", new String(plain, StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception err) {
            // Keystore 密钥随卸载/重装或恢复失效时安全清除坏密文，不抛崩溃
            getPrefs().edit().remove(key).apply();
            ret.put("value", JSObject.NULL);
            ret.put("invalidated", true);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void removeSecret(PluginCall call) {
        if (!isTrustedCaller()) {
            call.reject("Untrusted WebView origin");
            return;
        }
        String key = call.getString("key");
        if (key == null || !VALID_KEY_PATTERN.matcher(key).matches()) {
            call.reject("Invalid secret key");
            return;
        }
        getPrefs().edit().remove(key).apply();
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }
}
