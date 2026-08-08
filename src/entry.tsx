import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

function Entry() {
  const [ready, setReady] = useState(false)
  const [showApp, setShowApp] = useState(false)

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (token) {
      setShowApp(true)
    } else {
      window.location.assign('/login.html')
      return
    }
    setReady(true)
  }, [])

  if (!ready) return null
  return showApp ? <App /> : null
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Entry />
  </React.StrictMode>,
)
