import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import logoUrl from '../logo.jpeg'
import {
  POSTE_FEATURES, POSTE_LABELS, POSTE_ORDER,
  isFeatureEnabled, setFeatureEnabled, isPosteEnabled, setPosteEnabled,
  loadRemoteFlags,
  type PosteId,
  GEO_CITIES, SOUS_STATION_LABELS, SOUS_STATION_ORDER,
  isCountryEnabled, setCountryEnabled, isCityEnabled, setCityEnabled,
  isSousStationEnabled, setSousStationEnabled,
  type SousStationId,
} from './featureFlags'

const UNLOCK_KEY = 'ssAdminUnlocked'
const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

const ic = {
  chevDown: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>,
  signOut: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>,
  sun: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
}

function Switch({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  )
}

function LoginGate({ onUnlock }: { onUnlock: () => void }) {
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !pass || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), password: pass }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.message || payload?.error || 'Identifiants incorrects.')
      const user = payload?.data?.user
      const token = payload?.data?.token
      const roleId = Number(user?.role_id)
      if (!token || !user || ![1, 2, 8, 12].includes(roleId)) throw new Error('Accès réservé à un administrateur.')
      window.localStorage.setItem('token', token)
      window.localStorage.setItem('user', JSON.stringify(user))
      window.sessionStorage.setItem(UNLOCK_KEY, '1')
      onUnlock()
    } catch (err: any) {
      setError(err?.message || 'Connexion impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/10 p-8 shadow-2xl backdrop-blur-xl">
        <div className="mx-auto w-full max-w-[200px] rounded-2xl bg-white px-4 py-3">
          <img src={logoUrl} alt="La Lunetterie" className="h-auto w-full object-contain" />
        </div>
        <p className="mt-5 text-center text-xs font-semibold uppercase tracking-[0.15em] text-slate-400">Administration</p>
        <h1 className="mt-1 text-center text-xl font-bold text-white">Fonctionnalités</h1>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <div>
            <label htmlFor="ssUser" className="mb-1 block text-xs font-medium text-slate-400">Identifiant</label>
            <input
              id="ssUser"
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              autoComplete="username"
              placeholder="Nom administrateur"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30"
            />
          </div>
          <div>
            <label htmlFor="ssPass" className="mb-1 block text-xs font-medium text-slate-400">Mot de passe</label>
            <input
              id="ssPass"
              type="password"
              value={pass}
              onChange={e => { setPass(e.target.value); setError('') }}
              autoComplete="current-password"
              placeholder="••••"
              className="w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-white/30"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || !pass || busy}
            className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-40"
          >
            {busy ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        {error && <p className="mt-4 text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>
  )
}

function PosteCard({ poste, dark, refreshKey, bump }: { poste: PosteId; dark: boolean; refreshKey: number; bump: () => void }) {
  const [open, setOpen] = useState(false)
  const features = POSTE_FEATURES[poste]
  const posteActive = isPosteEnabled(poste)
  const enabledCount = features.filter(f => isFeatureEnabled(poste, f.id)).length
  void refreshKey // force le recalcul ci-dessus à chaque bump() du parent

  return (
    <div className="rounded-2xl border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex flex-1 items-center justify-between gap-3 text-left min-w-0">
          <div className="min-w-0">
            <p className={`text-sm font-bold truncate ${posteActive ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>{POSTE_LABELS[poste]}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {posteActive ? `${enabledCount} / ${features.length} écran${features.length > 1 ? 's' : ''} actif${enabledCount > 1 ? 's' : ''}` : 'Poste désactivé'}
            </p>
          </div>
          <span className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>{ic.chevDown('w-5 h-5')}</span>
        </button>
        <Switch checked={posteActive} onChange={next => { setPosteEnabled(poste, next); bump() }} />
      </div>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
          {features.map(feature => {
            const enabled = isFeatureEnabled(poste, feature.id)
            return (
              <div key={feature.id} className="flex items-center justify-between px-4 py-3">
                <span className={`text-sm ${enabled && posteActive ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>{feature.label}</span>
                <Switch checked={enabled} disabled={!posteActive} onChange={next => { setFeatureEnabled(poste, feature.id, next); bump() }} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Sous-station : le 3ᵉ et dernier niveau (Stock magasin / Présentoir / Laboratoire / Réserve
// d'UNE ville). Son propre interrupteur reste actionnable même ville désactivée — comme une
// fonctionnalité de poste reste visible poste désactivé — mais `disabled` le grise et bloque
// le clic pour ne pas donner l'impression qu'elle compte tant que la ville ne l'est pas.
function SousStationRow({ city, sousStation, disabled, bump }: { city: string; sousStation: SousStationId; disabled: boolean; bump: () => void }) {
  const enabled = isSousStationEnabled(city, sousStation)
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className={`text-sm ${enabled && !disabled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500'}`}>{SOUS_STATION_LABELS[sousStation]}</span>
      <Switch checked={enabled} disabled={disabled} onChange={next => { setSousStationEnabled(city, sousStation, next); bump() }} />
    </div>
  )
}

function CityCard({ city, disabled, bump }: { city: string; disabled: boolean; bump: () => void }) {
  const [open, setOpen] = useState(false)
  const cityActive = isCityEnabled(city)
  const enabledCount = SOUS_STATION_ORDER.filter(s => isSousStationEnabled(city, s)).length

  return (
    <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex flex-1 items-center justify-between gap-3 text-left min-w-0">
          <div className="min-w-0">
            <p className={`text-sm font-bold truncate ${cityActive && !disabled ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>{city}</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {disabled ? 'Pays désactivé' : cityActive ? `${enabledCount} / ${SOUS_STATION_ORDER.length} sous-stations actives` : 'Ville désactivée'}
            </p>
          </div>
          <span className={`flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}>{ic.chevDown('w-4 h-4')}</span>
        </button>
        <Switch checked={cityActive} disabled={disabled} onChange={next => { setCityEnabled(city, next); bump() }} />
      </div>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
          {SOUS_STATION_ORDER.map(sousStation => (
            <SousStationRow key={sousStation} city={city} sousStation={sousStation} disabled={disabled || !cityActive} bump={bump} />
          ))}
        </div>
      )}
    </div>
  )
}

function CountryCard({ country, flag, cities, refreshKey, bump }: { country: string; flag: string; cities: string[]; refreshKey: number; bump: () => void }) {
  const [open, setOpen] = useState(false)
  const countryActive = isCountryEnabled(country)
  const activeCities = cities.filter(c => isCityEnabled(c)).length
  void refreshKey

  return (
    <div className="rounded-2xl border border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex flex-1 items-center gap-3 text-left min-w-0">
          <span className="text-2xl leading-none flex-shrink-0">{flag}</span>
          <div className="min-w-0 flex-1 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-sm font-bold truncate ${countryActive ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500'}`}>{country}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {countryActive ? `${activeCities} / ${cities.length} ville${cities.length > 1 ? 's' : ''} active${activeCities > 1 ? 's' : ''}` : 'Pays désactivé'}
              </p>
            </div>
            <span className="flex-shrink-0 text-slate-400 transition-transform" style={{ transform: open ? 'rotate(180deg)' : undefined }}>{ic.chevDown('w-5 h-5')}</span>
          </div>
        </button>
        <Switch checked={countryActive} onChange={next => { setCountryEnabled(country, next); bump() }} />
      </div>

      {open && (
        <div className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40 p-3 space-y-2">
          {cities.map(city => (
            <CityCard key={city} city={city} disabled={!countryActive} bump={bump} />
          ))}
        </div>
      )}
    </div>
  )
}

function FonctionnalitesPage() {
  const [unlocked, setUnlocked] = useState(() => window.sessionStorage.getItem(UNLOCK_KEY) === '1')
  const [dark, setDark] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const bump = () => setRefreshKey(n => n + 1)

  useEffect(() => {
    if (unlocked && window.localStorage.getItem('token')) void loadRemoteFlags()
    if (unlocked && !window.localStorage.getItem('token')) {
      window.sessionStorage.removeItem(UNLOCK_KEY)
      setUnlocked(false)
    }
  }, [unlocked])

  if (!unlocked) return <LoginGate onUnlock={() => setUnlocked(true)} />

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center flex-shrink-0 overflow-hidden">
            <img src={logoUrl} alt="La Lunetterie" className="w-full h-full object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">Fonctionnalités</h1>
            <p className="text-xs text-slate-400">Administration distante</p>
          </div>
          <button onClick={() => setDark(d => !d)} className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all flex-shrink-0">
            {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
          </button>
          <button
            onClick={() => { window.sessionStorage.removeItem(UNLOCK_KEY); setUnlocked(false) }}
            className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all flex-shrink-0"
            aria-label="Verrouiller"
          >
            {ic.signOut('w-4 h-4')}
          </button>
        </header>

        <main className="max-w-2xl mx-auto px-4 md:px-6 py-6 space-y-4">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Active ou désactive un poste entier, ou seulement un de ses écrans. Un poste désactivé disparaît du choix de poste (magasin.html) et refuse la connexion même en tapant l'URL directement.
            </p>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs font-medium text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
            Réglage centralisé sur le serveur : les postes connectés voient la même configuration.
          </div>

          <div className="space-y-3">
            {POSTE_ORDER.map(poste => (
              <PosteCard key={poste} poste={poste} dark={dark} refreshKey={refreshKey} bump={bump} />
            ))}
          </div>

          <div className="pt-2">
            <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500">Géographie</p>
            <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
              Active ou désactive un pays, une ville, ou une seule de ses sous-stations. Un pays ou une ville désactivée disparaît de Suivi Global côté Direction.
            </p>
          </div>

          <div className="space-y-3">
            {Array.from(new Set(GEO_CITIES.map(g => g.country))).map(country => {
              const entries = GEO_CITIES.filter(g => g.country === country)
              return (
                <CountryCard
                  key={country}
                  country={country}
                  flag={entries[0]?.flag || ''}
                  cities={entries.map(e => e.city)}
                  refreshKey={refreshKey}
                  bump={bump}
                />
              )
            })}
          </div>
        </main>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FonctionnalitesPage />
  </React.StrictMode>,
)
