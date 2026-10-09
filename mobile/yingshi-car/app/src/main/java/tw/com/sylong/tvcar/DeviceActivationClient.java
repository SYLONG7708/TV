package tw.com.sylong.tvcar;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class DeviceActivationClient {
    static final class Session {
        final String sessionId;
        final String userCode;
        final String pollSecret;
        final long expiresAt;
        final long pollAfterSeconds;

        Session(String sessionId, String userCode, String pollSecret, long expiresAt, long pollAfterSeconds) {
            this.sessionId = sessionId;
            this.userCode = userCode;
            this.pollSecret = pollSecret;
            this.expiresAt = expiresAt;
            this.pollAfterSeconds = Math.max(2L, Math.min(10L, pollAfterSeconds));
        }
    }

    static final class PollResult {
        final String status;
        final String licenseToken;
        final String entitlementKind;
        final String licenseDuration;
        final long licenseExpiresAt;

        PollResult(String status, String licenseToken, String entitlementKind,
                   String licenseDuration, long licenseExpiresAt) {
            this.status = status;
            this.licenseToken = licenseToken;
            this.entitlementKind = entitlementKind;
            this.licenseDuration = licenseDuration;
            this.licenseExpiresAt = licenseExpiresAt;
        }
    }

    private DeviceActivationClient() {
    }

    static Session start(Context context) throws Exception {
        JSONObject response = post("/api/v1/activation/start", installationJson(context));
        return new Session(
                response.getString("sessionId"),
                response.getString("userCode"),
                response.getString("pollSecret"),
                response.getLong("expiresAt"),
                response.optLong("pollAfterSeconds", 3L)
        );
    }

    static PollResult poll(Session session) throws Exception {
        JSONObject response = post(
                "/api/v1/activation/poll",
                new JSONObject()
                        .put("sessionId", session.sessionId)
                        .put("pollSecret", session.pollSecret)
        );
        return new PollResult(
                response.optString("status", "pending"),
                response.optString("licenseToken", ""),
                response.optString("entitlementKind", ""),
                response.optString("licenseDuration", ""),
                response.optLong("licenseExpiresAt", 0L)
        );
    }

    static void startTrial(Session session) throws Exception {
        post(
                "/api/v1/activation/trial-1year",
                new JSONObject()
                        .put("sessionId", session.sessionId)
                        .put("pollSecret", session.pollSecret)
        );
    }

    static String link(Context context, String linkToken) throws Exception {
        JSONObject body = installationJson(context).put("linkToken", linkToken);
        JSONObject response = post("/api/v1/activation/link", body);
        if (!"approved".equals(response.optString("status"))) {
            throw new IllegalStateException("跨 App 授權未完成");
        }
        String token = response.optString("licenseToken", "").trim();
        if (token.isEmpty()) throw new IllegalStateException("授權服務未回傳裝置憑證");
        return token;
    }

    static JSONObject installationJson(Context context) throws Exception {
        return new JSONObject()
                .put("product", BuildConfig.LICENSE_PRODUCT_ID)
                .put("packageName", context.getPackageName())
                .put("certSha256", DeviceLicenseManager.signingCertificateSha256(context))
                .put("publicKey", DeviceLicenseManager.publicKeyBase64(context))
                .put("deviceLabel", DeviceLicenseManager.deviceLabel())
                .put("androidIdHash", DeviceLicenseManager.androidIdHash(context));
    }

    private static JSONObject post(String path, JSONObject body) throws Exception {
        String base = BuildConfig.LICENSE_API_BASE_URL;
        if (base == null || !base.startsWith("https://")) {
            throw new IllegalStateException("授權伺服器必須使用 HTTPS");
        }
        HttpURLConnection connection = (HttpURLConnection) new URL(base.replaceAll("/+$", "") + path).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(20_000);
            connection.setDoOutput(true);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "SYLONG-Yingshi/" + BuildConfig.VERSION_NAME);
            byte[] requestBody = body.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(requestBody.length);
            connection.getOutputStream().write(requestBody);
            int status = connection.getResponseCode();
            InputStream stream = status >= 200 && status <= 299
                    ? connection.getInputStream()
                    : connection.getErrorStream();
            String raw = stream == null ? "" : readLimited(stream, 32 * 1024);
            JSONObject response;
            try {
                response = new JSONObject(raw);
            } catch (Exception ignored) {
                response = new JSONObject();
            }
            if (status < 200 || status > 299) {
                String message = response.optString("error", "授權服務暫時無法使用 (" + status + ")");
                throw new IllegalStateException(message);
            }
            return response;
        } finally {
            connection.disconnect();
        }
    }

    private static String readLimited(InputStream input, int maxBytes) throws Exception {
        try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[2048];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) >= 0) {
                total += read;
                if (total > maxBytes) throw new IllegalStateException("授權服務回應過大");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }
}
