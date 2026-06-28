import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import AdminLayout from '../../components/AdminLayout'
import Spinner from '../../components/Spinner'
import { useAdminStats } from '../../hooks/useAdminStats'
import StatsCards, { ResumenCharts } from './components/StatsCards'
import SubscriptionsTable from './components/SubscriptionsTable'
import PaymentsTable from './components/PaymentsTable'
import PaymentConfig from './components/PaymentConfig'
import UsersTable from './components/UsersTable'

const TAB_TITLES = {
  resumen: 'Resumen',
  suscripciones: 'Suscripciones',
  pagos: 'Pagos',
  cobros: 'Configuración de cobros',
  usuarios: 'Usuarios',
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
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-muted border border-outline-variant rounded hover:bg-surface-card disabled:opacity-60"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {loading && !stats ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : (
        <>
          {activeTab === 'resumen' && (
            <>
              <StatsCards kpis={stats?.kpis} />
              <ResumenCharts stats={stats} />
            </>
          )}
          {activeTab === 'suscripciones' && (
            <SubscriptionsTable stats={stats} onRefresh={refresh} />
          )}
          {activeTab === 'pagos' && <PaymentsTable stats={stats} onRefresh={refresh} />}
          {activeTab === 'cobros' && <PaymentConfig />}
          {activeTab === 'usuarios' && <UsersTable stats={stats} />}
        </>
      )}
    </AdminLayout>
  )
}
