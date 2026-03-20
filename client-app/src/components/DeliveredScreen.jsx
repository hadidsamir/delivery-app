function DeliveredScreen({ courier }) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 text-center">
      {/* Check animado */}
      <div className="w-24 h-24 rounded-full bg-green-100 flex items-center justify-center mb-6">
        <svg className="w-12 h-12 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        ¡Tu pedido fue entregado!
      </h1>

      {courier && (
        <p className="text-gray-500 text-base mb-8">
          Entregado por <span className="font-semibold text-gray-700">{courier.name}</span>
        </p>
      )}

      <button className="bg-orange-500 text-white font-semibold text-base px-8 py-3 rounded-2xl shadow-md active:scale-95 transition-transform">
        Calificar servicio
      </button>
    </div>
  )
}

export default DeliveredScreen
