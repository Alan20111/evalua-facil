// Descarga de la app móvil de Evalúa Fácil.
//
// Es UNA sola app para docentes y estudiantes: al abrirla se elige con cuál
// de los dos perfiles se entra, igual que en la web. Por eso hay una sola
// dirección aquí y no una por rol.
//
// Mientras esté vacío, los avisos de "también hay app" se muestran sin botón
// de descarga (ver Dashboard del docente y del estudiante) — preferible a
// publicar un enlace que todavía no existe. En cuanto haya URL oficial de la
// tienda, se pega aquí y los dos avisos la toman solos.
//
// Temporal mientras se aprueba en Play Store: apunta a la descarga directa del
// APK. Cambiar por la URL de la tienda en cuanto esté disponible.
//
// ⚠️ Es la ruta FIJA /descargar, NO un /descarga/<slug> concreto. Un slug
// clavado aquí apunta para siempre a la versión que estaba vigente el día que
// se escribió: así fue como el QR del panel se quedó sirviendo la 1.0.5
// mientras ya circulaba la 1.0.6. /descargar resuelve solo al enlace marcado
// como producción más reciente (ver obtenerLinkProduccion en
// utils/descargaLinks.js), así que publicar una versión desde el panel de
// admin actualiza este botón y el QR sin tocar código.
export const APP_DOWNLOAD_URL = 'https://www.evaluafacil.mx/descargar'

export const APP_DOWNLOAD_READY = APP_DOWNLOAD_URL.length > 0
