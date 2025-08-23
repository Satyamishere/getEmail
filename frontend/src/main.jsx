import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import Home from './components/Home'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Home />
  </React.StrictMode>
)
