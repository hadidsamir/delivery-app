import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import NewOrder from './pages/NewOrder'
import Couriers from './pages/Couriers'

function RequireAuth({ children }) {
  return localStorage.getItem('admin_auth') === 'true'
    ? children
    : <Navigate to="/login" replace />
}

export default function App() {
  useTheme()
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/orders/new" element={<RequireAuth><NewOrder /></RequireAuth>} />
        <Route path="/couriers" element={<RequireAuth><Couriers /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
