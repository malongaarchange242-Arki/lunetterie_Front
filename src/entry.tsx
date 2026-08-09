import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import logoUrl from '../logo.jpeg'

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'
const RP_ID = 'api-lunetterie.universearch.com'

/** Seuls ces deux rôles ont l'écran Direction. Tous les autres passent par
 *  /magasin.html — c'est la seconde des deux portes d'entrée de l'application. */
const DIRECTION_ROLES = ['SUPER_ADMIN', 'ADMIN']

const ROLE_ID_TO_NAME: Record<number, string> = {
  1: 'SUPER_ADMIN', 2: 'ADMIN', 3: 'MAGASINIER', 4: 'VENDEUR',
  5: 'LABORATOIRE', 6: 'RESPONSABLE_STATION', 7: 'DIRECTION', 8: 'SUPER_DIRECTEUR',
  // 9 et 10 sont fixés à la main par les migrations 025_caisse et 028_sav : la
  // séquence aurait fait dépendre leur id de l'ordre d'exécution des migrations.
  9: 'CAISSIER', 10: 'SAV',
}
const ROLE_ALIASES: Record<string, string> = { DIRECTION: 'ADMIN', SUPER_DIRECTEUR: 'SUPER_ADMIN' }

// Le serveur renvoie tantôt un role_name, tantôt un role_id seul, et deux rôles
// historiques portent encore leur ancien nom.
function getRoleName(user: any): string | null {
  const raw = user?.role_name ?? user?.role ?? user?.roleName
  if (raw) {
    const name = String(raw).trim().toUpperCase().replace(/\s+/g, '_')
    return ROLE_ALIASES[name] || name
  }
  const id = Number(user?.role_id ?? user?.roleId)
  const byId = ROLE_ID_TO_NAME[id]
  return byId ? (ROLE_ALIASES[byId] || byId) : null
}

function isDirection(user: any) {
  return DIRECTION_ROLES.includes(String(getRoleName(user)))
}

// Le code de connexion fait exactement 4 ou 6 chiffres — même règle que IsValidPIN côté Go.
function isValidPin(value: string) {
  return /^(\d{4}|\d{6})$/.test(value)
}

function bufferToBase64URL(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  bytes.forEach(byte => { binary += String.fromCharCode(byte) })
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64URLToBuffer(base64url: string) {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const binary = window.atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function clearSession() {
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('user')
  window.localStorage.removeItem('poste')
}

const FIELD = 'w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30'

function DirectionLogin({ notice, onSuccess }: { notice: string; onSuccess: (user: any) => void }) {
  const [name, setName] = useState(() => (window.localStorage.getItem('loginName') || '').trim())
  const [pin, setPin] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(notice)
  const [error, setError] = useState(Boolean(notice))

  /** Une session ouverte sans écran où aller laisserait l'employé bloqué sur une page
   *  vide, sans moyen de se déconnecter. On refuse donc avant de poser le jeton, et on
   *  nomme le poste pour qu'il sache où aller. */
  function accept(result: any) {
    const user = result?.data?.user
    const token = result?.data?.token
    if (!token || !user) throw new Error('Réponse inattendue du serveur.')
    if (!isDirection(user)) {
      const role = getRoleName(user)
      throw new Error(`Poste « ${role || 'inconnu'} » : connectez-vous sur la page Magasin.`)
    }
    window.localStorage.setItem('token', token)
    window.localStorage.setItem('user', JSON.stringify(user))
    return user
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (!isValidPin(pin)) {
      setMessage('Le code doit contenir exactement 4 ou 6 chiffres.')
      setError(true)
      return
    }

    setBusy(true)
    setMessage('Connexion en cours…')
    setError(false)
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, password: pin }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.message || result?.error || 'Identifiants incorrects.')

      const user = accept(result)
      // Le nom exact qu'a accepté le serveur : le reconstruire depuis la fiche donnerait
      // « Prénom NOM » alors que /auth/check-user attend « NOM Prénom ».
      window.localStorage.setItem('loginName', trimmed)
      onSuccess(user)
    } catch (err: any) {
      setMessage(err?.message || 'Échec de la connexion.')
      setError(true)
      setBusy(false)
    }
  }

  async function biometric() {
    setBusy(true)
    setMessage('Analyse biométrique en cours…')
    setError(false)
    try {
      if (!window.PublicKeyCredential) throw new Error('Ce navigateur ne gère pas WebAuthn.')

      const challengeResponse = await fetch(`${API_URL}/auth/webauthn/discoverable-login-challenge`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!challengeResponse.ok) throw new Error('Impossible de contacter le serveur.')
      const challengeBody = await challengeResponse.json()

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: base64URLToBuffer(challengeBody.data.challenge),
          rpId: RP_ID,
          userVerification: 'required',
          timeout: 60000,
        },
      }) as PublicKeyCredential | null
      if (!assertion) throw new Error('Échec de l’authentification biométrique.')

      const assertionResponse = assertion.response as AuthenticatorAssertionResponse
      const verifyResponse = await fetch(`${API_URL}/auth/webauthn/discoverable-login-verify`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assertion.id,
          rawId: bufferToBase64URL(assertion.rawId),
          type: assertion.type,
          response: {
            clientDataJSON: bufferToBase64URL(assertionResponse.clientDataJSON),
            authenticatorData: bufferToBase64URL(assertionResponse.authenticatorData),
            signature: bufferToBase64URL(assertionResponse.signature),
            userHandle: assertionResponse.userHandle ? bufferToBase64URL(assertionResponse.userHandle) : null,
          },
        }),
      })
      if (!verifyResponse.ok) throw new Error('Empreinte non reconnue.')

      const user = accept(await verifyResponse.json())
      // Aucun nom saisi par empreinte : on efface celui d'avant plutôt que de laisser
      // /magasin.html reproposer le nom de quelqu'un d'autre.
      window.localStorage.removeItem('loginName')
      onSuccess(user)
    } catch (err: any) {
      setMessage(err?.message || 'Échec de l’authentification.')
      setError(true)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
        {/* Fond blanc nécessaire : le JPEG n'a pas de transparence. */}
        <div className="mx-auto w-full max-w-[200px] rounded-2xl bg-white px-4 py-3">
          <img src={logoUrl} alt="La Lunetterie" className="h-auto w-full object-contain" />
        </div>

        <p className="mt-5 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Direction</p>
        <h1 className="mt-1 text-center text-xl font-bold text-white">Connexion</h1>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <label htmlFor="dirName" className="mb-1 block text-xs font-medium text-slate-400">Nom</label>
            <input
              id="dirName"
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(false); setMessage('') }}
              autoComplete="username"
              placeholder="NOM Prénom"
              className={FIELD}
            />
          </div>

          <div>
            <label htmlFor="dirPin" className="mb-1 block text-xs font-medium text-slate-400">Code</label>
            <div className="relative">
              <input
                id="dirPin"
                type={show ? 'text' : 'password'}
                value={pin}
                onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(false); setMessage('') }}
                inputMode="numeric"
                autoComplete="current-password"
                placeholder="••••"
                className={`${FIELD} pr-14`}
              />
              <button
                type="button"
                onClick={() => setShow(v => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-semibold text-slate-400 hover:text-white"
              >
                {show ? 'Cacher' : 'Voir'}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={busy || !name.trim() || !pin}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-40"
          >
            {busy ? 'Connexion…' : 'Ouvrir la Direction'}
          </button>
        </form>

        <button
          type="button"
          onClick={() => void biometric()}
          disabled={busy}
          className="mt-3 w-full rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/5 disabled:opacity-40"
        >
          Se connecter par empreinte
        </button>

        {message && (
          <p className={`mt-4 text-center text-xs ${error ? 'text-red-400' : 'text-slate-400'}`}>{message}</p>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          Vous êtes un poste magasin ?{' '}
          <a href="/magasin.html" className="font-semibold text-blue-400 hover:underline">Connectez-vous ici</a>.
        </p>
      </div>
    </div>
  )
}

function Entry() {
  const [state, setState] = useState<'checking' | 'login' | 'app'>('checking')
  const [notice, setNotice] = useState('')

  // Le jeton seul ne suffit pas : sans relire le rôle, n'importe quel employé connecté
  // ouvrirait la Direction en tapant /index.html.
  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setState('login')
      return
    }

    void (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        })
        if (!response.ok) throw new Error('session invalide')
        const user = (await response.json())?.data?.user
        if (!user) throw new Error('session invalide')

        if (!isDirection(user)) {
          // On ne déconnecte pas : sa session reste valable pour son propre poste.
          setNotice(`Ce compte est un poste « ${getRoleName(user) || 'inconnu'} », qui n'a pas accès à la Direction.`)
          setState('login')
          return
        }

        window.localStorage.setItem('user', JSON.stringify(user))
        setState('app')
      } catch {
        clearSession()
        setState('login')
      }
    })()
  }, [])

  if (state === 'checking') return null
  if (state === 'app') return <App />
  return <DirectionLogin notice={notice} onSuccess={() => setState('app')} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Entry />
  </React.StrictMode>,
)
