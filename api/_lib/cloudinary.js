import crypto from 'crypto'
import { getDb } from './firebaseAdmin.js'

// Borrado de archivos en Cloudinary.
//
// La app sube a Cloudinary desde el navegador con un upload preset sin firmar:
// fotos de perfil, adjuntos de instrucciones, imágenes de preguntas, iconos de
// asignatura y las entregas de los estudiantes. Subir no necesita secreto,
// pero BORRAR sí, y por eso vive aquí y no en el cliente.
//
// Requiere CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en Vercel. Si no están,
// no se rompe nada: se devuelve la lista de lo que no se pudo borrar para que
// quede constancia, en vez de dejar creer que se limpió todo.

// Cualquier URL de entrega de Cloudinary:
//   https://res.cloudinary.com/<cloud>/<tipo>/upload/[transformaciones/]v123/<carpeta>/<nombre>.<ext>
const URL_CLOUDINARY = /https?:\/\/res\.cloudinary\.com\/([^/\s"'\\]+)\/(image|video|raw)\/upload\/([^\s"'\\)]+)/g

// De la ruta que sigue a /upload/ saca el public_id, que es lo que identifica
// al archivo para borrarlo.
function publicIdDesdeRuta(ruta, tipo) {
  const partes = ruta.split('/')
  // Cloudinary mete la versión (v1712345678) justo antes del public_id; todo
  // lo que va entre /upload/ y la versión son transformaciones y no cuenta.
  const iVersion = partes.findIndex((p) => /^v\d+$/.test(p))
  const camino = iVersion >= 0 ? partes.slice(iVersion + 1) : partes
  if (!camino.length) return null
  const completo = camino.join('/').split('?')[0]
  // En los `raw` la extensión ES parte del public_id; en imagen y video no.
  return tipo === 'raw' ? completo : completo.replace(/\.[^./]+$/, '')
}

// Recorre cualquier objeto (un documento de Firestore, por ejemplo) y saca
// todas las URLs de Cloudinary que haya dentro, sin importar en qué campo
// estén. Se hace así a propósito: los archivos aparecen en `photoURL`, en
// `adjuntos[].url`, en `imagenUrl`, dentro del HTML de las instrucciones…
// y con una lista de campos, cualquier campo nuevo se quedaría sin limpiar.
export function extraerAssets(objeto, acumulador = new Map()) {
  let texto
  try {
    texto = JSON.stringify(objeto)
  } catch {
    return acumulador
  }
  if (!texto) return acumulador
  for (const m of texto.matchAll(URL_CLOUDINARY)) {
    const [, cloud, tipo, ruta] = m
    const publicId = publicIdDesdeRuta(ruta, tipo)
    if (publicId) acumulador.set(`${cloud}|${tipo}|${publicId}`, { cloud, tipo, publicId })
  }
  return acumulador
}

async function destruir({ cloud, tipo, publicId }, apiKey, apiSecret) {
  const timestamp = Math.floor(Date.now() / 1000)
  const firma = crypto
    .createHash('sha1')
    .update(`public_id=${publicId}&timestamp=${timestamp}${apiSecret}`)
    .digest('hex')

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${tipo}/destroy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_id: publicId, api_key: apiKey, timestamp, signature: firma }),
  })
  const data = await res.json().catch(() => ({}))
  // 'not found' cuenta como éxito: el archivo ya no ocupa espacio, que es de
  // lo que se trata (pasa cuando se reintenta un borrado a medias).
  return data.result === 'ok' || data.result === 'not found'
}

// Deja constancia EN FIRESTORE de los archivos que no se pudieron borrar.
//
// Antes esto solo se escribía con console.warn, y ahí se pierde: los registros
// de Vercel se rotan en horas, y para entonces los documentos que guardaban
// esas URLs ya no existen — eran justamente lo que se acababa de borrar. Sin
// este apunte, un archivo que se queda en Cloudinary se vuelve **imposible de
// encontrar para siempre**: nadie puede saber que existe, a quién fue, ni
// cuál era su public_id. Ocupa cuota (que paga Alan) hasta el fin de los
// tiempos y ni siquiera se sabe cuánta.
//
// La colección no la lee ni la escribe ningún cliente: solo el Admin SDK desde
// estos endpoints, y `seeds-db/purgar-cloudinary-pendientes.js`, que es la
// escoba que la vacía cuando las llaves existen.
async function anotarPendientes(pendientes, motivo, contexto) {
  try {
    await getDb().collection('archivosPendientes').add({
      pendientes,
      motivo,          // 'sin-credenciales' | 'cloudinary-rechazo'
      ...contexto,     // origen del borrado y de quién era la cuenta
      creado: new Date(),
      purgado: false,
    })
  } catch (err) {
    // Si ni esto se puede escribir, al menos que quede en el log: es el
    // último cartucho, no una razón para tumbar el borrado de la cuenta.
    console.error(`[archivos-pendientes] no se pudo anotar la constancia: ${err.message}`)
  }
}

// Borra los assets recolectados. Nunca lanza: el borrado de la cuenta no se
// puede quedar a medias porque Cloudinary tuvo un mal día.
//
// `contexto` identifica de dónde vino el borrado ({ origen, uid }) y solo se
// usa para la constancia de arriba.
export async function borrarAssets(mapa, contexto = {}) {
  const assets = [...mapa.values()]
  if (!assets.length) return { total: 0, borrados: 0, pendientes: [] }

  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!apiKey || !apiSecret) {
    const pendientes = assets.map((a) => `${a.tipo}/${a.publicId}`)
    await anotarPendientes(pendientes, 'sin-credenciales', contexto)
    return { total: assets.length, borrados: 0, configurado: false, anotados: true, pendientes }
  }

  const pendientes = []
  // De 20 en 20: son cientos de archivos y abrirlos todos a la vez hace que
  // Cloudinary empiece a rechazar por límite de peticiones.
  for (let i = 0; i < assets.length; i += 20) {
    const lote = assets.slice(i, i + 20)
    const resultados = await Promise.all(
      lote.map((a) => destruir(a, apiKey, apiSecret).catch(() => false))
    )
    resultados.forEach((ok, j) => { if (!ok) pendientes.push(`${lote[j].tipo}/${lote[j].publicId}`) })
  }

  // Con llaves puestas también puede quedar algo sin borrar (Cloudinary caído,
  // límite de peticiones, un public_id que no cuadra). Ese caso es más grave
  // todavía, porque nadie lo espera: también se anota.
  if (pendientes.length) await anotarPendientes(pendientes, 'cloudinary-rechazo', contexto)

  return {
    total: assets.length,
    borrados: assets.length - pendientes.length,
    configurado: true,
    anotados: pendientes.length > 0,
    pendientes,
  }
}
