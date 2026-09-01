import { getDb, admin, verifyRequest } from '../_lib/firebaseAdmin.js'
import { extraerAssets, borrarAssets } from '../_lib/cloudinary.js'
import { aplicarCors } from '../_lib/cors.js'

// Borra de Cloudinary el archivo de una planeación propia que YA dejó de ser
// la vigente (1-sep-2026). Mismo motivo que api/subject/delete-fuente.js:
// borrar en Cloudinary exige CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET, que
// nunca viven en el cliente.
//
// El cliente NO manda ninguna URL: manda solo la asignatura. La URL real se
// lee de `subjects/{id}.planeacionArchivoPorBorrar`, que el propio cliente
// dejó escrita en la MISMA operación atómica en la que cambió la planeación
// vigente. Así el servidor nunca borra un archivo por el simple hecho de que
// alguien se lo pida: solo borra lo que el documento de la asignatura ya
// declara como reemplazado.
//
// Además, nunca borra el archivo de la planeación que SÍ está vigente: si por
// lo que sea las dos URLs coinciden, se limpia la marca y no se toca nada.

export default async function handler(req, res) {
  if (aplicarCors(req, res)) return // preflight de la app
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const subjectId = String(body.subjectId || '').trim()
    if (!subjectId) {
      return res.status(400).json({ error: 'Falta subjectId.' })
    }

    const db = getDb()
    const subjectRef = db.collection('subjects').doc(subjectId)
    const subjectDoc = await subjectRef.get()
    if (!subjectDoc.exists) {
      return res.status(404).json({ error: 'La asignatura no existe.' })
    }
    const datos = subjectDoc.data()
    if (datos.docenteId !== uid) {
      return res.status(403).json({ error: 'Esta asignatura no es tuya.' })
    }

    const porBorrar = datos.planeacionArchivoPorBorrar
    if (!porBorrar?.url) {
      return res.status(200).json({ ok: true, archivos: { total: 0, borrados: 0, noEncontrados: 0, pendientes: [] } })
    }

    // Candado final: jamás borrar el archivo de la planeación vigente.
    const vigente = datos.planeacionAceptada
    if (vigente?.origen === 'archivo' && vigente?.archivo?.url === porBorrar.url) {
      await subjectRef.update({ planeacionArchivoPorBorrar: admin.firestore.FieldValue.delete() })
      return res.status(200).json({ ok: true, archivos: { total: 0, borrados: 0, noEncontrados: 0, pendientes: [] } })
    }

    const assets = extraerAssets(porBorrar)
    const archivos = await borrarAssets(assets, { origen: 'subject/delete-planeacion-archivo', uid })

    // La marca se quita siempre: si el borrado falló, reintentarlo en cada
    // carga de la pantalla no lo arreglaría (falta la credencial o el asset ya
    // no existe) y dejaría el documento con basura pegada para siempre. Lo que
    // sí queda es el registro en consola, igual que en delete-fuente.js.
    await subjectRef.update({ planeacionArchivoPorBorrar: admin.firestore.FieldValue.delete() })

    if (archivos.pendientes?.length) {
      console.warn(
        `[borrar-planeacion-archivo ${subjectId}] archivo NO borrado de Cloudinary` +
        `${archivos.configurado === false ? ' (faltan CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)' : ''}: ` +
        archivos.pendientes.join(', ')
      )
    }

    return res.status(200).json({ ok: true, archivos })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo borrar el archivo de la planeación.' })
  }
}
