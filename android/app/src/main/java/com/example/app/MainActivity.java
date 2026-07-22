package com.example.app;

import android.os.Bundle;
import android.view.OrientationEventListener;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Orientación FÍSICA del dispositivo (sensor nativo). Los eventos web
    // deviceorientation/devicemotion no llegan en todos los WebView, así que
    // se lee aquí y se avisa al JS con un CustomEvent "fisicaorientacion"
    // (detail: "portrait" | "portrait-reverse" | "landscape") cada vez que
    // cambia. Lo usa la vista de Asistencias (bloqueada en horizontal) para
    // regresar sola cuando el docente vuelve el teléfono a vertical.
    private OrientationEventListener orientationListener;
    private String lastOrientationBucket = "";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Requerido por @capacitor-community/safe-area para que Android
        // reporte los insets correctos (env(safe-area-inset-*) en el
        // WebView) — Android 15+ ya fuerza edge-to-edge de todos modos.
        EdgeToEdge.enable(this);

        orientationListener = new OrientationEventListener(this) {
            @Override
            public void onOrientationChanged(int angle) {
                if (angle == ORIENTATION_UNKNOWN) return;
                String bucket = (angle <= 45 || angle >= 315) ? "portrait"
                    : (angle >= 135 && angle <= 225) ? "portrait-reverse"
                    : "landscape";
                if (!bucket.equals(lastOrientationBucket)) {
                    lastOrientationBucket = bucket;
                    if (getBridge() != null) {
                        getBridge().triggerWindowJSEvent("fisicaorientacion", "{ \"detail\": \"" + bucket + "\" }");
                    }
                }
            }
        };
    }

    @Override
    public void onResume() {
        super.onResume();
        if (orientationListener != null && orientationListener.canDetectOrientation()) {
            orientationListener.enable();
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        if (orientationListener != null) {
            orientationListener.disable();
        }
    }
}
