function CourierCard({ courier, status }) {
  const initial = courier.name?.charAt(0).toUpperCase() || '?'

  return (
    <div className="bg-white rounded-2xl shadow-md p-4 flex items-center gap-4">
      {/* Foto o avatar */}
      {courier.photo_url ? (
        <img
          src={courier.photo_url}
          alt={courier.name}
          className="w-16 h-16 rounded-full object-cover flex-shrink-0 border-2 border-orange-200"
        />
      ) : (
        <div className="w-16 h-16 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0 text-white text-2xl font-bold">
          {initial}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-gray-500 text-xs mb-0.5">Tu mensajero</p>
        <h2 className="text-gray-900 text-lg font-semibold leading-tight truncate">
          {courier.name}
        </h2>
        {courier.phone && (
          <a
            href={`tel:${courier.phone}`}
            className="inline-flex items-center gap-1.5 text-orange-500 text-sm font-medium mt-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 8V5z" />
            </svg>
            {courier.phone}
          </a>
        )}
      </div>

      {/* Badge */}
      <div className="flex-shrink-0">
        {status === 'tracking' ? (
          <span className="pulse-badge inline-flex items-center gap-1.5 bg-orange-100 text-orange-600 text-xs font-semibold px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>
            En camino
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 bg-green-100 text-green-600 text-xs font-semibold px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
            Llegando
          </span>
        )}
      </div>
    </div>
  )
}

export default CourierCard
