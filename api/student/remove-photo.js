import { getDb, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// "Sin foto" — el estudiante quita la foto que subió.
//
// Limpiar el campo `photoURL` de sus inscripciones lo podría hacer el propio
// navegador (las reglas se lo permiten sobre su propio registro), pero eso
// solo la quitaría de la vista: el archivo seguiría vivo en Cloudinary y
// accesible por su URL para quien la tuviera. Y borrar en Cloudinary necesita
// secreto, que no puede estar en el cliente. Por eso las dos cosas pasan aquí:
// que ya no esté en ningún lado es justo lo que se pidió.

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const db = getDb()

    const snap = await db.collection('students').where('uid', '==', uid).get()
    if (snap.empty) {
      return res.status(404).json({ error: 'No encontramos tu inscripción.' })
    }

    // La foto vive repetida en cada inscripción del estudiante (una por
    // asignatura), así que se recolectan todas: normalmente es el mismo
    // archivo, pero si quedó una URL vieja en alguna, también se va.
    const assets = new Map()
    snap.docs.forEach((d) => {
      const url = d.data().photoURL
      if (url) extraerAssets({ url }, assets)
    })

    const batch = db.batch()
    snap.docs.forEach((d) => batch.update(d.ref, { photoURL: null }))
    await batch.commit()

    const archivos = await borrarAssets(assets, { origen: 'student/remove-photo', uid })
    if (archivos.pendientes?.length) {
      console.warn(
        `[quitar-foto ${uid}] ${archivos.pendientes.length} archivos NO borrados de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({ ok: true, inscripciones: snap.size, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo quitar la foto.' })
  }
}
