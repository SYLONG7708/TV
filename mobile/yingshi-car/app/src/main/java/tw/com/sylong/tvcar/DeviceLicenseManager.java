package tw.com.sylong.tvcar;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import android.provider.Settings;
import android.security.KeyPairGeneratorSpec;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import org.json.JSONObject;

import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Calendar;
import java.util.Locale;

import javax.security.auth.x500.X500Principal;

final class DeviceLicenseManager {
    private static final String PREFS = "yingshi_cloud_device_license";
    private static final String LEGACY_PREFS = "yingshi_license";
    private static final String KEY_TOKEN = "signed_license_token";
    private static final String KEY_LEGACY_REMOVED = "legacy_offline_license_removed";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "sylong.yingshi.device.license.v1";
    private static final long CLOCK_SKEW_SECONDS = 300L;

    static final class Status {
        final boolean valid;
        final String message;

        Status(boolean valid, String message) {
            this.valid = valid;
            this.message = message;
        }
    }

    private DeviceLicenseManager() {
    }

    static boolean isLicensed(Context context) {
        return status(context).valid;
    }

    static boolean hasStoredToken(Context context) {
        String token = prefs(context).getString(KEY_TOKEN, "");
        return token != null && !token.trim().isEmpty();
    }

    static Status status(Context context) {
        if (!BuildConfig.REQUIRE_LICENSE) {
            return new Status(true, "正式免授權版");
        }
        removeLegacyLicenseState(context);
        String token = prefs(context).getString(KEY_TOKEN, "");
        if (token == null || token.trim().isEmpty()) {
            return invalid("尚未綁定這台車機");
        }
        return verifyToken(context, token, System.currentTimeMillis() / 1000L);
    }

    static Status installToken(Context context, String token) {
        Status result = verifyToken(context, token, System.currentTimeMillis() / 1000L);
        if (!result.valid) {
            return result;
        }
        prefs(context).edit().putString(KEY_TOKEN, token.trim()).apply();
        return new Status(true, "裝置綁定授權有效");
    }

    static String publicKeyBase64(Context context) {
        try {
            return Base64.encodeToString(
                    ensureKeyEntry(context).getCertificate().getPublicKey().getEncoded(),
                    Base64.NO_WRAP
            );
        } catch (Exception error) {
            throw new IllegalStateException("無法建立裝置安全金鑰", error);
        }
    }

    static String publicKeySha256(Context context) {
        try {
            return sha256Hex(ensureKeyEntry(context).getCertificate().getPublicKey().getEncoded());
        } catch (Exception error) {
            throw new IllegalStateException("無法讀取裝置安全金鑰", error);
        }
    }

    @SuppressLint("HardwareIds")
    static String androidIdHash(Context context) {
        String androidId = Settings.Secure.getString(context.getContentResolver(), Settings.Secure.ANDROID_ID);
        if (androidId == null) {
            androidId = "";
        }
        return sha256Hex((context.getPackageName() + "|" + androidId.trim()).getBytes(StandardCharsets.UTF_8));
    }

    static String deviceLabel() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String label = (manufacturer + " " + model).trim();
        return label.isEmpty() ? "Android 車機" : label.substring(0, Math.min(label.length(), 80));
    }

    static String signingCertificateSha256(Context context) {
        try {
            PackageManager manager = context.getPackageManager();
            PackageInfo info;
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                info = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNING_CERTIFICATES);
                if (info.signingInfo == null) {
                    return "";
                }
                signatures = info.signingInfo.hasMultipleSigners()
                        ? info.signingInfo.getApkContentsSigners()
                        : info.signingInfo.getSigningCertificateHistory();
            } else {
                info = manager.getPackageInfo(context.getPackageName(), PackageManager.GET_SIGNATURES);
                signatures = info.signatures;
            }
            if (signatures == null || signatures.length == 0) {
                return "";
            }
            return sha256Hex(signatures[0].toByteArray());
        } catch (Exception ignored) {
            return "";
        }
    }

    static Status verifyToken(Context context, String token, long nowSeconds) {
        try {
            String[] parts = token == null ? new String[0] : token.trim().split("\\.");
            if (parts.length != 3 || !"SML1".equals(parts[0])) {
                return invalid("授權格式錯誤");
            }
            byte[] publicBytes = Base64.decode(BuildConfig.LICENSE_PUBLIC_KEY_SPKI_B64, Base64.DEFAULT);
            java.security.PublicKey publicKey = KeyFactory.getInstance("RSA")
                    .generatePublic(new X509EncodedKeySpec(publicBytes));
            java.security.Signature verifier = java.security.Signature.getInstance("SHA256withRSA");
            verifier.initVerify(publicKey);
            verifier.update(parts[1].getBytes(StandardCharsets.US_ASCII));
            if (!verifier.verify(decodeBase64Url(parts[2]))) {
                return invalid("授權簽章驗證失敗");
            }

            JSONObject claims = new JSONObject(new String(decodeBase64Url(parts[1]), StandardCharsets.UTF_8));
            if (claims.optInt("version") != 1) return invalid("授權版本不相容");
            if (!"https://license.sylong.tw".equals(claims.optString("iss"))) return invalid("授權簽發者不相符");
            if (!BuildConfig.LICENSE_PRODUCT_ID.equals(claims.optString("aud"))) return invalid("授權產品不相符");
            if (!claims.optBoolean("offline", false)) return invalid("授權模式不相容");
            if (!context.getPackageName().equals(claims.optString("packageName"))) return invalid("授權 App 身分不符");
            if (!normalize(claims.optString("certSha256")).equals(normalize(signingCertificateSha256(context)))) {
                return invalid("授權 App 簽章不符");
            }
            JSONObject confirmation = claims.optJSONObject("cnf");
            if (confirmation == null || !normalize(confirmation.optString("sha256"))
                    .equals(normalize(publicKeySha256(context)))) {
                return invalid("授權不屬於這台車機");
            }
            if (claims.optLong("nbf", Long.MAX_VALUE) > nowSeconds + CLOCK_SKEW_SECONDS) {
                return invalid("裝置時間或授權生效時間不正確");
            }
            if (claims.optLong("iat", Long.MAX_VALUE) > nowSeconds + CLOCK_SKEW_SECONDS) {
                return invalid("裝置時間或授權簽發時間不正確");
            }
            if (claims.optLong("exp", 0L) <= nowSeconds) {
                return invalid("授權已到期");
            }
            return new Status(true, "裝置綁定授權有效");
        } catch (Exception error) {
            return invalid(error.getMessage() == null ? "授權驗證失敗" : error.getMessage());
        }
    }

    @SuppressWarnings("deprecation")
    private static KeyStore.PrivateKeyEntry ensureKeyEntry(Context context) throws Exception {
        KeyStore keyStore = KeyStore.getInstance(KEYSTORE);
        keyStore.load(null);
        KeyStore.Entry existing = keyStore.getEntry(KEY_ALIAS, null);
        if (existing instanceof KeyStore.PrivateKeyEntry) {
            return (KeyStore.PrivateKeyEntry) existing;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE);
            generator.initialize(new KeyGenParameterSpec.Builder(
                    KEY_ALIAS,
                    KeyProperties.PURPOSE_SIGN | KeyProperties.PURPOSE_VERIFY
            )
                    .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256)
                    .setUserAuthenticationRequired(false)
                    .build());
            generator.generateKeyPair();
        } else {
            Calendar start = Calendar.getInstance();
            Calendar end = Calendar.getInstance();
            end.add(Calendar.YEAR, 30);
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA", KEYSTORE);
            generator.initialize(new KeyPairGeneratorSpec.Builder(context)
                    .setAlias(KEY_ALIAS)
                    .setSubject(new X500Principal("CN=SYLONG Yingshi Device License"))
                    .setSerialNumber(BigInteger.ONE)
                    .setStartDate(start.getTime())
                    .setEndDate(end.getTime())
                    .build());
            generator.generateKeyPair();
        }

        KeyStore.Entry created = keyStore.getEntry(KEY_ALIAS, null);
        if (!(created instanceof KeyStore.PrivateKeyEntry)) {
            throw new IllegalStateException("無法建立裝置安全金鑰");
        }
        return (KeyStore.PrivateKeyEntry) created;
    }

    private static byte[] decodeBase64Url(String value) {
        return Base64.decode(value.replace('-', '+').replace('_', '/'), Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String sha256Hex(byte[] value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value);
            StringBuilder result = new StringBuilder(digest.length * 2);
            for (byte item : digest) result.append(String.format(Locale.US, "%02X", item));
            return result.toString();
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    private static String normalize(String value) {
        return value == null ? "" : value.replace(":", "").toUpperCase(Locale.US);
    }

    private static Status invalid(String message) {
        return new Status(false, message);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void removeLegacyLicenseState(Context context) {
        SharedPreferences cloudPreferences = prefs(context);
        if (cloudPreferences.getBoolean(KEY_LEGACY_REMOVED, false)) {
            return;
        }
        context.getApplicationContext()
                .getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply();
        cloudPreferences.edit().putBoolean(KEY_LEGACY_REMOVED, true).apply();
    }
}
