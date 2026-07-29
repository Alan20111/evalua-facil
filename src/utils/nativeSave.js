// Guardar/compartir un archivo generado en el cliente (Excel, PDF) — en la
// web, un <a download> con blob: URL basta y el navegador lo maneja solo,
// SIEMPRE que sea nuestro propio <a> con un `.click()` real (ver
// downloadInBrowser). El de PDF no lo era — ver el comentario de savePdfDoc.
//
// En la app nativa (Capacitor/Android) ese mismo truco NO funciona: el
// WebView no tiene un manejador de descargas para blob: URLs (eso es
// exclusivo de un navegador real con su propio gestor de descargas), así que
// XLSX.writeFile()/doc.save() —que internamente hacen ese mismo truco—
// terminaban sin hacer NADA visible: el docente tocaba "Excel" o "PDF" y no
// pasaba nada, sin ningún error tampoco (el <a> se crea, se clickea y se
// destruye, todo en silencio).
//
// Arreglo: en nativo, se escribe el archivo a la caché de la app
// (Filesystem) y se abre el panel de "Compartir" de Android (Share) para que
// el docente elija dónde guardarlo (Drive, WhatsApp, Descargas vía un
// administrador de archivos, etc.) — no hay una carpeta "Descargas" a la que
// escribir directo sin permisos de almacenamiento aparte, y este camino ya
// resuelve guardar Y compartir en un solo paso, sin pedir ningún permiso
// extra (Share/Filesystem-en-caché no los necesitan).
import * as XLSX from 'xlsx'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { IS_NATIVE_APP } from './platform'

// Escribe a caché + abre "Compartir" (Share resuelve el tipo de archivo por
// la extensión del uri, no hace falta indicarle el mime type).
// `base64` SIN el prefijo `data:...;base64,`.
async function writeAndShare(filename, base64) {
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: base64,
    directory: Directory.Cache,
  })
  await Share.share({ title: filename, url: uri })
}

function downloadInBrowser(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// `wb` = libro de SheetJS (XLSX.utils.book_new() ya armado con sus hojas).
export async function saveWorkbook(wb, filename) {
  if (!IS_NATIVE_APP) {
    XLSX.writeFile(wb, filename)
    return
  }
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' })
  await writeAndShare(filename, base64)
}

// `doc` = instancia de jsPDF ya armada (con su contenido/autotable listos).
//
// Bug real encontrado (el reportado en Calificaciones, en la WEB): NO se usa
// `doc.save(filename)` — jsPDF trae su propio "FileSaver" embebido que, en
// vez de llamar al `.click()` nativo del elemento, dispara el clic con
// `elemento.dispatchEvent(new MouseEvent('click'))` sobre un <a> que ni
// siquiera se agrega al documento. Eso ya NO detona una descarga real en el
// Chrome/Edge actuales (sí generaba el PDF en memoria — confirmado con
// URL.createObjectURL — pero nunca llegaba a la carpeta de descargas). Se
// arma el blob nosotros mismos y se baja con downloadInBrowser, que sí hace
// clic de verdad (mismo camino que ya usa Excel, confirmado funcionando).
export async function savePdfDoc(doc, filename) {
  if (!IS_NATIVE_APP) {
    downloadInBrowser(doc.output('blob'), filename)
    return
  }
  // jsPDF entrega el base64 con el prefijo data URI — Filesystem.writeFile
  // quiere el base64 puro, sin él.
  const dataUri = doc.output('datauristring')
  const base64 = dataUri.slice(dataUri.indexOf(',') + 1)
  await writeAndShare(filename, base64)
}

// Para descargas que ya traen su propio Blob (ej. la plantilla de Excel en
// blanco, que usa ExcelJS en vez de SheetJS).
export async function saveBlob(blob, filename) {
  if (!IS_NATIVE_APP) {
    downloadInBrowser(blob, filename)
    return
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.slice(reader.result.indexOf(',') + 1))
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
  await writeAndShare(filename, base64)
}

// Descarga un archivo AJENO (una entrega de un alumno en Cloudinary, no algo
// que generamos nosotros) y lo abre con lo que el docente ya tenga instalado
// para ese tipo de archivo (Word, Excel, Google Sheets, WPS…). En vez de
// reconstruir el documento dentro de la app —lo que se intentó varias veces
// con Word/Excel/PowerPoint y nunca se vio fiel al original—, se le entrega
// el archivo real a una app real. En Android, "Compartir" (Share) no es solo
// para enviarlo a alguien: la lista de apps que ofrece también incluye las
// que pueden ABRIRLO (Sheets, Word, WPS…), así que tocar una de esas lo abre
// directo. En la web simplemente se descarga — no hay forma de forzar "abrir
// con" desde un sitio, es una restricción del navegador, no de esta app.
export async function abrirArchivoNativo(url, filename) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`No se pudo descargar el archivo (${res.status})`)
  const blob = await res.blob()
  await saveBlob(blob, filename)
}
