import './i18n'
import './index.css'
import './polyfill'
import './services/lightning.service'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary.tsx'

// Extract invite params from URL before any rendering or Nostr queries
const _inviteParams = new URLSearchParams(window.location.search)
const _inviteKey = _inviteParams.get('openai_key')
if (_inviteKey) {
  localStorage.setItem('openai_api_key', _inviteKey)
  _inviteParams.delete('openai_key')
  const newSearch = _inviteParams.toString()
  const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash
  window.history.replaceState({}, '', newUrl)
}

const setVh = () => {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`)
}
window.addEventListener('resize', setVh)
window.addEventListener('orientationchange', setVh)
setVh()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
