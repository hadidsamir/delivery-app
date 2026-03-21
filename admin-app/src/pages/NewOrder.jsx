import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AddressAutocomplete from '../components/AddressAutocomplete'
import Logo from '../components/Logo'
import ThemeToggle from '../components/ThemeToggle'
import { useTheme } from '../hooks/useTheme'

export default function NewOrder() {
  const navigate = useNavigate()
  const { dark, toggleTheme } = useTheme()
  const [couriers, setCouriers] = useState([])
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    client_name: '',
    client_phone: '',
    delivery_address: '',
    courier_id: '',
  })
  const [deliveryCoords, setDeliveryCoords] = useState(null)
  const [items, setItems] = useState([{ name: '', qty: 1 }])

  useEffect(() => {
    supabase
      .from('couriers')
      .select('id, name')
      .eq('is_active', true)
      .then(({ data }) => setCouriers(data || []))
  }, [])

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function addItem() {
    setItems(i => [...i, { name: '', qty: 1 }])
  }

  function removeItem(idx) {
    setItems(i => i.filter((_, j) => j !== idx))
  }

  function updateItem(idx, k, v) {
    setItems(i => i.map((item, j) => j === idx ? { ...item, [k]: v } : item))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.courier_id) return alert('Selecciona un mensajero')
    const validItems = items.filter(i => i.name.trim())
    if (!validItems.length) return alert('Agrega al menos un ítem')

    setLoading(true)
    const { error } = await supabase.from('orders').insert({
      client_name: form.client_name,
      client_phone: form.client_phone,
      delivery_address: form.delivery_address,
      courier_id: form.courier_id,
      status: 'pendiente',
      items: validItems.map(i => ({ name: i.name, qty: Number(i.qty) })),
      delivery_order: 1,
      delivery_lat: deliveryCoords?.lat ?? null,
      delivery_lng: deliveryCoords?.lng ?? null,
    })

    setLoading(false)
    if (error) return alert('Error al crear pedido: ' + error.message)
    navigate('/dashboard')
  }

  const inputClass = "w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 transition-colors"

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">

      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
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
          <ThemeToggle dark={dark} onToggle={toggleTheme} />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">Nuevo pedido</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Completa los datos para crear la entrega</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Sección cliente */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">Datos del cliente</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Nombre *</label>
                <input
                  type="text"
                  required
                  value={form.client_name}
                  onChange={e => setField('client_name', e.target.value)}
                  className={inputClass}
                  placeholder="Juan García"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Teléfono *</label>
                <input
                  type="text"
                  required
                  value={form.client_phone}
                  onChange={e => setField('client_phone', e.target.value)}
                  className={inputClass}
                  placeholder="320-456-7890"
                />
              </div>
            </div>
          </div>

          {/* Sección entrega */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider mb-4">Entrega</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Dirección *</label>
                <AddressAutocomplete
                  value={form.delivery_address}
                  onChange={v => setField('delivery_address', v)}
                  onSelect={({ address, lat, lng }) => {
                    setField('delivery_address', address)
                    setDeliveryCoords({ lat, lng })
                  }}
                  placeholder="Ej: Calle 80 # 45-32, Valledupar"
                  className={inputClass}
                />
                {deliveryCoords && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Coordenadas detectadas — el mapa será preciso
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Mensajero *</label>
                <select
                  required
                  value={form.courier_id}
                  onChange={e => setField('courier_id', e.target.value)}
                  className={inputClass + " appearance-none cursor-pointer"}
                >
                  <option value="">Seleccionar mensajero...</option>
                  {couriers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Sección ítems */}
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-800 shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Artículos del pedido</h2>
              <button
                type="button"
                onClick={addItem}
                className="flex items-center gap-1.5 text-orange-500 hover:text-orange-600 text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Agregar ítem
              </button>
            </div>

            <div className="space-y-2.5">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => updateItem(idx, 'name', e.target.value)}
                    placeholder="Nombre del producto"
                    className={inputClass + " flex-1"}
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.qty}
                    onChange={e => updateItem(idx, 'qty', e.target.value)}
                    className={inputClass + " !w-16 shrink-0 text-center"}
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="w-10 h-10 flex items-center justify-center shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Botones */}
          <div className="flex gap-3 pb-6">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="flex-1 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 font-medium py-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors shadow-sm shadow-orange-200 dark:shadow-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creando...
                </span>
              ) : 'Crear pedido'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
