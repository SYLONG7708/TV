package com.yingshi.player;

import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void load() {
        // Apply before Capacitor starts the first navigation. Cloud deployments
        // must not be hidden behind an older WebView HTTP cache after an upgrade.
        WebView webView = findViewById(com.getcapacitor.android.R.id.webview);
        if (webView != null) {
            webView.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
        }
        super.load();
    }
}
