import { getDb, verifyRequest } from '../_lib/firebaseAdmin.js'

// El correo de recuperación del estudiante.
//
// ANTES esto usaba verifyBeforeUpdateEmail de Firebase, que al confirmarse
// REEMPLAZABA el correo de la cuenta: el usuario que le dio su maestro dejaba
// de servir para entrar y el correo pasaba a ser su llave. Eso estaba mal. El
// acceso del estudiante es SIEMPRE el usuario que le da su maestro y no
// cambia nunca; el correo es opcional y solo sirve para recuperar su
// contraseña si la olvida.
//
// Por eso ahora el correo se guarda aquí, en `studentRecovery/{uid}`, y no en
// Firebase Auth ni en `students`. `students` es de lectura pública (la
// activación por QR lo necesita), así que un correo ahí lo podría leer
// cualquiera. `studentRecovery` no aparece en firestore.rules y no hay regla
// comodín, así que Firestore lo deniega a todos los clientes por omisión:
// solo el Admin SDK, desde aquí, lo puede tocar.
//
// En `students` se guarda únicamente la máscara (a***@gmail.com), que es lo
// que la pantalla necesita para recordarle al estudiante cuál registró.

function enmascarar(correo) {
  const [nombre, dominio] = String(correo).split('@')
  if (!dominio) return ''
  const visible = nombre.slice(0, 1)
  return `${visible}${'*'.repeat(Math.max(nombre.length - 1, 1))}@${dominio}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' })
  }
  try {
    const { uid } = await verifyRequest(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {})
    const db = getDb()

    const inscripciones = await db.collection('students').where('uid', '==', uid).get()
    if (inscripciones.empty) {
      return res.status(403).json({ error: 'Esta cuenta no es de un estudiante.' })
    }

    // ── Quitar el correo ──────────────────────────────────────────────────
    if (body.accion === 'quitar') {
      await db.collection('studentRecovery').doc(uid).delete()
      const batch = db.batch()
      inscripciones.docs.forEach((d) => batch.update(d.ref, { correoMask: null, correoVerificado: false }))
      await batch.commit()
      return res.status(200).json({ ok: true, correoMask: null })
    }

    // ── Guardar el correo ─────────────────────────────────────────────────
    const correo = String(body.correo || '').trim().toLowerCase()
    if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      return res.status(400).json({ error: 'Escribe un correo válido.' })
    }
    if (correo.endsWith('@evalua.local')) {
      return res.status(400).json({ error: 'Ese no es un correo de verdad. Usa el tuyo (Gmail, Outlook…).' })
    }

    // Un mismo correo no puede quedar como recuperación de dos estudiantes:
    // quien lo tuviera podría pedir el acceso de cualquiera de los dos.
    const yaUsado = await db.collection('studentRecovery').where('correo', '==', correo).limit(1).get()
    if (!yaUsado.empty && yaUsado.docs[0].id !== uid) {
      return res.status(409).json({ error: 'Ese correo ya está registrado en otra cuenta.' })
    }

    const correoMask = enmascarar(correo)
    await db.collection('studentRecovery').doc(uid).set({
      correo,
      correoMask,
      // Todavía sin comprobar que el buzón es suyo — eso lo hará el enlace de
      // confirmación cuando esté lista la recuperación por correo. Mientras
      // tanto queda guardado, que es lo que el estudiante pidió.
      verificado: false,
      guardadoEn: new Date().toISOString(),
    }, { merge: true })

    const batch = db.batch()
    inscripciones.docs.forEach((d) => batch.update(d.ref, { correoMask, correoVerificado: false }))
    await batch.commit()

    return res.status(200).json({ ok: true, correoMask })
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || 'No se pudo guardar tu correo.' })
  }
}
