package mx.evaluafacil.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.view.OrientationEventListener;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

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

        // Word/PowerPoint se ven con el visor de Google Docs embebido en un
        // <iframe>; su botón "Ventana emergente" llama a window.open() desde
        // JavaScript. Un WebView de Android, por defecto, no soporta abrir
        // "otra ventana" (no hace nada con esas llamadas) — por eso el botón
        // no funcionaba pese al allow-popups del iframe. Esto activa ese
        // soporte y, cuando el WebView pide una ventana nueva, la abre en el
        // navegador del sistema: el equivalente más cercano a una pestaña
        // nueva, ya que el WebView de la app no tiene pestañas propias.
        Bridge bridge = getBridge();
        WebView webView = bridge.getWebView();
        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(true);
        webView.getSettings().setSupportMultipleWindows(true);
        webView.setWebChromeClient(new BridgeWebChromeClient(bridge) {
            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                WebView.HitTestResult hit = view.getHitTestResult();
                String url = hit != null ? hit.getExtra() : null;
                if (url != null) {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                    return false;
                }
                // window.open() sin un <a> debajo del dedo (el caso normal aquí):
                // se entrega un WebView "de transporte" desechable solo para
                // leer a dónde intenta navegar, y esa URL se abre afuera.
                WebView transportWebView = new WebView(view.getContext());
                transportWebView.setWebViewClient(new WebViewClient() {
                    @Override
                    public boolean shouldOverrideUrlLoading(WebView v, String u) {
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)));
                        return true;
                    }
                });
                WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
                transport.setWebView(transportWebView);
                resultMsg.sendToTarget();
                return true;
            }
        });

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
