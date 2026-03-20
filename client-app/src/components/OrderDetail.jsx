function OrderDetail({ order, totalActiveOrders }) {
  const isMultiple = totalActiveOrders > 1
  const items = order.items || []

  return (
    <div className="bg-white rounded-2xl shadow-md p-4">
      {/* Dirección */}
      <div className="flex items-start gap-2 mb-4 pb-4 border-b border-gray-100">
        <svg className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z" />
        </svg>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Dirección de entrega</p>
          <p className="text-gray-800 text-sm font-medium">{order.delivery_address}</p>
        </div>
      </div>

      {/* Badge pedido múltiple */}
      {isMultiple && (
        <div className="mb-3">
          <span className="inline-flex items-center bg-orange-100 text-orange-700 text-sm font-semibold px-3 py-1.5 rounded-full">
            Tu pedido es la entrega #{order.delivery_order} de {totalActiveOrders}
          </span>
        </div>
      )}

      {/* Título */}
      <p className="text-gray-700 text-sm font-semibold mb-2">
        {isMultiple ? 'Tus productos' : 'Tu pedido'}
      </p>

      {/* Lista de items */}
      {items.length > 0 ? (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{item.name}</span>
              <span className="bg-orange-50 text-orange-600 font-semibold text-xs px-2 py-0.5 rounded-full">
                x{item.qty}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-400 text-sm">Sin detalle de productos</p>
      )}
    </div>
  )
}

export default OrderDetail
