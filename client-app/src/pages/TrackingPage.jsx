import { useParams } from 'react-router-dom'
import { useOrderTracking } from '../hooks/useOrderTracking'
import CourierCard from '../components/CourierCard'
import TrackingMap from '../components/TrackingMap'
import OrderDetail from '../components/OrderDetail'
import DeliveredScreen from '../components/DeliveredScreen'

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-white">
      <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="text-gray-500 text-base">Buscando tu domicilio...</p>
    </div>
  )
}

function ErrorScreen({ message }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-white">
      <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-4">
        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </div>
      <p className="text-gray-800 text-lg font-semibold">{message}</p>
    </div>
  )
}

function TrackingPage() {
  const { token } = useParams()
  const { status, order, courier, totalActiveOrders, courierLocation, errorMessage } = useOrderTracking(token)

  if (status === 'loading') return <LoadingScreen />
  if (status === 'error') return <ErrorScreen message={errorMessage} />
  if (status === 'delivered') return <DeliveredScreen courier={courier} />

  return (
    <div className="min-h-screen bg-gray-50 py-4 px-4">
      <div className="max-w-[480px] mx-auto space-y-3">
        {/* Header mínimo */}
        <div className="text-center pb-1">
          <span className="text-orange-500 font-bold text-lg tracking-tight">
            Rastreo en vivo
          </span>
        </div>

        {/* Tarjeta mensajero */}
        <CourierCard courier={courier} status={status} courierLocation={courierLocation} />

        {/* Mapa */}
        <TrackingMap
          courierLocation={courierLocation}
        />

        {/* Detalle del pedido */}
        <OrderDetail order={order} totalActiveOrders={totalActiveOrders} />

        {/* Pie */}
        <p className="text-center text-xs text-gray-300 pb-2">
          Actualización en tiempo real
        </p>
      </div>
    </div>
  )
}

export default TrackingPage
