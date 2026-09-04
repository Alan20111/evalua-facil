import { doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc, collection, query, where } from 'firebase/firestore'
import { db } from '../firebase'

// Links de descarga del APK de Android.
//
// Cada link es un doc de `downloadLinks` cuyo ID **es** el slug, para que la
// página pública lo resuelva con un getDoc directo (una sola lectura, sin
// queries — ver la restricción de Firestore en CLAUDE.md).
//
// Lectura pública a propósito: quien abre el link no está autenticado. Lo que
// protege el link es que el slug sea impredecible, no las reglas. Escritura
// solo para admin (ver firestore.rules → match /downloadLinks/).
const COL = 'downloadLinks'

// Link original, creado a mano antes de que existiera el panel. Vive en el
// repo (public/descargas/) en vez de Firestore, así que se resuelve aquí para
// que no se rompa. No borrar mientras siga circulando por WhatsApp.
export const LINK_LEGADO = {
  slug: 'p47hj9m8lk',
  version: '1.0.3',
  fecha: '19 de agosto de 2026',
  url: '/descargas/evalua-facil.apk',
  activo: true,
  legado: true,
}

// Slug de 10 caracteres, suficiente para que no se adivine por fuerza bruta.
// Sin vocales ni 0/1/l/o: evita que salgan palabras por accidente y que se
// confundan caracteres al dictarlo por teléfono.
const ALFABETO = 'bcdfghjkmnpqrstvwxyz23456789'
export function generarSlug(largo = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(largo))
  return Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join('')
}

export function urlPublica(slug) {
  return `${window.location.origin}/descarga/${slug}`
}

// Devuelve una fecha corta legible en español a partir del createdAt ISO que
// guardan los documentos nuevos (p. ej. "4 sep 2026"). Fallback a cadena vacía
// si el dato no está o no es parseable.
export function fechaCorta(createdAt) {
  if (!createdAt) return ''
  try {
    return new Date(createdAt).toLocaleDateString('es-MX', {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch {
    return ''
  }
}

// Resuelve un slug para la página pública. Devuelve null si no existe.
export async function obtenerLink(slug) {
  if (slug === LINK_LEGADO.slug) return LINK_LEGADO
  const snap = await getDoc(doc(db, COL, slug))
  return snap.exists() ? { slug, ...snap.data() } : null
}

// La versión de producción vigente, para la ruta fija /descargar (la que se
// enlaza desde el login del docente). Devuelve el enlace marcado como
// producción más reciente, así al publicar una versión nueva desde el panel
// el enlace del login apunta solo — sin tocar código.
//
// Un solo where('==') a propósito: `activo` se filtra en memoria porque dos
// igualdades exigirían un índice compuesto (ver la restricción de Firestore
// en CLAUDE.md), y esta colección tiene un puñado de documentos.
export async function obtenerLinkProduccion() {
  const snap = await getDocs(query(collection(db, COL), where('produccion', '==', true)))
  const links = snap.docs
    .map((d) => ({ slug: d.id, ...d.data() }))
    .filter((l) => l.activo !== false)
  if (links.length === 0) return null
  links.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return links[0]
}

// Historial completo para el panel, más reciente primero. Se ordena en memoria
// porque Firestore no admite orderBy aquí (ver CLAUDE.md).
export async function listarLinks() {
  const snap = await getDocs(collection(db, COL))
  const links = snap.docs.map((d) => ({ slug: d.id, ...d.data() }))
  links.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
  return links
}

// Crea un nuevo enlace de descarga. Si produccion es true, primero quita el
// flag produccion de todos los documentos existentes para que haya exactamente
// uno vigente en todo momento.
export async function crearLink({ slug, version, url, fileName, produccion, createdBy }) {
  if (produccion) {
    const snap = await getDocs(query(collection(db, COL), where('produccion', '==', true)))
    await Promise.all(
      snap.docs.map((d) => updateDoc(doc(db, COL, d.id), { produccion: false }))
    )
  }
  const data = {
    version,
    url,
    fileName: fileName || null,
    produccion: !!produccion,
    activo: true,
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
  }
  await setDoc(doc(db, COL, slug), data)
  return { slug, ...data }
}

// Marca un enlace como vigente (produccion: true) y quita el flag del resto.
// También reactiva el enlace si estaba desactivado. No es atómico, pero es
// seguro para un panel de un solo administrador a la vez.
export async function usarComoVigente(slug) {
  const snap = await getDocs(query(collection(db, COL), where('produccion', '==', true)))
  await Promise.all(
    snap.docs
      .filter((d) => d.id !== slug)
      .map((d) => updateDoc(doc(db, COL, d.id), { produccion: false }))
  )
  await updateDoc(doc(db, COL, slug), { produccion: true, activo: true })
}

export async function cambiarActivo(slug, activo) {
  await updateDoc(doc(db, COL, slug), { activo })
}

export async function borrarLink(slug) {
  await deleteDoc(doc(db, COL, slug))
}
