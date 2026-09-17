import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './SELAE_Frontend.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
