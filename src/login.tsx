import React, { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'
const RP_ID = 'api-lunetterie.universearch.com'

function getRoleRedirect(user: any) {
  const role = normalizeRoleName(user?.role_name || user?.role || user?.role_id)
  const redirects: Record<string, string> = {
    SUPER_ADMIN: '/index.html',
    ADMIN: '/index.html',
    MAGASINIER: '/index.html',
    VENDEUR: '/index.html',
    LABORATOIRE: '/index.html',
    RESPONSABLE_STATION: '/index.html',
  }
  return redirects[role as string] || '/index.html'
}

// Le code de connexion fait exactement 4 ou 6 chiffres — même règle que IsValidPIN côté Go.
function isValidPin(value: string) {
  return /^(\d{4}|\d{6})$/.test(value)
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 6)
}

function normalizeRoleName(value: unknown) {
  if (!value) return null
  const name = String(value).trim().toUpperCase().replace(/\s+/g, '_')
  const aliases: Record<string, string> = { DIRECTION: 'ADMIN', SUPER_DIRECTEUR: 'SUPER_ADMIN' }
  return aliases[name] || name
}

function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [feedback, setFeedback] = useState('')
  const [feedbackType, setFeedbackType] = useState<'error' | 'success' | ''>('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordStepVisible, setPasswordStepVisible] = useState(false)
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false)
  const [loading, setLoading] = useState(false)
  const [useBiometric, setUseBiometric] = useState(false)
  const [biometricStatus, setBiometricStatus] = useState('Utilisez votre empreinte digitale pour vous connecter.')

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return
    void (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        })
        if (!response.ok) {
          window.localStorage.removeItem('token')
          window.localStorage.removeItem('user')
          return
        }
        const payload = await response.json()
        const user = payload?.data?.user
        if (user) {
          window.localStorage.setItem('user', JSON.stringify(user))
          window.location.assign(getRoleRedirect(user))
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  async function checkEmailExists(nextName: string) {
    const normalized = nextName.trim()
    // Un nom complet, donc au moins deux mots : sans ça on interroge le serveur à chaque
    // lettre tapée, pour rien.
    if (normalized.split(/\s+/).filter(Boolean).length < 2) {
      setPasswordStepVisible(false)
      setFeedback('')
      return
    }
    try {
      setFeedback('Vérification du nom…')
      const response = await fetch(`${API_URL}/auth/check-user`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: normalized }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.message || result?.error || 'Impossible de vérifier ce nom.')
      const data = result?.data || {}
      if (!data.exists) {
        setPasswordStepVisible(false)
        setFeedback('Aucun employé ne correspond à ce nom.')
        setFeedbackType('error')
        return
      }
      setNeedsPasswordSetup(!data.has_password)
      setPasswordStepVisible(true)
      setFeedback(data.has_password ? 'Nom reconnu. Saisissez votre code.' : 'Première connexion : choisissez votre code.')
      setFeedbackType('success')
    } catch (error: any) {
      setPasswordStepVisible(false)
      setFeedback(error.message || 'Vérification indisponible.')
      setFeedbackType('error')
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    if (!isValidPin(password)) {
      setFeedback('Le code doit contenir exactement 4 ou 6 chiffres.')
      setFeedbackType('error')
      return
    }
    if (needsPasswordSetup && password !== confirmPassword) {
      setFeedback('Les deux codes ne correspondent pas.')
      setFeedbackType('error')
      return
    }

    setLoading(true)
    setFeedback('Connexion en cours...')
    setFeedbackType('')
    try {
      const endpoint = needsPasswordSetup ? 'auth/set-password' : 'auth/login'
      const response = await fetch(`${API_URL}/${endpoint}`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: email.trim(), password }),
      })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData?.message || 'Identifiants incorrects')
      }
      const result = await response.json()
      window.localStorage.setItem('token', result.data.token)
      window.localStorage.setItem('user', JSON.stringify(result.data.user))
      setFeedback('Connexion réussie ! Redirection...')
      setFeedbackType('success')
      window.location.assign(getRoleRedirect(result.data.user))
    } catch (error: any) {
      setFeedback(error.message || 'Échec de la connexion')
      setFeedbackType('error')
    } finally {
      setLoading(false)
    }
  }

  async function handleBiometricLogin() {
    setUseBiometric(true)
    setBiometricStatus('Analyse biométrique en cours...')
    try {
      if (!window.PublicKeyCredential) throw new Error('Ce navigateur ne supporte pas WebAuthn.')
      const challengeResponse = await fetch(`${API_URL}/auth/webauthn/discoverable-login-challenge`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!challengeResponse.ok) throw new Error('Impossible de contacter le serveur')
      const challengeBody = await challengeResponse.json()
      const challenge = challengeBody.data.challenge
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: base64URLToBuffer(challenge),
          rpId: RP_ID,
          userVerification: 'required',
          timeout: 60000,
        },
      })
      if (!assertion) throw new Error('Échec d’authentification biométrique')
      const payload = {
        id: assertion.id,
        rawId: bufferToBase64URL(assertion.rawId),
        type: assertion.type,
        response: {
          clientDataJSON: bufferToBase64URL((assertion as any).response.clientDataJSON),
          authenticatorData: bufferToBase64URL((assertion as any).response.authenticatorData),
          signature: bufferToBase64URL((assertion as any).response.signature),
          userHandle: (assertion as any).response.userHandle ? bufferToBase64URL((assertion as any).response.userHandle) : null,
        },
      }
      const verifyResponse = await fetch(`${API_URL}/auth/webauthn/discoverable-login-verify`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!verifyResponse.ok) throw new Error('Empreinte non reconnue')
      const result = await verifyResponse.json()
      window.localStorage.setItem('token', result.data.token)
      window.localStorage.setItem('user', JSON.stringify(result.data.user))
      window.location.assign(getRoleRedirect(result.data.user))
    } catch (error: any) {
      setBiometricStatus(error.message || 'Échec de l’authentification')
      setUseBiometric(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 shadow-2xl backdrop-blur-xl p-8">
        <img src={logoUrl} alt="La Lunetterie" className="mx-auto mb-6 h-20 w-auto rounded-2xl bg-white p-2" />
        <h1 className="text-center text-2xl font-semibold">Connexion</h1>
        <p className="mt-2 text-center text-sm text-slate-300">Connectez-vous avec votre nom ou par authentification biométrique</p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium text-slate-200" htmlFor="loginName">Nom de l'employé</label>
          <input id="loginName" type="text" autoComplete="name" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => void checkEmailExists(email)} className="w-full rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm outline-none ring-0" placeholder="MALONGA Archange" />

          <p className={`text-sm ${feedbackType === 'error' ? 'text-red-300' : feedbackType === 'success' ? 'text-emerald-300' : 'text-slate-300'}`}>{feedback}</p>

          {passwordStepVisible && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-slate-200" htmlFor="loginPassword">{needsPasswordSetup ? 'Nouveau code' : 'Code'}</label>
              {/* inputMode numeric : pavé numérique sur mobile. type text plutôt que number,
                  qui ignore maxLength et laisserait passer « e », « + » et « - ». */}
              <div className="flex items-center rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3">
                <input id="loginPassword" type={showPassword ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]*" maxLength={6} autoComplete="one-time-code" value={password} onChange={e => setPassword(onlyDigits(e.target.value))} className="w-full bg-transparent text-sm tracking-[0.4em] outline-none" placeholder={needsPasswordSetup ? 'Choisissez 4 ou 6 chiffres' : '••••'} />
                <button type="button" onClick={() => setShowPassword(v => !v)} className="ml-2 text-slate-400">{showPassword ? 'Cacher' : 'Voir'}</button>
              </div>
              {needsPasswordSetup && (
                <>
                  <div className="flex items-center rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3">
                    <input type={showPassword ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]*" maxLength={6} value={confirmPassword} onChange={e => setConfirmPassword(onlyDigits(e.target.value))} className="w-full bg-transparent text-sm tracking-[0.4em] outline-none" placeholder="Confirmez le code" />
                  </div>
                  <p className="text-xs text-slate-400">Le code doit contenir exactement 4 ou 6 chiffres.</p>
                </>
              )}
              <button type="submit" disabled={loading} className="w-full rounded-2xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                {loading ? 'Connexion...' : needsPasswordSetup ? 'Définir mon code' : 'Se connecter'}
              </button>
            </div>
          )}
        </form>

        <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-[0.3em] text-slate-400">
          <div className="h-px flex-1 bg-white/10" />
          <span>ou</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <button onClick={() => void handleBiometricLogin()} className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm font-medium text-slate-100">
          <span>🔐</span>
          <span>{useBiometric ? 'Connexion en cours...' : 'Connexion biométrique'}</span>
        </button>
        <p className="mt-3 text-center text-sm text-slate-400">{biometricStatus}</p>
      </div>
    </div>
  )
}

function bufferToBase64URL(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let str = ''
  bytes.forEach(b => { str += String.fromCharCode(b) })
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64URLToBuffer(base64url: string) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(base64 + padding)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return buffer
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LoginPage />
  </React.StrictMode>,
)
