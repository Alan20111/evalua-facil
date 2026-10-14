import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
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
import { SkeletonCards, Button } from '../../components/ui'
import { ICONO } from '../../config/iconos'

const TAB_TITLES = {
  chat: 'Inteligencia de Evalúa Fácil',
  resumen: 'Resumen',
  registros: 'Registros',
  creditos: 'Compras de créditos',
  costosIA: 'Costos de IA',
  zonas: 'Ventas por zona',
  cobros: 'Configuración de cobros',
  escuelas: 'Configuración de escuelas',
  estudiantes: 'Estudiantes',
  descargas: 'Descarga de la app',
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('resumen')
  const { stats, loading, refresh } = useAdminStats()
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  return (
    <AdminLayout activeTab={activeTab} onTabChange={setActiveTab}>
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
          {activeTab === 'reportesIA' && <ReportesIAPanel />}
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
