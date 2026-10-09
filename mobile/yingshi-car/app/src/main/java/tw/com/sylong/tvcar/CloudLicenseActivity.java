package tw.com.sylong.tvcar;

import android.app.AlertDialog;
import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class CloudLicenseActivity extends Activity {
    private static final int COLOR_BG = Color.rgb(5, 14, 21);
    private static final int COLOR_PANEL = Color.rgb(14, 31, 41);
    private static final int COLOR_TEXT = Color.rgb(241, 249, 248);
    private static final int COLOR_MUTED = Color.rgb(145, 167, 173);
    private static final int COLOR_ACCENT = Color.rgb(104, 234, 217);

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private volatile boolean stopped;
    private volatile int activationGeneration;
    private String currentCode = "";
    private TextView status;
    private TextView code;
    private TextView countdown;
    private ProgressBar progress;
    private Button retry;
    private Button openSite;
    private Button copyCode;
    private Button enter;
    private boolean automaticTrialGranted;
    private boolean trialConfirmed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(COLOR_BG);
        getWindow().setNavigationBarColor(COLOR_BG);
        hideSystemUi();
        if (DeviceLicenseManager.isLicensed(this)) {
            enterYingshi();
            return;
        }
        setContentView(buildUi());
        if (DeviceLicenseManager.hasStoredToken(this)) {
            beginActivation();
        } else {
            showTrialOffer();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
    }

    @Override
    protected void onDestroy() {
        stopped = true;
        activationGeneration += 1;
        mainHandler.removeCallbacksAndMessages(null);
        executor.shutdownNow();
        super.onDestroy();
    }

    private void showTrialOffer() {
        new AlertDialog.Builder(this)
                .setTitle("免費使用 1 年")
                .setMessage("影視首次開啟可免費使用 1 年。按下「確認啟用」後，連線成功才開始計算一年期限；到期後會進入授權頁面。")
                .setPositiveButton("確認啟用", (dialog, which) -> {
                    trialConfirmed = true;
                    beginActivation();
                })
                .setNegativeButton("稍後再說", (dialog, which) -> finish())
                .setCancelable(false)
                .show();
    }

    private void beginActivation() {
        stopped = false;
        int generation = ++activationGeneration;
        mainHandler.removeCallbacksAndMessages(null);
        currentCode = "";
        automaticTrialGranted = false;
        retry.setEnabled(false);
        openSite.setEnabled(false);
        copyCode.setEnabled(false);
        enter.setVisibility(View.GONE);
        progress.setVisibility(View.VISIBLE);
        code.setText("••• •••");
        countdown.setText("有效時間 10:00");
        status.setText("正在連接你指定的私人授權中心…");
        executor.execute(() -> {
            try {
                DeviceActivationClient.Session session = DeviceActivationClient.start(this);
                if (!isCurrent(generation)) return;
                currentCode = session.userCode;
                runOnUiThread(() -> {
                    if (!isCurrent(generation)) return;
                    code.setText(formatCode(session.userCode));
                    status.setText(trialConfirmed
                            ? "正在啟用這台車機的一次性免費 1 年使用…"
                            : "請用手機授權中心核准畫面上的 6 位數字。");
                    retry.setEnabled(true);
                    copyCode.setEnabled(true);
                });
                if (trialConfirmed && isCurrent(generation)) {
                    try {
                        DeviceActivationClient.startTrial(session);
                        automaticTrialGranted = true;
                        runOnUiThread(() -> {
                            if (isCurrent(generation)) {
                                status.setText("免費 1 年使用已核准，正在安全寫入這台車機…");
                            }
                        });
                    } catch (Exception trialError) {
                        runOnUiThread(() -> {
                            if (!isCurrent(generation)) return;
                            automaticTrialGranted = false;
                            openSite.setEnabled(true);
                            String reason = trialError.getMessage();
                            status.setText((reason == null || reason.trim().isEmpty()
                                    ? "這台車機目前無法啟用免費使用。"
                                    : reason + "。")
                                    + " 請用手機開啟授權中心，輸入這組 6 位數字。");
                        });
                    }
                } else {
                    runOnUiThread(() -> {
                        if (isCurrent(generation)) openSite.setEnabled(true);
                    });
                }
                poll(session, generation);
            } catch (Exception error) {
                showFailure(error.getMessage(), generation);
            }
        });
    }

    private void poll(DeviceActivationClient.Session session, int generation) {
        if (!isCurrent(generation)) return;
        long remaining = session.expiresAt - System.currentTimeMillis() / 1000L;
        if (remaining <= 0L) {
            showFailure("配對碼已逾時，請重新取得", generation);
            return;
        }
        runOnUiThread(() -> {
            if (isCurrent(generation)) {
                countdown.setText("有效時間 " + (remaining / 60L) + ":" + String.format(Locale.US, "%02d", remaining % 60L));
            }
        });
        mainHandler.postDelayed(() -> executor.execute(() -> {
            if (!isCurrent(generation)) return;
            try {
                DeviceActivationClient.PollResult result = DeviceActivationClient.poll(session);
                if ("approved".equals(result.status)) {
                    DeviceLicenseManager.Status installed = DeviceLicenseManager.installToken(this, result.licenseToken);
                    if (!installed.valid) {
                        showFailure(installed.message, generation);
                        return;
                    }
                    runOnUiThread(() -> showSuccess(result, generation));
                } else if ("expired".equals(result.status)) {
                    showFailure("配對碼已逾時，請重新取得", generation);
                } else {
                    poll(session, generation);
                }
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (isCurrent(generation)) status.setText("網路暫時中斷，正在自動重試…");
                });
                poll(session, generation);
            }
        }), session.pollAfterSeconds * 1000L);
    }

    private void showSuccess(DeviceActivationClient.PollResult result, int generation) {
        if (!isCurrent(generation)) return;
        boolean trial = automaticTrialGranted || "trial".equals(result.entitlementKind);
        boolean oneYearTrial = trial && "1-year-trial".equals(result.licenseDuration);
        String expiresAt = formatExpiry(result.licenseExpiresAt);
        progress.setVisibility(View.GONE);
        code.setText("✓");
        countdown.setText(oneYearTrial ? "免費使用 1 年已啟用" : trial ? "免費試用已啟用" : "影視裝置綁定完成");
        status.setText(trial
                ? "免費使用到 " + expiresAt + "；期滿後會自動回到授權畫面。"
                : "雲端授權已安全寫入這台車機；之後離線也能使用。");
        retry.setVisibility(View.GONE);
        openSite.setVisibility(View.GONE);
        copyCode.setVisibility(View.GONE);
        enter.setVisibility(View.VISIBLE);
        if (oneYearTrial) {
            new AlertDialog.Builder(this)
                    .setTitle("免費使用 1 年")
                    .setMessage("影視已開通免費使用。\n到期時間：" + expiresAt
                            + "（台灣時間）\n期限已從確認啟用並連線成功時起算；到期後會自動開啟授權頁面。")
                    .setPositiveButton("進入影視", (dialog, which) -> enterYingshi())
                    .setCancelable(false)
                    .show();
        } else {
            Toast.makeText(this, trial ? "影視免費試用已啟用" : "影視授權完成", Toast.LENGTH_LONG).show();
            mainHandler.postDelayed(() -> {
                if (isCurrent(generation)) enterYingshi();
            }, 1200L);
        }
    }

    private void showFailure(String message, int generation) {
        runOnUiThread(() -> {
            if (!isCurrent(generation)) return;
            progress.setVisibility(View.GONE);
            countdown.setText("");
            status.setText(message == null || message.trim().isEmpty() ? "授權服務暫時無法使用" : message);
            retry.setEnabled(true);
        });
    }

    private View buildUi() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(COLOR_BG);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        root.setPadding(dp(28), dp(28), dp(28), dp(34));
        scroll.addView(root);

        root.addView(text("影視", 32, COLOR_TEXT, Typeface.BOLD));
        TextView subtitle = text("首次確認啟用後提供 1 年免費使用；期滿後需完成授權", 18, COLOR_MUTED, Typeface.NORMAL);
        subtitle.setPadding(0, dp(6), 0, dp(20));
        root.addView(subtitle);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_HORIZONTAL);
        card.setPadding(dp(22), dp(22), dp(22), dp(22));
        card.setBackgroundColor(COLOR_PANEL);
        root.addView(card, matchWrap());
        card.addView(text("一次性 6 位配對碼", 15, COLOR_MUTED, Typeface.BOLD));
        code = text("••• •••", 44, COLOR_ACCENT, Typeface.BOLD);
        code.setGravity(Gravity.CENTER);
        code.setLetterSpacing(0.08f);
        code.setPadding(0, dp(12), 0, dp(8));
        card.addView(code, matchWrap());
        countdown = text("有效時間 10:00", 14, COLOR_ACCENT, Typeface.NORMAL);
        card.addView(countdown);
        progress = new ProgressBar(this);
        LinearLayout.LayoutParams progressParams = new LinearLayout.LayoutParams(dp(40), dp(40));
        progressParams.topMargin = dp(12);
        card.addView(progress, progressParams);

        status = text("正在連線授權服務…", 15, COLOR_MUTED, Typeface.NORMAL);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, dp(18), 0, dp(10));
        root.addView(status, matchWrap());

        TextView site = text(BuildConfig.LICENSE_API_BASE_URL, 14, COLOR_ACCENT, Typeface.BOLD);
        site.setGravity(Gravity.CENTER);
        site.setPadding(0, 0, 0, dp(12));
        root.addView(site, matchWrap());

        openSite = button("在這台車機開啟私人授權網站", COLOR_PANEL, view -> openAuthorizationSite());
        root.addView(openSite, fixedButton());
        copyCode = button("複製 6 位配對碼", COLOR_PANEL, view -> copyPairingCode());
        LinearLayout.LayoutParams copyParams = fixedButton();
        copyParams.topMargin = dp(8);
        root.addView(copyCode, copyParams);
        retry = button("重新取得配對碼", COLOR_PANEL, view -> beginActivation());
        LinearLayout.LayoutParams retryParams = fixedButton();
        retryParams.topMargin = dp(8);
        root.addView(retry, retryParams);
        enter = button("進入影視", Color.rgb(23, 145, 141), view -> enterYingshi());
        enter.setVisibility(View.GONE);
        LinearLayout.LayoutParams enterParams = fixedButton();
        enterParams.topMargin = dp(8);
        root.addView(enter, enterParams);

        TextView security = text(
                "每台車機每個正式 App 只能取得一次免費 1 年使用。資格由不可逆的裝置識別雜湊判斷，解除安裝或清除資料不會重新取得；正式授權仍綁定 Android Keystore 安全金鑰。",
                12,
                COLOR_MUTED,
                Typeface.NORMAL
        );
        security.setPadding(0, dp(18), 0, 0);
        security.setGravity(Gravity.CENTER);
        root.addView(security, matchWrap());
        return scroll;
    }

    private void openAuthorizationSite() {
        try {
            String suffix = currentCode.isEmpty() ? "" : "/?code=" + Uri.encode(currentCode);
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.LICENSE_API_BASE_URL + suffix)));
        } catch (Exception error) {
            Toast.makeText(this, "請在手機瀏覽器開啟畫面上的授權網址", Toast.LENGTH_LONG).show();
        }
    }

    private void copyPairingCode() {
        if (currentCode.isEmpty()) return;
        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (clipboard != null) {
            clipboard.setPrimaryClip(ClipData.newPlainText("影視 6 位配對碼", currentCode));
            Toast.makeText(this, "已複製 6 位配對碼", Toast.LENGTH_SHORT).show();
        }
    }

    private void enterYingshi() {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }

    private String formatExpiry(long epochSeconds) {
        if (epochSeconds <= 0L) return "請以授權資料為準";
        SimpleDateFormat format = new SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.TAIWAN);
        format.setTimeZone(TimeZone.getTimeZone("Asia/Taipei"));
        return format.format(new Date(epochSeconds * 1000L));
    }

    private boolean isCurrent(int generation) {
        return !stopped && generation == activationGeneration && !isFinishing();
    }

    private String formatCode(String value) {
        return value != null && value.length() == 6 ? value.substring(0, 3) + " " + value.substring(3) : value;
    }

    private TextView text(String value, int size, int color, int style) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setTypeface(Typeface.DEFAULT, style);
        return view;
    }

    private Button button(String label, int color, View.OnClickListener listener) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(COLOR_TEXT);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setBackgroundColor(color);
        button.setOnClickListener(listener);
        return button;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams fixedButton() {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }
}
