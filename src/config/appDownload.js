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
export const APP_DOWNLOAD_URL = ''

export const APP_DOWNLOAD_READY = APP_DOWNLOAD_URL.length > 0
