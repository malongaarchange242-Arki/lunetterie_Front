import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'
import { isPosteEnabled } from './featureFlags'

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

// ── Postes ─────────────────────────────────────────────────────────────────────
type PosteId = 'vendeuse' | 'caisse' | 'labo' | 'sav' | 'responsable' | 'magasinier'

interface Poste {
  id: PosteId
  label: string
  /** Rôle attendu côté serveur pour ce poste. */
  role: string
  color: string
  /** Page du poste. Vide tant qu'elle n'est pas construite : on affiche alors un
   *  écran de confirmation au lieu de rediriger vers un 404. */
  home: string
}

const POSTES: Poste[] = [
  { id: 'vendeuse', label: 'Vendeuse', role: 'VENDEUR', color: '#2563eb', home: '/vendeuse.html' },
  { id: 'caisse', label: 'Caisse', role: 'CAISSIER', color: '#16a34a', home: '/caisse.html' },
  { id: 'labo', label: 'Labo', role: 'LABORATOIRE', color: '#0891b2', home: '/labo.html' },
  // Rôle posé en base par la migration 028_sav, id 10.
  { id: 'sav', label: 'SAV', role: 'SAV', color: '#d97706', home: '/sav.html' },
  { id: 'responsable', label: 'R. Magasin', role: 'RESPONSABLE_STATION', color: '#9333ea', home: '/responsable.html' },
  // Le magasinier n'est ni un poste de vente ni la Direction : sans cette carte, la
  // disparition de login.html le laisserait sans aucune porte d'entrée.
  { id: 'magasinier', label: 'Magasinier', role: 'MAGASINIER', color: '#7c3aed', home: '/scan.html' },
]

// Mêmes tables que auth-guard.js : le serveur renvoie tantôt un role_name, tantôt un
// role_id seul, et deux rôles historiques portent encore leur ancien nom.
// 9 et 10 sont fixés à la main par les migrations 025_caisse et 028_sav : la séquence
// aurait fait dépendre leur id de l'ordre d'exécution des migrations.
const ROLE_ID_TO_NAME: Record<number, string> = {
  1: 'SUPER_ADMIN', 2: 'ADMIN', 3: 'MAGASINIER', 4: 'VENDEUR',
  5: 'LABORATOIRE', 6: 'RESPONSABLE_STATION', 7: 'DIRECTION', 8: 'SUPER_DIRECTEUR',
  9: 'CAISSIER', 10: 'SAV',
}
const ROLE_ALIASES: Record<string, string> = { DIRECTION: 'ADMIN', SUPER_DIRECTEUR: 'SUPER_ADMIN' }

function normalizeRoleName(value: unknown) {
  if (!value) return null
  const name = String(value).trim().toUpperCase().replace(/\s+/g, '_')
  return ROLE_ALIASES[name] || name
}

function getRoleName(user: any): string | null {
  if (!user) return null
  const named = normalizeRoleName(user.role_name || user.role)
  if (named) return named
  // role_id seul : le passer tel quel à normalizeRoleName donnerait « 4 », pas « VENDEUR ».
  const byId = user.role_id != null ? ROLE_ID_TO_NAME[Number(user.role_id)] : null
  return byId ? normalizeRoleName(byId) : null
}

// Le code de connexion fait exactement 4 ou 6 chiffres — même règle que IsValidPIN côté Go.
function isValidPin(value: string) {
  return /^(\d{4}|\d{6})$/.test(value)
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 6)
}

function clearSession() {
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('user')
  window.localStorage.removeItem('poste')
}

// ── Reconnaissance du nom ──────────────────────────────────────────────────────
/** Un compte tout juste créé existe sans code. `/auth/check-user` est le seul point
 *  d'entrée public qui le dit : `GET /auth/users` exige un rôle admin, il expose tout
 *  le dossier employés. Même étape que login.js:142 du front en production. */
type LookupStatus = 'idle' | 'checking' | 'absent' | 'known' | 'new' | 'error'

interface Lookup { status: LookupStatus; message: string }

const LOOKUP_IDLE: Lookup = { status: 'idle', message: '' }

// ── Icônes ─────────────────────────────────────────────────────────────────────
const ic = {
  sun: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>,
  alert: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  lock: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>,
  x: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>,
}

/** Buste dessiné dans un rond, comme sur la maquette. */
function PosteAvatar({ color, muted }: { color: string; muted?: boolean }) {
  const stroke = muted ? 'currentColor' : color
  return (
    <div
      className={`w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0 ${muted ? 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500' : ''}`}
      style={muted ? undefined : { backgroundColor: `${color}18` }}
    >
      <svg viewBox="0 0 24 24" className="w-9 h-9" fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round">
        <circle cx="12" cy="8.5" r="3.25" />
        <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
      </svg>
    </div>
  )
}

// ── Carte verrouillée ──────────────────────────────────────────────────────────
/** Les postes qui ne sont pas celui du compte connecté. Visibles — la maquette montre
 *  les cinq — mais inertes : c'est la moitié utile de la double vérification. */
/** Les autres postes. Cliquables : cette page est devenue la connexion du magasin,
 *  c'est donc l'employé qui désigne son poste — il n'y a plus de session ouverte d'où
 *  le déduire. */
function LockedCard({ poste, onSelect }: { poste: Poste; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="bg-white/60 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700/60 p-4 flex flex-col items-center text-center transition-all hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white dark:hover:bg-slate-800"
    >
      <PosteAvatar color={poste.color} muted />
      <p className="mt-2.5 text-sm font-bold text-slate-400 dark:text-slate-500 leading-tight">{poste.label}</p>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
        {ic.lock('w-3.5 h-3.5')}
        <span>Autre poste</span>
      </p>
    </button>
  )
}

// ── Carte active ───────────────────────────────────────────────────────────────
function ActiveCard({ poste, name, pin, confirmPin, lookup, busy, message, onChangeName, onCheckName, onChangePin, onChangeConfirmPin, onSubmit }: {
  poste: Poste
  name: string
  pin: string
  confirmPin: string
  lookup: Lookup
  busy: boolean
  message: string
  onChangeName: (value: string) => void
  onCheckName: () => void
  onChangePin: (value: string) => void
  onChangeConfirmPin: (value: string) => void
  onSubmit: () => void
}) {
  const [showPin, setShowPin] = useState(false)
  // Première connexion : le compte existe, il n'a pas encore de code.
  const premiere = lookup.status === 'new'

  const inputClass = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600'
  const hintColor = lookup.status === 'absent' || lookup.status === 'error'
    ? 'text-red-600 dark:text-red-400'
    : lookup.status === 'known'
      ? 'text-green-600 dark:text-green-400'
      : lookup.status === 'new'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-slate-400 dark:text-slate-500'

  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit() }}
      className="bg-white dark:bg-slate-800 rounded-2xl border p-4 flex flex-col"
      style={{ borderColor: poste.color, boxShadow: `0 0 0 3px ${poste.color}1f` }}
    >
      <div className="flex flex-col items-center gap-2.5 text-center">
        <PosteAvatar color={poste.color} />
        <p className="text-sm font-bold text-slate-900 dark:text-white leading-tight">{poste.label}</p>
      </div>

      <div className="mt-4 space-y-2">
        <div>
          <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="magasinName">Nom</label>
          <input
            id="magasinName"
            type="text"
            autoComplete="off"
            value={name}
            onChange={e => onChangeName(e.target.value)}
            onBlur={onCheckName}
            className={inputClass}
            placeholder="Prénom Nom"
          />
          {lookup.message && (
            <p className={`mt-1 text-[11px] leading-snug ${hintColor}`}>{lookup.message}</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="magasinPin">
            {premiere ? 'Nouveau code' : 'Code'}
          </label>
          {/* inputMode numeric : pavé numérique sur mobile. type text plutôt que number,
              qui ignore maxLength et laisserait passer « e », « + » et « - ». */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2">
            <input
              id="magasinPin"
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              value={pin}
              onChange={e => onChangePin(onlyDigits(e.target.value))}
              className="w-full min-w-0 bg-transparent text-sm tracking-[0.3em] text-slate-900 dark:text-white outline-none"
              placeholder={premiere ? '4 ou 6 chiffres' : '••••'}
            />
            <button type="button" onClick={() => setShowPin(v => !v)} className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0">
              {showPin ? 'Cacher' : 'Voir'}
            </button>
          </div>
        </div>

        {premiere && (
          <div>
            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="magasinPinConfirm">
              Confirmer le code
            </label>
            <input
              id="magasinPinConfirm"
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              value={confirmPin}
              onChange={e => onChangeConfirmPin(onlyDigits(e.target.value))}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm tracking-[0.3em] text-slate-900 dark:text-white outline-none focus:border-slate-300 dark:focus:border-slate-600"
              placeholder="••••"
            />
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={busy}
        className="mt-3 w-full rounded-xl px-3 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
        style={{ backgroundColor: poste.color }}
      >
        {busy
          ? (premiere ? 'Enregistrement…' : 'Vérification…')
          : (premiere ? 'Définir mon code' : 'Ouvrir mon poste')}
      </button>

      {message && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-red-600 dark:text-red-400">
          <span className="flex-shrink-0 mt-px">{ic.alert('w-3.5 h-3.5')}</span>
          <span>{message}</span>
        </p>
      )}
    </form>
  )
}

// ── Écran d'attente ────────────────────────────────────────────────────────────
/** Affiché après la double vérification tant que l'écran du poste n'existe pas. */
function ConnectedScreen({ poste, name, onBack }: { poste: Poste; name: string; onBack: () => void }) {
  return (
    <div className="max-w-md mx-auto bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-8 text-center">
      <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center" style={{ backgroundColor: `${poste.color}18`, color: poste.color }}>
        {ic.check('w-7 h-7')}
      </div>
      <p className="mt-4 text-lg font-bold text-slate-900 dark:text-white">Poste {poste.label} ouvert</p>
      {name && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{name}</p>}
      <p className="mt-4 text-sm text-slate-400 dark:text-slate-500">
        Identité confirmée. L'écran du poste {poste.label} arrive à la page suivante.
      </p>
      <button
        onClick={onBack}
        className="mt-6 w-full rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        Retour
      </button>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
function MagasinPage() {
  const [dark, setDark] = useState(false)
  // Le poste est désigné par l'employé, plus déduit d'une session : cette page est
  // devenue la porte d'entrée du magasin, il n'y a rien d'ouvert quand elle s'affiche.
  // On rouvre sur le dernier poste utilisé, celui de la personne devant l'écran neuf
  // fois sur dix.
  // Désactivé depuis la page Fonctionnalités : ni le dernier poste utilisé, ni « vendeuse »
  // par défaut ne doivent rouvrir sur une carte qui n'a plus le droit d'être choisie.
  const [posteId, setPosteId] = useState<PosteId>(() => {
    const last = window.localStorage.getItem('poste')
    const preferred = POSTES.some(p => p.id === last) ? (last as PosteId) : 'vendeuse'
    if (isPosteEnabled(preferred)) return preferred
    return POSTES.find(p => isPosteEnabled(p.id))?.id || preferred
  })
  const [name, setName] = useState(() => (window.localStorage.getItem('loginName') || '').trim())
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [lookup, setLookup] = useState<Lookup>(LOOKUP_IDLE)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const ENABLED_POSTES = POSTES.filter(p => isPosteEnabled(p.id))
  const poste = ENABLED_POSTES.find(p => p.id === posteId) || ENABLED_POSTES[0] || POSTES[0]

  // Le nom peut changer pendant que la requête voyage : la réponse d'une saisie
  // abandonnée ne doit pas écraser l'état de la saisie en cours.
  const nameRef = useRef(name)
  useEffect(() => { nameRef.current = name }, [name])

  async function checkUser() {
    const trimmed = nameRef.current.trim()
    // Un nom complet, donc au moins deux mots : sans ça on interroge le serveur pour rien.
    if (trimmed.split(/\s+/).filter(Boolean).length < 2) {
      setLookup({ status: 'idle', message: trimmed ? 'Saisissez votre nom complet.' : '' })
      return
    }

    setLookup({ status: 'checking', message: 'Vérification du nom…' })
    try {
      const response = await fetch(`${API_URL}/auth/check-user`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || payload?.error || 'Impossible de vérifier ce nom.')
      if (nameRef.current.trim() !== trimmed) return

      const data = payload?.data || {}
      if (!data.exists) {
        setLookup({ status: 'absent', message: 'Aucun employé ne correspond à ce nom.' })
        return
      }
      setLookup(data.has_password
        ? { status: 'known', message: 'Nom reconnu. Saisissez votre code.' }
        : { status: 'new', message: 'Première connexion : choisissez votre code.' })
    } catch (error: any) {
      setLookup({ status: 'error', message: error?.message || 'Vérification indisponible.' })
    }
  }

  // Débounce : sans ce délai, le serveur serait interrogé à chaque lettre tapée.
  useEffect(() => {
    const timer = window.setTimeout(() => { void checkUser() }, 450)
    return () => window.clearTimeout(timer)
  }, [name])

  function selectPoste(next: PosteId) {
    setPosteId(next)
    setPin('')
    setConfirmPin('')
    setMessage('')
  }

  /** Efface le nom retenu du poste précédent : sur un écran partagé, l'employé suivant
   *  ne doit pas trouver celui de la personne d'avant. */
  function forgetName() {
    clearSession()
    window.localStorage.removeItem('loginName')
    setName('')
    setPin('')
    setConfirmPin('')
    setLookup(LOOKUP_IDLE)
    setMessage('')
  }

  // Une seule saisie : le code est validé auprès du serveur, et le jeton qui en revient
  // ouvre directement le poste.
  async function confirmIdentity() {
    const trimmed = name.trim()
    if (trimmed.split(/\s+/).filter(Boolean).length < 2) {
      setMessage('Saisissez votre nom complet (prénom et nom).')
      return
    }
    if (lookup.status === 'absent') {
      setMessage('Aucun employé ne correspond à ce nom.')
      return
    }
    if (!isValidPin(pin)) {
      setMessage('Le code doit contenir exactement 4 ou 6 chiffres.')
      return
    }

    const premiere = lookup.status === 'new'
    if (premiere && pin !== confirmPin) {
      setMessage('Les deux codes ne correspondent pas.')
      return
    }

    setBusy(true)
    setMessage('')
    try {
      // Un compte tout juste créé existe sans code : set-password le pose et ouvre la
      // session du même coup, il renvoie le même { token, user } que login (login.js:224).
      const endpoint = premiere ? '/auth/set-password' : '/auth/login'
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, password: pin }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.message || payload?.error || (premiere ? "Impossible d'enregistrer ce code." : 'Code incorrect.'))
      }

      const token = payload?.data?.token
      const user = payload?.data?.user
      if (!token || !user) throw new Error('Réponse inattendue du serveur.')

      // Le nom est modifiable : rien ne garantit que le compte saisi soit celui du
      // poste déverrouillé. On revérifie plutôt que de faire confiance au champ.
      if (getRoleName(user) !== poste.role) {
        throw new Error(`Ce compte n'est pas un poste ${poste.label}.`)
      }

      window.localStorage.setItem('token', token)
      window.localStorage.setItem('user', JSON.stringify(user))
      window.localStorage.setItem('loginName', trimmed)
      window.localStorage.setItem('poste', poste.id)

      if (poste.home) {
        window.location.assign(poste.home)
        return
      }
      setConfirmed(true)
    } catch (error: any) {
      setMessage(error?.message || 'Vérification impossible.')
    } finally {
      setBusy(false)
    }
  }


  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex flex-col">
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-14 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-white border border-slate-100 dark:border-slate-700 p-1 flex-shrink-0">
            <img src={logoUrl} alt="La Lunetterie" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">Interface Magasin</h1>
            <p className="text-xs text-slate-400 truncate">Connexion · poste {poste.label}</p>
          </div>
          <button
            onClick={() => setDark(d => !d)}
            className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0"
            aria-label="Changer de thème"
          >
            {dark ? ic.sun() : ic.moon()}
          </button>
          {name && (
            <button
              onClick={forgetName}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0"
            >
              {ic.x('w-3.5 h-3.5')}
              <span className="hidden sm:inline">Ce n'est pas vous ?</span>
            </button>
          )}
        </header>

        <main className="flex-1 px-4 md:px-6 py-6 md:py-10">
          {confirmed ? (
            <ConnectedScreen poste={poste} name={name} onBack={() => { setConfirmed(false); setPin('') }} />
          ) : (
            <div className="max-w-6xl mx-auto">
              <p className="mb-4 text-center text-sm text-slate-500 dark:text-slate-400">
                Connectez-vous pour ouvrir le poste <span className="font-semibold text-slate-700 dark:text-slate-200">{poste.label}</span>.
              </p>
              {/* Trois colonnes plutôt que six : la carte active porte un formulaire, une
                  colonne sur six la rendrait illisible. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                {ENABLED_POSTES.map(item => (
                  item.id === poste.id ? (
                    <ActiveCard
                      key={item.id}
                      poste={item}
                      name={name}
                      pin={pin}
                      confirmPin={confirmPin}
                      lookup={lookup}
                      busy={busy}
                      message={message}
                      onChangeName={value => { setName(value); setMessage('') }}
                      onCheckName={() => void checkUser()}
                      onChangePin={value => { setPin(value); setMessage('') }}
                      onChangeConfirmPin={value => { setConfirmPin(value); setMessage('') }}
                      onSubmit={() => void confirmIdentity()}
                    />
                  ) : (
                    <LockedCard key={item.id} poste={item} onSelect={() => selectPoste(item.id)} />
                  )
                ))}
              </div>
              <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
                Code à 4 ou 6 chiffres. Choisissez une autre carte si ce n'est pas votre poste.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MagasinPage />
  </React.StrictMode>,
)
