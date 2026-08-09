import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

// ── Session ────────────────────────────────────────────────────────────────────
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
const ROLE_ALIASES: Record<string, string> = { DIRECTION: 'ADMIN', SUPER_DIRECTEUR: 'SUPER_ADMIN' }

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
// l'écran afficher des listes vides en donnant l'illusion d'un stock à zéro.
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
    throw new Error(payload?.error || payload?.message || `Erreur ${response.status}`)
  }
  return payload
}

// ── Format ─────────────────────────────────────────────────────────────────────
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

function fmtDateTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

function dayKey(value?: string) {
  return String(value || '').slice(0, 10)
}

/** Même barème que getGamme() de presentoir.js. */
function getGamme(price: unknown) {
  const value = Number(price)
  if (!price || Number.isNaN(value)) return '—'
  if (value <= 50000) return 'Classique'
  if (value <= 100000) return 'Moyenne gamme'
  return 'Luxe'
}

function fullName(user: any) {
  return `${String(user?.first_name || '').trim()} ${String(user?.last_name || '').trim()}`.trim()
}

function glassRef(glass: Glass) {
  return glass.reference || glass.barcode || '—'
}

/** Compare deux attributs saisis à la main : « Écaille » et « ecaille » désignent la
 *  même couleur. Accents retirés et casse ignorée, comme normalizeSendValue() de
 *  ../Frontend/scan.js — sans quoi la moitié du stock ne se retrouverait jamais. */
function normalizeAttr(value: unknown) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    // Les marques diacritiques que NFD vient de détacher. En échappements plutôt
    // qu'en caractères bruts : ceux-ci se collent au crochet dans un éditeur.
    .replace(/[\u0300-\u036f]/g, '')
}

/** Une monture qu'on peut encore proposer. Vendue, perdue, cassée ou rendue ne
 *  comptent pas ; la réserve non plus, elle est déjà promise à quelqu'un. Le transit
 *  reste dedans : la monture existe et arrive, et chaque ligne affiche son statut. */
const AVAILABLE_STATUSES = new Set([
  'EN_STOCK_GENERAL',
  'EN_STOCK_SOUS_STATION',
  'EN_PRESENTOIR',
  'EN_TRANSIT',
  'EN_CAISSE',
])

function escapeHtml(value: string) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Même procédé que downloadStockExcel() de presentoir.js : un tableau HTML servi
 *  sous le type MIME d'Excel. Excel et LibreOffice l'ouvrent comme un classeur, et
 *  ça évite d'embarquer une bibliothèque de génération de .xlsx. */
function downloadXls(filename: string, headers: string[], rows: string[][]) {
  const head = headers.map(h => `<th>${escapeHtml(h)}</th>`).join('')
  const body = rows.map(row => `<tr>${row.map(cell => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')
  const html = `<html><head><meta charset="UTF-8" /></head><body>`
    + `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
    + `</body></html>`

  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.xls`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Glass {
  barcode: string
  reference?: string
  brand?: string
  shape?: string
  color?: string
  material?: string
  gender?: string
  size?: string
  price?: number | string
  status?: string
  station_id?: number
  station_name?: string
  location_code?: string
  created_at?: string
  updated_at?: string
  sold_at?: string
}

interface ProformaItem {
  id: number
  barcode?: string
  reference?: string
  brand?: string
  shape?: string
  forme?: string
  color?: string
  unit_price?: number | string
  is_pending?: boolean
  // La décision de la Caisse sur cette ligne : VENDUE ou RETOUR_PRESENTOIR. Absente tant
  // que la ligne attend son arbitrage.
  outcome?: string
  settled_at?: string
}

interface Proforma {
  id: number
  code?: string
  client_name?: string
  client_phone?: string
  status?: string
  note?: string
  created_at?: string
  settled_at?: string
  total_amount?: number | string
  items?: ProformaItem[]
}

interface Movement {
  created_at?: string
  action?: string
  barcode?: string
  reference?: string
  from_station_name?: string
  to_station_name?: string
  user_first_name?: string
  user_last_name?: string
}

/** Miroir de `models.Claim` côté serveur. `detail` et `barcode` sont `omitempty` en Go :
 *  ils manquent purement du JSON quand ils sont vides, d'où l'optionnel partout. */
interface Claim {
  id: number
  station_id?: number
  client_name?: string
  barcode?: string
  motif?: string
  detail?: string
  status?: string
  created_at?: string
  updated_at?: string
}

type Screen = 'dashboard' | 'proforma' | 'ventes' | 'scan' | 'reclamation' | 'stats'

// ── Icônes ─────────────────────────────────────────────────────────────────────
const ic = {
  home: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>,
  doc: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h8M8 17h5" /></svg>,
  cart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="9" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L23 7H6" /></svg>,
  scan: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="M7 8v8M11 8v8M15 8v8" /></svg>,
  alert: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  chart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>,
  glasses: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="7" cy="12" r="4" /><circle cx="17" cy="12" r="4" /><path d="M3 12h0M21 12h0M11 12h2" /></svg>,
  bookmark: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>,
  sun: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  x: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>,
  back: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>,
  refresh: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" /></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>,
  search: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  download: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><path d="M12 15V3" /></svg>,
  chevRight: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>,
  users: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>,
  print: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" rx="1" /></svg>,
}

/** Ville imprimée en tête du document : le nom technique de la station
 *  (« Station Pointe-Noire ») n'a pas sa place sur une facture client. */
function stationCity(user: any) {
  const raw = String(user?.station_name || '').replace(/^station\s+/i, '').trim()
  return (raw || 'Pointe-Noire').toUpperCase()
}

const NAV: { id: Screen; label: string; short: string; icon: (c?: string) => React.ReactElement }[] = [
  { id: 'dashboard', label: 'Tableau de bord', short: 'Accueil', icon: ic.home },
  { id: 'proforma', label: 'Faire une proforma', short: 'Proforma', icon: ic.doc },
  { id: 'ventes', label: 'Ventes & proformas', short: 'Ventes', icon: ic.cart },
  { id: 'scan', label: 'Scan monture', short: 'Scan', icon: ic.scan },
  { id: 'reclamation', label: 'Réclamation', short: 'Réclam.', icon: ic.alert },
  { id: 'stats', label: 'Mes stats', short: 'Stats', icon: ic.chart },
]

// ── Briques d'interface ────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{children}</p>
      {action}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
      {children}
    </div>
  )
}

// ── Donut ──────────────────────────────────────────────────────────────────────
interface Slice {
  label: string
  value: number
  /** Classes Tailwind écrites en toutes lettres, variante sombre comprise. Le
   *  scanner de Tailwind v4 lit le source : une classe assemblée à l'exécution
   *  (`stroke-[${couleur}]`) ne serait jamais générée. Les porter ici évite en prime
   *  de faire descendre `dark` depuis VendeusePage jusqu'au graphique. */
  stroke: string
  swatch: string
}

const DONUT_R = 66
const DONUT_C = 2 * Math.PI * DONUT_R
/** 2 px de fond entre deux parts : c'est le vide qui sépare, pas un contour. Un trait
 *  autour de chaque part ajouterait de l'encre qui n'est pas de la donnée. */
const DONUT_GAP = 2

/** Part-à-tout en anneau. Les couleurs sortent de la charte (AGENTS.md) et ont été
 *  vérifiées au daltonisme sur les deux fonds de carte : vert #16a34a et violet
 *  #9333ea se séparent de ΔE 29 en deutéranopie. Le violet 600 ne tenait que 2,7:1
 *  sur `slate-800`, d'où le 500 en sombre.
 *
 *  Les libellés restent courts : celui du centre est posé dans le SVG, où rien ne
 *  peut le faire revenir à la ligne. */
function Donut({ slices, centerLabel }: {
  slices: Slice[]
  centerLabel: string
}) {
  const [active, setActive] = useState<number | null>(null)

  const total = slices.reduce((sum, slice) => sum + slice.value, 0)

  // Zéro donnée garde la forme de l'anneau, en piste neutre : l'écran reste lisible
  // d'un coup d'œil comme un graphique vide, là où une phrase obligerait à lire pour
  // comprendre qu'il n'y a rien. Le centre affiche le 0, qui est l'information.
  let cursor = 0
  const arcs = total === 0 ? [] : slices.map(slice => {
    const length = (slice.value / total) * DONUT_C
    const arc = { slice, length, offset: cursor }
    cursor += length
    return arc
  })

  const shown = active === null ? null : slices[active]

  return (
    <Card className="flex flex-col sm:flex-row items-center gap-5">
      <svg
        viewBox="0 0 168 168"
        className="w-40 h-40 flex-shrink-0"
        role="img"
        aria-label={`${centerLabel} : ${slices.map(s => `${s.label} ${s.value}`).join(', ')}`}
      >
        {/* Piste de fond : elle porte l'anneau vide, et sert de rail aux parts sinon. */}
        <circle
          cx="84"
          cy="84"
          r={DONUT_R}
          fill="none"
          strokeWidth={20}
          className="stroke-slate-100 dark:stroke-slate-700"
        />
        {/* Départ à midi plutôt qu'à 3 h : c'est là que l'œil commence à lire un cadran. */}
        <g transform="rotate(-90 84 84)">
          {arcs.map(({ slice, length, offset }, index) => {
            const drawn = Math.max(length - DONUT_GAP, 0)
            return (
              <circle
                key={slice.label}
                cx="84"
                cy="84"
                r={DONUT_R}
                fill="none"
                strokeWidth={active === index ? 24 : 20}
                strokeDasharray={`${drawn} ${DONUT_C - drawn}`}
                strokeDashoffset={-offset}
                className={`${slice.stroke} transition-all duration-200`}
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
              />
            )
          })}
        </g>
        {/* Encre neutre, pas la couleur de la part : à cette taille un violet sur fond
            blanc se lit mal. L'identité passe par la pastille de la légende. */}
        <text x="84" y="82" textAnchor="middle" className="fill-slate-900 dark:fill-white text-[26px] font-black tabular-nums">
          {fmt(shown ? shown.value : total)}
        </text>
        <text x="84" y="100" textAnchor="middle" className="fill-slate-400 text-[11px]">
          {shown ? shown.label : centerLabel}
        </text>
      </svg>

      {/* La légende est le canal d'identité fiable : la couleur seule ne suffit jamais. */}
      <ul className="w-full sm:w-auto sm:flex-1 space-y-1 min-w-0">
        {slices.map((slice, index) => (
          <li key={slice.label}>
            <button
              type="button"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              className="w-full flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
            >
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${slice.swatch}`} />
              <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{slice.label}</span>
              <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{fmt(slice.value)}</span>
              {/* total à 0 : une division donnerait NaN %, on garde un 0 franc. */}
              <span className="w-10 text-right text-xs tabular-nums text-slate-400">
                {total === 0 ? 0 : Math.round((slice.value / total) * 100)} %
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ── Barre empilée ──────────────────────────────────────────────────────────────
/** Part-à-tout sur une seule ligne, pour une grandeur continue (des francs).
 *
 *  Pas un second anneau : deux parts dans un cercle gaspillent la surface pour une
 *  information que l'œil compare mieux sur une longueur. Et deux anneaux côte à côte
 *  laisseraient croire à deux découpages du même total, alors que l'un compte des
 *  montures et l'autre des francs.
 *
 *  Les parts sont séparées par 2 px de fond, pas par un contour : c'est le vide qui
 *  sépare. Chaque part est étiquetée sous la barre — la couleur seule ne dit rien. */
function StackedBar({ segments, format }: {
  segments: { label: string; value: number; swatch: string }[]
  format: (value: number) => string
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  return (
    <Card>
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700"
        role="img"
        aria-label={segments.map(s => `${s.label} ${format(s.value)}`).join(', ')}
      >
        {total > 0 && segments.map(segment => (
          <div
            key={segment.label}
            className={`h-3 first:rounded-l-full last:rounded-r-full transition-all duration-700 ${segment.swatch}`}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>

      <ul className="mt-3 space-y-1">
        {segments.map(segment => (
          <li key={segment.label} className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${segment.swatch}`} />
            <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">{segment.label}</span>
            <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{format(segment.value)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-slate-400">
              {total === 0 ? 0 : Math.round((segment.value / total) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ── Tableau générique ──────────────────────────────────────────────────────────
interface Column<T> {
  key: string
  label: string
  value: (row: T) => string
  /** Trie sur la valeur chiffrée plutôt qu'alphabétiquement : sans ça 9 passe après 10. */
  numeric?: boolean
  /** Rend la cellule cliquable. Le texte reste celui de value(), donc la recherche,
   *  le tri et l'export ne changent pas. */
  onClick?: (row: T) => void
  /** Affiche la valeur comme une vignette. value() doit rendre l'URL de l'image :
   *  c'est elle qui part dans le fichier Excel, où une vignette n'aurait pas sa
   *  place — l'écran montre la photo, l'export donne son adresse. */
  image?: boolean
}

function DataTable<T>({ columns, rows, filename, empty }: {
  columns: Column<T>[]
  rows: T[]
  filename: string
  empty: string
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)

  // Les lignes sont aplaties une fois en texte : c'est ce même texte qui sert à
  // l'affichage, à la recherche, au tri et à l'export — donc pas de divergence
  // possible entre ce qu'on voit et ce qu'on télécharge.
  // La ligne d'origine voyage avec son texte : les cellules cliquables en ont besoin,
  // et tout le reste (recherche, tri, export) continue de travailler sur le texte seul.
  const cells = useMemo(
    () => rows.map(row => {
      const flat: Record<string, string> = {}
      for (const column of columns) flat[column.key] = column.value(row)
      return { flat, row }
    }),
    [rows, columns],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    let list = needle
      ? cells.filter(entry => Object.values(entry.flat).some(value => value.toLowerCase().includes(needle)))
      : cells

    if (sort) {
      const column = columns.find(c => c.key === sort.key)
      list = [...list].sort((a, b) => {
        if (column?.numeric) {
          const an = Number(String(a.flat[sort.key]).replace(/[^\d.-]/g, '')) || 0
          const bn = Number(String(b.flat[sort.key]).replace(/[^\d.-]/g, '')) || 0
          return (an - bn) * sort.dir
        }
        return String(a.flat[sort.key]).localeCompare(String(b.flat[sort.key]), 'fr') * sort.dir
      })
    }
    return list
  }, [cells, query, sort, columns])

  function toggleSort(key: string) {
    setSort(prev => (prev?.key === key ? { key, dir: prev.dir === 1 ? -1 : 1 } : { key, dir: 1 }))
  }

  function exportXls() {
    // On exporte ce qui est affiché, filtre compris — comme downloadStockExcel(),
    // qui part de getStockFilteredItems() et non de la liste complète.
    downloadXls(filename, columns.map(c => c.label), visible.map(entry => columns.map(c => entry.flat[c.key])))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search('w-4 h-4')}</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filtrer…"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600"
          />
        </div>
        <button
          onClick={exportXls}
          disabled={visible.length === 0}
          className="flex items-center justify-center gap-2 rounded-xl bg-green-600 hover:bg-green-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-50 flex-shrink-0"
        >
          {ic.download('w-4 h-4')}
          <span>Télécharger en Excel</span>
        </button>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        {visible.length} ligne{visible.length > 1 ? 's' : ''}
        {visible.length !== cells.length ? ` sur ${cells.length}` : ''}
      </p>

      {visible.length === 0 ? (
        <EmptyState>{cells.length === 0 ? empty : 'Aucune ligne ne correspond au filtre.'}</EmptyState>
      ) : (
        // overflow-x-auto sur le conteneur : c'est le tableau qui défile, pas la page.
        <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                {columns.map(column => (
                  <th key={column.key} className="text-left font-semibold text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    <button
                      onClick={() => toggleSort(column.key)}
                      className="w-full flex items-center gap-1 px-3 py-2.5 text-xs uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                    >
                      <span>{column.label}</span>
                      {sort?.key === column.key && <span className="text-blue-600">{sort.dir === 1 ? '↑' : '↓'}</span>}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((entry, index) => (
                <tr key={index} className="border-b border-slate-50 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  {columns.map(column => {
                    const text = entry.flat[column.key] || '—'
                    return (
                      <td key={column.key} className={`px-3 py-2.5 whitespace-nowrap ${column.numeric ? 'tabular-nums font-medium text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}`}>
                        {column.image ? (
                          text === '—' ? (
                            <span className="text-slate-300 dark:text-slate-600">—</span>
                          ) : (
                            // alt vide : la référence occupe la colonne voisine, la répéter
                            // ferait lire deux fois la même chose à un lecteur d'écran.
                            <img
                              src={text}
                              alt=""
                              loading="lazy"
                              className="w-10 h-10 rounded-lg object-cover bg-slate-100 dark:bg-slate-700"
                            />
                          )
                        ) : column.onClick && text !== '—' ? (
                          <button
                            onClick={() => column.onClick!(entry.row)}
                            className="font-semibold text-blue-600 dark:text-blue-400 hover:underline underline-offset-2"
                          >
                            {text}
                          </button>
                        ) : text}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function GlassRow({ glass, selected, onToggle }: { glass: Glass; selected?: boolean; onToggle?: () => void }) {
  const interactive = Boolean(onToggle)
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!interactive}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
        selected
          ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800'
          : 'bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700'
      } ${interactive ? 'hover:border-slate-300 dark:hover:border-slate-600' : 'cursor-default'}`}
    >
      {interactive && (
        <span className={`w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300 dark:border-slate-600'}`}>
          {selected && ic.check('w-3 h-3')}
        </span>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
          {[glass.brand, glass.shape, glass.color].filter(Boolean).join(' · ') || glass.barcode}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmtFCFA(glass.price)}</p>
        {glass.location_code && <p className="text-[11px] text-slate-400">{glass.location_code}</p>}
      </div>
    </button>
  )
}

// ── Données du poste ───────────────────────────────────────────────────────────
interface StoreData {
  presentoir: Glass[]
  reserved: Glass[]
  sold: Glass[]
  proformas: Proforma[]
  movements: Movement[]
  claims: Claim[]
}

const EMPTY_DATA: StoreData = { presentoir: [], reserved: [], sold: [], proformas: [], movements: [], claims: [] }

/** Les ventes reconstituées depuis les proformas encaissées.
 *
 *  Une monture encaissée ne reste pas au statut VENDUE : la Caisse l'expédie dans la foulée
 *  au Laboratoire (VENDUE → EN_TRANSIT → EN_LABORATOIRE, sales_and_reserves_service.go
 *  CreateSale). `/inventory/glasses?status=VENDUE` ne la renvoie donc plus, et l'onglet
 *  Ventes affichait « 0 » en face d'une proforma pourtant réglée. La vente, elle, est
 *  gravée sur la ligne de proforma : `outcome = VENDUE`.
 *
 *  Une ligne rendue au client (`RETOUR_PRESENTOIR`) n'est pas une vente. Quand l'outcome
 *  manque — vieille ligne tranchée avant la colonne — une proforma REGLEE à une seule
 *  monture ne peut être qu'une vente : le serveur ne règle que si une monture au moins a
 *  été encaissée, il annule sinon (CloseIfComplete).
 */
function soldFromProformas(proformas: Proforma[], fiches: Map<string, Glass>): Glass[] {
  const ventes: Glass[] = []

  for (const proforma of proformas) {
    const items = proforma.items || []
    const reglee = String(proforma.status || '').toUpperCase() === 'REGLEE'

    for (const item of items) {
      const outcome = String(item.outcome || '').toUpperCase()
      const vendue = outcome === 'VENDUE'
        || (!outcome && reglee && items.length === 1 && item.is_pending === false)
      if (!vendue) continue

      const barcode = item.barcode || ''
      const fiche = barcode ? fiches.get(barcode) : undefined
      ventes.push({
        // La fiche monture porte la photo et les attributs que la ligne de proforma ne
        // recopie pas. Ce que la ligne dit prime : c'est l'état du jour de la vente.
        ...(fiche || {}),
        barcode,
        reference: item.reference || fiche?.reference,
        brand: item.brand || fiche?.brand,
        shape: item.shape || fiche?.shape,
        color: item.color || fiche?.color,
        // ?? et non || : une monture offerte est facturée 0, ce n'est pas un prix manquant.
        price: item.unit_price ?? fiche?.price,
        status: 'VENDUE',
        sold_at: item.settled_at || proforma.settled_at || proforma.created_at,
      })
    }
  }

  return ventes
}

function useStoreData(stationId: number | null) {
  const [data, setData] = useState<StoreData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Les réclamations ont leur propre erreur, à l'écart du bandeau global : le serveur
  // n'expose que la création (`POST /inventory/claims`), la lecture n'a pas encore de
  // route. Comptée avec les autres, son échec afficherait « 1 liste indisponible » en
  // permanence sur tout le poste, pour une table que personne n'a ouverte.
  const [claimsError, setClaimsError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    // allSettled : une liste indisponible ne doit pas vider les cinq autres. Le poste
    // doit rester utilisable même si un seul endpoint tombe.
    const results = await Promise.allSettled([
      stationId ? apiFetch(`/inventory/glasses?station_id=${stationId}&status=EN_PRESENTOIR`) : Promise.resolve({}),
      apiFetch('/inventory/glasses?status=RESERVEE'),
      apiFetch('/inventory/glasses?status=VENDUE'),
      apiFetch('/inventory/proformas'),
      apiFetch('/inventory/movements?limit=300&offset=0'),
    ])

    const [presentoirR, reservedR, soldR, proformasR, movementsR] = results
    const glasses = (r: PromiseSettledResult<any>): Glass[] =>
      r.status === 'fulfilled' ? (r.value?.data?.glasses || []) : []

    const listees: Proforma[] = proformasR.status === 'fulfilled' ? (proformasR.value?.data?.proformas || []) : []

    // /inventory/proformas ne renvoie pas les lignes : presentoir.js:1831 va les chercher
    // une par une sur /inventory/proformas/:id. Sans ce second tour, une proforma
    // s'affiche « 0 monture · 0 FCFA » et la liste exportable sort vide.
    const details = await Promise.allSettled(
      listees.map(proforma => apiFetch(`/inventory/proformas/${proforma.id}`)),
    )
    const proformas = listees.map((proforma, index) => {
      const detail = details[index]
      const complete = detail.status === 'fulfilled' ? detail.value?.data?.proforma : null
      // Un détail indisponible ne doit pas faire disparaître la proforma : on garde
      // alors ce que la liste en disait.
      return complete ? { ...proforma, ...complete } : proforma
    })

    // Les fiches encore en rayon servent de source pour la photo et les attributs des
    // ventes reconstituées : la ligne de proforma ne recopie pas tout.
    const fiches = new Map<string, Glass>()
    for (const glass of [...glasses(presentoirR), ...glasses(reservedR)]) {
      if (glass.barcode) fiches.set(glass.barcode, glass)
    }

    // La liste VENDUE de l'API d'abord : c'est la fiche à jour. Les proformas encaissées
    // complètent, sans jamais doubler une monture déjà comptée.
    const vendues = glasses(soldR)
    const comptees = new Set(vendues.map(glass => glass.barcode))
    const encaissees = soldFromProformas(proformas, fiches).filter(vente => {
      if (!vente.barcode || comptees.has(vente.barcode)) return false
      comptees.add(vente.barcode)
      return true
    })

    // Le serveur peut nommer la liste `claims` ou la rendre à la racine de `data` :
    // on accepte les deux plutôt que d'afficher une table vide sur une clé mal devinée.
    const [claimsR] = await Promise.allSettled([apiFetch('/inventory/claims')])
    const claims: Claim[] = claimsR.status === 'fulfilled'
      ? (claimsR.value?.data?.claims || claimsR.value?.data || [])
      : []
    // Le message du serveur est repris tel quel derrière la phrase : « Erreur 404 » dit
    // au moins que la route manque, là où un « erreur » seul n'oriente personne.
    setClaimsError(
      claimsR.status === 'rejected'
        ? `Le suivi des réclamations n'a pas pu être chargé. ${claimsR.reason?.message || ''}`.trim()
        : '',
    )

    setData({
      presentoir: glasses(presentoirR),
      reserved: glasses(reservedR),
      sold: [...vendues, ...encaissees],
      proformas,
      movements: movementsR.status === 'fulfilled' ? (movementsR.value?.data?.movements || []) : [],
      claims: Array.isArray(claims) ? claims : [],
    })

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed === results.length) setError('Aucune donnée n\'a pu être chargée.')
    else if (failed > 0) setError(`${failed} liste${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}.`)
    setLoading(false)
  }

  useEffect(() => { void load() }, [stationId])

  return { data, loading, error, claimsError, reload: load }
}

// ── Tableau de bord ────────────────────────────────────────────────────────────
type TableId = 'lunettes' | 'proformas' | 'reclamations' | 'mes-clients'

function myMovements(movements: Movement[], user: any) {
  const me = fullName(user).toLowerCase()
  if (!me) return []
  return movements.filter(movement => {
    const operator = `${String(movement.user_first_name || '').trim()} ${String(movement.user_last_name || '').trim()}`.trim().toLowerCase()
    return operator === me
  })
}

interface ClientRow {
  name: string
  phone: string
  proformas: number
  pending: number
  montures: number
  total: number
  lastVisit: string
}

/** Les proformas sont le seul endroit où l'API garde un nom et un téléphone de
 *  client. On les regroupe par client pour en tirer un suivi : combien de devis,
 *  combien en attente, quel montant, à quand remonte la dernière visite. */
function buildClients(proformas: Proforma[]): ClientRow[] {
  const byClient = new Map<string, ClientRow>()

  for (const proforma of proformas) {
    const name = (proforma.client_name || '').trim() || 'Client non renseigné'
    const key = name.toLowerCase()
    const items = proforma.items || []
    const total = items.reduce((sum, item) => sum + (Number(item.unit_price) || 0), 0)
    const isPending = String(proforma.status || '').toUpperCase() === 'EN_ATTENTE'
    const date = proforma.created_at || ''
    const phone = (proforma.client_phone || '').trim()

    const row = byClient.get(key)
    if (row) {
      row.proformas += 1
      row.pending += isPending ? 1 : 0
      row.montures += items.length
      row.total += total
      // Un client peut avoir laissé son numéro sur un seul de ses devis.
      if (!row.phone && phone) row.phone = phone
      if (date > row.lastVisit) row.lastVisit = date
    } else {
      byClient.set(key, {
        name, phone,
        proformas: 1,
        pending: isPending ? 1 : 0,
        montures: items.length,
        total,
        lastVisit: date,
      })
    }
  }

  return Array.from(byClient.values()).sort((a, b) => b.lastVisit.localeCompare(a.lastVisit))
}

/** Tuile cliquable du tableau de bord : un ou deux chiffres, puis le tableau détaillé. */
function DashTile({ label, color, icon, primary, primaryLabel, secondary, secondaryLabel, note, onClick }: {
  label: string
  color: string
  icon: (c?: string) => React.ReactElement
  primary: React.ReactNode
  primaryLabel?: string
  secondary?: React.ReactNode
  secondaryLabel?: string
  note?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 text-left hover:border-slate-300 dark:hover:border-slate-600 transition-all active:scale-95"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}18`, color }}>
          {icon('w-5 h-5')}
        </div>
        <span className="text-slate-300 dark:text-slate-600 group-hover:text-slate-500 transition-colors">{ic.chevRight()}</span>
      </div>

      <p className="mt-3 text-xs text-slate-500 dark:text-slate-400 font-medium">{label}</p>

      <div className="mt-1 flex items-baseline gap-3">
        <div>
          <p className="text-3xl font-black tabular-nums leading-tight" style={{ color }}>{primary}</p>
          {primaryLabel && <p className="text-[11px] text-slate-400 dark:text-slate-500">{primaryLabel}</p>}
        </div>
        {secondary !== undefined && (
          <>
            <span className="text-2xl font-light text-slate-200 dark:text-slate-600">/</span>
            <div>
              <p className="text-3xl font-black tabular-nums leading-tight text-slate-400 dark:text-slate-500">{secondary}</p>
              {secondaryLabel && <p className="text-[11px] text-slate-400 dark:text-slate-500">{secondaryLabel}</p>}
            </div>
          </>
        )}
      </div>

      {note && <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">{note}</p>}
    </button>
  )
}

function DashboardScreen({ data, user, onNavigate, onOpenTable }: {
  data: StoreData
  user: any
  onNavigate: (s: Screen) => void
  onOpenTable: (t: TableId) => void
}) {
  const pendingProformas = data.proformas.filter(p => String(p.status || '').toUpperCase() === 'EN_ATTENTE')
  const soldValue = data.sold.reduce((sum, g) => sum + (Number(g.price) || 0), 0)
  const clients = buildClients(data.proformas)
  const openClaims = data.claims.filter(c => String(c.status || '').toUpperCase() === 'OUVERTE')
  const clientsPending = clients.filter(c => c.pending > 0).length

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <DashTile
          label="Lunettes vendues"
          color="#2563eb"
          icon={ic.glasses}
          primary={fmt(data.sold.length)}
          note={fmtFCFA(soldValue)}
          onClick={() => onOpenTable('lunettes')}
        />
        <DashTile
          label="Proformas"
          color="#d97706"
          icon={ic.doc}
          primary={fmt(data.proformas.length)}
          note={`${pendingProformas.length} en attente`}
          onClick={() => onOpenTable('proformas')}
        />
        <DashTile
          label="Suivi de réclamation"
          color="#dc2626"
          icon={ic.alert}
          primary={fmt(data.claims.length)}
          note={openClaims.length ? `${openClaims.length} ouverte${openClaims.length > 1 ? 's' : ''}` : 'Aucune ouverte'}
          onClick={() => onOpenTable('reclamations')}
        />
        <DashTile
          label="Suivi de mes clients"
          color="#16a34a"
          icon={ic.users}
          primary={fmt(clients.length)}
          note={clientsPending ? `${clientsPending} client${clientsPending > 1 ? 's' : ''} avec un devis en attente` : 'Aucun devis en attente'}
          onClick={() => onOpenTable('mes-clients')}
        />
      </div>

      <div>
        <SectionTitle>Raccourcis</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { screen: 'proforma' as Screen, label: 'Faire une proforma', color: '#2563eb', icon: ic.doc },
            { screen: 'scan' as Screen, label: 'Scanner une monture', color: '#0891b2', icon: ic.scan },
            { screen: 'ventes' as Screen, label: 'Ventes & proformas', color: '#16a34a', icon: ic.cart },
            { screen: 'stats' as Screen, label: 'Mes stats', color: '#9333ea', icon: ic.chart },
          ].map(item => (
            <button
              key={item.screen}
              onClick={() => onNavigate(item.screen)}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 text-left hover:border-slate-300 dark:hover:border-slate-600 transition-all active:scale-95"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3" style={{ backgroundColor: `${item.color}18`, color: item.color }}>
                {item.icon('w-5 h-5')}
              </div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white leading-tight">{item.label}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>Présentoir</SectionTitle>
        {data.presentoir.length === 0 ? (
          <EmptyState>Aucune monture au présentoir.</EmptyState>
        ) : (
          <div className="space-y-2">
            {data.presentoir.slice(0, 6).map(glass => <GlassRow key={glass.barcode} glass={glass} />)}
            {data.presentoir.length > 6 && (
              <button onClick={() => onNavigate('scan')} className="w-full text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 py-2">
                Voir les {data.presentoir.length} montures →
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Écrans tableau ─────────────────────────────────────────────────────────────
const GLASS_COLUMNS: Column<Glass>[] = [
  { key: 'ref', label: 'Référence', value: g => glassRef(g) },
  { key: 'brand', label: 'Marque', value: g => g.brand || '' },
  { key: 'gender', label: 'Genre', value: g => g.gender || '' },
  { key: 'gamme', label: 'Gamme', value: g => getGamme(g.price) },
  { key: 'shape', label: 'Forme', value: g => g.shape || '' },
  { key: 'color', label: 'Couleur', value: g => g.color || '' },
  { key: 'barcode', label: 'Code-barres', value: g => g.barcode || '' },
  { key: 'location', label: 'Emplacement', value: g => g.location_code || '' },
  { key: 'price', label: 'Prix', value: g => fmtFCFA(g.price), numeric: true },
]

const SOLD_COLUMNS: Column<Glass>[] = [
  ...GLASS_COLUMNS.filter(c => c.key !== 'location'),
  { key: 'soldAt', label: 'Vendue le', value: g => fmtDate(g.sold_at || g.updated_at || g.created_at) },
]

/** Le serveur ne connaît que OUVERTE et TRAITEE (`models.Claim`). Un statut inconnu
 *  ressort tel quel, souligné par le remplacement des tirets bas : mieux vaut un mot
 *  brut à l'écran qu'une case vide si la liste s'enrichit côté serveur. */
const CLAIM_STATUS: Record<string, string> = { OUVERTE: 'Ouverte', TRAITEE: 'Traitée' }

const CLAIM_COLUMNS: Column<Claim>[] = [
  { key: 'date', label: 'Date', value: c => fmtDate(c.created_at) },
  { key: 'client', label: 'Client', value: c => c.client_name || '' },
  { key: 'ref', label: 'Monture', value: c => c.barcode || '' },
  { key: 'motif', label: 'Motif', value: c => c.motif || '' },
  // Le détail est saisi en texte libre : il compte dans l'export, et la recherche du
  // tableau porte dessus.
  { key: 'detail', label: 'Détail', value: c => c.detail || '' },
  {
    key: 'status',
    label: 'Statut',
    value: c => {
      const raw = String(c.status || '').toUpperCase()
      return CLAIM_STATUS[raw] || raw.replace(/_/g, ' ')
    },
  },
]

// ── Lignes de proforma ─────────────────────────────────────────────────────────
/** Une ligne par monture, pas par proforma : la colonne « Réf lunette » doit pouvoir
 *  ouvrir une monture précise, ce qui n'aurait pas de sens sur un devis qui en
 *  contient trois. Le code de la proforma se répète alors sur ses lignes. */
interface ProformaLine {
  proforma: Proforma
  code: string
  client: string
  ref: string
  barcode: string
  amount: number
  status: string
}

/** Le sort d'une ligne de proforma, en un mot.
 *
 *  `outcome` tranche dès que la Caisse est passée. Le rattachement aux ventes reste utile
 *  en second : une monture encaissée ne garde pas le statut VENDUE (elle part au
 *  Laboratoire), et soldFromProformas la remet dans la liste des ventes. */
function ligneStatut(item: ProformaItem, soldBarcodes: Set<string>) {
  const outcome = String(item.outcome || '').toUpperCase()
  if (outcome === 'RETOUR_PRESENTOIR') return 'Rendu'
  if (outcome === 'VENDUE' || (item.barcode ? soldBarcodes.has(item.barcode) : false)) return 'Vendu'
  return item.is_pending === false ? 'Soldé' : 'En attente'
}

function buildProformaLines(proformas: Proforma[], sold: Glass[]): ProformaLine[] {
  const soldBarcodes = new Set(sold.map(glass => glass.barcode))
  const lines: ProformaLine[] = []

  for (const proforma of proformas) {
    const code = proforma.code || `#${proforma.id}`
    const client = proforma.client_name || 'Client non renseigné'
    const items = proforma.items || []

    if (items.length === 0) {
      lines.push({ proforma, code, client, ref: '', barcode: '', amount: proformaTotal(proforma), status: 'En attente' })
      continue
    }

    for (const item of items) {
      const barcode = item.barcode || ''
      lines.push({
        proforma, code, client,
        ref: item.reference || barcode,
        barcode,
        amount: Number(item.unit_price) || 0,
        status: ligneStatut(item, soldBarcodes),
      })
    }
  }
  return lines
}

// ── Liste Ventes & proformas ───────────────────────────────────────────────────
/** Une ligne par monture, tous devis et toutes ventes confondus. C'est la vue que
 *  l'on exporte : elle rassemble ce que l'API éparpille sur trois endpoints. */
interface VenteLigne {
  photo: string
  ref: string
  emplacement: string
  proforma: string
  client: string
  montant: number
  statut: string
  faitPar: string
}

function buildVenteLignes(data: StoreData): VenteLigne[] {
  // Une ligne de proforma ne porte ni photo ni emplacement : ces deux-là ne vivent que
  // sur la fiche de la monture, qu'il faut donc retrouver par code-barres.
  const byBarcode = new Map<string, Glass>()
  for (const glass of [...data.presentoir, ...data.reserved, ...data.sold]) {
    if (glass.barcode) byBarcode.set(glass.barcode, glass)
  }

  // ⚠️ « Fait par » est une approximation. Une proforma n'a pas de created_by : le seul
  // nom que l'API rattache à une monture est celui qui a enregistré son dernier
  // mouvement. Les mouvements arrivent du plus récent au plus ancien et sont plafonnés
  // à 300, donc la colonne reste vide dès qu'on remonte plus loin que ça.
  const operateur = new Map<string, string>()
  for (const movement of data.movements) {
    const barcode = movement.barcode
    if (!barcode || operateur.has(barcode)) continue
    const nom = `${String(movement.user_first_name || '').trim()} ${String(movement.user_last_name || '').trim()}`.trim()
    if (nom) operateur.set(barcode, nom)
  }

  const soldBarcodes = new Set(data.sold.map(glass => glass.barcode))
  const vues = new Set<string>()
  const lignes: VenteLigne[] = []

  for (const proforma of data.proformas) {
    const code = proforma.code || `#${proforma.id}`
    const client = proforma.client_name || 'Client non renseigné'
    const items = proforma.items || []

    // Même parti pris que buildProformaLines() : une proforma dont les lignes n'ont pas
    // pu être chargées reste visible, avec son montant déclaré. La faire disparaître
    // laisserait croire qu'elle n'existe pas.
    if (items.length === 0) {
      lignes.push({
        photo: '',
        ref: '',
        emplacement: '',
        proforma: code,
        client,
        montant: proformaTotal(proforma),
        statut: String(proforma.status || '').toUpperCase() === 'EN_ATTENTE' ? 'En attente' : proforma.status || '—',
        faitPar: '',
      })
      continue
    }

    for (const item of items) {
      const barcode = item.barcode || ''
      const glass = byBarcode.get(barcode)
      if (barcode) vues.add(barcode)
      lignes.push({
        photo: monturePhoto(glass) || '',
        ref: item.reference || barcode,
        emplacement: glass?.location_code || '',
        proforma: code,
        client,
        montant: Number(item.unit_price) || 0,
        statut: ligneStatut(item, soldBarcodes),
        faitPar: operateur.get(barcode) || '',
      })
    }
  }

  // Une vente peut n'être rattachée à aucune proforma. Sans ce second passage, le total
  // de la liste ne retomberait pas sur celui de l'onglet Ventes.
  for (const glass of data.sold) {
    if (vues.has(glass.barcode)) continue
    lignes.push({
      photo: monturePhoto(glass) || '',
      ref: glassRef(glass),
      emplacement: glass.location_code || '',
      proforma: '',
      client: '',
      montant: Number(glass.price) || 0,
      statut: 'Vendu',
      faitPar: operateur.get(glass.barcode) || '',
    })
  }

  return lignes
}

const VENTE_COLUMNS: Column<VenteLigne>[] = [
  { key: 'photo', label: 'Photo', value: r => r.photo, image: true },
  { key: 'ref', label: 'Référence', value: r => r.ref },
  { key: 'emplacement', label: 'Emplacement', value: r => r.emplacement },
  { key: 'proforma', label: 'Proforma', value: r => r.proforma },
  { key: 'client', label: 'Client', value: r => r.client },
  { key: 'montant', label: 'Montant', value: r => fmtFCFA(r.montant), numeric: true },
  { key: 'statut', label: 'Statut', value: r => r.statut },
  { key: 'faitPar', label: 'Fait par', value: r => r.faitPar },
]

const CLIENT_COLUMNS: Column<ClientRow>[] = [
  { key: 'name', label: 'Client', value: c => c.name },
  { key: 'phone', label: 'Téléphone', value: c => c.phone },
  { key: 'proformas', label: 'Devis', value: c => String(c.proformas), numeric: true },
  { key: 'pending', label: 'En attente', value: c => String(c.pending), numeric: true },
  { key: 'montures', label: 'Montures', value: c => String(c.montures), numeric: true },
  { key: 'total', label: 'Total', value: c => fmtFCFA(c.total), numeric: true },
  { key: 'lastVisit', label: 'Dernière visite', value: c => fmtDate(c.lastVisit) },
]

// ── Fiches de détail ───────────────────────────────────────────────────────────
// Le nom du champ photo varie selon l'endroit où la monture a été enregistrée : on
// reprend la même cascade que direction.js et admin.js plutôt que d'en inventer une.
function monturePhoto(glass: any): string | null {
  return glass?.photo_monture_url || glass?.image_url || glass?.photo_url || glass?.image
    || glass?.monture_image || glass?.frame_image
    || glass?.monture?.photo_monture_url || glass?.monture?.image_url || glass?.monture?.photo_url
    || null
}

function branchePhoto(glass: any): string | null {
  return glass?.photo_branche_url || glass?.branche_image_url || null
}

function DetailField({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500">{label}</p>
      <p className="text-sm text-slate-700 dark:text-slate-200 break-words">{value || '—'}</p>
    </div>
  )
}

function Photo({ src, label }: { src: string | null; label: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div>
      <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-1.5">{label}</p>
      <div className="w-full max-w-[220px] aspect-[4/3] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 overflow-hidden flex items-center justify-center mx-auto">
        {src && !failed ? (
          <img src={src} alt={label} className="w-full h-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-8 h-8')}</span>
        )}
      </div>
    </div>
  )
}

/** Fiche client : tout ce que le magasin sait d'elle ou de lui, c'est-à-dire ses
 *  proformas — l'API n'a pas de table clients. */
function ClientDetail({ name, data, onOpenProforma, onOpenGlass }: {
  name: string
  data: StoreData
  onOpenProforma: (proforma: Proforma) => void
  onOpenGlass: (barcode: string) => void
}) {
  const key = name.trim().toLowerCase()
  const proformas = data.proformas.filter(p => (p.client_name || 'Client non renseigné').trim().toLowerCase() === key)
  const row = buildClients(proformas)[0]
  const soldBarcodes = new Set(data.sold.map(g => g.barcode))
  const allItems = proformas.flatMap(p => (p.items || []).map(item => ({ item, proforma: p })))
  const boughtCount = allItems.filter(({ item }) => soldBarcodes.has(item.barcode || '')).length

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 flex items-center justify-center flex-shrink-0">
            {ic.users('w-7 h-7')}
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{name}</p>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{row?.phone || 'Téléphone non renseigné'}</p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <DetailField label="Devis" value={fmt(proformas.length)} />
          <DetailField label="Montures retenues" value={fmt(allItems.length)} />
          <DetailField label="Montures achetées" value={fmt(boughtCount)} />
          <DetailField label="Montant cumulé" value={fmtFCFA(row?.total || 0)} />
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <DetailField label="Première visite" value={fmtDate(proformas.map(p => p.created_at || '').sort()[0])} />
          <DetailField label="Dernière visite" value={fmtDate(row?.lastVisit)} />
          <DetailField label="Devis en attente" value={fmt(row?.pending || 0)} />
        </div>
      </Card>

      <div>
        <SectionTitle>Ses proformas</SectionTitle>
        {proformas.length === 0 ? (
          <EmptyState>Aucune proforma pour ce client.</EmptyState>
        ) : (
          <div className="space-y-2">
            {proformas.map(proforma => (
              <Card key={proforma.id}>
                <div className="flex items-start justify-between gap-3">
                  <button onClick={() => onOpenProforma(proforma)} className="text-sm font-bold text-blue-600 dark:text-blue-400 hover:underline underline-offset-2">
                    {proforma.code || `#${proforma.id}`}
                  </button>
                  <span className="text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmtFCFA(proformaTotal(proforma))}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">{fmtDate(proforma.created_at)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(proforma.items || []).map(item => (
                    <button
                      key={item.id}
                      onClick={() => onOpenGlass(item.barcode || '')}
                      disabled={!item.barcode}
                      className="rounded-lg bg-slate-100 dark:bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
                    >
                      {item.reference || item.barcode || '—'}
                    </button>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Fiche monture. La liste chargée ne contient que le présentoir et les ventes : une
 *  monture partie ailleurs (labo, réserve) n'y est pas, d'où la requête par code. */
function GlassDetail({ barcode, data, stationId }: { barcode: string; data: StoreData; stationId: number | null }) {
  const known = [...data.presentoir, ...data.sold, ...data.reserved].find(g => g.barcode === barcode) || null
  const [glass, setGlass] = useState<Glass | null>(known)
  const [loading, setLoading] = useState(!known)
  const [error, setError] = useState('')

  useEffect(() => {
    if (known) return
    setLoading(true)
    void (async () => {
      try {
        const path = stationId
          ? `/inventory/glasses/${encodeURIComponent(barcode)}?station_id=${stationId}`
          : `/inventory/glasses/${encodeURIComponent(barcode)}`
        const payload = await apiFetch(path)
        const found = payload?.data?.glass || payload?.data || null
        if (!found?.barcode) throw new Error('Monture introuvable.')
        setGlass(found)
      } catch (err: any) {
        setError(err?.message || 'Monture introuvable.')
      } finally {
        setLoading(false)
      }
    })()
  }, [barcode, known, stationId])

  if (loading) return <EmptyState>Chargement de la monture…</EmptyState>
  if (error || !glass) return <EmptyState>{error || 'Monture introuvable.'}</EmptyState>

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900 dark:text-white">{glassRef(glass)}</p>
            <p className="text-xs text-slate-400">{glass.barcode}</p>
          </div>
          <p className="text-lg font-black tabular-nums flex-shrink-0" style={{ color: '#2563eb' }}>{fmtFCFA(glass.price)}</p>
        </div>

        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Photo src={monturePhoto(glass)} label="Monture" />
          <Photo src={branchePhoto(glass)} label="Branche" />
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
          <DetailField label="Marque" value={glass.brand} />
          <DetailField label="Forme" value={glass.shape} />
          <DetailField label="Couleur" value={glass.color} />
          <DetailField label="Matière" value={glass.material} />
          <DetailField label="Genre" value={glass.gender} />
          <DetailField label="Taille" value={glass.size} />
          <DetailField label="Gamme" value={getGamme(glass.price)} />
          <DetailField label="Statut" value={String(glass.status || '').replace(/_/g, ' ')} />
          <DetailField label="Emplacement" value={glass.location_code} />
          <DetailField label="Station" value={glass.station_name} />
          <DetailField label="Enregistrée le" value={fmtDate(glass.created_at)} />
          {String(glass.status || '') === 'VENDUE' && (
            <DetailField label="Vendue le" value={fmtDate(glass.sold_at || glass.updated_at)} />
          )}
        </div>
      </Card>
    </div>
  )
}

const TABLE_TITLES: Record<TableId, string> = {
  lunettes: 'Lunettes vendues',
  proformas: 'Proformas',
  reclamations: 'Suivi de réclamation',
  'mes-clients': 'Suivi de mes clients',
}

type Detail =
  | { kind: 'proforma'; proforma: Proforma }
  | { kind: 'client'; name: string }
  | { kind: 'glass'; barcode: string }

function TableScreen({ table, data, user, stationId, claimsError, onBack }: {
  table: TableId
  data: StoreData
  user: any
  stationId: number | null
  claimsError: string
  onBack: () => void
}) {
  const stamp = new Date().toISOString().slice(0, 10)
  const [detail, setDetail] = useState<Detail | null>(null)

  // Revenir au tableau de bord depuis une fiche passerait par deux clics ; le bouton
  // de retour rend d'abord la fiche, puis seulement le tableau.
  function goBack() {
    if (detail) setDetail(null)
    else onBack()
  }

  const proformaLines = useMemo(() => buildProformaLines(data.proformas, data.sold), [data.proformas, data.sold])

  const LINE_COLUMNS: Column<ProformaLine>[] = [
    { key: 'code', label: 'Code', value: line => line.code, onClick: line => setDetail({ kind: 'proforma', proforma: line.proforma }) },
    { key: 'client', label: 'Client', value: line => line.client, onClick: line => setDetail({ kind: 'client', name: line.client }) },
    { key: 'ref', label: 'Réf lunette', value: line => line.ref, onClick: line => line.barcode && setDetail({ kind: 'glass', barcode: line.barcode }) },
    { key: 'amount', label: 'Montant', value: line => fmtFCFA(line.amount), numeric: true },
    { key: 'status', label: 'Statut', value: line => line.status },
  ]

  const backLabel = detail
    ? (detail.kind === 'proforma' ? 'Proformas' : detail.kind === 'client' ? 'Proformas' : 'Proformas')
    : 'Tableau de bord'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={goBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
          {ic.back('w-4 h-4')}
          <span>{backLabel}</span>
        </button>
        {detail?.kind === 'proforma' && (
          <button
            onClick={() => printProforma(detail.proforma)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95"
          >
            {ic.print('w-4 h-4')}
            <span>Imprimer</span>
          </button>
        )}
      </div>

      {detail?.kind === 'proforma' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white overflow-x-auto shadow-sm">
          <ProformaDocument proforma={detail.proforma} city={stationCity(user)} />
        </div>
      )}

      {detail?.kind === 'client' && (
        <ClientDetail
          name={detail.name}
          data={data}
          onOpenProforma={proforma => setDetail({ kind: 'proforma', proforma })}
          onOpenGlass={barcode => setDetail({ kind: 'glass', barcode })}
        />
      )}

      {detail?.kind === 'glass' && <GlassDetail barcode={detail.barcode} data={data} stationId={stationId} />}

      {!detail && (
      <>

      {table === 'lunettes' && (
        <DataTable columns={SOLD_COLUMNS} rows={data.sold} filename={`lunettes-vendues-${stamp}`} empty="Aucune vente enregistrée." />
      )}

      {table === 'proformas' && (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Une ligne par monture. Le <span className="font-semibold text-blue-600 dark:text-blue-400">code</span> ouvre la proforma,
            le <span className="font-semibold text-blue-600 dark:text-blue-400">client</span> sa fiche,
            la <span className="font-semibold text-blue-600 dark:text-blue-400">référence</span> la monture et ses photos.
          </p>
          <DataTable columns={LINE_COLUMNS} rows={proformaLines} filename={`proformas-${stamp}`} empty="Aucune proforma enregistrée." />
        </>
      )}

      {table === 'reclamations' && (
        <>
          {/* Une lecture qui échoue n'est pas « zéro réclamation » : sans ce mot, la table
              vide laisserait croire que le magasin n'en a jamais reçu. */}
          {claimsError && (
            <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
              <span className="text-amber-600 flex-shrink-0">{ic.alert('w-5 h-5')}</span>
              <p className="text-sm text-amber-900 dark:text-amber-300">{claimsError}</p>
            </div>
          )}
          <DataTable
            columns={CLAIM_COLUMNS}
            rows={data.claims}
            filename={`reclamations-${stamp}`}
            empty="Aucune réclamation enregistrée."
          />
        </>
      )}

      {table === 'mes-clients' && (
        <>
          {/* Les proformas ne portent pas le nom de la vendeuse qui les a créées :
              ce sont les clients passés au magasin, pas seulement les siens. */}
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Clients reconstitués depuis les proformas du magasin — c'est le seul endroit où l'API garde un nom
            et un téléphone. Les devis ne mémorisant pas qui les a établis, ce suivi est celui de tout
            <span className="font-semibold text-slate-700 dark:text-slate-200"> {user?.station_name || 'votre magasin'}</span>, pas du seul compte connecté.
          </p>
          <DataTable
            columns={CLIENT_COLUMNS}
            rows={buildClients(data.proformas)}
            filename={`mes-clients-${stamp}`}
            empty="Aucun client enregistré : les clients apparaissent dès la première proforma."
          />
        </>
      )}
      </>
      )}
    </div>
  )
}

// ── Faire une proforma ─────────────────────────────────────────────────────────
const FIELD = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

/** Sélecteur en pastilles : un clic remet à zéro, pour pouvoir désélectionner. */
function ChoiceRow({ options, value, onChange, color }: {
  options: string[]
  value: string
  onChange: (next: string) => void
  color: string
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(option => {
        const active = value === option
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(active ? '' : option)}
            className={`px-3 py-1.5 rounded-xl text-sm font-semibold transition-all ${
              active ? 'text-white shadow-md' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
            style={active ? { backgroundColor: color } : undefined}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}

function EyeRow({ label, eye, onChange }: { label: string; eye: EyeLine; onChange: (next: EyeLine) => void }) {
  const cell = 'w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-300 outline-none focus:border-slate-300'
  return (
    <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr_1.4fr] gap-1.5 items-center">
      <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{label}</span>
      <input value={eye.sphere} onChange={e => onChange({ ...eye, sphere: e.target.value })} placeholder="+1.00" className={cell} />
      <input value={eye.cylindre} onChange={e => onChange({ ...eye, cylindre: e.target.value })} placeholder="-0.50" className={cell} />
      <input value={eye.axe} onChange={e => onChange({ ...eye, axe: e.target.value })} placeholder="60°" className={cell} />
      <input value={eye.addition} onChange={e => onChange({ ...eye, addition: e.target.value })} placeholder="add." className={cell} />
      <input
        type="number"
        min={0}
        value={eye.prix || ''}
        onChange={e => onChange({ ...eye, prix: Number(e.target.value) || 0 })}
        placeholder="FCFA"
        className={`${cell} tabular-nums`}
      />
    </div>
  )
}

interface MontureLine { glass: Glass; offerte: boolean }

function ProformaScreen({ stationId, user, onDone }: {
  stationId: number | null
  user: any
  onDone: () => void
}) {
  const [rx, setRx] = useState<Prescription>(emptyPrescription)
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [montures, setMontures] = useState<MontureLine[]>([])
  const [code, setCode] = useState('')
  const [scanBusy, setScanBusy] = useState(false)
  const [scanMessage, setScanMessage] = useState('')
  const [scanTone, setScanTone] = useState<'error' | 'success' | ''>('')
  const [destination, setDestination] = useState<'caisse' | 'reserve' | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'error' | 'success' | ''>('')
  const [preview, setPreview] = useState(false)
  const [created, setCreated] = useState<Proforma | null>(null)
  const [reuseCode, setReuseCode] = useState('')
  const [reuseBusy, setReuseBusy] = useState(false)
  const [reuseMessage, setReuseMessage] = useState('')
  const [reuseTone, setReuseTone] = useState<'error' | 'success' | ''>('')
  const scanRef = useRef<HTMLInputElement>(null)

  // La douchette écrit là où est le curseur : le champ le reprend après chaque ajout.
  useEffect(() => { scanRef.current?.focus() }, [montures.length])

  const monturesTotal = montures.reduce((sum, line) => sum + (line.offerte ? 0 : Number(line.glass.price) || 0), 0)
  const totals = computeTotals(rx, monturesTotal)

  function patch(next: Partial<Prescription>) {
    setRx(prev => ({ ...prev, ...next }))
    setMessage('')
  }

  async function addMonture() {
    const value = code.trim()
    if (!value) return
    if (montures.some(line => line.glass.barcode === value || line.glass.reference === value)) {
      setScanMessage('Cette monture est déjà sur la proforma.')
      setScanTone('error')
      setCode('')
      return
    }

    setScanBusy(true)
    setScanMessage('Recherche…')
    setScanTone('')
    try {
      const path = stationId
        ? `/inventory/glasses/${encodeURIComponent(value)}?station_id=${stationId}`
        : `/inventory/glasses/${encodeURIComponent(value)}`
      const payload = await apiFetch(path)
      const glass = payload?.data?.glass || payload?.data || null
      if (!glass?.barcode) throw new Error('Aucune monture ne porte ce code.')
      setMontures(prev => [...prev, { glass, offerte: false }])
      setCode('')
      setScanMessage(`${glassRef(glass)} ajoutée — ${fmtFCFA(glass.price)}`)
      setScanTone('success')
      setMessage('')
    } catch (error: any) {
      setScanMessage(error?.message || 'Monture introuvable.')
      setScanTone('error')
    } finally {
      setScanBusy(false)
      scanRef.current?.focus()
    }
  }

  /** Reprend une facture déjà éditée : le client et toute l'ordonnance se remplissent
   *  seuls, c'est la partie longue à retaper (foyer, teinte, sphère, cylindre, axe et
   *  addition des deux yeux, accessoires, montage, remise).
   *
   *  Les montures sont volontairement laissées vides. La vendeuse les a en main, elle
   *  les scanne en quelques secondes — et surtout celles de l'ancienne facture peuvent
   *  être encore engagées : le serveur refuserait l'enregistrement en les nommant, à
   *  la toute fin, après que le formulaire ait été rempli pour rien.
   *
   *  L'API ne sert pas une proforma par son code : on lit la liste et on y cherche.
   *  Un `/inventory/proformas/:code` éviterait ce détour le jour où il existera. */
  async function reuseInvoice() {
    const value = reuseCode.trim()
    if (!value) return

    setReuseBusy(true)
    setReuseMessage('Recherche…')
    setReuseTone('')
    try {
      const payload = await apiFetch('/inventory/proformas')
      const list: Proforma[] = Array.isArray(payload?.data?.proformas) ? payload.data.proformas : []
      const wanted = value.toUpperCase()
      const invoice = list.find(item => String(item.code || '').trim().toUpperCase() === wanted)
        // La douchette lit le code imprimé, mais rien n'empêche de taper le numéro
        // interne : autant le reconnaître plutôt que de répondre « introuvable ».
        || list.find(item => String(item.id) === value)

      if (!invoice) throw new Error(`Aucune facture ne porte le numéro ${value}.`)

      setClientName(invoice.client_name || '')
      setClientPhone(invoice.client_phone || '')
      // parsePrescription est tolérant : une note écrite à la main ressort en note
      // libre plutôt que de vider la grille.
      setRx(parsePrescription(invoice.note))
      setReuseCode('')
      setReuseMessage(`Facture ${invoice.code || value} reprise${invoice.client_name ? ` — ${invoice.client_name}` : ''}. Scannez maintenant les montures.`)
      setReuseTone('success')
      setMessage('')
      scanRef.current?.focus()
    } catch (error: any) {
      setReuseMessage(error?.message || 'Facture introuvable.')
      setReuseTone('error')
    } finally {
      setReuseBusy(false)
    }
  }

  function removeMonture(barcode: string) {
    setMontures(prev => prev.filter(line => line.glass.barcode !== barcode))
    setMessage('')
  }

  function toggleOfferte(barcode: string) {
    setMontures(prev => prev.map(line => (line.glass.barcode === barcode ? { ...line, offerte: !line.offerte } : line)))
  }

  function reset() {
    setRx(emptyPrescription())
    setClientName('')
    setClientPhone('')
    setMontures([])
    setDestination(null)
    setScanMessage('')
    setScanTone('')
    // Sinon « Facture PRO-… reprise » reste affiché au-dessus d'un formulaire vide,
    // et la vendeuse croit que la suivante est déjà pré-remplie.
    setReuseCode('')
    setReuseMessage('')
    setReuseTone('')
  }

  async function submit() {
    if (!clientName.trim()) {
      setMessage('Le nom du client est requis.')
      setTone('error')
      return
    }
    if (!montures.length) {
      setMessage('Ajoutez au moins une monture, en scannant ou en saisissant son code.')
      setTone('error')
      return
    }
    if (!destination) {
      setMessage('Choisissez la destination : réserve ou caisse.')
      setTone('error')
      return
    }

    setBusy(true)
    setMessage('')
    const barcodes = montures.map(line => line.glass.barcode)

    try {
      const payload = await apiFetch('/inventory/proformas', {
        method: 'POST',
        body: JSON.stringify({
          station_id: stationId ? Number(stationId) : undefined,
          client_name: clientName.trim(),
          client_phone: clientPhone.trim(),
          // L'ordonnance en clair reste envoyée : c'est elle que la Caisse réaffiche, et
          // elle garde la saisie d'origine si une valeur ne se convertit pas en nombre.
          note: serializePrescription(rx),
          // `lines` remplace `barcodes` : c'est ce qui transporte « offerte », qui n'était
          // pas transmis du tout et laissait la monture facturée plein tarif en base.
          lines: montures.map(line => ({ barcode: line.glass.barcode, offerte: line.offerte })),
          // Les mêmes valeurs qu'au-dessus, mais en champs : c'est ce qui les rend
          // interrogeables — combien de progressifs, quel chiffre sur les accessoires.
          prescription: {
            societe: rx.societe,
            foyer: rx.foyer,
            teinte: rx.teinte,
            od_sphere: rx.od.sphere,
            od_cylindre: rx.od.cylindre,
            od_axe: rx.od.axe,
            od_addition: rx.od.addition,
            od_prix: Number(rx.od.prix) || 0,
            og_sphere: rx.og.sphere,
            og_cylindre: rx.og.cylindre,
            og_axe: rx.og.axe,
            og_addition: rx.og.addition,
            og_prix: Number(rx.og.prix) || 0,
            accessoires_label: rx.accessoiresLabel,
            accessoires_prix: Number(rx.accessoiresPrix) || 0,
            montage_prix: Number(rx.montage) || 0,
            remise_pct: Number(rx.remise) || 0,
            note_libre: rx.freeNote,
          },
        }),
      })

      const proforma: Proforma = payload?.data?.proforma || payload?.data || {}
      let warning = ''

      // Le serveur crée la proforma même quand les montures n'ont pas pu partir en caisse
      // (seule une monture EN_PRESENTOIR y part — display_service.go SendToCaisse) et le
      // dit dans `warning` / `skipped`. Les taire afficherait « envoyée en caisse » sur des
      // montures restées en rayon, que la Caisse chercherait en vain au comptoir.
      const skipped: { barcode?: string; reason?: string }[] = Array.isArray(payload?.data?.skipped) ? payload.data.skipped : []
      if (payload?.data?.warning) {
        warning = ` ${payload.data.warning}`
      } else if (skipped.length) {
        const detail = skipped
          .map(item => `${item.barcode || '?'} — ${item.reason || 'refusée'}`)
          .join(' · ')
        warning = ` ${skipped.length} monture${skipped.length > 1 ? 's' : ''} non envoyée${skipped.length > 1 ? 's' : ''} en caisse : ${detail}.`
      }

      if (destination === 'reserve') {
        // La proforma a déjà déplacé les montures vers la caisse ; la réserve est un
        // second geste. S'il échoue, la proforma existe quand même — on le dit plutôt
        // que de laisser croire que tout s'est passé comme demandé.
        try {
          await apiFetch('/inventory/reserves', {
            method: 'POST',
            body: JSON.stringify({ station_id: stationId ? Number(stationId) : undefined, barcodes }),
          })
        } catch (error: any) {
          // Ajouté, pas substitué : les deux déplacements peuvent échouer l'un après
          // l'autre, et n'en montrer qu'un cacherait la moitié du problème.
          warning += ` Mise en réserve refusée : ${error?.message || 'erreur serveur'}.`
        }
      }

      setCreated({
        ...proforma,
        code: proforma.code || '',
        client_name: clientName.trim(),
        client_phone: clientPhone.trim(),
        note: serializePrescription(rx),
        created_at: proforma.created_at || new Date().toISOString(),
        items: montures.map((line, index) => ({
          id: index,
          barcode: line.glass.barcode,
          reference: line.glass.reference,
          brand: line.glass.brand,
          shape: line.glass.shape,
          color: line.glass.color,
          unit_price: line.offerte ? 0 : line.glass.price,
          is_pending: true,
        })),
      })
      // Le sort annoncé suit ce qui s'est réellement passé : annoncer « envoyée en caisse »
      // juste avant la liste des montures qui n'y sont pas parties se contredirait.
      const acheminement = warning
        ? 'acheminement incomplet'
        : destination === 'reserve' ? 'mise en réserve' : 'envoyée en caisse'
      setMessage(`Proforma ${proforma.code || ''} créée pour ${clientName.trim()} — ${acheminement}.${warning}`)
      setTone(warning ? 'error' : 'success')
      onDone()
    } catch (error: any) {
      // Le serveur refuse nommément une monture déjà engagée sur une autre proforma :
      // son message vaut mieux qu'un « erreur » générique.
      setMessage(error?.message || 'Impossible de créer la proforma.')
      setTone('error')
    } finally {
      setBusy(false)
    }
  }

  const draftProforma: Proforma = {
    id: 0,
    code: created?.code || '(à créer)',
    client_name: clientName,
    client_phone: clientPhone,
    created_at: new Date().toISOString(),
    items: montures.map((line, index) => ({
      id: index,
      barcode: line.glass.barcode,
      reference: line.glass.reference,
      brand: line.glass.brand,
      shape: line.glass.shape,
      color: line.glass.color,
      unit_price: line.offerte ? 0 : line.glass.price,
    })),
  }

  if (created) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-4 flex items-start gap-3">
          <span className="text-green-600 flex-shrink-0">{ic.check('w-5 h-5')}</span>
          <p className="text-sm font-semibold text-green-900 dark:text-green-300">{message}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => printProforma(created)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95"
          >
            {ic.print('w-4 h-4')}
            <span>Imprimer</span>
          </button>
          <button
            onClick={() => { setCreated(null); reset(); setMessage('') }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          >
            Nouvelle proforma
          </button>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white overflow-x-auto shadow-sm">
          <ProformaDocument proforma={created} city={stationCity(user)} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_22rem] gap-4 items-start">
      <div className="space-y-4">
        {/* En tête de formulaire : la cliente revient avec sa facture, on la scanne
            avant de commencer plutôt que de tout ressaisir puis de s'en apercevoir. */}
        <Card>
          <p className="mb-3 text-sm font-bold text-slate-900 dark:text-white">Reprendre une facture</p>
          <form onSubmit={e => { e.preventDefault(); void reuseInvoice() }} className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={reuseCode}
              onChange={e => { setReuseCode(e.target.value); setReuseMessage('') }}
              placeholder="Scannez le code-barres de la facture ou saisissez son numéro"
              autoComplete="off"
              className={FIELD}
            />
            <button
              type="submit"
              disabled={reuseBusy || !reuseCode.trim()}
              className="flex-shrink-0 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/50"
            >
              {reuseBusy ? 'Recherche…' : 'Reprendre'}
            </button>
          </form>
          <p className={`mt-2 text-xs ${reuseTone === 'error' ? 'text-red-600 dark:text-red-400' : reuseTone === 'success' ? 'text-green-700 dark:text-green-400' : 'text-slate-400'}`}>
            {reuseMessage || "Remplit le client et l'ordonnance. Les montures restent à scanner."}
          </p>
        </Card>

        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-3">Client</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Société">
              <input value={rx.societe} onChange={e => patch({ societe: e.target.value })} placeholder="PARTICULIER" className={FIELD} />
            </Field>
            <Field label="Nom et prénoms *">
              <input value={clientName} onChange={e => { setClientName(e.target.value); setMessage('') }} placeholder="MANCACATH Christiane" className={FIELD} />
            </Field>
            <Field label="Contact">
              <input type="tel" value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="+242 05 533 41 29" className={FIELD} />
            </Field>
          </div>
        </Card>

        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-3">Qualité des verres</p>
          <div className="space-y-3">
            <Field label="Type">
              <ChoiceRow options={FOYERS} value={rx.foyer} onChange={foyer => patch({ foyer })} color="#2563eb" />
            </Field>
            <Field label="Teinte">
              <ChoiceRow options={TEINTES} value={rx.teinte} onChange={teinte => patch({ teinte })} color="#0891b2" />
            </Field>
          </div>
        </Card>

        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">Correction</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">Sphère · Cylindre · Axe · Addition · Prix du verre</p>
          <div className="space-y-2 overflow-x-auto">
            <div className="min-w-[30rem] space-y-2">
              <EyeRow label="OD" eye={rx.od} onChange={od => patch({ od })} />
              <EyeRow label="OG" eye={rx.og} onChange={og => patch({ og })} />
            </div>
          </div>
        </Card>

        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">Montures</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">Scannez l'étiquette ou saisissez le code, puis Entrée.</p>

          <form onSubmit={e => { e.preventDefault(); void addMonture() }} className="flex flex-col sm:flex-row gap-2">
            <input
              ref={scanRef}
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="Code-barres ou référence"
              autoComplete="off"
              className={FIELD}
            />
            <button
              type="submit"
              disabled={scanBusy}
              className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60 flex-shrink-0"
            >
              {ic.scan('w-4 h-4')}
              <span>{scanBusy ? 'Recherche…' : 'Ajouter'}</span>
            </button>
          </form>

          {scanMessage && (
            <p className={`mt-2 text-[11px] ${scanTone === 'error' ? 'text-red-600 dark:text-red-400' : scanTone === 'success' ? 'text-green-700 dark:text-green-400' : 'text-slate-400'}`}>
              {scanMessage}
            </p>
          )}

          <div className="mt-3 space-y-2">
            {montures.length === 0 ? (
              <EmptyState>Aucune monture. Scannez la première.</EmptyState>
            ) : (
              montures.map((line, index) => (
                <div key={line.glass.barcode} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800">
                  <span className="text-xs font-bold text-slate-400 flex-shrink-0">{index + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{glassRef(line.glass)}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {[line.glass.brand, line.glass.shape, line.glass.color].filter(Boolean).join(' · ') || line.glass.barcode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleOfferte(line.glass.barcode)}
                    className={`text-[11px] font-semibold px-2 py-1 rounded-lg flex-shrink-0 transition-colors ${
                      line.offerte
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                    }`}
                  >
                    {line.offerte ? 'OFFERTE' : 'Offrir'}
                  </button>
                  <span className={`text-sm font-bold tabular-nums flex-shrink-0 ${line.offerte ? 'text-slate-300 line-through dark:text-slate-600' : 'text-slate-700 dark:text-slate-200'}`}>
                    {fmtFCFA(line.glass.price)}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeMonture(line.glass.barcode)}
                    className="text-slate-300 hover:text-red-600 transition-colors flex-shrink-0"
                    aria-label="Retirer"
                  >
                    {ic.x('w-4 h-4')}
                  </button>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-3">Accessoires, montage et remise</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Accessoires">
              <input value={rx.accessoiresLabel} onChange={e => patch({ accessoiresLabel: e.target.value })} placeholder="Housse, cordon…" className={FIELD} />
            </Field>
            <Field label="Prix des accessoires">
              <input type="number" min={0} value={rx.accessoiresPrix || ''} onChange={e => patch({ accessoiresPrix: Number(e.target.value) || 0 })} placeholder="0" className={`${FIELD} tabular-nums`} />
            </Field>
            <Field label="Montage">
              <input type="number" min={0} value={rx.montage || ''} onChange={e => patch({ montage: Number(e.target.value) || 0 })} placeholder="0" className={`${FIELD} tabular-nums`} />
            </Field>
            <Field label="Remise (%)">
              <input type="number" min={0} max={100} value={rx.remise || ''} onChange={e => patch({ remise: Number(e.target.value) || 0 })} placeholder="0" className={`${FIELD} tabular-nums`} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Note libre">
              <textarea value={rx.freeNote} onChange={e => patch({ freeNote: e.target.value })} rows={2} placeholder="Retrait prévu vendredi…" className={`${FIELD} resize-none`} />
            </Field>
          </div>
        </Card>
      </div>

      <div className="xl:sticky xl:top-20 space-y-4">
        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-3">Total</p>
          <div className="space-y-1.5 text-sm">
            {[
              ['Verres', totals.verres],
              ['Montures', monturesTotal],
              ['Accessoires', rx.accessoiresPrix],
              ['Montage', rx.montage],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>{label}</span>
                <span className="tabular-nums">{fmtFCFA(value)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1.5 border-t border-slate-100 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-semibold">
              <span>Sous-total</span>
              <span className="tabular-nums">{fmtFCFA(totals.brut)}</span>
            </div>
            {totals.remise > 0 && (
              <div className="flex justify-between text-slate-500 dark:text-slate-400">
                <span>Remise {rx.remise} %</span>
                <span className="tabular-nums">- {fmtFCFA(totals.remise)}</span>
              </div>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700 flex items-baseline justify-between">
            <span className="text-xs text-slate-400 dark:text-slate-500">Total Net</span>
            <span className="text-xl font-black tabular-nums text-slate-900 dark:text-white">{fmtFCFA(totals.net)}</span>
          </div>
        </Card>

        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">Destination</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">Où partent les montures une fois la proforma créée.</p>
          <div className="space-y-2">
            {[
              { id: 'reserve' as const, label: 'Mise en réserve', note: 'Gardées de côté au nom du client', color: '#9333ea', icon: ic.bookmark },
              { id: 'caisse' as const, label: 'Mise à la caisse', note: 'Envoyées au comptoir pour encaissement', color: '#16a34a', icon: ic.cart },
            ].map(option => {
              const active = destination === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => { setDestination(option.id); setMessage('') }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all"
                  style={active
                    ? { borderColor: option.color, backgroundColor: `${option.color}12` }
                    : undefined}
                >
                  <span
                    className={`flex-shrink-0 ${active ? '' : 'text-slate-400'}`}
                    style={active ? { color: option.color } : undefined}
                  >
                    {option.icon('w-5 h-5')}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-slate-900 dark:text-white">{option.label}</span>
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">{option.note}</span>
                  </span>
                  {active && <span style={{ color: option.color }}>{ic.check('w-4 h-4')}</span>}
                </button>
              )
            })}
          </div>

          <button
            onClick={() => void submit()}
            disabled={busy}
            className="mt-3 w-full rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
          >
            {busy ? 'Création…' : 'Valider la proforma'}
          </button>

          {message && (
            <p className={`mt-2 text-[11px] leading-snug ${tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
              {message}
            </p>
          )}

          <button
            onClick={() => setPreview(v => !v)}
            className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
          >
            {preview ? 'Masquer l’aperçu' : 'Aperçu du document'}
          </button>
        </Card>

        {preview && (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white overflow-x-auto shadow-sm xl:hidden">
            <ProformaDocument proforma={draftProforma} city={stationCity(user)} draft={rx} />
          </div>
        )}
      </div>

      {preview && (
        <div className="hidden xl:block xl:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white overflow-x-auto shadow-sm">
          <ProformaDocument proforma={draftProforma} city={stationCity(user)} draft={rx} />
        </div>
      )}
    </div>
  )
}

// ── Document proforma ──────────────────────────────────────────────────────────
// Mentions légales reprises du pied de page imprimé.
const SOCIETE = {
  nom: 'C.M.S.A · LA LUNETTERIE',
  adresse: 'B.P. 4805 — 44 Rue de Limbou, Centre-Ville — À côté de la tour Mayombe',
  tel: '00(242) 06 902 80 96 / 06 902 89 86',
  email: 'contact@lunetterie-cg.com',
  rccm: 'RCCM N° : CG-PNR-01-2022-B12-00069 — NIU : M22000000209390J',
  pays: 'République du Congo',
}

/** Une seule feuille de style pour l'écran et pour l'impression : le papier sorti de
 *  l'imprimante est alors exactement ce qui était affiché. Pas de classes Tailwind
 *  ici — elles n'existeraient pas dans la fenêtre d'impression. */
const PROFORMA_CSS = `
/* Le sélecteur porte aussi sur les descendants : index.css applique Inter via « * »,
   qui touche chaque élément directement et couperait l'héritage depuis .pf — le
   document se serait affiché en Inter à l'écran et en Times à l'impression. */
.pf, .pf * { font-family:"Times New Roman",Times,serif; }
.pf { background:#fff; color:#111; padding:26px 30px; max-width:830px; margin:0 auto; font-size:13px; line-height:1.35; }
.pf-logo { height:44px; width:auto; }
.pf-rule { border:0; border-top:2px solid #111; margin:10px 0 16px; }
.pf-city { text-align:right; font-size:11px; letter-spacing:.04em; text-transform:uppercase; }
.pf-title { text-align:center; font-weight:bold; font-style:italic; font-size:16px; letter-spacing:.02em; margin:2px 0 6px; }
.pf-barcode { display:flex; justify-content:center; margin:0 0 12px; }
.pf-barcode svg { max-width:190px; height:auto; }
.pf-client { margin-bottom:14px; }
.pf-client div { margin-bottom:3px; }
.pf-client b { font-weight:bold; }
.pf-contact { float:right; font-size:12px; }
.pf table { width:100%; border-collapse:collapse; margin-bottom:12px; }
.pf th, .pf td { border:1px solid #111; padding:5px 7px; vertical-align:middle; }
.pf th { font-weight:bold; text-align:center; }
.pf .pf-lead { font-weight:bold; text-align:left; width:22%; }
.pf .pf-num { text-align:right; white-space:nowrap; font-weight:bold; }
.pf .pf-fill { height:26px; }
.pf .pf-tick { text-align:center; font-weight:bold; }
.pf .pf-nb { text-align:center; font-weight:bold; }
.pf-note { font-style:italic; font-weight:bold; margin:16px 0 40px; }
.pf-sign { display:flex; justify-content:space-between; gap:24px; margin-bottom:26px; }
.pf-sign div { flex:1; border-top:1px solid #111; padding-top:4px; font-size:11px; text-align:center; }
.pf-foot { border-top:1px solid #111; padding-top:8px; text-align:center; font-size:10px; line-height:1.5; color:#333; }
.pf-foot b { display:block; font-size:12px; color:#111; letter-spacing:.05em; }
@media print { @page { size:A4; margin:12mm; } body { margin:0; } .pf { max-width:none; padding:0; } }
`

// ── Ordonnance ─────────────────────────────────────────────────────────────────
// Aucun de ces champs n'existe en base. Ils voyagent dans proforma.note, en texte
// lisible : le poste Caisse réaffiche cette note telle quelle (presentoir.js:1871),
// donc ce qu'on y écrit doit se lire comme une ordonnance, pas comme du JSON.
const FOYERS = ['Simple foyer', 'Double foyer', 'Progressif']
const TEINTES = ['Teinte A, B, C', 'Photo / Transit°', 'Blanc']

interface EyeLine { sphere: string; cylindre: string; axe: string; addition: string; prix: number }

interface Prescription {
  societe: string
  foyer: string
  teinte: string
  od: EyeLine
  og: EyeLine
  accessoiresLabel: string
  accessoiresPrix: number
  montage: number
  remise: number
  freeNote: string
}

const EMPTY_EYE: EyeLine = { sphere: '', cylindre: '', axe: '', addition: '', prix: 0 }

function emptyPrescription(): Prescription {
  return {
    societe: 'PARTICULIER', foyer: '', teinte: '',
    od: { ...EMPTY_EYE }, og: { ...EMPTY_EYE },
    accessoiresLabel: '', accessoiresPrix: 0, montage: 0, remise: 0, freeNote: '',
  }
}

function eyeIsEmpty(eye: EyeLine) {
  return !eye.sphere && !eye.cylindre && !eye.axe && !eye.addition && !eye.prix
}

const NOTE_SEPARATOR = '—'

function serializePrescription(p: Prescription): string {
  const lines: string[] = []
  if (p.societe && p.societe !== 'PARTICULIER') lines.push(`Société : ${p.societe}`)
  if (p.foyer || p.teinte) lines.push(`Verres : ${[p.foyer, p.teinte].filter(Boolean).join(' · ')}`)

  for (const [label, eye] of [['OD', p.od], ['OG', p.og]] as const) {
    if (eyeIsEmpty(eye)) continue
    lines.push(`${label} : sph ${eye.sphere || '—'} · cyl ${eye.cylindre || '—'} · axe ${eye.axe || '—'} · add ${eye.addition || '—'} · prix ${eye.prix || 0}`)
  }

  if (p.accessoiresLabel || p.accessoiresPrix) lines.push(`Accessoires : ${p.accessoiresLabel || '—'} · prix ${p.accessoiresPrix || 0}`)
  if (p.montage) lines.push(`Montage : prix ${p.montage}`)
  if (p.remise) lines.push(`Remise : ${p.remise} %`)

  const free = p.freeNote.trim()
  if (free) {
    if (lines.length) lines.push(NOTE_SEPARATOR)
    lines.push(free)
  }
  return lines.join('\n')
}

/** Relit ce que serializePrescription() a écrit. Tolérant : une note saisie à la main
 *  par quelqu'un d'autre ne doit rien casser, elle ressort en note libre. */
function parsePrescription(note?: string): Prescription {
  const result = emptyPrescription()
  if (!note) return result

  const [head, ...tail] = note.split(`\n${NOTE_SEPARATOR}\n`)
  result.freeNote = tail.join(`\n${NOTE_SEPARATOR}\n`)

  let recognized = false
  for (const line of head.split('\n')) {
    const societe = /^Société\s*:\s*(.+)$/.exec(line)
    if (societe) { result.societe = societe[1].trim(); recognized = true; continue }

    const verres = /^Verres\s*:\s*(.+)$/.exec(line)
    if (verres) {
      for (const part of verres[1].split('·').map(s => s.trim())) {
        if (FOYERS.includes(part)) result.foyer = part
        else if (TEINTES.includes(part)) result.teinte = part
      }
      recognized = true
      continue
    }

    const eye = /^(OD|OG)\s*:\s*sph\s*(.*?)\s*·\s*cyl\s*(.*?)\s*·\s*axe\s*(.*?)\s*·\s*add\s*(.*?)\s*·\s*prix\s*(\d*)$/.exec(line)
    if (eye) {
      const clean = (v: string) => (v === '—' ? '' : v)
      const parsed: EyeLine = {
        sphere: clean(eye[2]), cylindre: clean(eye[3]), axe: clean(eye[4]),
        addition: clean(eye[5]), prix: Number(eye[6]) || 0,
      }
      if (eye[1] === 'OD') result.od = parsed
      else result.og = parsed
      recognized = true
      continue
    }

    const acc = /^Accessoires\s*:\s*(.*?)\s*·\s*prix\s*(\d*)$/.exec(line)
    if (acc) {
      result.accessoiresLabel = acc[1] === '—' ? '' : acc[1]
      result.accessoiresPrix = Number(acc[2]) || 0
      recognized = true
      continue
    }

    const montage = /^Montage\s*:\s*prix\s*(\d+)$/.exec(line)
    if (montage) { result.montage = Number(montage[1]) || 0; recognized = true; continue }

    const remise = /^Remise\s*:\s*([\d.]+)\s*%$/.exec(line)
    if (remise) { result.remise = Number(remise[1]) || 0; recognized = true; continue }
  }

  // Rien de reconnu : c'est une note ordinaire, on la rend intégralement.
  if (!recognized) result.freeNote = note
  return result
}

/** Total du document : verres + montures + accessoires + montage, remise déduite. */
function computeTotals(prescription: Prescription, monturesTotal: number) {
  const verres = (prescription.od.prix || 0) + (prescription.og.prix || 0)
  const brut = verres + monturesTotal + (prescription.accessoiresPrix || 0) + (prescription.montage || 0)
  const remise = Math.round(brut * (prescription.remise || 0) / 100)
  return { verres, brut, remise, net: brut - remise }
}

function proformaTotal(proforma: Proforma) {
  const declared = Number(proforma.total_amount)
  if (!Number.isNaN(declared) && declared > 0) return declared
  return (proforma.items || []).reduce((sum, item) => sum + (Number(item.unit_price) || 0), 0)
}

/** Le CODE128 du numéro de facture. Dessiné dans le SVG affiché, pas généré au
 *  moment d'imprimer : printProforma() clone le nœud de l'écran, donc les barres
 *  doivent déjà s'y trouver — sinon la facture sort avec un cadre vide. */
function ProformaBarcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const target = ref.current
    if (!target) return
    void import('jsbarcode').then(module => {
      const JsBarcode = (module.default || module) as any
      if (typeof JsBarcode !== 'function') return
      JsBarcode(target, value, {
        format: 'CODE128',
        lineColor: '#000000',
        background: '#ffffff',
        width: 1.6,
        height: 38,
        fontSize: 13,
        margin: 4,
        displayValue: true,
      })
      // JsBarcode pose width/height en pixels sans viewBox : sans elle, le max-width
      // du CSS d'impression ne peut pas réduire le code proportionnellement.
      const w = target.getAttribute('width')
      const h = target.getAttribute('height')
      if (w && h) target.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }).catch(() => {
      // Le numéro reste lisible en toutes lettres au-dessus : une facture sans
      // code-barres s'utilise encore, elle se saisit à la main.
    })
  }, [value])

  return <svg ref={ref} />
}

function ProformaDocument({ proforma, city, draft }: { proforma: Proforma; city: string; draft?: Prescription }) {
  const items = proforma.items || []
  // En saisie, l'ordonnance vient du formulaire ; sur une proforma enregistrée, elle
  // est relue depuis la note.
  const rx = draft || parsePrescription(proforma.note)
  const monturesTotal = items.reduce((sum, item) => sum + (Number(item.unit_price) || 0), 0)
  const totals = computeTotals(rx, monturesTotal)
  // Une proforma d'avant l'ordonnance n'a que son total_amount : on le garde plutôt
  // que d'afficher un 0 calculé sur des champs vides.
  const hasDetail = totals.brut > 0
  const total = hasDetail ? totals.net : proformaTotal(proforma)
  const date = proforma.created_at ? fmtDate(proforma.created_at) : fmtDate(new Date().toISOString())
  const tick = (on: boolean) => (on ? '☑' : '')

  return (
    <div className="pf" id="proforma-document">
      <style>{PROFORMA_CSS}</style>

      <img src={logoUrl} alt="La Lunetterie" className="pf-logo" />
      <hr className="pf-rule" />

      <p className="pf-city">{city}, le {date}</p>
      <p className="pf-title">FACTURE PROFORMA N° : {proforma.code || `—`}</p>

      {/* Le numéro était imprimé en toutes lettres et rien d'autre : la cliente
          revenait avec sa facture et il fallait le retaper. En CODE128 la douchette
          le lit, et le texte reste dessous pour la saisie à la main si besoin. */}
      {proforma.code && (
        <div className="pf-barcode">
          <ProformaBarcode value={proforma.code} />
        </div>
      )}

      <div className="pf-client">
        <span className="pf-contact">Contact : {proforma.client_phone || '—'}</span>
        <div><b>Société :</b> {rx.societe || 'PARTICULIER'}</div>
        <div><b>Nom et prénoms :</b> {(proforma.client_name || '—').toUpperCase()}</div>
      </div>

      {/* Type et teinte des verres : l'API ne les stocke pas, la grille s'imprime
          vide pour être cochée à la main, comme sur le formulaire papier actuel. */}
      <table>
        <thead>
          <tr>
            <th colSpan={4} className="pf-nb">Qualité des verres N°1 — NB : VERRES EN ORGANIQUE</th>
          </tr>
          <tr>
            <th style={{ width: '22%' }}></th>
            <th>Teinte A, B, C</th>
            <th>Photo / Transit°</th>
            <th>Blanc</th>
          </tr>
        </thead>
        <tbody>
          {FOYERS.map(type => (
            <tr key={type}>
              <td className="pf-lead">{type}</td>
              {TEINTES.map(teinte => (
                <td key={teinte} className="pf-fill pf-tick">
                  {tick(rx.foyer === type && rx.teinte === teinte)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Correction œil par œil : même remarque, ces valeurs viennent de l'ordonnance
          et n'ont pas de champ en base. */}
      <table>
        <thead>
          <tr>
            <th style={{ width: '10%' }}></th>
            <th>Sphère</th>
            <th>Cylindre ⊥ Axe</th>
            <th>Addition</th>
            <th style={{ width: '22%' }}>Prix (FCFA)</th>
          </tr>
        </thead>
        <tbody>
          {([['OD', rx.od], ['OG', rx.og]] as const).map(([label, eye]) => (
            <tr key={label}>
              <td className="pf-lead">{label} :</td>
              <td className="pf-fill pf-tick">{eye.sphere}</td>
              <td className="pf-fill pf-tick">{[eye.cylindre, eye.axe].filter(Boolean).join(' / ')}</td>
              <td className="pf-fill pf-tick">{eye.addition}</td>
              <td className="pf-fill pf-num">{eye.prix ? fmtFCFA(eye.prix) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td className="pf-lead">Monture</td>
              <td></td>
              <td className="pf-num">—</td>
            </tr>
          ) : (
            items.map((item, index) => (
              <tr key={item.id ?? index}>
                <td className="pf-lead">Monture {index + 1}</td>
                <td>
                  {[item.reference || item.barcode, item.brand, item.shape || item.forme, item.color].filter(Boolean).join(' · ')}
                  {/* Une monture à 0 est offerte, comme sur le formulaire papier. */}
                  {!Number(item.unit_price) && <b> — OFFERTE</b>}
                </td>
                <td className="pf-num" style={{ width: '22%' }}>{item.unit_price ? fmtFCFA(item.unit_price) : '—'}</td>
              </tr>
            ))
          )}
          <tr>
            <td className="pf-lead">Accessoires</td>
            <td>{rx.accessoiresLabel}</td>
            <td className="pf-num">{rx.accessoiresPrix ? fmtFCFA(rx.accessoiresPrix) : '—'}</td>
          </tr>
          <tr><td className="pf-lead">Montage</td><td></td><td className="pf-num">{rx.montage ? fmtFCFA(rx.montage) : '—'}</td></tr>
          <tr><td className="pf-lead">Total</td><td></td><td className="pf-num">{fmtFCFA(hasDetail ? totals.brut : total)}</td></tr>
          <tr>
            <td className="pf-lead">Remise</td>
            <td style={{ textAlign: 'right' }}>{rx.remise || 0} %</td>
            <td className="pf-num">{totals.remise ? `- ${fmtFCFA(totals.remise)}` : '—'}</td>
          </tr>
          <tr><td className="pf-lead">Total Net</td><td></td><td className="pf-num">{fmtFCFA(total)}</td></tr>
        </tbody>
      </table>

      <p className="pf-note">Les lunettes vendues ne sont ni échangées ni remboursées</p>

      <div className="pf-sign">
        <div>Le prescripteur</div>
        <div>Le client</div>
      </div>

      <div className="pf-foot">
        <b>{SOCIETE.nom}</b>
        {SOCIETE.adresse}<br />
        Tél : {SOCIETE.tel} — Email : {SOCIETE.email}<br />
        {SOCIETE.rccm}<br />
        {SOCIETE.pays}
      </div>
    </div>
  )
}

/** Imprime en clonant le noeud affiché : ce qui sort de l'imprimante ne peut pas
 *  diverger de ce qui est à l'écran, puisque c'est le même HTML et le même CSS. */
function printProforma(proforma: Proforma) {
  const node = document.getElementById('proforma-document')
  if (!node) return

  const popup = window.open('', '_blank', 'width=900,height=1000')
  if (!popup) return

  const clone = node.cloneNode(true) as HTMLElement

  // Le logo part en données plutôt qu'en URL : la fenêtre d'impression déclenche
  // window.print() dès le chargement, et une image encore en vol sortirait blanche
  // sur le papier. Celle de l'écran est déjà chargée, on la recopie telle quelle.
  const source = node.querySelector('img')
  const target = clone.querySelector('img')
  if (source && target) {
    target.src = imageToDataUrl(source)
  }

  popup.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8" />`
    + `<title>Proforma ${proforma.code || ''}</title><style>${PROFORMA_CSS}</style></head>`
    + `<body>${clone.outerHTML}`
    + `<script>window.onload=function(){window.print();}<\/script></body></html>`,
  )
  popup.document.close()
}

/** Rembobine une image déjà affichée en data: URI. Même origine, donc le canvas
 *  n'est pas contaminé et toDataURL() passe. */
function imageToDataUrl(img: HTMLImageElement) {
  if (!img.naturalWidth) return img.src
  try {
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) return img.src
    context.drawImage(img, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    // Origine croisée inattendue : on retombe sur l'URL, quitte à ce que le logo
    // manque, plutôt que de faire échouer toute l'impression.
    return img.src
  }
}

// ── Ventes & proformas ─────────────────────────────────────────────────────────
function VentesScreen({ data, user }: { data: StoreData; user: any }) {
  const city = stationCity(user)
  const [tab, setTab] = useState<'proformas' | 'ventes' | 'liste'>('proformas')
  const [openId, setOpenId] = useState<number | null>(null)

  const venteLignes = useMemo(() => buildVenteLignes(data), [data])
  const stamp = new Date().toISOString().slice(0, 10)

  const open = data.proformas.find(p => p.id === openId) || null
  const soldByDay = useMemo(() => {
    const groups = new Map<string, Glass[]>()
    for (const glass of data.sold) {
      const key = dayKey(glass.sold_at || glass.updated_at || glass.created_at)
      if (!key) continue
      groups.set(key, [...(groups.get(key) || []), glass])
    }
    return Array.from(groups.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [data.sold])

  if (open) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button onClick={() => setOpenId(null)} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
            {ic.back('w-4 h-4')}
            <span>Proformas</span>
          </button>
          <button
            onClick={() => printProforma(open)}
            className="flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95"
          >
            {ic.print('w-4 h-4')}
            <span>Imprimer</span>
          </button>
        </div>

        {open.note && (
          <Card>
            <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Note interne</p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{open.note}</p>
            <p className="mt-2 text-[11px] text-slate-400">Ne figure pas sur le document imprimé.</p>
          </Card>
        )}

        {/* Le document garde ses couleurs de papier même en thème sombre : c'est une
            facture, pas un écran, et c'est ce cadre-là qui part à l'imprimante. */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white overflow-x-auto shadow-sm">
          <ProformaDocument proforma={open} city={city} />
        </div>

        {/* L'encaissement (POST /proformas/:id/settle) est le geste de la Caisse, pas
            de la vendeuse : elle consulte, elle ne tranche pas. */}
        <p className="text-xs text-slate-400 dark:text-slate-500">
          L'encaissement ou le retour au présentoir se fait au poste Caisse.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[
          { id: 'proformas' as const, label: `Proformas (${data.proformas.length})` },
          { id: 'ventes' as const, label: `Ventes (${data.sold.length})` },
          { id: 'liste' as const, label: `Liste (${venteLignes.length})` },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
              tab === item.id ? 'bg-blue-600 text-white shadow-md' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'liste' ? (
        <div className="space-y-3">
          {/* Dit à l'écran ce que la colonne ne peut pas tenir : sans created_by sur une
              proforma, « Fait par » est déduit du dernier mouvement de la monture. */}
          <p className="text-xs text-slate-400 dark:text-slate-500">
            « Fait par » vient du dernier mouvement enregistré sur la monture — l'API ne
            garde pas l'auteur d'une proforma. La colonne reste vide au-delà des 300
            derniers mouvements.
          </p>
          <DataTable
            columns={VENTE_COLUMNS}
            rows={venteLignes}
            filename={`ventes-et-proformas-${stamp}`}
            empty="Aucune vente ni proforma enregistrée."
          />
        </div>
      ) : tab === 'proformas' ? (
        data.proformas.length === 0 ? (
          <EmptyState>Aucune proforma enregistrée.</EmptyState>
        ) : (
          <div className="space-y-2">
            {data.proformas.map(proforma => {
              const items = proforma.items || []
              // total_amount d'abord : si le détail n'a pas pu être chargé, la somme des
              // lignes vaudrait 0 et afficherait un devis gratuit.
              const total = proformaTotal(proforma)
              const pending = String(proforma.status || '').toUpperCase() === 'EN_ATTENTE'
              return (
                <button
                  key={proforma.id}
                  onClick={() => setOpenId(proforma.id)}
                  className="w-full bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 text-left hover:border-slate-300 dark:hover:border-slate-600 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{proforma.code || `Proforma ${proforma.id}`}</p>
                      <p className="text-xs text-slate-400 truncate">{proforma.client_name || 'Client non renseigné'}</p>
                    </div>
                    <span className={`text-[11px] font-semibold px-2 py-1 rounded-lg flex-shrink-0 ${pending ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                      {pending ? 'En attente' : proforma.status || '—'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-slate-400">{items.length} monture{items.length > 1 ? 's' : ''} · {fmtDate(proforma.created_at)}</span>
                    <span className="font-bold tabular-nums text-slate-700 dark:text-slate-200">{fmtFCFA(total)}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )
      ) : soldByDay.length === 0 ? (
        <EmptyState>Aucune vente enregistrée.</EmptyState>
      ) : (
        <div className="space-y-4">
          {soldByDay.map(([day, glasses]) => (
            <div key={day}>
              <SectionTitle action={<span className="text-xs font-bold tabular-nums text-slate-500 dark:text-slate-400">{fmtFCFA(glasses.reduce((s, g) => s + (Number(g.price) || 0), 0))}</span>}>
                {fmtDate(day)} · {glasses.length} vente{glasses.length > 1 ? 's' : ''}
              </SectionTitle>
              <div className="space-y-2">
                {glasses.map(glass => <GlassRow key={glass.barcode} glass={glass} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Scan monture / présentoir ──────────────────────────────────────────────────
function ScanScreen({ data, stationId }: { data: StoreData; stationId: number | null }) {
  const [code, setCode] = useState('')
  const [found, setFound] = useState<Glass | null>(null)
  const [status, setStatus] = useState('Prêt à scanner.')
  const [tone, setTone] = useState<'error' | 'success' | ''>('')
  const [busy, setBusy] = useState(false)
  const [similar, setSimilar] = useState<Glass[] | null>(null)
  const [similarBusy, setSimilarBusy] = useState(false)
  const [similarError, setSimilarError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // La douchette écrit là où est le curseur : le champ reprend le focus après chaque
  // recherche, sinon le scan suivant part dans le vide.
  useEffect(() => { inputRef.current?.focus() }, [found, busy])

  // Recherche automatique après une courte pause, pour éviter de devoir cliquer
  // à chaque nouveau code scanné ou saisi.
  useEffect(() => {
    const value = code.trim()
    if (!value || busy) return
    const timer = window.setTimeout(() => { void search() }, 450)
    return () => window.clearTimeout(timer)
  }, [code, busy])

  // Dès qu’une monture est affichée, on déclenche automatiquement la recherche des
  // montures similaires, sans attendre le clic sur le bouton.
  useEffect(() => {
    if (!found || similar !== null || similarBusy) return
    void searchSimilar(found)
  }, [found, similar, similarBusy])

  async function search() {
    const value = code.trim()
    if (!value) return
    setBusy(true)
    setFound(null)
    // Les résultats de la monture précédente n'ont plus rien à voir avec celle qu'on
    // vient de scanner : les laisser à l'écran ferait lire un stock pour un autre.
    setSimilar(null)
    setSimilarError('')
    setStatus('Recherche…')
    setTone('')
    try {
      const path = stationId
        ? `/inventory/glasses/${encodeURIComponent(value)}?station_id=${stationId}`
        : `/inventory/glasses/${encodeURIComponent(value)}`
      const payload = await apiFetch(path)
      const glass = payload?.data?.glass || payload?.data || null
      if (!glass || !glass.barcode) throw new Error('Monture introuvable.')
      setFound(glass)
      setStatus(`${glassRef(glass)} trouvée.`)
      setTone('success')
      setCode('')
    } catch (error: any) {
      setStatus(error?.message || 'Monture introuvable.')
      setTone('error')
    } finally {
      setBusy(false)
    }
  }

  /** « Est-ce qu'il en reste une comme celle-là ? » — on cherche ici les montures du
   *  stock magasin qui partagent au moins la forme, la marque et la couleur avec la
   *  lunette recherchée. Le tri se fait côté client pour garder la logique proche de
   *  ../Frontend/scan.js, qui construit déjà les listes de disponibilité à partir des
   *  statuts et de la station. */
  async function searchSimilar(glass: Glass) {
    setSimilarBusy(true)
    setSimilarError('')
    try {
      const payload = await apiFetch(stationId
        ? `/inventory/glasses?station_id=${stationId}`
        : '/inventory/glasses')
      const all: Glass[] = Array.isArray(payload?.data?.glasses) ? payload.data.glasses : []

      const shape = normalizeAttr(glass.shape)
      const color = normalizeAttr(glass.color)
      const brand = normalizeAttr(glass.brand)

      const matches = all.filter(candidate => {
        const candidateShape = normalizeAttr(candidate.shape)
        const candidateColor = normalizeAttr(candidate.color)
        const candidateBrand = normalizeAttr(candidate.brand)

        return candidate.barcode !== glass.barcode
          && AVAILABLE_STATUSES.has(String(candidate.status || '').toUpperCase())
          && (
            (candidateShape && candidateShape === shape)
            || (candidateBrand && candidateBrand === brand)
            || (candidateColor && candidateColor === color)
          )
          && (
            candidateShape === shape || candidateBrand === brand || candidateColor === color
          )
      })

      setSimilar(matches)
    } catch (error: any) {
      setSimilarError(error?.message || 'Recherche impossible pour le moment.')
      setSimilar(null)
    } finally {
      setSimilarBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <form onSubmit={e => { e.preventDefault(); void search() }} className="flex flex-col sm:flex-row gap-2">
          <input
            ref={inputRef}
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Scannez ou saisissez le code-barres"
            autoComplete="off"
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
          >
            {busy ? 'Recherche…' : 'Rechercher'}
          </button>
        </form>
        <p className={`mt-2 text-xs ${tone === 'error' ? 'text-red-600 dark:text-red-400' : tone === 'success' ? 'text-green-700 dark:text-green-400' : 'text-slate-400'}`}>
          {status}
        </p>
      </Card>

      {found && (
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-white truncate">{glassRef(found)}</p>
              <p className="text-xs text-slate-400">{found.barcode}</p>
            </div>
            <p className="text-lg font-black tabular-nums flex-shrink-0" style={{ color: '#2563eb' }}>{fmtFCFA(found.price)}</p>
          </div>
          <div className="mt-5 flex flex-col lg:flex-row gap-4">
            <div className="flex-1 flex flex-col gap-4">
              <Photo src={monturePhoto(found)} label="Monture" />
              <Photo src={branchePhoto(found)} label="Branche" />
            </div>

            <div className="w-full lg:w-[45%] grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
              {[
                ['Marque', found.brand], ['Forme', found.shape], ['Couleur', found.color],
                ['Matière', found.material], ['Genre', found.gender], ['Taille', found.size],
                ['Gamme', getGamme(found.price)], ['Statut', found.status], ['Emplacement', found.location_code],
                ['Station', found.station_name],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">{label}</p>
                  <p className="text-sm text-slate-700 dark:text-slate-200 break-words">{value || '—'}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 border-t border-slate-100 dark:border-slate-700 pt-3">
            {similarError && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">{similarError}</p>
            )}

            {similar !== null && (
              <div className="mt-3">
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
                  {similar.length === 0
                    ? 'Aucune autre monture disponible avec cette forme, cette couleur et cette gamme.'
                    : `${similar.length} autre${similar.length > 1 ? 's' : ''} monture${similar.length > 1 ? 's' : ''} disponible${similar.length > 1 ? 's' : ''}.`}
                </p>
                <div className="space-y-2">
                  {similar.map(glass => (
                    <div key={glass.barcode}>
                      <GlassRow glass={glass} />
                      <p className="mt-0.5 pl-3 text-[11px] text-slate-400">
                        {[glass.status, glass.station_name].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <div>
        <SectionTitle action={<span className="text-xs text-slate-500 dark:text-slate-400">{data.presentoir.length} monture{data.presentoir.length > 1 ? 's' : ''}</span>}>
          Présentoir
        </SectionTitle>
        {data.presentoir.length === 0 ? (
          <EmptyState>Aucune monture au présentoir.</EmptyState>
        ) : (
          <div className="space-y-2">
            {data.presentoir.map(glass => <GlassRow key={glass.barcode} glass={glass} />)}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Réclamation ────────────────────────────────────────────────────────────────
/** L'envoi part sur `POST /inventory/claims`. La lecture, elle, n'a pas encore de route
 *  côté serveur (`claims` n'enregistre que `Create`) : le tableau de bord la demande
 *  quand même, pour se remplir tout seul le jour où elle existera. */
function ReclamationScreen({ stationId, onDone }: { stationId: number | null; onDone: () => void }) {
  const [client, setClient] = useState('')
  const [barcode, setBarcode] = useState('')
  const [motif, setMotif] = useState('')
  const [detail, setDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const inputClass = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600'
  const ready = client.trim() && motif

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || submitting) return
    setSubmitting(true)
    setError(null)
    setMessage(null)
    try {
      const payload = await apiFetch('/inventory/claims', {
        method: 'POST',
        body: JSON.stringify({
          station_id: stationId ? Number(stationId) : undefined,
          client_name: client.trim(),
          barcode: barcode.trim(),
          motif,
          detail: detail.trim(),
        }),
      })
      setMessage(payload?.message || 'Réclamation enregistrée.')
      setClient('')
      setBarcode('')
      setMotif('')
      setDetail('')
      // Le suivi doit compter celle qu'on vient de saisir, sans attendre un retour au
      // tableau de bord.
      onDone()
    } catch (err: any) {
      setError(err?.message || 'Impossible d’enregistrer la réclamation.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Card>
        <p className="text-sm font-bold text-slate-900 dark:text-white">Nouvelle réclamation</p>
        <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="recClient">Client</label>
            <input id="recClient" type="text" value={client} onChange={e => setClient(e.target.value)} placeholder="Nom du client" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="recBarcode">Monture concernée</label>
            <input id="recBarcode" type="text" value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="Code-barres ou référence" className={inputClass} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="recMotif">Motif</label>
            <select id="recMotif" value={motif} onChange={e => setMotif(e.target.value)} className={inputClass}>
              <option value="">Choisissez un motif</option>
              <option value="CASSE">Monture cassée</option>
              <option value="DEFAUT">Défaut de fabrication</option>
              <option value="VERRE">Problème de verre</option>
              <option value="MONTAGE">Erreur de montage</option>
              <option value="DELAI">Délai non tenu</option>
              <option value="AUTRE">Autre</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="recDetail">Détail</label>
            <textarea id="recDetail" value={detail} onChange={e => setDetail(e.target.value)} rows={4} placeholder="Décrivez le problème signalé par le client" className={`${inputClass} resize-none`} />
          </div>
          {message && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
          {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button
            type="submit"
            disabled={!ready || submitting}
            className={`mt-4 w-full rounded-xl px-4 py-2.5 text-sm font-semibold ${ready && !submitting ? 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500 cursor-not-allowed'}`}
          >
            {submitting ? 'Enregistrement…' : 'Enregistrer la réclamation'}
          </button>
        </form>
      </Card>
    </div>
  )
}

// ── Mes stats ──────────────────────────────────────────────────────────────────
/** Les montures vendues ne portent pas de vendeuse (pas de champ sold_by) : la seule
 *  attribution nominative de l'API est celle des mouvements. Ces chiffres comptent
 *  donc des gestes enregistrés, pas des ventes signées. */
function StatsScreen({ data, user }: { data: StoreData; user: any }) {
  const me = fullName(user).toLowerCase()

  const mine = useMemo(() => myMovements(data.movements, user), [data.movements, user])

  // Le donut compte les montures, la barre empilée en cumule les montants : les deux
  // partent des mêmes listes, ils ne peuvent pas diverger.
  const etatSlices: Slice[] = [
    { label: 'Vendues', value: data.sold.length, stroke: 'stroke-[#16a34a]', swatch: 'bg-[#16a34a]' },
    {
      label: 'En réserve',
      value: data.reserved.length,
      stroke: 'stroke-[#9333ea] dark:stroke-[#a855f7]',
      swatch: 'bg-[#9333ea] dark:bg-[#a855f7]',
    },
  ]

  const montant = (glasses: Glass[]) => glasses.reduce((sum, glass) => sum + (Number(glass.price) || 0), 0)

  return (
    <div className="space-y-5">
      {!me && (
        <EmptyState>Votre nom n'est pas renseigné sur la fiche employé : impossible de retrouver vos mouvements.</EmptyState>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SectionTitle>Montures vendues et en réserve</SectionTitle>
          {/* Réduit à une pastille, mais pas supprimé : ces deux listes sont celles du
              magasin, l'API ne rattachant pas une vente à une vendeuse. Sans cette
              mention l'écran se lit comme un bilan personnel — ce serait faux. */}
          <span
            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500 dark:bg-slate-700/60 dark:text-slate-300"
            title="L'API n'attribue pas les ventes à une vendeuse : ces chiffres sont ceux du magasin."
          >
            {ic.home('w-3 h-3')} Magasin
          </span>
        </div>

        <div className="grid gap-3 lg:grid-cols-2 items-start">
          <Donut slices={etatSlices} centerLabel="montures" />
          <StackedBar
            segments={[
              { label: 'Valeur vendue', value: montant(data.sold), swatch: 'bg-[#16a34a]' },
              { label: 'Valeur en réserve', value: montant(data.reserved), swatch: 'bg-[#9333ea] dark:bg-[#a855f7]' },
            ]}
            format={fmtFCFA}
          />
        </div>
      </div>

      <div>
        <SectionTitle>Mes actions</SectionTitle>
        {mine.length === 0 ? (
          <EmptyState>Aucun mouvement à votre nom.</EmptyState>
        ) : (
          <div className="space-y-2">
            {mine.slice(0, 15).map((movement, index) => (
              <Card key={`${movement.barcode}-${index}`} className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                    {movement.reference || movement.barcode || '—'}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {String(movement.action || '').replace(/_/g, ' ').toLowerCase()}
                    {movement.to_station_name ? ` → ${movement.to_station_name}` : ''}
                  </p>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">{fmtDateTime(movement.created_at)}</span>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Shell ──────────────────────────────────────────────────────────────────────
function Sidebar({ current, onNavigate, dark, onToggleDark, user }: {
  current: Screen; onNavigate: (s: Screen) => void
  dark: boolean; onToggleDark: () => void; user: any
}) {
  const name = fullName(user) || 'Vendeuse'
  const initial = (name[0] || 'V').toUpperCase()

  return (
    <aside className="hidden md:flex flex-col w-56 lg:w-60 bg-slate-900 dark:bg-slate-950 h-screen sticky top-0 flex-shrink-0">
      <div className="px-4 py-5 border-b border-slate-800 flex-shrink-0">
        <div className="flex flex-col items-center gap-2.5 text-center">
          {/* Fond blanc nécessaire : le JPEG n'a pas de transparence. */}
          <div className="w-full max-w-[180px] rounded-xl bg-white px-3 py-2">
            <img src={logoUrl} alt="La Lunetterie" className="w-full h-auto object-contain" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Vendeuse</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition-all ${
              current === item.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <span className="flex-shrink-0">{item.icon('w-4 h-4')}</span>
            <span className="truncate font-medium">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 space-y-3 flex-shrink-0">
        <button onClick={onToggleDark} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
          {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
          <span className="text-xs">{dark ? 'Thème clair' : 'Thème sombre'}</span>
        </button>
        <button onClick={logoutToLogin} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
          {ic.x('w-4 h-4')}
          <span className="text-xs">Déconnexion</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-black flex-shrink-0">{initial}</div>
          <div className="min-w-0">
            <p className="text-xs text-white font-semibold truncate">{name}</p>
            <p className="text-xs text-slate-500 truncate">{user?.station_name || 'Poste vendeuse'}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function MobileNav({ current, onNavigate }: { current: Screen; onNavigate: (s: Screen) => void }) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40">
      <div className="flex">
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors ${current === item.id ? 'text-blue-600' : 'text-slate-400'}`}
          >
            {item.icon('w-5 h-5')}
            <span className="text-[9px] font-semibold leading-none">{item.short}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

function TopBar({ current, override, dark, onToggleDark, onReload, loading }: {
  current: Screen; override?: string | null
  dark: boolean; onToggleDark: () => void; onReload: () => void; loading: boolean
}) {
  const label = override || NAV.find(item => item.id === current)?.label || ''
  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-14 flex items-center gap-3 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">{label}</h1>
      </div>
      <button
        onClick={onReload}
        disabled={loading}
        className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40 flex-shrink-0"
        aria-label="Recharger"
      >
        {ic.refresh('w-4 h-4')}
      </button>
      <button
        onClick={onToggleDark}
        className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0"
        aria-label="Changer de thème"
      >
        {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
      </button>
    </header>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
function VendeusePage() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [table, setTable] = useState<TableId | null>(null)
  const [dark, setDark] = useState(false)

  // Le tableau détaillé se superpose à l'écran courant : changer de section par la
  // barre latérale doit donc le refermer, sinon on resterait coincé dedans.
  function navigate(next: Screen) {
    setTable(null)
    setScreen(next)
  }

  // Les deux étapes doivent avoir été franchies : un jeton valide de rôle VENDEUR, et
  // le passage par /magasin.html (qui pose `poste`). Sans le second, on y renvoie —
  // sinon la double vérification se contournerait en tapant l'URL.
  useEffect(() => {
    const token = getToken()
    if (!token) {
      window.location.replace('/magasin.html')
      return
    }
    if (window.localStorage.getItem('poste') !== 'vendeuse') {
      window.location.replace('/magasin.html')
      return
    }

    void (async () => {
      try {
        const payload = await apiFetch('/auth/me')
        const me = payload?.data?.user
        if (!me) throw new Error('session invalide')
        if (getRoleName(me) !== 'VENDEUR') {
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
  const { data, loading, error, claimsError, reload } = useStoreData(ready ? stationId : null)

  if (!ready) return null

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
        <Sidebar current={screen} onNavigate={navigate} dark={dark} onToggleDark={() => setDark(d => !d)} user={user} />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar current={screen} override={table ? TABLE_TITLES[table] : null} dark={dark} onToggleDark={() => setDark(d => !d)} onReload={() => void reload()} loading={loading} />

          <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 overflow-auto">
            {error && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-400">
                {error}
              </div>
            )}

            {table ? (
              <TableScreen table={table} data={data} user={user} stationId={stationId} claimsError={claimsError} onBack={() => setTable(null)} />
            ) : (
              <>
                {screen === 'dashboard' && <DashboardScreen data={data} user={user} onNavigate={navigate} onOpenTable={setTable} />}
                {screen === 'proforma' && <ProformaScreen stationId={stationId} user={user} onDone={() => void reload()} />}
                {screen === 'ventes' && <VentesScreen data={data} user={user} />}
                {screen === 'scan' && <ScanScreen data={data} stationId={stationId} />}
                {screen === 'reclamation' && <ReclamationScreen stationId={stationId} onDone={() => void reload()} />}
                {screen === 'stats' && <StatsScreen data={data} user={user} />}
              </>
            )}
          </main>
        </div>

        <MobileNav current={screen} onNavigate={navigate} />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VendeusePage />
  </React.StrictMode>,
)
