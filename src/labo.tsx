import React, { useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'
import type { ReactElement, ReactNode } from 'react'
import { GlassTable } from './GlassTable'

// Écran du poste Laboratoire (rôle LABORATOIRE).
//
// Le labo n'a qu'une transition à sa main : EN_LABORATOIRE → PRETE_A_LIVRER, posée par
// POST /inventory/deliveries (../Frontend/presentoir.js:1446). Tout le reste de l'écran
// n'est que de la lecture.

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

type IconFn = (c?: string) => ReactElement

// ── Session ───────────────────────────────────────────────────────────────────
function getToken() {
  return window.localStorage.getItem('token')
}

function clearSession() {
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('user')
  window.localStorage.removeItem('poste')
}

function logoutToLogin() {
  clearSession()
  window.location.replace('/magasin.html')
}

const ROLE_ID_TO_NAME: Record<number, string> = {
  1: 'SUPER_ADMIN', 2: 'ADMIN', 3: 'MAGASINIER', 4: 'VENDEUR',
  5: 'LABORATOIRE', 6: 'RESPONSABLE_STATION', 7: 'DIRECTION', 8: 'SUPER_DIRECTEUR',
  // 9 et 10 sont fixés à la main par les migrations 025_caisse et 028_sav : la
  // séquence aurait fait dépendre leur id de l'ordre d'exécution des migrations.
  9: 'CAISSIER', 10: 'SAV',
}
const ROLE_ALIASES: Record<string, string> = { DIRECTION: 'ADMIN', SUPER_DIRECTEUR: 'SUPER_ADMIN', LABO: 'LABORATOIRE' }

function getRoleName(user: any): string | null {
  const raw = user?.role_name || user?.role
  if (raw) {
    const name = String(raw).trim().toUpperCase().replace(/\s+/g, '_')
    return ROLE_ALIASES[name] || name
  }
  const byId = user?.role_id != null ? ROLE_ID_TO_NAME[Number(user.role_id)] : null
  return byId ? (ROLE_ALIASES[byId] || byId) : null
}

// Toute réponse 401/403 signifie que le jeton ne vaut plus rien : on ne laisse pas
// l'écran afficher des listes vides en donnant l'illusion d'un plan de charge vide.
async function apiFetch(path: string, init?: RequestInit) {
  const token = getToken()
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401 || response.status === 403) {
    logoutToLogin()
    throw new Error('Session expirée')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Le serveur nomme précisément ce qui bloque (monture déjà livrée, code inconnu) :
    // ce message vaut mieux qu'un « erreur » générique.
    throw new Error(payload?.error || payload?.message || `Erreur ${response.status}`)
  }
  return payload
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface Glass {
  barcode: string
  reference?: string
  brand?: string
  shape?: string
  color?: string
  material?: string
  gender?: string
  price?: number | string
  status?: string
  station_id?: number
  location_code?: string
  photo_monture_url?: string
  photo_branche_url?: string
  created_at?: string
  updated_at?: string
}

interface ProformaItem {
  id: number
  barcode?: string
  reference?: string
}

interface Proforma {
  id: number
  code?: string
  client_name?: string
  client_phone?: string
  note?: string
  created_at?: string
  items?: ProformaItem[]
}

// ── Format ────────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return Number(n || 0).toLocaleString('fr-FR')
}

function fmtFCFA(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  return Number.isNaN(n) ? '—' : `${fmt(n)} FCFA`
}

function fmtDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function glassRef(glass: Glass) {
  return glass.reference || glass.barcode || '—'
}

/** Le repli sur le code-barres est propre à cet écran : les listes du labo montrent une
 *  ligne par monture sans colonne code, il faut bien l'identifier quand ses attributs
 *  manquent. Le tableau partagé, lui, a sa propre colonne et rend « — ». */
function glassModelOrBarcode(glass: Glass) {
  return [glass.brand, glass.shape, glass.color].filter(Boolean).join(' · ') || glass.barcode
}

function fullName(user: any) {
  return `${String(user?.first_name || '').trim()} ${String(user?.last_name || '').trim()}`.trim()
}

function daysSince(value?: string) {
  if (!value) return 0
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
}

// ── Icônes ────────────────────────────────────────────────────────────────────
// SVG inline : le projet n'embarque aucune bibliothèque d'icônes (cf. AGENTS.md).
const ic = {
  flask: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M9 2h6M10 2v6.4a2 2 0 0 1-.4 1.2L4.7 17a2 2 0 0 0 1.6 3.2h11.4a2 2 0 0 0 1.6-3.2l-4.9-7.4a2 2 0 0 1-.4-1.2V2"/></svg>,
  scan: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M11 8v8M15 8v8"/></svg>,
  hand: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v9"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8"/></svg>,
  glasses: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M3 12h0M21 12h0M11 12h2"/></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M5 13l4 4L19 7"/></svg>,
  clock: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  alert: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h0"/></svg>,
  info: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h0"/></svg>,
  x: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  signOut: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>,
  refresh: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/></svg>,
  sun: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  moon: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
} satisfies Record<string, IconFn>

// Rôles de couleur du design system (AGENTS.md § Design system).
const C = {
  primary: '#2563eb',
  success: '#16a34a',
  violet: '#9333ea',
  cyan: '#0891b2',
  amber: '#d97706',
  danger: '#dc2626',
  muted: '#94a3b8',
}

const CARD = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4'
const INPUT_CLASS = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600'

const TONE = {
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  violet: 'bg-purple-50 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300',
  cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
}

type Tone = keyof typeof TONE
type TabId = 'arrivees' | 'stock' | 'afaire' | 'prete' | 'magasin'

/** Au-delà, la monture traîne au labo : seul repère d'urgence disponible, le backend
 *  ne porte aucune date de livraison promise au client. */
const RETARD_JOURS = 7

// ── Chargement ────────────────────────────────────────────────────────────────

interface LaboData {
  /** Expédiées vers le labo, pas encore scannées : EN_TRANSIT. */
  enRoute: Glass[]
  aMonter: Glass[]
  pretes: Glass[]
  proformas: Proforma[]
}

const EMPTY_DATA: LaboData = { enRoute: [], aMonter: [], pretes: [], proformas: [] }

function useLaboData(stationId: number | null, enabled: boolean) {
  const [data, setData] = useState<LaboData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    if (!enabled) return
    setLoading(true)
    setError('')

    const scope = stationId ? `station_id=${stationId}&` : ''
    // allSettled : une liste indisponible ne doit pas vider les deux autres. Le poste
    // doit rester utilisable même si un seul endpoint tombe.
    const results = await Promise.allSettled([
      apiFetch(`/inventory/glasses?${scope}status=EN_LABORATOIRE`),
      apiFetch(`/inventory/glasses?${scope}status=PRETE_A_LIVRER`),
      apiFetch('/inventory/proformas'),
      // Les montures encore en route. Deux appels sont nécessaires, et aucun ne suffit
      // seul : une monture EN_TRANSIT garde la station d'où elle part — filtrer sur celle
      // du labo n'en ramènerait aucune — et le mouvement d'expédition, lui, sait où elle
      // va mais pas si elle est déjà arrivée. On croise donc les deux.
      apiFetch('/inventory/glasses?status=EN_TRANSIT'),
      stationId
        ? apiFetch(`/inventory/movements?to_station_id=${stationId}&action=EXPEDITION&limit=300`)
        : Promise.resolve({}),
    ])

    const [monterR, pretesR, proformasR, transitR, expeditionsR] = results
    const glasses = (r: PromiseSettledResult<any>): Glass[] => {
      const list: Glass[] = r.status === 'fulfilled' ? (r.value?.data?.glasses || []) : []
      if (!stationId) return list
      return list.filter(g => g.station_id == null || Number(g.station_id) === stationId)
    }

    // Sans le filtre par station : une monture en transit porte encore celle de son
    // expéditeur, `glasses()` la jetterait.
    const enTransit: Glass[] = transitR.status === 'fulfilled' ? (transitR.value?.data?.glasses || []) : []
    const versLabo = new Set<string>(
      (expeditionsR.status === 'fulfilled' ? (expeditionsR.value?.data?.movements || []) : [])
        .map((movement: any) => String(movement?.barcode || ''))
        .filter(Boolean),
    )
    const enRoute = enTransit.filter(glass => versLabo.has(glass.barcode))

    const listees: Proforma[] = proformasR.status === 'fulfilled' ? (proformasR.value?.data?.proformas || []) : []

    // /inventory/proformas ne renvoie pas les lignes : presentoir.js:1831 va les chercher
    // une par une. Sans ce second tour, aucune monture ne peut être rattachée à son client
    // — or le labo travaille sur une ordonnance, pas sur un code-barres anonyme.
    const details = await Promise.allSettled(
      listees.map(proforma => apiFetch(`/inventory/proformas/${proforma.id}`)),
    )
    const proformas = listees.map((proforma, index) => {
      const detail = details[index]
      const complete = detail.status === 'fulfilled' ? detail.value?.data?.proforma : null
      return complete ? { ...proforma, ...complete } : proforma
    })

    setData({ enRoute, aMonter: glasses(monterR), pretes: glasses(pretesR), proformas })

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed === results.length) setError("Aucune donnée n'a pu être chargée.")
    else if (failed > 0) setError(`${failed} liste${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}.`)
    setLoading(false)
  }

  useEffect(() => { void load() }, [stationId, enabled])

  return { data, loading, error, reload: load }
}

/** Rattache chaque monture à la proforma qui la porte : c'est la seule façon de
 *  connaître le client, le backend ne le stocke pas sur la monture. */
function buildClientIndex(proformas: Proforma[]) {
  const index = new Map<string, Proforma>()
  for (const proforma of proformas) {
    for (const item of proforma.items || []) {
      for (const code of [item.barcode, item.reference]) {
        const key = String(code || '').trim().toUpperCase()
        if (key) index.set(key, proforma)
      }
    }
  }
  return index
}

// ── Briques d'interface ───────────────────────────────────────────────────────

function Pastille({ color, children }: { color: string; children: ReactNode }) {
  // Fond = la couleur à 9 % (`18` en hexa), comme les pastilles de la Direction.
  return (
    <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${color}18`, color }}>
      {children}
    </span>
  )
}

function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${TONE[tone]}`}>
      {children}
    </span>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3 mt-6 first:mt-0">{children}</h2>
}

function Note({ children, tone = 'blue' }: { children: ReactNode; tone?: Tone }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl p-3 text-xs leading-relaxed ${TONE[tone]}`}>
      <span className="flex-shrink-0 mt-px">{ic.info('w-4 h-4')}</span>
      <p>{children}</p>
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-10 text-center text-sm text-slate-400">{children}</p>
}

function StatTile({ label, value, color, note }: { label: string; value: number; color: string; note: string }) {
  return (
    <div className={CARD}>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-black tabular-nums" style={{ color }}>{value}</p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
    </div>
  )
}

/** Une monture dans une liste. Sélectionnable quand le poste peut agir dessus. */
function GlassRow({ glass, client, badge, selected, onToggle }: {
  glass: Glass
  client: string
  badge?: ReactNode
  selected?: boolean
  onToggle?: () => void
}) {
  const jours = daysSince(glass.updated_at || glass.created_at)
  const content = (
    <>
      {onToggle && (
        <span className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
          {selected && ic.check('w-3 h-3')}
        </span>
      )}
      <Pastille color={selected ? C.primary : C.cyan}>{ic.glasses()}</Pastille>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
        <p className="text-xs text-slate-400 truncate">{client}</p>
        <p className="text-xs text-slate-400 truncate">{glassModelOrBarcode(glass)}</p>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {badge}
        <p className="text-xs text-slate-400 tabular-nums">{jours} j</p>
      </div>
    </>
  )

  if (!onToggle) {
    return <div className="flex items-center gap-3 px-4 py-3">{content}</div>
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${selected ? 'bg-blue-50/60 dark:bg-blue-500/5' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}
    >
      {content}
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function LaboPage() {
  const [dark, setDark] = useState(false)
  const [tab, setTab] = useState<TabId>('arrivees')
  const [user, setUser] = useState<any>(null)
  const [ready, setReady] = useState(false)

  const [selection, setSelection] = useState<string[]>([])
  const [scanInput, setScanInput] = useState('')
  const [scanError, setScanError] = useState('')
  // Le scan d'une arrivée fait un aller-retour serveur : sans ce drapeau, l'opérateur
  // rescanne pendant que la réception est en cours.
  const [scanBusy, setScanBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')

  // Les deux étapes doivent avoir été franchies : un jeton valide de rôle LABORATOIRE,
  // et le passage par /magasin.html (qui pose `poste`). Sans le second, on y renvoie —
  // sinon la double vérification se contournerait en tapant l'URL.
  useEffect(() => {
    const token = getToken()
    if (!token) {
      window.location.replace('/magasin.html')
      return
    }
    if (window.localStorage.getItem('poste') !== 'labo') {
      window.location.replace('/magasin.html')
      return
    }

    void (async () => {
      try {
        const payload = await apiFetch('/auth/me')
        const me = payload?.data?.user
        if (!me) throw new Error('session invalide')
        if (getRoleName(me) !== 'LABORATOIRE') {
          window.location.replace('/magasin.html')
          return
        }
        window.localStorage.setItem('user', JSON.stringify(me))
        setUser(me)
        setReady(true)
      } catch {
        logoutToLogin()
      }
    })()
  }, [])

  const stationId = user?.station_id ? Number(user.station_id) : null
  const { data, loading, error, reload } = useLaboData(stationId, ready)

  const clientIndex = useMemo(() => buildClientIndex(data.proformas), [data.proformas])
  const clientOf = (glass: Glass) => {
    const proforma = clientIndex.get(String(glass.barcode || '').toUpperCase())
      || clientIndex.get(String(glass.reference || '').toUpperCase())
    return proforma?.client_name || 'Client non rattaché'
  }

  // Le plus ancien en premier : c'est l'ordre dans lequel le labo doit monter.
  const aMonter = useMemo(
    () => [...data.aMonter].sort((a, b) => daysSince(b.updated_at || b.created_at) - daysSince(a.updated_at || a.created_at)),
    [data.aMonter],
  )
  const enRetard = aMonter.filter(g => daysSince(g.updated_at || g.created_at) >= RETARD_JOURS)

  const aFaire = useMemo(
    () => [...data.aMonter].sort((a, b) => (daysSince(a.updated_at || a.created_at) - daysSince(b.updated_at || b.created_at))),
    [data.aMonter],
  )

  const TABS: { id: TabId; label: string; short: string; icon: IconFn; count?: number }[] = [
    // Le compteur inclut les montures en route : ce sont elles qui appellent un geste,
    // les afficher sans les compter reviendrait à les cacher dans la navigation.
    { id: 'arrivees', label: 'Arrivées', short: 'Arrivées', icon: ic.flask, count: aMonter.length + data.enRoute.length },
    { id: 'stock', label: 'Stock Labo', short: 'Stock', icon: ic.scan, count: aMonter.length },
    { id: 'afaire', label: 'À faire', short: 'À faire', icon: ic.clock, count: aMonter.length },
    { id: 'prete', label: 'Montures prêtes', short: 'Prêtes', icon: ic.hand, count: data.pretes.length },
    { id: 'magasin', label: 'Magasin', short: 'Magasin', icon: ic.glasses, count: data.pretes.length },
  ]

  function toggle(barcode: string) {
    setSelection(list => (list.includes(barcode) ? list.filter(b => b !== barcode) : [...list, barcode]))
  }

  /** Ajoute à la sélection la monture dont le code vient d'être scanné.
   *
   *  Le scan interroge le serveur quand le code est inconnu des listes chargées : une
   *  monture encaissée ne débarque pas d'elle-même ici, la Caisse l'expédie EN_TRANSIT
   *  (sales_and_reserves_service.go CreateSale) et c'est la recherche du code-barres
   *  avec `station_id` qui vaut réception et la fait passer EN_LABORATOIRE
   *  (display_service.go PlaceOnDisplay). Se contenter des listes déjà chargées
   *  laisserait ces montures en transit pour toujours. */
  async function scan(value: string) {
    const code = value.trim().toUpperCase()
    if (!code) return
    const matches = (g: Glass) => g.barcode.toUpperCase() === code || glassRef(g).toUpperCase() === code

    setScanInput('')

    // Déjà au labo : rien à demander au serveur.
    const found = data.aMonter.find(matches)
    if (found) {
      setScanError('')
      if (!selection.includes(found.barcode)) setSelection([...selection, found.barcode])
      return
    }
    // Distinguer les deux échecs : « déjà livrée » et « inconnue au labo » n'appellent
    // pas la même réaction de l'opérateur.
    if (data.pretes.some(matches)) {
      setScanError(`${code} est déjà marquée prête.`)
      return
    }
    if (!stationId) {
      setScanError("Aucune station rattachée à ce compte : impossible de réceptionner ici.")
      return
    }

    setScanBusy(true)
    setScanError('')
    try {
      const payload = await apiFetch(`/inventory/glasses/${encodeURIComponent(code)}?station_id=${stationId}`)
      const glass: Glass | undefined = payload?.data?.glass
      const status = String(glass?.status || '')
      if (status !== 'EN_LABORATOIRE') {
        // Le serveur explique lui-même pourquoi un scan reste sans effet (« en transit
        // vers un autre poste ») : sa note vaut mieux que notre déduction.
        const note = String(payload?.data?.placement_note || '')
        setScanError(note || `${code} est au statut « ${status || 'inconnu'} » : elle n'est pas arrivée au laboratoire.`)
        return
      }

      const barcode = glass?.barcode || code
      await reload()
      setSelection(list => (list.includes(barcode) ? list : [...list, barcode]))
      setFlash(`${barcode} réceptionnée au laboratoire.`)
    } catch (error: any) {
      setScanError(error?.message || `${code} n'est pas au laboratoire.`)
    } finally {
      setScanBusy(false)
    }
  }

  /** La seule écriture du poste : POST /inventory/deliveries pose PRETE_A_LIVRER.
   *  Même corps que confirmDeliverGlasses() de ../Frontend/presentoir.js:1447. */
  async function marquerPretes() {
    if (selection.length === 0 || !stationId) return
    setBusy(true)
    setScanError('')
    try {
      await apiFetch('/inventory/deliveries', {
        method: 'POST',
        body: JSON.stringify({ station_id: stationId, barcodes: selection }),
      })
      const n = selection.length
      setSelection([])
      setFlash(`${n} monture${n > 1 ? 's' : ''} marquée${n > 1 ? 's' : ''} prête${n > 1 ? 's' : ''}.`)
      await reload()
      setTab('prete')
    } catch (e: any) {
      setScanError(e?.message || "Échec de l'enregistrement.")
    } finally {
      setBusy(false)
    }
  }

  const nomAffiche = fullName(user) || 'Laboratoire'

  if (!ready) return null

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="hidden md:flex flex-col w-56 lg:w-60 bg-slate-900 dark:bg-slate-950 h-screen sticky top-0 flex-shrink-0">
          {/* Le fond blanc est nécessaire : le JPEG du logo n'a pas de transparence. */}
          <div className="px-4 py-5 border-b border-slate-800 flex-shrink-0">
            <div className="flex flex-col items-center gap-2.5 text-center">
              <div className="w-full max-w-[180px] rounded-xl bg-white px-3 py-2">
                <img src={logoUrl} alt="La Lunetterie" className="w-full h-auto object-contain" />
              </div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Laboratoire</p>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {TABS.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition-all ${tab === item.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              >
                <span className="flex-shrink-0">{item.icon('w-4 h-4')}</span>
                <span className="truncate font-medium flex-1">{item.label}</span>
                {item.count != null && item.count > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${tab === item.id ? 'bg-white/20' : 'bg-slate-800 text-slate-300'}`}>
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="px-4 py-3 border-t border-slate-800 space-y-3 flex-shrink-0">
            <button onClick={() => setDark(d => !d)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
              {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
              <span className="text-xs">{dark ? 'Thème clair' : 'Thème sombre'}</span>
            </button>
            <button onClick={logoutToLogin} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
              {ic.signOut('w-4 h-4')}
              <span className="text-xs">Déconnexion</span>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              {/* Cyan : la couleur du poste Labo dans magasin.tsx. */}
              <div className="w-7 h-7 rounded-xl flex items-center justify-center text-white text-xs font-black flex-shrink-0" style={{ background: C.cyan }}>
                {(nomAffiche[0] || 'L').toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-white font-semibold truncate">{nomAffiche}</p>
                <p className="text-xs text-slate-500 truncate">{user?.station_name || 'Laboratoire'}</p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">

          {/* ── TopBar ────────────────────────────────────────────────────── */}
          <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-14 flex items-center gap-3 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">
                {TABS.find(t => t.id === tab)?.label}
              </h1>
              <p className="text-xs text-slate-400 truncate first-letter:uppercase">
                {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <button
              onClick={() => void reload()}
              disabled={loading}
              className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors disabled:opacity-40"
              aria-label="Recharger"
            >
              <span className={loading ? 'block animate-spin' : 'block'}>{ic.refresh('w-4 h-4')}</span>
            </button>
            <button onClick={() => setDark(d => !d)} className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors">
              {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
            </button>
            {/* Déconnexion vit dans la barre latérale ; sur mobile elle n'existe pas, elle
                remonte donc ici. */}
            <button onClick={logoutToLogin} className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors" aria-label="Se déconnecter">
              {ic.signOut('w-4 h-4')}
            </button>
          </header>

          <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 overflow-auto">
            {error && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-400">
                {error}
              </div>
            )}
            {!stationId && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-400">
                Aucune station rattachée à ce compte : impossible d'enregistrer une livraison.
              </div>
            )}
            {flash && (
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-2.5 text-xs text-green-800 dark:text-green-400">
                <span>{flash}</span>
                <button onClick={() => setFlash('')} aria-label="Fermer">{ic.x('w-4 h-4')}</button>
              </div>
            )}

            {/* ── ARRIVÉES ───────────────────────────────────────────────────── */}
            {/* Une seule table, deux états. Les montures en route y figurent grisées avant
                même d'être scannées : c'est la page des arrivées, elle doit annoncer ce qui
                arrive, pas seulement constater ce qui est arrivé. Sans elles, l'opérateur
                voyait un écran vide et n'avait aucune raison de sortir sa douchette — la
                monture pouvait rester EN_TRANSIT indéfiniment. */}
            {tab === 'arrivees' && (
              <div className={`${CARD} overflow-x-auto`}>
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Arrivées au laboratoire</p>
                  {data.enRoute.length > 0 && (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${TONE.amber}`}>
                      {data.enRoute.length} en route · à scanner
                    </span>
                  )}
                </div>
                {loading && aMonter.length === 0 && data.enRoute.length === 0 ? (
                  <Empty>Chargement…</Empty>
                ) : (
                  <GlassTable
                    emptyLabel="Aucune monture arrivée ni attendue."
                    // Le labo travaille sur une commande client, pas sur une référence : son
                    // nom passe juste après la réf, devant tout le reste.
                    title="arrivees-labo"
                    before={[{ header: 'Client' }, { header: 'Code-barres', mono: true }]}
                    rows={[
                      // En route d'abord : c'est la seule partie qui appelle un geste.
                      ...data.enRoute.map(glass => ({
                        key: `transit-${glass.barcode}`,
                        photo: glass.photo_monture_url,
                        branchPhoto: glass.photo_branche_url,
                        reference: glassRef(glass),
                        brand: glass.brand,
                        gender: glass.gender,
                        shape: glass.shape,
                        location: glass.location_code,
                        entry: glass.created_at,
                        muted: true,
                        before: [clientOf(glass), glass.barcode],
                        status: { label: 'en route', tone: 'amber' as const },
                      })),
                      ...aMonter.map(glass => ({
                        key: glass.barcode,
                        photo: glass.photo_monture_url,
                        branchPhoto: glass.photo_branche_url,
                        reference: glassRef(glass),
                        brand: glass.brand,
                        gender: glass.gender,
                        shape: glass.shape,
                        location: glass.location_code,
                        entry: glass.created_at,
                        before: [clientOf(glass), glass.barcode],
                        status: { label: 'reçue', tone: 'green' as const },
                      })),
                    ]}
                  />
                )}
              </div>
            )}

            {/* ── À FAIRE ─────────────────────────────────────────────────────── */}
            {tab === 'afaire' && (
              <div className={`${CARD} overflow-x-auto`}>
                <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">À fabriquer</p>
                </div>
                {loading && aMonter.length === 0 ? (
                  <Empty>Chargement…</Empty>
                ) : aMonter.length === 0 ? (
                  <Empty>Aucune monture à fabriquer.</Empty>
                ) : (
                  <table className="w-full text-sm min-w-[560px]">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-slate-700">
                        <th className="text-left py-2 pr-3 text-xs font-semibold text-slate-400">#</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Client</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Modèle</th>
                        <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Code</th>
                        <th className="text-right py-2 pl-3 text-xs font-semibold text-slate-400">À livrer</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aMonter.map((glass, index) => (
                        <tr key={glass.barcode} className="border-b border-slate-50 dark:border-slate-700/60 last:border-0">
                          <td className="py-3 pr-3 font-medium text-slate-900 dark:text-white">{index + 1}</td>
                          <td className="py-3 px-3 text-slate-400 truncate max-w-[160px]">{clientOf(glass)}</td>
                          <td className="py-3 px-3 text-slate-400">{glassModelOrBarcode(glass)}</td>
                          <td className="py-3 px-3 font-mono text-xs text-slate-500 dark:text-slate-300">{glass.barcode}</td>
                          <td className="py-3 pl-3 text-right text-xs text-slate-400">{fmtDate(glass.updated_at || glass.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {/* ── STOCK LABO ──────────────────────────────────────────────── */}
            {tab === 'stock' && (
              <div className="space-y-3">
                <div className={CARD}>
                  <div className="flex items-center gap-2.5">
                    <Pastille color={C.primary}>{ic.scan()}</Pastille>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">Scanner une monture</p>
                      <p className="text-xs text-slate-400">Une arrivée de la Caisse est réceptionnée au scan ; validez ensuite pour l'envoyer au magasin</p>
                    </div>
                  </div>

                  <form
                    onSubmit={e => { e.preventDefault(); void scan(scanInput) }}
                    className="mt-4 flex gap-2"
                  >
                    <input
                      type="text"
                      value={scanInput}
                      onChange={e => {
                        const value = e.target.value
                        setScanInput(value)
                        // La douchette envoie le code d'un bloc puis un Entrée. On tente aussi
                        // à la frappe : tous les lecteurs n'émettent pas cet Entrée.
                        const code = value.trim().toUpperCase()
                        if (code && data.aMonter.some(g => g.barcode.toUpperCase() === code || glassRef(g).toUpperCase() === code)) {
                          void scan(value)
                        }
                      }}
                      placeholder="Code-barres ou référence…"
                      autoFocus
                      className={INPUT_CLASS}
                    />
                    <button
                      type="submit"
                      disabled={scanBusy}
                      className="flex-shrink-0 rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                    >
                      {scanBusy ? 'Réception…' : 'Ajouter'}
                    </button>
                  </form>

                  {scanError && (
                    <p className="mt-2 rounded-xl bg-red-50 dark:bg-red-500/15 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
                      {scanError}
                    </p>
                  )}
                </div>

                <div className={`${CARD} p-0 overflow-hidden`}>
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      À marquer prêtes <span className="tabular-nums text-slate-400">({selection.length})</span>
                    </p>
                  </div>
                  <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
                    {selection.length === 0 ? (
                      <Empty>Scannez une monture pour commencer.</Empty>
                    ) : (
                      selection.map(barcode => {
                        const glass = data.aMonter.find(g => g.barcode === barcode)
                        if (!glass) return null
                        return (
                          <GlassRow
                            key={barcode}
                            glass={glass}
                            client={clientOf(glass)}
                            selected
                            onToggle={() => toggle(barcode)}
                            badge={<Badge tone="blue">Retirer</Badge>}
                          />
                        )
                      })
                    )}
                  </div>
                </div>

                {selection.length > 0 && (
                  <button
                    onClick={() => void marquerPretes()}
                    disabled={busy || !stationId}
                    className="w-full rounded-xl bg-green-600 hover:bg-green-700 px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50"
                  >
                    {busy ? 'Enregistrement…' : `Marquer ${selection.length} monture${selection.length > 1 ? 's' : ''} prête${selection.length > 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            )}

            {/* ── PRÊTES À LIVRER ──────────────────────────────────────────── */}
            {tab === 'prete' && (
              <div>
                <div className={`${CARD} p-0 overflow-hidden`}>
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      Montage terminé <span className="tabular-nums text-slate-400">({data.pretes.length})</span>
                    </p>
                    <p className="text-xs text-slate-400">Le magasin peut les remettre au client</p>
                  </div>
                  <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
                    {loading && data.pretes.length === 0 ? (
                      <Empty>Chargement…</Empty>
                    ) : data.pretes.length === 0 ? (
                      <Empty>Aucune monture prête.</Empty>
                    ) : (
                      data.pretes.map(glass => (
                        <GlassRow
                          key={glass.barcode}
                          glass={glass}
                          client={clientOf(glass)}
                          badge={<Badge tone="green">{ic.check('w-3.5 h-3.5')}Prête</Badge>}
                        />
                      ))
                    )}
                  </div>
                </div>

                <SectionTitle>Détail</SectionTitle>
                <div className={`${CARD} overflow-x-auto`}>
                  {data.pretes.length === 0 ? (
                    <p className="text-xs text-slate-400">Rien à afficher.</p>
                  ) : (
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                          <th className="text-left py-2 pr-3 text-xs font-semibold text-slate-400">Client</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Modèle</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Code</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Prête depuis</th>
                          <th className="text-right py-2 pl-3 text-xs font-semibold text-slate-400">Prix</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.pretes.map(glass => (
                          <tr key={glass.barcode} className="border-b border-slate-50 dark:border-slate-700/60 last:border-0">
                            <td className="py-3 pr-3 font-medium text-slate-900 dark:text-white truncate max-w-[160px]">{clientOf(glass)}</td>
                            <td className="py-3 px-3 text-slate-400">{glassModelOrBarcode(glass)}</td>
                            <td className="py-3 px-3 font-mono text-xs text-slate-500 dark:text-slate-300">{glass.barcode}</td>
                            <td className="py-3 px-3 tabular-nums text-slate-400">{fmtDate(glass.updated_at || glass.created_at)}</td>
                            <td className="py-3 pl-3 text-right font-bold tabular-nums" style={{ color: C.primary }}>{fmtFCFA(glass.price)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── MAGASIN ────────────────────────────────────────────────────── */}
            {tab === 'magasin' && (
              <div>
                <div className={`${CARD} p-0 overflow-hidden`}>
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">Envoyées au magasin</p>
                  </div>
                  <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
                    {loading && data.pretes.length === 0 ? (
                      <Empty>Chargement…</Empty>
                    ) : data.pretes.length === 0 ? (
                      <Empty>Aucune monture envoyée au magasin.</Empty>
                    ) : (
                      data.pretes.map(glass => (
                        <GlassRow
                          key={glass.barcode}
                          glass={glass}
                          client={clientOf(glass)}
                          badge={<Badge tone="blue">En magasin</Badge>}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* ── Navigation mobile ─────────────────────────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40">
          <div className="flex">
            {TABS.map(item => (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors relative ${tab === item.id ? 'text-blue-600' : 'text-slate-400'}`}
              >
                {item.icon('w-5 h-5')}
                <span className="text-[10px] font-semibold leading-none">{item.short}</span>
                {item.count != null && item.count > 0 && (
                  <span className="absolute top-1 right-1/4 rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white tabular-nums">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LaboPage />
  </React.StrictMode>,
)
