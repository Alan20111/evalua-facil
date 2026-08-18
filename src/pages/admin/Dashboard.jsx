import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import AdminLayout from '../../components/AdminLayout'
import Spinner from '../../components/Spinner'
import { useAdminStats } from '../../hooks/useAdminStats'
import StatsCards, { ResumenCharts } from './components/StatsCards'
import SubscriptionsTable from './components/SubscriptionsTable'
import PaymentsTable from './components/PaymentsTable'
import CreditPurchasesTable from './components/CreditPurchasesTable'
import PaymentConfig from './components/PaymentConfig'
import StudentsTable from './components/StudentsTable'
import VentasPorZona from './components/VentasPorZona'
import AdminChat from './components/AdminChat'

const TAB_TITLES = {
  chat: 'Inteligencia de Evalúa Fácil',
  resumen: 'Resumen',
  suscripciones: 'Suscripciones',
  pagos: 'Pagos',
  creditos: 'Créditos adicionales',
  zonas: 'Ventas por zona',
  cobros: 'Configuración de cobros',
  estudiantes: 'Estudiantes',
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('pagos')
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
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted border border-outline-variant rounded hover:bg-[var(--accent-tint)] hover:border-accent hover:text-accent transition-colors disabled:opacity-60"
        >
          <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {loading && !stats ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <>
          {activeTab === 'chat' && <AdminChat />}
          {activeTab === 'resumen' && (
            /* Tabla de indicadores a la izquierda con su ancho justo, y a su
               derecha la columna de gráficas (top 10 arriba, estado de las
               suscripciones abajo). En móvil se apilan. */
            <div className="flex flex-col lg:flex-row items-start gap-3">
              <StatsCards kpis={stats?.kpis} />
              <ResumenCharts stats={stats} />
            </div>
          )}
          {activeTab === 'suscripciones' && (
            <SubscriptionsTable stats={stats} onRefresh={refresh} />
          )}
          {activeTab === 'pagos' && <PaymentsTable stats={stats} onRefresh={refresh} />}
          {activeTab === 'creditos' && <CreditPurchasesTable stats={stats} onRefresh={refresh} />}
          {activeTab === 'zonas' && <VentasPorZona stats={stats} />}
          {activeTab === 'cobros' && <PaymentConfig />}
          {activeTab === 'estudiantes' && <StudentsTable stats={stats} />}
        </>
      )}
    </AdminLayout>
  )
}
