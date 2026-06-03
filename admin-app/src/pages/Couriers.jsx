import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../hooks/useTheme'

function Avatar({ name, photoUrl }) {
  if (photoUrl) return <img src={photoUrl} alt={name} className="w-10 h-10 rounded-full object-cover" />
  return (
    <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
      {name?.charAt(0).toUpperCase()}
    </div>
  )
}

export default function Couriers() {
  const navigate = useNavigate()
  const { dark, toggleTheme } = useTheme()
  const [couriers, setCouriers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editCourier, setEditCourier] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', pin: '', photo_url: '', is_active: true })
  const [todayStats, setTodayStats] = useState({}) // { courier_id: count }
  const [historicalStats, setHistoricalStats] = useState([])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]) // YYYY-MM-DD

  const fetchCouriers = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('couriers')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      setCouriers(data || [])
    } catch (err) {
      console.error('[Couriers] Error cargando mensajeros:', err.message)
      alert('Error al cargar mensajeros: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Cargar estadísticas del día actual
  const fetchTodayStats = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0]
      const { data, error } = await supabase
        .from('orders')
        .select('courier_id')
        .eq('status', 'entregado')
        .gte('delivered_at', `${today}T00:00:00`)
        .lte('delivered_at', `${today}T23:59:59`)

      if (error) throw error

      // Contar por courier_id
      const stats = {}
      data?.forEach(order => {
        if (order.courier_id) {
          stats[order.courier_id] = (stats[order.courier_id] || 0) + 1
        }
      })
      setTodayStats(stats)
    } catch (err) {
      console.error('[Couriers] Error cargando stats de hoy:', err.message)
    }
  }, [])

  // Cargar estadísticas históricas para la fecha seleccionada
  const fetchHistoricalStats = useCallback(async (date) => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('courier_id, couriers(name, photo_url)')
        .eq('status', 'entregado')
        .gte('delivered_at', `${date}T00:00:00`)
        .lte('delivered_at', `${date}T23:59:59`)

      if (error) throw error

      // Agrupar por mensajero
      const grouped = {}
      data?.forEach(order => {
        if (order.courier_id && order.couriers) {
          if (!grouped[order.courier_id]) {
            grouped[order.courier_id] = {
              courier_id: order.courier_id,
              name: order.couriers.name,
              photo_url: order.couriers.photo_url,
              count: 0,
            }
          }
          grouped[order.courier_id].count++
        }
      })

      setHistoricalStats(Object.values(grouped).sort((a, b) => b.count - a.count))
    } catch (err) {
      console.error('[Couriers] Error cargando stats históricas:', err.message)
    }
  }, [])

  useEffect(() => {
    fetchCouriers()
    fetchTodayStats()
  }, [fetchCouriers, fetchTodayStats])

  useEffect(() => {
    fetchHistoricalStats(selectedDate)
  }, [selectedDate, fetchHistoricalStats])

  function openNew() {
    setEditCourier(null)
    setForm({ name: '', phone: '', photo_url: '', is_active: true })
    setShowModal(true)
  }

  function openEdit(courier) {
    setEditCourier(courier)
    setForm({
      name: courier.name || '',
      phone: courier.phone || '',
      pin: courier.pin || '',
      photo_url: courier.photo_url || '',
      is_active: courier.is_active,
    })
    setShowModal(true)
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    if (!form.pin.trim() || form.pin.trim().length < 4) {
      setSaving(false)
      return alert('El PIN debe tener al menos 4 caracteres')
    }
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      pin: form.pin.trim(),
      photo_url: form.photo_url.trim() || null,
      is_active: form.is_active,
    }
    let error
    if (editCourier) {
      ;({ error } = await supabase.from('couriers').update(payload).eq('id', editCourier.id))
    } else {
      ;({ error } = await supabase.from('couriers').insert(payload))
    }
    setSaving(false)
    if (error) return alert('Error: ' + error.message)
    setShowModal(false)
    fetchCouriers()
  }

  async function toggleActive(courier) {
    try {
      const { error } = await supabase
        .from('couriers')
        .update({ is_active: !courier.is_active })
        .eq('id', courier.id)
      if (error) throw error
      fetchCouriers()
    } catch (err) {
      console.error('[Couriers] Error cambiando estado:', err.message)
      alert('No se pudo cambiar el estado del mensajero: ' + err.message)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">

      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/dashboard')}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <Logo size="sm" />
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle dark={dark} onToggle={toggleTheme} />
            <button
              onClick={openNew}
              className="flex items-center gap-2 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl transition-colors shadow-sm shadow-orange-200 dark:shadow-none"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
              </svg>
              Nuevo mensajero
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Mensajeros</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Gestiona el equipo de entregas</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-8 h-8 border-4 border-orange-100 dark:border-orange-900/50 border-t-orange-500 rounded-full animate-spin" />
            </div>
          ) : couriers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-2xl flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-gray-500 dark:text-gray-400 font-medium">No hay mensajeros registrados</p>
              <button onClick={openNew} className="mt-4 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors">
                Agregar el primero
              </button>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                  {['Mensajero', 'Teléfono', 'Servicios hoy', 'Estado', 'Acciones'].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-4 py-3 first:pl-6 last:pr-6">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {couriers.map(c => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="pl-6 pr-4 py-4">
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name} photoUrl={c.photo_url} />
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white">{c.name}</p>
                          <p className="text-gray-400 dark:text-gray-500 text-xs font-mono mt-0.5">{c.id.slice(0, 8)}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-gray-600 dark:text-gray-400">
                      {c.phone || <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="inline-flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-full">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        <span className="font-bold text-sm">{todayStats[c.id] || 0}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <button
                        onClick={() => toggleActive(c)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-colors ${
                          c.is_active
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${c.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                        {c.is_active ? 'Activo' : 'Inactivo'}
                      </button>
                    </td>
                    <td className="px-4 py-4 pr-6">
                      <button
                        onClick={() => openEdit(c)}
                        className="text-xs font-medium bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Estadísticas históricas */}
        <div className="mt-8 bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">Estadísticas por día</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Servicios completados por mensajero</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 dark:text-gray-400">Fecha:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200"
              />
            </div>
          </div>

          <div className="p-6">
            {historicalStats.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center mb-3">
                  <svg className="w-7 h-7 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <p className="text-gray-500 dark:text-gray-400 font-medium">No hay entregas registradas en esta fecha</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Selecciona otra fecha para ver estadísticas</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {historicalStats.map((stat) => (
                  <div key={stat.courier_id} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 border border-gray-100 dark:border-gray-700">
                    <div className="flex items-center gap-3 mb-3">
                      <Avatar name={stat.name} photoUrl={stat.photo_url} />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-900 dark:text-white truncate">{stat.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-white dark:bg-gray-900 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">Servicios completados</p>
                        <p className="text-2xl font-black text-orange-500">{stat.count}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modal crear/editar */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6 w-full max-w-md">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/30 rounded-xl flex items-center justify-center">
                  <svg className="w-5 h-5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white">
                  {editCourier ? 'Editar mensajero' : 'Nuevo mensajero'}
                </h3>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="flex justify-center mb-2">
                <Avatar name={form.name || '?'} photoUrl={form.photo_url} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nombre completo *</label>
                <input
                  type="text"
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
                  placeholder="Carlos Rodríguez"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Teléfono</label>
                <input
                  type="text"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
                  placeholder="300-123-4567"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  PIN de acceso *
                  <span className="ml-2 text-xs text-gray-400 font-normal">El mensajero lo usa para ingresar a la app</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.pin}
                  onChange={e => setForm(f => ({ ...f, pin: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 font-mono tracking-widest"
                  placeholder="Ej: 1234"
                  maxLength={10}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">URL de foto <span className="text-gray-400 font-normal">(opcional)</span></label>
                <input
                  type="url"
                  value={form.photo_url}
                  onChange={e => setForm(f => ({ ...f, photo_url: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600"
                  placeholder="https://..."
                />
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Sin foto se muestra la inicial del nombre</p>
              </div>

              <div className="flex items-center gap-3 py-1">
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className="text-sm text-gray-700 dark:text-gray-300">{form.is_active ? 'Mensajero activo' : 'Mensajero inactivo'}</span>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 py-3 rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors"
                >
                  {saving ? 'Guardando...' : editCourier ? 'Guardar cambios' : 'Crear mensajero'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
