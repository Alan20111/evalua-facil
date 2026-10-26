import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { collection, getCountFromServer, query, where } from 'firebase/firestore'
import { RefreshCw } from 'lucide-react'
import { db } from '../../firebase'
import AdminLayout from '../../components/AdminLayout'
import { useAdminStats } from '../../hooks/useAdminStats'
import StatsCards, { ResumenCharts } from './components/StatsCards'
import RegistrosTable from './components/RegistrosTable'
import CreditPurchasesTable from './components/CreditPurchasesTable'
import CostosIAPanel from './components/CostosIAPanel'
import PaymentConfig from './components/PaymentConfig'
import StudentsTable from './components/StudentsTable'
import VentasPorZona from './components/VentasPorZona'
import AdminChat from './components/AdminChat'
import DownloadLinks from './components/DownloadLinks'
import EscuelasConfig from './components/EscuelasConfig'
import ReportesIAPanel from './components/ReportesIAPanel'
import SugerenciasPanel from './components/SugerenciasPanel'
import ErroresPanel from './components/ErroresPanel'
import { SkeletonCards, Button } from '../../components/ui'
import { ICONO } from '../../config/iconos'

const TAB_TITLES = {
  chat: 'Inteligencia de Evalúa Fácil',
  resumen: 'Resumen',
  registros: 'Registros',
  creditos: 'Compras de créditos',
  costosIA: 'Costos de IA',
  reportesIA: 'Comentarios sobre la IA',
  sugerencias: 'Sugerencias a Evalúa Fácil',
  zonas: 'Ventas por zona',
  cobros: 'Configuración de cobros',
  escuelas: 'Configuración de escuelas',
  estudiantes: 'Estudiantes',
  descargas: 'Descarga de la app',
}

// Secciones con casos que atender. El correo que avisa de uno nuevo
// (functions/avisosReportes.js) enlaza a `/Admin?tab=<sección>&caso=<id>`.
const SECCIONES_DE_CASOS = ['reportesIA', 'sugerencias']

// Cuántos casos «nuevo» hay en cada sección, para el número junto a su
// nombre en el menú. Si la lectura falla, no se muestra número.
function useCasosNuevos() {
  const [nuevos, setNuevos] = useState({})
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let vivo = true
    Promise.all(SECCIONES_DE_CASOS.map((c) =>
      getCountFromServer(query(collection(db, c), where('estado', '==', 'nuevo')))
        .then((s) => [c, s.data().count])
        .catch(() => [c, 0])))
      .then((pares) => { if (vivo) setNuevos(Object.fromEntries(pares)) })
    return () => { vivo = false }
  }, [version])
  const recontar = useCallback(() => setVersion((v) => v + 1), [])
  return [nuevos, recontar]
}

export default function AdminDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabDelEnlace = searchParams.get('tab')
  const [activeTab, setActiveTab] = useState(SECCIONES_DE_CASOS.includes(tabDelEnlace) ? tabDelEnlace : 'resumen')
  // El caso del enlace solo vale en su sección y hasta que se cambia de pestaña.
  const caso = tabDelEnlace === activeTab ? searchParams.get('caso') : null
  const { stats, loading, refresh } = useAdminStats()
  const [refreshing, setRefreshing] = useState(false)
  const [nuevos, recontar] = useCasosNuevos()

  function cambiarPestana(id) {
    setActiveTab(id)
    if (searchParams.has('tab') || searchParams.has('caso')) setSearchParams({}, { replace: true })
  }

  async function handleRefresh() {
    setRefreshing(true)
    recontar()
    await refresh()
    setRefreshing(false)
  }

  return (
    <AdminLayout activeTab={activeTab} onTabChange={cambiarPestana} nuevos={nuevos}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-on-surface">
            {TAB_TITLES[activeTab]}
          </h1>
          <p className="text-sm text-muted mt-0.5">Panel de administración</p>
        </div>
        <Button variant="secondary"
          onClick={handleRefresh}
          disabled={refreshing || loading}>
          <RefreshCw size={ICONO.sm} className={refreshing ? 'animate-spin' : ''} />
          Actualizar
        </Button>
      </div>

      {loading && !stats ? (
        <SkeletonCards count={6} className="py-4" />
      ) : (
        <>
          {activeTab === 'chat' && <AdminChat />}
          {activeTab === 'resumen' && (
            /* Tabla de indicadores a la izquierda con su ancho justo, y a su
               derecha la columna de gráficas (top 10 arriba, registros e
               ingresos por mes abajo). En móvil se apilan. */
            <div className="flex flex-col lg:flex-row items-start gap-3">
              <StatsCards kpis={stats?.kpis} />
              <ResumenCharts stats={stats} />
            </div>
          )}
          {activeTab === 'registros' && (
            <RegistrosTable stats={stats} onRefresh={refresh} />
          )}
          {activeTab === 'creditos' && <CreditPurchasesTable stats={stats} onRefresh={refresh} />}
          {/* Carga sus propios datos del callable `resumenCostosIA`: no
              usa `stats`, que no incluye métricas internas de tokens. */}
          {activeTab === 'costosIA' && <CostosIAPanel />}
          {activeTab === 'reportesIA' && <ReportesIAPanel caso={caso} onCambio={recontar} />}
          {activeTab === 'sugerencias' && <SugerenciasPanel caso={caso} onCambio={recontar} />}
          {activeTab === 'errores' && <ErroresPanel />}
          {activeTab === 'zonas' && <VentasPorZona stats={stats} />}
          {activeTab === 'cobros' && <PaymentConfig />}
          {activeTab === 'escuelas' && <EscuelasConfig />}
          {activeTab === 'estudiantes' && <StudentsTable stats={stats} />}
          {activeTab === 'descargas' && <DownloadLinks />}
        </>
      )}
    </AdminLayout>
  )
}
