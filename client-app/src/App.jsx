import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import TrackingPage from './pages/TrackingPage'
import RequestPage  from './pages/RequestPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/track/:token" element={<TrackingPage />} />
        <Route path="/solicitar"    element={<RequestPage />} />
        <Route path="*" element={<Navigate to="/solicitar" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
