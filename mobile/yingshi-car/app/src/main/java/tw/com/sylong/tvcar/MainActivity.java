package tw.com.sylong.tvcar;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ConsoleMessage;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class MainActivity extends Activity {
    private static final String TAG = "YingshiCar";
    private static final String HOME_URL = "https://sylong7708.github.io/TV/docs/iphone/index.html";
    private static final String COMPAT_ASSET = "iphone/index.html";
    private static final String APP_USER_AGENT_TOKEN = "YingshiCar/3.0";
    private static final int ONLINE_MODULE_MIN_CHROME = 89;
    // Production receives player fixes from the trusted cloud page. The bundled
    // identical player remains available after network/boot failure and for QA.
    private static final boolean USE_BUNDLED_UI = BuildConfig.DEBUG;
    private static final long BOOT_TIMEOUT_MS = 22000L;
    private static final long LICENSE_RECHECK_MS = 60000L;
    public static final String ACTION_VOICE_COMMAND = "tw.com.sylong.tvcar.action.VOICE_COMMAND";
    public static final String EXTRA_VOICE_COMMAND = "tw.com.sylong.tvcar.extra.VOICE_COMMAND";
    public static final String EXTRA_VOICE_QUERY = "tw.com.sylong.tvcar.extra.VOICE_QUERY";
    private static final String DIRECT_PACKAGE = "tw.com.sylong.tvcar.direct";
    private static final int MAX_PENDING_VOICE_COMMANDS = 8;
    private static final Set<String> SUPPORTED_VOICE_COMMANDS = new HashSet<>(Arrays.asList(
            "OPEN", "HOME", "MOVIE", "SERIES", "SHORT", "ANIME", "VARIETY",
            "SEARCH", "PLAY_SEARCH", "LIVE", "PLAY_LIVE", "FULLSCREEN_ON",
            "FULLSCREEN_OFF", "PLAY", "PAUSE", "NEXT", "PREVIOUS", "STOP",
            "CLOSE_PLAYER", "SEEK_FORWARD", "SEEK_BACKWARD", "RESTART"
    ));

    private FrameLayout root;
    private WebView webView;
    private static final int SUBTITLE_REQUEST = 7301;
    private ValueCallback<Uri[]> subtitleCallback;
    private TextView statusView;
    private View customView;
    private FrameLayout customViewContainer;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private android.widget.Button nativeRestoreButton;
    private android.widget.Button nativeCloseButton;
    private View nativeExitControls;
    private boolean nativeRevealTouch;
    private boolean nativeControlsTouchActive;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable hideNativeExitControls = () -> {
        if (nativeExitControls != null && !nativeControlsTouchActive) {
            nativeExitControls.setVisibility(View.INVISIBLE);
            if (customViewContainer != null) customViewContainer.requestFocus();
        }
    };
    private final Runnable licenseRecheck = this::checkActiveLicense;
    private volatile boolean serveBundledPage;
    private boolean pageReady;
    private int webViewChromeMajor;
    private int bootGeneration;
    private PlaybackDiagnostics diagnostics;
    private final Runnable collectDiagnostics = new Runnable() {
        @Override public void run() {
            if (webView != null && pageReady && isTrustedUiPage()) {
                webView.evaluateJavascript("JSON.stringify(window.YingshiDiagnostics?.snapshot?.()||{})", value -> {
                    try {
                        Object decoded = new org.json.JSONTokener(value).nextValue();
                        if (decoded instanceof String && diagnostics != null) diagnostics.snapshot((String) decoded, serveBundledPage, webViewChromeMajor);
                    } catch (Exception ignored) { }
                });
            }
            mainHandler.postDelayed(this, 10000);
        }
    };
    private final ArrayDeque<VoiceRequest> pendingVoiceRequests = new ArrayDeque<>();
    private final Object phoneticLock = new Object();
    private android.icu.text.Transliterator hanLatinTransliterator;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        diagnostics = new PlaybackDiagnostics(this);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

        root = new FrameLayout(this);
        root.setBackgroundColor(0xff050507);
        setContentView(root);

        statusView = new TextView(this);
        statusView.setText("影視 載入中");
        statusView.setTextColor(0xfff5f5f7);
        statusView.setTextSize(18f);
        statusView.setGravity(Gravity.CENTER);
        statusView.setBackgroundColor(0xff050507);
        root.addView(statusView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        hideSystemUi();
        receiveVoiceIntent(getIntent());
        handleLicenseIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        receiveVoiceIntent(intent);
        handleLicenseIntent(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        if (BuildConfig.REQUIRE_LICENSE && !DeviceLicenseManager.isLicensed(this)) {
            openLicenseScreen();
            return;
        }
        scheduleLicenseRecheck();
        mainHandler.removeCallbacks(collectDiagnostics);
        mainHandler.post(collectDiagnostics);
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
    }

    @Override
    protected void onPause() {
        mainHandler.removeCallbacks(licenseRecheck);
        mainHandler.removeCallbacks(collectDiagnostics);
        if (diagnostics != null) diagnostics.persist(true);
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (subtitleCallback != null) { subtitleCallback.onReceiveValue(null); subtitleCallback = null; }
        if (customView != null) {
            hideCustomView();
        }
        if (webView != null) {
            root.removeView(webView);
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        bootGeneration += 1;
        mainHandler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
        }
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        hideSystemUi();
        if (webView != null) {
            injectDeviceProfile(webView);
        }
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (webView != null && level >= TRIM_MEMORY_RUNNING_LOW) {
            webView.clearCache(false);
        }
    }

    @Override
    public void onLowMemory() {
        if (webView != null) {
            webView.clearCache(false);
        }
        super.onLowMemory();
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
            return;
        }
        if (webView != null && pageReady && isTrustedUiPage()) {
            webView.evaluateJavascript("Boolean(window.YingshiHandleBack&&window.YingshiHandleBack())", value -> {
                if (!"true".equals(value)) navigateBackOrBackground();
            });
            return;
        }
        navigateBackOrBackground();
    }

    private void navigateBackOrBackground() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        moveTaskToBack(true);
    }

    @Override
    public boolean dispatchTouchEvent(MotionEvent event) {
        if (customView != null && nativeExitControls != null) {
            if (event.getActionMasked() == MotionEvent.ACTION_DOWN) {
                nativeRevealTouch = nativeExitControls.getVisibility() != View.VISIBLE;
                nativeControlsTouchActive = true;
                revealNativeExitControls();
            } else if (event.getActionMasked() == MotionEvent.ACTION_UP
                    || event.getActionMasked() == MotionEvent.ACTION_CANCEL) {
                nativeControlsTouchActive = false;
                revealNativeExitControls();
                if (nativeRevealTouch) { nativeRevealTouch = false; return true; }
            }
            // Consume the complete first tap, including at an old exit-button
            // position, so revealing an invisible control cannot activate it.
            if (nativeRevealTouch) return true;
        }
        return super.dispatchTouchEvent(event);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_ESCAPE) {
            if (event.getAction() == KeyEvent.ACTION_UP) onBackPressed();
            return true;
        }
        if (webView != null && event.getAction() == KeyEvent.ACTION_UP && event.getKeyCode() == KeyEvent.KEYCODE_MENU) {
            reloadLatest();
            return true;
        }
        String remoteKey = remoteKeyName(event.getKeyCode());
        if (customView != null && nativeRestoreButton != null && nativeCloseButton != null
                && ("ENTER".equals(remoteKey) || "UP".equals(remoteKey) || "DOWN".equals(remoteKey)
                || "LEFT".equals(remoteKey) || "RIGHT".equals(remoteKey))) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                boolean wasHidden = nativeExitControls != null && nativeExitControls.getVisibility() != View.VISIBLE;
                revealNativeExitControls();
                if (wasHidden) { nativeRestoreButton.requestFocus(); return true; }
                if ("ENTER".equals(remoteKey)) {
                    (nativeCloseButton.hasFocus() ? nativeCloseButton : nativeRestoreButton).performClick();
                } else {
                    ("RIGHT".equals(remoteKey) || "DOWN".equals(remoteKey)
                            ? nativeCloseButton : nativeRestoreButton).requestFocus();
                }
            }
            return true;
        }
        if (customView == null && webView != null && pageReady && remoteKey != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN
                    && (event.getRepeatCount() == 0 || !"ENTER".equals(remoteKey))) {
                String script = "window.__yingshiTvRemote&&window.__yingshiTvRemote.handle("
                        + JSONObject.quote(remoteKey) + ")";
                webView.evaluateJavascript(script, null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private String remoteKeyName(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_DPAD_UP:
                return "UP";
            case KeyEvent.KEYCODE_DPAD_DOWN:
                return "DOWN";
            case KeyEvent.KEYCODE_DPAD_LEFT:
                return "LEFT";
            case KeyEvent.KEYCODE_DPAD_RIGHT:
                return "RIGHT";
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER:
            case KeyEvent.KEYCODE_BUTTON_A:
                return "ENTER";
            case KeyEvent.KEYCODE_PAGE_UP:
            case KeyEvent.KEYCODE_CHANNEL_UP:
                return "PAGE_UP";
            case KeyEvent.KEYCODE_PAGE_DOWN:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
                return "PAGE_DOWN";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
                return "PLAY_PAUSE";
            case KeyEvent.KEYCODE_MEDIA_PLAY:
                return "PLAY";
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                return "PAUSE";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                return "FAST_FORWARD";
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                return "REWIND";
            default:
                return null;
        }
    }

    private void handleLicenseIntent(Intent intent) {
        if (!BuildConfig.REQUIRE_LICENSE) {
            startWebView();
            return;
        }
        if (DeviceLicenseManager.isLicensed(this)) {
            scheduleLicenseRecheck();
            startWebView();
        } else if (forwardVoiceToDirectVariant(intent)) {
            finish();
        } else {
            startActivity(new Intent(this, CloudLicenseActivity.class));
            finish();
        }
    }

    private void scheduleLicenseRecheck() {
        mainHandler.removeCallbacks(licenseRecheck);
        if (BuildConfig.REQUIRE_LICENSE && !isFinishing()) {
            mainHandler.postDelayed(licenseRecheck, LICENSE_RECHECK_MS);
        }
    }

    private void checkActiveLicense() {
        if (!BuildConfig.REQUIRE_LICENSE || isFinishing()) {
            return;
        }
        if (!DeviceLicenseManager.isLicensed(this)) {
            openLicenseScreen();
            return;
        }
        scheduleLicenseRecheck();
    }

    private void openLicenseScreen() {
        mainHandler.removeCallbacks(licenseRecheck);
        if (customView != null) {
            hideCustomView();
        }
        try {
            startActivity(new Intent(this, CloudLicenseActivity.class)
                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        } finally {
            finish();
        }
    }

    private boolean forwardVoiceToDirectVariant(Intent source) {
        if (source == null || !ACTION_VOICE_COMMAND.equals(source.getAction())
                || DIRECT_PACKAGE.equals(getPackageName())) {
            return false;
        }
        try {
            if (!getPackageManager().getApplicationInfo(DIRECT_PACKAGE, 0).enabled) {
                return false;
            }
            Intent forwarded = new Intent(ACTION_VOICE_COMMAND);
            forwarded.setComponent(new android.content.ComponentName(DIRECT_PACKAGE, MainActivity.class.getName()));
            forwarded.putExtra(EXTRA_VOICE_COMMAND, source.getStringExtra(EXTRA_VOICE_COMMAND));
            forwarded.putExtra(EXTRA_VOICE_QUERY, source.getStringExtra(EXTRA_VOICE_QUERY));
            forwarded.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP
                    | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(forwarded);
            Log.i(TAG, "voice_forwarded_to_direct reason=cloud_license_unavailable");
            return true;
        } catch (PackageManager.NameNotFoundException | ActivityNotFoundException | SecurityException error) {
            Log.i(TAG, "voice_direct_fallback_unavailable");
            return false;
        }
    }

    private void startWebView() {
        if (webView != null) {
            drainVoiceRequests();
            return;
        }
        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        statusView.setText("影視 載入中");
        statusView.setVisibility(View.VISIBLE);
        hideSystemUi();
        loadHome(false);
    }

    private void receiveVoiceIntent(Intent intent) {
        if (intent == null || !ACTION_VOICE_COMMAND.equals(intent.getAction())) {
            return;
        }
        String command = safeVoiceValue(intent.getStringExtra(EXTRA_VOICE_COMMAND), 40).toUpperCase(java.util.Locale.ROOT);
        String query = safeVoiceValue(intent.getStringExtra(EXTRA_VOICE_QUERY), 200);
        if (!SUPPORTED_VOICE_COMMANDS.contains(command)) {
            Log.w(TAG, "voice_rejected command=" + command);
            return;
        }
        if (pendingVoiceRequests.size() >= MAX_PENDING_VOICE_COMMANDS) {
            pendingVoiceRequests.removeFirst();
        }
        pendingVoiceRequests.addLast(new VoiceRequest(command, query));
        Log.i(TAG, "voice_received command=" + command + " queryLength=" + query.length());
        drainVoiceRequests();
    }

    private String safeVoiceValue(String value, int maximumLength) {
        String safe = value == null ? "" : value.trim();
        if (safe.length() > maximumLength) {
            safe = safe.substring(0, maximumLength);
        }
        return safe;
    }

    private void drainVoiceRequests() {
        if (!pageReady || webView == null || pendingVoiceRequests.isEmpty()) {
            return;
        }
        while (!pendingVoiceRequests.isEmpty()) {
            VoiceRequest request = pendingVoiceRequests.removeFirst();
            String script = "(function(){if(!window.YingshiVoice||typeof window.YingshiVoice.execute!=='function')"
                    + "{return 'bridge_not_ready';}window.YingshiVoice.execute("
                    + JSONObject.quote(request.command) + "," + JSONObject.quote(request.query)
                    + ");return 'queued';})()";
            webView.evaluateJavascript(script, value -> Log.i(TAG,
                    "voice_dispatched command=" + request.command + " result=" + value));
        }
    }

    private static final class VoiceRequest {
        final String command;
        final String query;

        VoiceRequest(String command, String query) {
            this.command = command;
            this.query = query;
        }
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setLoadsImagesAutomatically(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setTextZoom(100);
        settings.setAllowFileAccess(false);
        // Only user-selected document URIs are granted by the Android picker.
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setSaveFormData(false);
        settings.setGeolocationEnabled(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN) {
            settings.setAllowFileAccessFromFileURLs(false);
            settings.setAllowUniversalAccessFromFileURLs(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        String originalUserAgent = settings.getUserAgentString();
        webViewChromeMajor = chromeMajor(originalUserAgent);
        serveBundledPage = USE_BUNDLED_UI || webViewChromeMajor == 0 || webViewChromeMajor < ONLINE_MODULE_MIN_CHROME;
        settings.setUserAgentString(originalUserAgent + " " + APP_USER_AGENT_TOKEN);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            settings.setOffscreenPreRaster(false);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
        }
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        view.setBackgroundColor(0xff050507);
        view.setKeepScreenOn(true);
        view.setFocusable(true);
        view.setFocusableInTouchMode(true);
        view.setVerticalScrollBarEnabled(true);
        view.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        view.setOverScrollMode(View.OVER_SCROLL_NEVER);
        view.setLayerType(View.LAYER_TYPE_HARDWARE, null);
        view.setDownloadListener(downloadListener());
        view.addJavascriptInterface(new PageBridge(), "CarBridge");
        view.setWebViewClient(new CarWebViewClient());
        view.setWebChromeClient(new CarWebChromeClient());
    }

    private int chromeMajor(String userAgent) {
        Matcher matcher = Pattern.compile("(?:Chrome|CriOS)/(\\d+)").matcher(userAgent == null ? "" : userAgent);
        if (!matcher.find()) {
            return 0;
        }
        try {
            return Integer.parseInt(matcher.group(1));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private void loadHome(boolean forceCompatibility) {
        if (webView == null) {
            return;
        }
        serveBundledPage = USE_BUNDLED_UI || forceCompatibility || webViewChromeMajor == 0 || webViewChromeMajor < ONLINE_MODULE_MIN_CHROME;
        pageReady = false;
        statusView.setText(serveBundledPage ? "影視 正在啟動相容模式" : "影視 載入中");
        statusView.setVisibility(View.VISIBLE);
        webView.loadUrl(buildHomeUrl());
    }

    private void watchPageBoot() {
        pageReady = false;
        final int generation = ++bootGeneration;
        mainHandler.postDelayed(() -> {
            if (webView == null || pageReady || generation != bootGeneration) {
                return;
            }
            if (!serveBundledPage) {
                diagnostics.event("boot_timeout", "{}");
                loadHome(true);
            } else {
                statusView.setText("影視 載入逾時，按 MENU 重新載入");
                statusView.setVisibility(View.VISIBLE);
            }
        }, BOOT_TIMEOUT_MS);
    }

    private void handlePageFailure(String message) {
        runOnUiThread(() -> {
            if (pageReady || webView == null) {
                return;
            }
            if (!serveBundledPage) {
                diagnostics.event("page_failure", "{}");
                loadHome(true);
                return;
            }
            statusView.setText(message == null || message.isEmpty() ? "影視 載入失敗，按 MENU 重新載入" : message);
            statusView.setVisibility(View.VISIBLE);
        });
    }

    private String buildHomeUrl() {
        String stamp = String.valueOf(System.currentTimeMillis());
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        Configuration config = getResources().getConfiguration();
        int widthPx = Math.max(metrics.widthPixels, metrics.heightPixels);
        int heightPx = Math.min(metrics.widthPixels, metrics.heightPixels);
        int shortestDp = Math.min(config.screenWidthDp, config.screenHeightDp);
        String screenClass = screenClass(widthPx, heightPx, shortestDp);
        String deviceProfile = deviceProfile(widthPx, heightPx);

        return HOME_URL +
                "?car_apk=1" +
                "&v=" + encode(BuildConfig.VERSION_NAME) +
                "&boot=" + stamp +
                "&screen=" + encode(screenClass) +
                "&profile=" + encode(deviceProfile) +
                "&w=" + widthPx +
                "&h=" + heightPx +
                "&sw_dp=" + shortestDp +
                "&density=" + encode(String.format(java.util.Locale.US, "%.2f", metrics.density)) +
                "&dpi=" + metrics.densityDpi +
                "&sdk=" + Build.VERSION.SDK_INT +
                "&wv=" + webViewChromeMajor +
                "&compat=" + (serveBundledPage ? "1" : "0");
    }

    private String screenClass(int widthPx, int heightPx, int shortestDp) {
        if (widthPx >= 1900 && heightPx >= 1200) {
            return "car-2k";
        }
        if (widthPx >= 1700 || shortestDp >= 900) {
            return "car-xl";
        }
        if (widthPx >= 1200 || shortestDp >= 600) {
            return "car-wide";
        }
        return "compact";
    }

    private String deviceProfile(int widthPx, int heightPx) {
        String identity = (Build.DEVICE + " " + Build.PRODUCT + " " + Build.MODEL + " " + Build.HARDWARE)
                .toLowerCase(java.util.Locale.US);
        if (widthPx >= 1900 && heightPx >= 1200 && identity.contains("7870")) {
            return "uis7870-129";
        }
        return "universal";
    }

    private void injectDeviceProfile(WebView view) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) {
            return;
        }
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        Configuration config = getResources().getConfiguration();
        int widthPx = Math.max(metrics.widthPixels, metrics.heightPixels);
        int heightPx = Math.min(metrics.widthPixels, metrics.heightPixels);
        int shortestDp = Math.min(config.screenWidthDp, config.screenHeightDp);
        String screenClass = screenClass(widthPx, heightPx, shortestDp);
        String deviceProfile = deviceProfile(widthPx, heightPx);
        String script = "(function(){var e=document.documentElement;" +
                "e.dataset.longTvCar='1';" +
                "e.dataset.longTvScreen='" + screenClass + "';" +
                "e.dataset.longTvProfile='" + deviceProfile + "';" +
                "e.dataset.longTvWidth='" + widthPx + "';" +
                "e.dataset.longTvHeight='" + heightPx + "';" +
                "e.dataset.longTvShortestDp='" + shortestDp + "';" +
                "e.classList.add('long-tv-car','long-tv-" + screenClass + "','long-tv-" + deviceProfile + "');" +
                "})();";
        view.evaluateJavascript(script, null);
    }

    private void injectTvRemoteNavigation(WebView view) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) {
            return;
        }
        try {
            view.evaluateJavascript(readAssetText("tv-remote.js"), null);
        } catch (IOException error) {
            Log.e(TAG, "tv_remote_asset_unavailable", error);
        }
    }

    private String readAssetText(String name) throws IOException {
        try (InputStream input = getAssets().open(name);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void injectPlaybackEnhancements(WebView view) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.KITKAT) {
            return;
        }
        view.evaluateJavascript(playbackEnhancementScript(), null);
    }

    private String playbackEnhancementScript() {
        // Compatibility alias only. The UI owns both header buttons and state.
        return "(function(){window.__yingshiFullscreenPatch={"
                + "refresh:function(){},enter:function(){if(window.YingshiPlayerPresentation)window.YingshiPlayerPresentation.enter();},"
                + "exit:function(){if(window.YingshiPlayerPresentation)window.YingshiPlayerPresentation.exit();}};})();";
    }

    private static String encode(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8");
        } catch (Exception ignored) {
            return value;
        }
    }

    private DownloadListener downloadListener() {
        return (url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                Uri uri = Uri.parse(url);
                String scheme = uri.getScheme();
                if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                    Toast.makeText(this, "已阻擋不支援的下載連結", Toast.LENGTH_SHORT).show();
                    return;
                }
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (ActivityNotFoundException error) {
                Toast.makeText(this, "沒有可開啟此下載的 App", Toast.LENGTH_SHORT).show();
            }
        };
    }

    private void reloadLatest() {
        if (webView == null) {
            return;
        }
        webView.clearCache(false);
        loadHome(false);
        Toast.makeText(this, "正在重新載入最新內容", Toast.LENGTH_SHORT).show();
    }

    private void recoverWebView() {
        if (webView != null) {
            root.removeView(webView);
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
        }
        statusView.setText("影視 正在恢復播放環境");
        statusView.setVisibility(View.VISIBLE);
        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        hideSystemUi();
        loadHome(false);
    }

    private void showCustomView(View view, WebChromeClient.CustomViewCallback callback) {
        if (customView != null) {
            hideCustomView();
        }
        customView = view;
        customViewCallback = callback;

        customViewContainer = new FrameLayout(this);
        customViewContainer.setBackgroundColor(0xff000000);
        customViewContainer.setKeepScreenOn(true);
        customViewContainer.setFocusable(true);
        customViewContainer.setFocusableInTouchMode(true);
        customViewContainer.addView(customView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
                Gravity.CENTER));

        // HTML video/YouTube native fullscreen excludes the page's own header.
        // Exits are available on touch/remote input, then disappear while watching.
        android.widget.LinearLayout exits = new android.widget.LinearLayout(this);
        nativeExitControls = exits;
        nativeControlsTouchActive = false;
        nativeRevealTouch = false;
        exits.setOrientation(android.widget.LinearLayout.HORIZONTAL);
        exits.setPadding(dp(6), dp(4), dp(6), dp(4));
        exits.setBackgroundColor(0xe622232b);
        android.widget.Button restore = new android.widget.Button(this);
        nativeRestoreButton = restore;
        restore.setText("縮回");
        restore.setContentDescription("縮回一般畫面");
        restore.setTextColor(0xffffffff);
        restore.setAllCaps(false);
        restore.setBackgroundTintList(fullscreenButtonColors());
        restore.setOnClickListener(button -> hideCustomView());
        android.widget.Button close = new android.widget.Button(this);
        nativeCloseButton = close;
        close.setText("關閉");
        close.setContentDescription("關閉播放器");
        close.setTextColor(0xffffffff);
        close.setAllCaps(false);
        close.setBackgroundTintList(fullscreenButtonColors());
        close.setOnClickListener(button -> {
            hideCustomView();
            if (webView != null) webView.evaluateJavascript(
                    "window.YingshiPlayerPresentation&&window.YingshiPlayerPresentation.closeFromNative()", null);
        });
        exits.addView(restore, new android.widget.LinearLayout.LayoutParams(dp(88), dp(52)));
        exits.addView(close, new android.widget.LinearLayout.LayoutParams(dp(88), dp(52)));
        FrameLayout.LayoutParams exitParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP | Gravity.END);
        exitParams.setMargins(dp(8), dp(8), dp(8), 0);
        customViewContainer.addView(exits, exitParams);

        root.addView(customViewContainer, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        if (webView != null) {
            webView.evaluateJavascript("window.YingshiPlayerPresentation&&window.YingshiPlayerPresentation.nativeChanged(true)", null);
            webView.setVisibility(View.INVISIBLE);
        }
        statusView.setVisibility(View.GONE);
        enterEmbeddedFullscreen();
        restore.requestFocus();
        revealNativeExitControls();
    }

    private void revealNativeExitControls() {
        mainHandler.removeCallbacks(hideNativeExitControls);
        if (nativeExitControls == null) return;
        nativeExitControls.setVisibility(View.VISIBLE);
        if (!nativeControlsTouchActive) {
            mainHandler.postDelayed(hideNativeExitControls, 3000L);
        }
    }

    private android.content.res.ColorStateList fullscreenButtonColors() {
        return new android.content.res.ColorStateList(
                new int[][] { new int[] { android.R.attr.state_focused }, new int[] { android.R.attr.state_pressed }, new int[] {} },
                new int[] { 0xff007986, 0xff007986, 0xff343640 });
    }

    private void hideCustomView() {
        mainHandler.removeCallbacks(hideNativeExitControls);
        if (customView == null) {
            return;
        }
        if (customViewContainer != null) {
            customViewContainer.removeAllViews();
            root.removeView(customViewContainer);
            customViewContainer = null;
        } else {
            root.removeView(customView);
        }
        customView = null;
        nativeRestoreButton = null;
        nativeCloseButton = null;
        nativeExitControls = null;
        nativeRevealTouch = false;
        nativeControlsTouchActive = false;
        WebChromeClient.CustomViewCallback callback = customViewCallback;
        customViewCallback = null;
        if (callback != null) callback.onCustomViewHidden();
        if (webView != null) {
            webView.setVisibility(View.VISIBLE);
            webView.requestFocus();
            webView.evaluateJavascript("window.YingshiPlayerPresentation&&window.YingshiPlayerPresentation.nativeChanged(false)", null);
        }
        exitEmbeddedFullscreen();
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY |
                        View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                        View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                        View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    private void enterEmbeddedFullscreen() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        hideSystemUi();
    }

    private void exitEmbeddedFullscreen() {
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE);
        hideSystemUi();
    }

    private final class CarWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (!request.isForMainFrame()) {
                return false;
            }
            return handleTopLevelNavigation(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleTopLevelNavigation(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (isHomeDocument(Uri.parse(url))) watchPageBoot();
            statusView.setText("影視 載入中");
            statusView.setVisibility(View.VISIBLE);
            super.onPageStarted(view, url, favicon);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            injectDeviceProfile(view);
            injectPlaybackEnhancements(view);
            injectTvRemoteNavigation(view);
            hideSystemUi();
            super.onPageFinished(view, url);
        }

        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            if (isHomeDocument(Uri.parse(failingUrl))) {
                handlePageFailure("網路異常，按 MENU 重新載入");
            }
            super.onReceivedError(view, errorCode, description, failingUrl);
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
            if (request.isForMainFrame()) {
                handlePageFailure("頁面讀取失敗，按 MENU 重新載入");
            }
            super.onReceivedHttpError(view, request, errorResponse);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            if (customView != null) {
                hideCustomView();
            }
            if (view == webView) {
                root.removeView(view);
                webView = null;
            }
            view.setWebChromeClient(null);
            view.setWebViewClient(null);
            view.destroy();
            pageReady = false;
            boolean crashed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash();
            diagnostics.event("renderer_recovered", "{}");
            statusView.setText(crashed ? "影視 播放核心異常，正在自動恢復" : "影視 記憶體已釋放，正在自動恢復");
            statusView.setVisibility(View.VISIBLE);
            mainHandler.post(MainActivity.this::recoverWebView);
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            WebResourceResponse response = compatibilityResponse(request.getUrl());
            return response != null ? response : super.shouldInterceptRequest(view, request);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            WebResourceResponse response = compatibilityResponse(Uri.parse(url));
            return response != null ? response : super.shouldInterceptRequest(view, url);
        }

        private WebResourceResponse compatibilityResponse(Uri uri) {
            if (!serveBundledPage || uri == null) {
                return null;
            }
            try {
                if (isHomeDocument(uri)) {
                    return new WebResourceResponse("text/html", "UTF-8", getAssets().open(COMPAT_ASSET));
                }
                if ("sylong7708.github.io".equalsIgnoreCase(uri.getHost())
                        && uri.getPath() != null && uri.getPath().startsWith("/TV/docs/assets/")) {
                    String name = uri.getLastPathSegment();
                    if (Arrays.asList("pako.min.js", "hls.min.js", "icon.png", "source-signal-icon.svg", "adult-18-badge.svg").contains(name)) {
                        String mime = name.endsWith(".js") ? "text/javascript" : name.endsWith(".svg") ? "image/svg+xml" : "image/png";
                        return new WebResourceResponse(mime, "UTF-8", getAssets().open("iphone/" + name));
                    }
                }
                // Source lists, catalog, details and search are cloud requests.
                return null;
            } catch (IOException error) {
                handlePageFailure("內建相容頁讀取失敗");
                return null;
            }
        }

        @SuppressWarnings("deprecation")
        private boolean isNetworkConnected() {
            ConnectivityManager manager =
                    (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (manager == null) {
                return true;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Network network = manager.getActiveNetwork();
                NetworkCapabilities capabilities = network == null
                        ? null : manager.getNetworkCapabilities(network);
                return capabilities != null
                        && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
            }
            NetworkInfo info = manager.getActiveNetworkInfo();
            return info != null && info.isConnected();
        }

    }

    private boolean handleTopLevelNavigation(Uri uri) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme();
        if (scheme == null) {
            return false;
        }
        if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) {
            if (isHomeDocument(uri)) {
                return false;
            }
            return openExternalUri(uri);
        }
        if ("about".equalsIgnoreCase(scheme) && "about:blank".equalsIgnoreCase(uri.toString())) {
            return false;
        }
        if ("intent".equalsIgnoreCase(scheme)) {
            try {
                Intent parsed = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                Uri target = parsed.getData();
                if (target != null) {
                    return openExternalUri(target);
                }
                String fallback = parsed.getStringExtra("browser_fallback_url");
                if (fallback != null) {
                    return openExternalUri(Uri.parse(fallback));
                }
            } catch (Exception ignored) {
                // The unsupported intent is consumed below.
            }
            Toast.makeText(this, "無法開啟外部連結", Toast.LENGTH_SHORT).show();
            return true;
        }
        if (!isAllowedExternalScheme(scheme)) {
            Toast.makeText(this, "已阻擋不支援的外部連結", Toast.LENGTH_SHORT).show();
            return true;
        }
        return openExternalUri(uri);
    }

    private boolean openExternalUri(Uri uri) {
        if (uri == null) {
            return true;
        }
        String scheme = uri.getScheme();
        boolean web = "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
        if (!web && !isAllowedExternalScheme(scheme)) {
            Toast.makeText(this, "已阻擋不支援的外部連結", Toast.LENGTH_SHORT).show();
            return true;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, uri);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, "無法開啟外部連結", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private boolean isAllowedExternalScheme(String scheme) {
        return "market".equalsIgnoreCase(scheme)
                || "tel".equalsIgnoreCase(scheme)
                || "mailto".equalsIgnoreCase(scheme)
                || "geo".equalsIgnoreCase(scheme)
                || "sms".equalsIgnoreCase(scheme)
                || "smsto".equalsIgnoreCase(scheme);
    }

    private boolean isHomeDocument(Uri uri) {
        return uri != null
                && "sylong7708.github.io".equalsIgnoreCase(uri.getHost())
                && "/TV/docs/iphone/index.html".equals(uri.getPath());
    }

    private boolean isTrustedUiPage() {
        if (webView == null) {
            return false;
        }
        String currentUrl = webView.getUrl();
        return currentUrl != null && isHomeDocument(Uri.parse(currentUrl));
    }

    private final class PageBridge {
        @JavascriptInterface
        public String phoneticKey(String value) {
            String safe = safeVoiceValue(value, 200);
            if (safe.isEmpty() || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                return "";
            }
            try {
                String latin;
                synchronized (phoneticLock) {
                    if (hanLatinTransliterator == null) {
                        try {
                            hanLatinTransliterator = android.icu.text.Transliterator.getInstance(
                                    "Han-Latin; Latin-ASCII; Lower()"
                            );
                        } catch (RuntimeException compoundUnavailable) {
                            hanLatinTransliterator = android.icu.text.Transliterator.getInstance("Han-Latin");
                        }
                    }
                    latin = hanLatinTransliterator.transliterate(
                            Normalizer.normalize(safe, Normalizer.Form.NFKC)
                    );
                }
                return latin.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "");
            } catch (RuntimeException error) {
                Log.w(TAG, "phonetic_key_unavailable", error);
                return "";
            }
        }

        @JavascriptInterface
        public void exitPlayerFullscreen() {
            runOnUiThread(() -> { if (isTrustedUiPage()) hideCustomView(); });
        }

        @JavascriptInterface
        public void dismissKeyboard() {
            runOnUiThread(() -> {
                if (!isTrustedUiPage() || webView == null) return;
                android.view.inputmethod.InputMethodManager keyboard =
                        (android.view.inputmethod.InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE);
                if (keyboard != null) keyboard.hideSoftInputFromWindow(webView.getWindowToken(), 0);
            });
        }

        @JavascriptInterface
        public void onBootStarted(String message) {
            runOnUiThread(() -> {
                if (!isTrustedUiPage()) {
                    return;
                }
                if (!pageReady) {
                    statusView.setText(serveBundledPage ? "影視 相容模式載入中" : "影視 資料載入中");
                    statusView.setVisibility(View.VISIBLE);
                }
            });
        }

        @JavascriptInterface
        public void onAppReady(String message) {
            runOnUiThread(() -> {
                boolean trusted = isTrustedUiPage();
                Log.i(TAG, "page_ready_callback trusted=" + trusted);
                if (!trusted) {
                    return;
                }
                pageReady = true;
                diagnostics.snapshot(message, serveBundledPage, webViewChromeMajor);
                diagnostics.event("ready", "{}");
                bootGeneration += 1;
                statusView.setVisibility(View.GONE);
                hideSystemUi();
                if (webView != null) {
                    webView.requestFocus();
                }
                drainVoiceRequests();
            });
        }

        @JavascriptInterface
        public void onVoiceResult(String message) {
            runOnUiThread(() -> {
                if (isTrustedUiPage() && BuildConfig.DEBUG) {
                    Log.i(TAG, "voice_result=" + safeVoiceValue(message, 500));
                }
            });
        }

        @JavascriptInterface
        public boolean requestCloudPlayerUpdate() {
            if (BuildConfig.DEBUG || webViewChromeMajor < ONLINE_MODULE_MIN_CHROME) return false;
            runOnUiThread(() -> {
                if (isTrustedUiPage() && serveBundledPage) {
                    diagnostics.event("cloud_retry", "{}");
                    loadHome(false);
                }
            });
            return true;
        }

        @JavascriptInterface
        public void onPlaybackStatus(String message) {
            runOnUiThread(() -> {
                if (isTrustedUiPage()) diagnostics.playback(message);
            });
        }

        @JavascriptInterface
        public void onAppError(String message) {
            runOnUiThread(() -> {
                if (isTrustedUiPage()) {
                    handlePageFailure("影視 相容模式載入失敗，按 MENU 重新載入");
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SUBTITLE_REQUEST || subtitleCallback == null) return;
        ValueCallback<Uri[]> callback = subtitleCallback;
        subtitleCallback = null;
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        callback.onReceiveValue(uri != null && "content".equalsIgnoreCase(uri.getScheme()) ? new Uri[]{uri} : null);
    }

    private final class CarWebChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (!isTrustedUiPage()) { callback.onReceiveValue(null); return true; }
            if (subtitleCallback != null) subtitleCallback.onReceiveValue(null);
            subtitleCallback = callback;
            Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            picker.addCategory(Intent.CATEGORY_OPENABLE);
            picker.setType("*/*");
            picker.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"text/plain", "text/vtt", "application/x-subrip", "application/octet-stream"});
            picker.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            // Some car ROMs have an OEM GET_CONTENT picker but no DocumentsUI.
            // Sending an unsupported OPEN_DOCUMENT through a chooser can open
            // the launcher again instead of returning a selected document.
            if (picker.resolveActivity(getPackageManager()) == null) picker.setAction(Intent.ACTION_GET_CONTENT);
            android.content.ComponentName handler = picker.resolveActivity(getPackageManager());
            // The UIS7870 file manager advertises GET_CONTENT but opens files
            // externally instead of returning subtitle data to its caller.
            if (handler == null || "com.syu.filemanager".equals(handler.getPackageName())) {
                subtitleCallback.onReceiveValue(null);
                subtitleCallback = null;
                showSubtitleTextInput();
                return true;
            }
            try { startActivityForResult(picker, SUBTITLE_REQUEST); }
            catch (ActivityNotFoundException error) { subtitleCallback.onReceiveValue(null); subtitleCallback = null; Toast.makeText(MainActivity.this, "此裝置沒有檔案選擇器", Toast.LENGTH_LONG).show(); }
            return true;
        }

        private void showSubtitleTextInput() {
            android.widget.EditText input = new android.widget.EditText(MainActivity.this);
            input.setHint("貼上 UTF-8 SRT 或 WebVTT 字幕內容");
            input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            input.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_EXTRACT_UI);
            input.setMinLines(6);
            input.setMaxLines(10);
            input.setTextSize(14);
            input.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(2 * 1024 * 1024)});
            new android.app.AlertDialog.Builder(MainActivity.this)
                    .setTitle("貼上字幕")
                    .setView(input)
                    .setNegativeButton("取消", (dialog, which) -> hideSystemUi())
                    .setPositiveButton("匯入", (dialog, which) -> {
                        String text = input.getText().toString();
                        if (text.trim().isEmpty() || !isTrustedUiPage() || webView == null) return;
                        String script = "(function(){var t=" + JSONObject.quote(text)
                                + ";var el=document.getElementById('playerSubtitleFile');if(!el)return;"
                                + "var dt=new DataTransfer();dt.items.add(new File([t],t.trim().startsWith('WEBVTT')?'pasted.vtt':'pasted.srt',{type:'text/plain'}));"
                                + "el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})();";
                        webView.postDelayed(() -> { if (webView != null && isTrustedUiPage()) webView.evaluateJavascript(script, null); }, 150);
                        hideSystemUi();
                    }).show();
        }
        @Override
        public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
            if (consoleMessage != null && BuildConfig.DEBUG) {
                Log.i(TAG, "web_console level=" + consoleMessage.messageLevel()
                        + " line=" + consoleMessage.lineNumber()
                        + " message=" + safeVoiceValue(consoleMessage.message(), 500));
            } else if (consoleMessage != null && consoleMessage.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                // Console text can contain URLs or user input. Keep only the event.
                diagnostics.event("console_error", "{}");
            }
            return true;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            showCustomView(view, callback);
        }

        @Override
        public void onShowCustomView(View view, int requestedOrientation, CustomViewCallback callback) {
            showCustomView(view, callback);
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show();
            result.confirm();
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            if (!isUserGesture) {
                return false;
            }
            WebView popup = new WebView(MainActivity.this);
            WebSettings popupSettings = popup.getSettings();
            popupSettings.setJavaScriptEnabled(false);
            popupSettings.setDomStorageEnabled(false);
            popupSettings.setDatabaseEnabled(false);
            popupSettings.setAllowFileAccess(false);
            popupSettings.setAllowContentAccess(false);
            popupSettings.setSupportMultipleWindows(false);
            popup.setWebViewClient(new WebViewClient() {
                private boolean consumed;

                private boolean consume(WebView popupView, Uri uri) {
                    if (!consumed) {
                        consumed = true;
                        if (!handleTopLevelNavigation(uri)) {
                            openExternalUri(uri);
                        }
                    }
                    popupView.stopLoading();
                    mainHandler.post(popupView::destroy);
                    return true;
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView popupView, WebResourceRequest request) {
                    return consume(popupView, request.getUrl());
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView popupView, String url) {
                    return consume(popupView, Uri.parse(url));
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }
    }

    @Override
    public void dump(String prefix, java.io.FileDescriptor fd, java.io.PrintWriter writer, String[] args) {
        super.dump(prefix, fd, writer, args);
        if (diagnostics != null) writer.println(prefix + "YINGSHI_DIAGNOSTICS=" + diagnostics.dump());
    }
}
