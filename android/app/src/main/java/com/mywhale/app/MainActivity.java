package com.mywhale.app;

import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Apply system bars, display cutout, and IME insets as padding on android.R.id.content
        // so the top menu / balance pill and bottom bar stay clear of status/navigation bars
        // on Android 15/16 edge-to-edge devices.
        View contentView = findViewById(android.R.id.content);
        if (contentView != null) {
            boolean isNight =
                (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES;
            getWindow().getDecorView().setBackgroundColor(isNight ? Color.parseColor("#141416") : Color.WHITE);

            WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                getWindow(),
                getWindow().getDecorView()
            );
            if (controller != null) {
                controller.setAppearanceLightStatusBars(!isNight);
                controller.setAppearanceLightNavigationBars(!isNight);
            }

            ViewCompat.setOnApplyWindowInsetsListener(contentView, (view, windowInsets) -> {
                Insets insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() |
                        WindowInsetsCompat.Type.displayCutout() |
                        WindowInsetsCompat.Type.ime()
                );
                view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(contentView);
        }
    }
}
