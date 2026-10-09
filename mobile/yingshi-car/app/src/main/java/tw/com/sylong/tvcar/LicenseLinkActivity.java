package tw.com.sylong.tvcar;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Toast;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class LicenseLinkActivity extends Activity {
    public static final String ACTION_LINK_DEVICE_LICENSE = "tw.com.sylong.tvcar.action.LINK_DEVICE_LICENSE";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        super.onDestroy();
    }

    private void handle(Intent intent) {
        String action = intent == null ? "" : intent.getAction();
        String linkToken = intent == null ? "" : intent.getStringExtra("linkToken");
        if (!ACTION_LINK_DEVICE_LICENSE.equals(action)
                || linkToken == null
                || linkToken.length() < 40
                || linkToken.length() > 256) {
            finish();
            return;
        }
        executor.execute(() -> {
            DeviceLicenseManager.Status result;
            try {
                String token = DeviceActivationClient.link(this, linkToken);
                result = DeviceLicenseManager.installToken(this, token);
            } catch (Exception error) {
                result = new DeviceLicenseManager.Status(
                        false,
                        error.getMessage() == null ? "影視連結授權失敗" : error.getMessage()
                );
            }
            DeviceLicenseManager.Status finalResult = result;
            runOnUiThread(() -> {
                Toast.makeText(
                        this,
                        finalResult.valid ? "影視三合一授權完成" : finalResult.message,
                        Toast.LENGTH_LONG
                ).show();
                finish();
            });
        });
    }
}
