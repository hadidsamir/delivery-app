import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import TrackingPage from './pages/TrackingPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/track/:token" element={<TrackingPage />} />
        <Route path="*" element={<Navigate to="/track/demo" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
