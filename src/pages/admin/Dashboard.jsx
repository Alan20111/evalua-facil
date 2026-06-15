import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import AdminLayout from '../../components/AdminLayout'
import Spinner from '../../components/Spinner'
import { useAdminStats } from '../../hooks/useAdminStats'
import StatsCards, { ResumenCharts } from './components/StatsCards'
import SubscriptionsTable from './components/SubscriptionsTable'
import PaymentsTable from './components/PaymentsTable'
import UsersTable from './components/UsersTable'
import PlansManager from './components/PlansManager'

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
          <h1 className="text-xl md:text-2xl font-bold text-slate-900">
            {activeTab === 'resumen' && 'Resumen'}
            {activeTab === 'suscripciones' && 'Suscripciones'}
            {activeTab === 'pagos' && 'Pagos'}
            {activeTab === 'usuarios' && 'Usuarios'}
            {activeTab === 'planes' && 'Planes'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Panel de administración</p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-xl hover:bg-white disabled:opacity-60"
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
          {activeTab === 'pagos' && (
            <PaymentsTable stats={stats} onRefresh={refresh} />
          )}
          {activeTab === 'usuarios' && <UsersTable stats={stats} />}
          {activeTab === 'planes' && (
            <PlansManager stats={stats} onRefresh={refresh} />
          )}
        </>
      )}
    </AdminLayout>
  )
}
