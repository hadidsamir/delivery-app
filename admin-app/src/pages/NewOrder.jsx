import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AddressAutocomplete from '../components/AddressAutocomplete'

export default function NewOrder() {
  const navigate = useNavigate()
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <button onClick={() => navigate('/dashboard')} className="text-gray-500 hover:text-gray-800">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-lg font-bold text-gray-900">Nuevo Pedido</h1>
      </header>

      <div className="max-w-2xl mx-auto p-6">
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-5">

          {/* Cliente */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del cliente *</label>
              <input
                type="text"
                required
                value={form.client_name}
                onChange={e => setField('client_name', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="Juan García"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono *</label>
              <input
                type="text"
                required
                value={form.client_phone}
                onChange={e => setField('client_phone', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                placeholder="320-456-7890"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Dirección de entrega *</label>
            <AddressAutocomplete
              value={form.delivery_address}
              onChange={v => setField('delivery_address', v)}
              onSelect={({ address, lat, lng }) => {
                setField('delivery_address', address)
                setDeliveryCoords({ lat, lng })
              }}
              placeholder="Ej: Calle 80 # 45-32, Valledupar"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
            {deliveryCoords && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <span>✓</span> Coordenadas obtenidas — el mapa será más preciso
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mensajero *</label>
            <select
              required
              value={form.courier_id}
              onChange={e => setField('courier_id', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 bg-white"
            >
              <option value="">Seleccionar mensajero...</option>
              {couriers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-700">Artículos del pedido *</label>
              <button
                type="button"
                onClick={addItem}
                className="text-orange-500 hover:text-orange-600 text-sm font-medium flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Agregar ítem
              </button>
            </div>
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="flex gap-2">
                  <input
                    type="text"
                    value={item.name}
                    onChange={e => updateItem(idx, 'name', e.target.value)}
                    placeholder="Nombre del producto"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.qty}
                    onChange={e => updateItem(idx, 'qty', e.target.value)}
                    className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 text-center"
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(idx)}
                      className="text-red-400 hover:text-red-600 px-2"
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

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="flex-1 border border-gray-300 text-gray-700 font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Creando...' : 'Crear pedido'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
