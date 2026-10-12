import { useMemo, useState } from 'react'
import MexicoMap from '../../../components/admin/MexicoMap'
import { Select } from '../../../components/ui'
import { ventasPorZona, mesesConVentas, indiceCoordenadas, MOTIVO_ZONA } from '../../../utils/ventasZona'
import municipioCoords from '../../../data/municipioCoords.json'

// "Docentes registrados" cuenta a todos los docentes de ese estado (de dónde
// viene la base). "Compradores" cuenta docentes distintos con al menos una
// compra de créditos completada y "Ingresos" suma esas ventas en MXN (de dónde
// vienen las ventas reales). Ver memoria project-ventas-por-zona: el objetivo
// es saber en qué zonas se dan las ventas, no solo dónde hay cuentas.
//
// El mapa siempre pinta conteos de personas (docentes o compradores): sus
// bandas de color están hechas para eso, así que "Ingresos" lo deja en
// compradores y los pesos se leen en el ranking.
const METRICAS = {
  docentes: { etiqueta: 'docentes registrados', titulo: 'Docentes registrados', mapa: 'docentes' },
  compradores: { etiqueta: 'compradores', titulo: 'Compradores', mapa: 'compradores' },
  ingresos: { etiqueta: 'compradores', titulo: 'Ingresos', mapa: 'compradores' },
}

const PESOS = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })
const dinero = (n) => PESOS.format(n)

const MESES_ES = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const etiquetaMes = (mes) => {
  const [y, m] = mes.split('-').map(Number)
  const t = MESES_ES.format(new Date(Date.UTC(y, m - 1, 1)))
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const TODO = 'todo'

const MOTIVOS = {
  [MOTIVO_ZONA.DOCENTE_INEXISTENTE]: 'Docente comprador inexistente (su cuenta ya no está)',
  [MOTIVO_ZONA.ESTADO_FALTANTE]: 'Docente sin estado registrado',
}

export default function VentasPorZona({ stats }) {
  const [metrica, setMetrica] = useState('docentes')
  const [periodo, setPeriodo] = useState(TODO)

  const compras = stats?.creditPurchases
  const docentes = stats?.teachers

  const opcionesPeriodo = useMemo(() => {
    const meses = mesesConVentas(compras || [], stats?.cargadoEn || new Date())
    return [{ value: TODO, label: 'Todo el tiempo' }, ...meses.map((m) => ({ value: m, label: etiquetaMes(m) }))]
  }, [compras, stats?.cargadoEn])

  // Si tras actualizar el mes elegido ya no tiene ventas, se vuelve a «Todo el
  // tiempo» en vez de dejar un selector vacío.
  const periodoVigente = opcionesPeriodo.some((o) => o.value === periodo) ? periodo : TODO
  const mes = periodoVigente === TODO ? null : periodoVigente

  const datos = useMemo(
    () => ventasPorZona({ docentes: docentes || [], compras: compras || [], mes }),
    [docentes, compras, mes]
  )

  const coordenadas = useMemo(() => indiceCoordenadas(municipioCoords), [])
  const valorDe = (fila, m) => (m === 'docentes' ? fila.docentes : fila.compradores)

  const ranking = useMemo(() => {
    const filas = datos.porEstado.map((z) => ({ ...z, valor: metrica === 'ingresos' ? z.ingresosMXN : valorDe(z, metrica) }))
    return filas
      .filter((z) => (metrica === 'docentes' ? true : z.valor > 0))
      .sort((a, b) => b.valor - a.valor || a.estado.localeCompare(b.estado, 'es-MX'))
  }, [datos, metrica])

  const totalRanking = ranking.reduce((a, z) => a + z.valor, 0)
  const maximo = ranking.reduce((a, z) => Math.max(a, z.valor), 0)

  const { marcadores, sinCoordenadas } = useMemo(() => {
    const m = METRICAS[metrica].mapa
    const lista = []
    let sin = 0
    datos.porEstado.forEach((z) => {
      z.municipios.forEach((mu) => {
        const valor = valorDe(mu, m)
        if (!valor) return
        const c = coordenadas.get(`${z.clave}|${mu.clave}`)
        if (!c) { sin += valor; return }
        lista.push({ clave: c.clave, lat: c.lat, lng: c.lng, aprox: !!c.approx, valor, etiqueta: mu.municipio })
      })
    })
    return { marcadores: lista, sinCoordenadas: sin }
  }, [datos, metrica, coordenadas])

  if (!stats) return null

  // Con estado pero sin municipio: cuentan en su estado, no tienen marcador.
  const sinMunicipio = metrica === 'docentes'
    ? datos.docentes.conEstadoSinMunicipio
    : datos.porEstado.reduce((a, z) => a + z.compradores - z.municipios.reduce((b, mu) => b + mu.compradores, 0), 0)

  const noAtribuible = datos.noAtribuible
  const hayNoAtribuible = noAtribuible.compras > 0
  const hayAvisos = datos.posiblesDuplicados > 0 || datos.inconsistencias > 0

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div className="flex flex-wrap gap-2">
          {Object.entries(METRICAS).map(([id, m]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMetrica(id)}
              className={`px-3 py-1.5 rounded text-sm font-semibold transition-colors ${
                metrica === id
                  ? 'bg-accent text-white'
                  : 'bg-surface-card text-muted border border-outline-variant hover:bg-[var(--accent-tint)]'
              }`}
            >
              {m.titulo}
            </button>
          ))}
        </div>
        {metrica !== 'docentes' && (
          <Select
            id="ventas-zona-periodo"
            label="Periodo"
            value={periodoVigente}
            onChange={setPeriodo}
            options={opcionesPeriodo}
            wrapperClassName="w-full sm:w-56"
          />
        )}
      </div>

      {metrica !== 'docentes' && (
        <p className="text-sm text-on-surface">
          {mes === null ? 'Todo el tiempo' : etiquetaMes(mes)}: {dinero(datos.total.ingresosMXN)} en {datos.total.compras}{' '}
          {datos.total.compras === 1 ? 'compra' : 'compras'} de créditos completadas
          {datos.total.compras > 0 && <> · {dinero(datos.atribuido.ingresosMXN)} atribuidos a una zona y {dinero(noAtribuible.ingresosMXN)} sin zona</>}.
        </p>
      )}

      <div className="bg-surface-card rounded-card shadow-card p-4">
        <MexicoMap marcadores={marcadores} etiqueta={METRICAS[metrica].etiqueta} />
        {sinMunicipio > 0 && (
          <p className="text-sm text-muted mt-2">
            + {sinMunicipio} con estado pero sin municipio registrado (no aparecen como marcador).
          </p>
        )}
        {sinCoordenadas > 0 && (
          <p className="text-sm text-muted mt-1">
            + {sinCoordenadas} en un municipio que el mapa todavía no ubica (cuentan en el ranking).
          </p>
        )}
      </div>

      <div className="bg-surface-card rounded-card shadow-card p-4">
        <h3 className="font-semibold text-on-surface mb-3">Ranking por estado</h3>
        {ranking.length === 0 ? (
          <p className="text-sm text-muted">
            {metrica === 'docentes'
              ? 'Todavía no hay docentes con estado registrado.'
              : 'No hay compras de créditos atribuibles a un estado en este periodo.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {ranking.map((z) => {
              const pct = maximo > 0 ? Math.round((z.valor / maximo) * 100) : 0
              const pctDelTotal = totalRanking > 0 ? Math.round((z.valor / totalRanking) * 100) : 0
              return (
                <div key={z.clave} className="text-sm">
                  <div className="flex items-center gap-2">
                    <span className="w-40 flex-shrink-0 truncate text-on-surface">{z.estado}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden" title={`${pctDelTotal}% del total`}>
                      <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className={`${metrica === 'ingresos' ? 'w-28' : 'w-10'} text-right text-muted flex-shrink-0`}>
                      {metrica === 'ingresos' ? dinero(z.valor) : z.valor}
                    </span>
                  </div>
                  {metrica === 'ingresos' && (
                    <div className="ml-40 pl-2 mt-0.5 space-y-0.5">
                      <p className="text-xs text-muted">
                        {z.compradores} {z.compradores === 1 ? 'comprador' : 'compradores'} · {z.compras} {z.compras === 1 ? 'compra' : 'compras'}
                      </p>
                      {z.municipios.filter((mu) => mu.ingresosMXN > 0).sort((a, b) => b.ingresosMXN - a.ingresosMXN).map((mu) => (
                        <p key={mu.clave} className="text-xs text-muted flex justify-between gap-2">
                          <span className="truncate">{mu.municipio}</span>
                          <span className="flex-shrink-0">{dinero(mu.ingresosMXN)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {metrica === 'docentes' && datos.docentes.sinEstado > 0 && (
          <p className="text-sm text-muted mt-3">
            + {datos.docentes.sinEstado} sin estado registrado (cuentas de antes del 25-jul-2026, no se les asigna zona a ciegas).
          </p>
        )}
      </div>

      {metrica !== 'docentes' && (hayNoAtribuible || datos.sinMunicipio.compras > 0 || datos.sinFechaValida.compras > 0) && (
        <div className="bg-surface-card rounded-card shadow-card p-4">
          <h3 className="font-semibold text-on-surface mb-1">Ingresos no atribuibles a una zona</h3>
          <p className="text-sm text-muted mb-3">
            Son ventas válidas: siguen dentro del total. No se reparten entre estados ni se les inventa una ubicación.
          </p>
          <ul className="space-y-1 text-sm">
            {Object.entries(MOTIVOS).map(([motivo, texto]) => {
              const x = noAtribuible.porMotivo[motivo]
              if (!x.compras) return null
              return (
                <li key={motivo} className="flex justify-between gap-3">
                  <span className="text-on-surface">{texto} · {x.compras} {x.compras === 1 ? 'compra' : 'compras'}</span>
                  <span className="text-muted flex-shrink-0">{dinero(x.ingresosMXN)}</span>
                </li>
              )
            })}
            {hayNoAtribuible && (
              <li className="flex justify-between gap-3 font-semibold border-t border-outline-variant pt-1">
                <span className="text-on-surface">Total sin zona</span>
                <span className="flex-shrink-0">{dinero(noAtribuible.ingresosMXN)}</span>
              </li>
            )}
          </ul>
          {datos.sinMunicipio.compras > 0 && (
            <p className="text-sm text-muted mt-3">
              Municipio faltante: {dinero(datos.sinMunicipio.ingresosMXN)} ({datos.sinMunicipio.compras}{' '}
              {datos.sinMunicipio.compras === 1 ? 'compra' : 'compras'}) ya cuentan en su estado; solo les falta el municipio.
            </p>
          )}
          {datos.sinFechaValida.compras > 0 && (
            <p className="text-sm text-muted mt-1">
              Fecha inválida para este mes: {dinero(datos.sinFechaValida.ingresosMXN)} ({datos.sinFechaValida.compras}{' '}
              {datos.sinFechaValida.compras === 1 ? 'compra' : 'compras'}) no tienen fecha de resolución válida; no se asignan a ningún mes,
              pero sí cuentan en «Todo el tiempo».
            </p>
          )}
        </div>
      )}

      {metrica !== 'docentes' && hayAvisos && (
        <output className="block text-xs text-muted">
          {datos.posiblesDuplicados > 0 && <>{datos.posiblesDuplicados} {datos.posiblesDuplicados === 1 ? 'grupo de compras completadas repetidas' : 'grupos de compras completadas repetidas'} por revisar (mismo docente, créditos y referencia): se cuentan todas. </>}
          {datos.inconsistencias > 0 && <>{datos.inconsistencias} {datos.inconsistencias === 1 ? 'documento de compra con datos inconsistentes' : 'documentos de compra con datos inconsistentes'} (ver Compras de créditos): no se corrigen aquí.</>}
        </output>
      )}
    </div>
  )
}
