package tw.com.sylong.tvcar;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONObject;

/** Bounded, private on-device evidence. No titles, URLs, searches or license data. */
final class PlaybackDiagnostics {
    private static final int LIMIT = 64;
    private static final long MAX_AGE = 7L * 24 * 60 * 60 * 1000;
    private final SharedPreferences prefs;
    private JSONArray events = new JSONArray();
    private JSONObject latest = new JSONObject();
    private long lastPersisted;
    private long lastEventAt;
    private String lastEvent = "";

    PlaybackDiagnostics(Context context) {
        prefs = context.getSharedPreferences("playback_diagnostics_v1", Context.MODE_PRIVATE);
        try { events = new JSONArray(prefs.getString("events", "[]")); } catch (Exception ignored) { }
        try { latest = new JSONObject(prefs.getString("latest", "{}")); } catch (Exception ignored) { }
        prune();
    }

    private void prune() {
        JSONArray kept = new JSONArray();
        long oldest = System.currentTimeMillis() - MAX_AGE;
        for (int i = Math.max(0, events.length() - LIMIT); i < events.length(); i++) {
            JSONObject event = events.optJSONObject(i);
            if (event != null && event.optLong("at") >= oldest) kept.put(event);
        }
        events = kept;
    }

    private static JSONObject parse(String value) {
        try { return value != null && value.length() <= 16384 ? new JSONObject(value) : new JSONObject(); }
        catch (Exception ignored) { return new JSONObject(); }
    }

    private static void revision(JSONObject out, JSONObject input, String key) throws Exception {
        String value = input.optString(key);
        if (value.matches("(?:local|[a-f0-9]{40}|[0-9]{8}\\.[0-9]{1,4})")) out.put(key, value);
    }

    private static JSONObject numbers(JSONObject input, String... keys) throws Exception {
        JSONObject out = new JSONObject();
        if (input == null) return out;
        for (String key : keys) {
            Object value = input.opt(key);
            if (value instanceof Boolean) out.put(key, value);
            else if (value instanceof Number) {
                double number = ((Number) value).doubleValue();
                if (!Double.isNaN(number) && !Double.isInfinite(number) && number >= -1 && number <= 1e13) out.put(key, value);
            }
        }
        return out;
    }

    void snapshot(String message, boolean bundled, int webViewMajor) {
        try {
            JSONObject input = parse(message);
            JSONObject out = numbers(input, "ready", "sources", "indexedRecords", "loadedItems", "liveChannels");
            out.put("at", System.currentTimeMillis()).put("versionCode", BuildConfig.VERSION_CODE);
            out.put("bundled", bundled).put("webViewMajor", webViewMajor);
            revision(out, input, "codeRevision"); revision(out, input, "playerRevision");
            out.put("media", numbers(input.optJSONObject("media"), "active", "time", "paused", "width", "height", "frames", "ready", "error", "youtubeState"));
            out.put("session", numbers(input.optJSONObject("session"), "attempts", "remaining", "loading", "waiting"));
            out.put("update", numbers(input.optJSONObject("update"), "lastCheckedAt", "pending", "failures"));
            latest = out;
            Log.i("YingshiCar", "diagnostic_snapshot=" + out);
            persist(false);
        } catch (Exception ignored) { }
    }

    void event(String kind, String message) {
        if (!kind.matches("(?:ready|playing|failure|stall|boot_timeout|page_failure|renderer_recovered|cloud_retry|console_error)")) return;
        long now = System.currentTimeMillis();
        if (kind.equals(lastEvent) && now - lastEventAt < 3000) return;
        lastEvent = kind; lastEventAt = now;
        try {
            JSONObject input = parse(message);
            JSONObject out = numbers(input, "startupMs", "height");
            out.put("at", System.currentTimeMillis()).put("event", kind).put("versionCode", BuildConfig.VERSION_CODE);
            String category = input.optString("category");
            if (category.matches("(?:offline|buffer|media|source|unknown)")) out.put("category", category);
            events.put(out); prune(); persist(true);
            Log.i("YingshiCar", "diagnostic_event=" + out);
        } catch (Exception ignored) { }
    }

    void playback(String message) {
        JSONObject input = parse(message);
        event(input.optString("event"), message);
    }

    void persist(boolean force) {
        long now = System.currentTimeMillis();
        if (!force && now - lastPersisted < 60000) return;
        lastPersisted = now;
        prefs.edit().putString("events", events.toString()).putString("latest", latest.toString()).apply();
    }

    String dump() {
        prune();
        try { return new JSONObject().put("schemaVersion", 1).put("latest", latest).put("events", events).toString(); }
        catch (Exception ignored) { return "{}"; }
    }
}
