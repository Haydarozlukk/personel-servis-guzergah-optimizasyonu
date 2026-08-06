import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './lib/leafletDefaultIcon'
import './styles.css'
import { AuthShell } from './components/AuthShell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthShell />
  </StrictMode>,
)
