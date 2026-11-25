import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './auth'
import { ToastProvider } from './components/ui'
import { SiteSettingsProvider } from './components/layout'
import { LanguageProvider } from './i18n'
import App from './App'
import './styles/tokens.css'
import './styles/components.css'
import './styles/animations.css'
import './styles/theme.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <SiteSettingsProvider>
            <LanguageProvider>
              <App />
            </LanguageProvider>
          </SiteSettingsProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
