package com.example.app;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Requerido por @capacitor-community/safe-area para que Android
        // reporte los insets correctos (env(safe-area-inset-*) en el
        // WebView) — Android 15+ ya fuerza edge-to-edge de todos modos.
        EdgeToEdge.enable(this);
    }
}
