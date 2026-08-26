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

export async function crearLink({ slug, version, fecha, url, fileName, produccion, createdBy }) {
  const data = {
    version,
    fecha,
    url,
    fileName: fileName || null,
    // Marca la versión que se envió al canal de Producción de Play. Solo
    // cambia lo que se muestra en la página pública; no afecta la descarga.
    produccion: !!produccion,
    activo: true,
    createdBy: createdBy || null,
    createdAt: new Date().toISOString(),
  }
  await setDoc(doc(db, COL, slug), data)
  return { slug, ...data }
}

export async function cambiarActivo(slug, activo) {
  await updateDoc(doc(db, COL, slug), { activo })
}

export async function borrarLink(slug) {
  await deleteDoc(doc(db, COL, slug))
}
