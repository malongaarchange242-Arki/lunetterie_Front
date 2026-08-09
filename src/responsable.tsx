import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'
import type { ReactElement, ReactNode } from 'react'

// Écran du poste Responsable magasin (rôle RESPONSABLE_STATION).
// Tout ce qui s'affiche vient de l'API, dans le périmètre de la station du compte.

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

type IconFn = (c?: string) => ReactElement

// ── Session ───────────────────────────────────────────────────────────────────
// Mêmes tables et mêmes verrous que vendeuse.tsx : le poste n'est pas plus ouvert
// que les autres sous prétexte qu'il encadre le magasin.

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

/** Même découpage que vendeuse.tsx : la chaîne ISO tronquée, pas une date locale — les
 *  deux fronts doivent grouper les ventes sur la même journée. */
function dayKey(value?: string) {
  return String(value || '').slice(0, 10)
}

function glassRef(glass: Glass) {
  return glass.reference || glass.barcode || '—'
}

function fullName(user: any) {
  return `${String(user?.first_name || '').trim()} ${String(user?.last_name || '').trim()}`.trim()
}

function priceOf(glass: Glass) {
  const n = Number(glass.price)
  return Number.isNaN(n) ? 0 : n
}

function sumPrice(glasses: Glass[]) {
  return glasses.reduce((total, glass) => total + priceOf(glass), 0)
}

/** La date qui fait foi pour une vente, dans l'ordre où le serveur la remplit. */
function soldDay(glass: Glass) {
  return dayKey(glass.sold_at || glass.updated_at || glass.created_at)
}

function daysSince(value?: string) {
  if (!value) return 0
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
}

/** Regroupe un attribut saisi à la main. « Écaille » et « ecaille » sont la même
 *  valeur — même normalisation que normalizeSendValue() de ../Frontend/scan.js. */
function groupByAttr(glasses: Glass[], pick: (g: Glass) => string | undefined) {
  const counts = new Map<string, number>()
  for (const glass of glasses) {
    const raw = String(pick(glass) || '').trim()
    if (!raw) continue
    const key = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

// ── Icônes ────────────────────────────────────────────────────────────────────
// SVG inline : le projet n'embarque aucune bibliothèque d'icônes (cf. AGENTS.md).
const ic = {
  home: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  glasses: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M3 12h0M21 12h0M11 12h2"/></svg>,
  chart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-8"/></svg>,
  cash: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  cart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  doc: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8M8 17h5"/></svg>,
  eye: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>,
  pkg: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  flask: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M9 2h6M10 2v6.4a2 2 0 0 1-.4 1.2L4.7 17a2 2 0 0 0 1.6 3.2h11.4a2 2 0 0 0 1.6-3.2l-4.9-7.4a2 2 0 0 1-.4-1.2V2"/></svg>,
  users: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M5 13l4 4L19 7"/></svg>,
  clock: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>,
  alert: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h0"/></svg>,
  info: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-5M12 8h0"/></svg>,
  up: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  down: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
  scan: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 8v8M11 8v8M15 8v8"/></svg>,
  hand: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v9"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2a8 8 0 0 1-8-8"/></svg>,
  x: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  refresh: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6"/></svg>,
  sun: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  moon: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
} satisfies Record<string, IconFn>

// Rôles de couleur du design system (AGENTS.md § Design system).
const C = {
  primary: '#2563eb',
  success: '#16a34a',
  violet: '#9333ea',
  violetDeep: '#7c3aed',
  cyan: '#0891b2',
  amber: '#d97706',
  danger: '#dc2626',
  muted: '#94a3b8',
}

const CARD = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4'
const CARD_LINK = `${CARD} w-full text-left transition-colors hover:border-slate-300 dark:hover:border-slate-600`
const INPUT_CLASS = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600'

// Les pastilles de statut passent par un jeu de tons plutôt que par des hex : sans ça,
// les fonds clairs devenaient illisibles en thème sombre.
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
type TabId = 'tableau' | 'ventes' | 'remise' | 'presentoir' | 'stock'

const TABS: { id: TabId; label: string; short: string; icon: IconFn }[] = [
  { id: 'tableau', label: 'Tableau de bord', short: 'Bord', icon: ic.home },
  { id: 'ventes', label: 'Ventes', short: 'Ventes', icon: ic.chart },
  { id: 'remise', label: 'Remise client', short: 'Remise', icon: ic.hand },
  { id: 'presentoir', label: 'Mise en présentoir', short: 'Présentoir', icon: ic.scan },
  { id: 'stock', label: 'Stock', short: 'Stock', icon: ic.pkg },
]

/** Au-delà, la paire retourne au stock local (règle métier du magasin). */
const RESERVE_LIMITE_JOURS = 10
/** Même seuil que le is_critical de ../Frontend/admin.js:626. */
const REFERENCE_CRITIQUE = 2

// Les actions du journal de mouvements (table ACTION_LABELS de ../Frontend/historique.js:10).
const ACTION_LIVRAISON = 'LIVRAISON'
const ACTION_RESERVATION = 'RESERVATION'
const ACTION_LABORATOIRE = 'LABORATOIRE'
/** Ce qui ramène une paire dans le magasin après un passage en réserve. Le backend ne
 *  journalise pas « fin de réserve » : c'est le mouvement suivant qui la trahit. */
const ACTIONS_RETOUR_STOCK = ['RETOUR', 'RANGEMENT', 'PRESENTOIR', 'RETRAIT_PRESENTOIR']

// ── Chargement ────────────────────────────────────────────────────────────────

interface StoreData {
  presentoir: Glass[]
  reserved: Glass[]
  sold: Glass[]
  labo: Glass[]
  pretes: Glass[]
  local: Glass[]
  proformas: Proforma[]
  movements: Movement[]
}

const EMPTY_DATA: StoreData = { presentoir: [], reserved: [], sold: [], labo: [], pretes: [], local: [], proformas: [], movements: [] }

/** Les ventes reconstituées depuis les proformas encaissées.
 *
 *  Une monture encaissée ne reste pas au statut VENDUE : la Caisse l'expédie dans la foulée
 *  au Laboratoire (AGENTS.md § « Une monture vendue ne reste pas VENDUE »).
 *  `/inventory/glasses?status=VENDUE` ne la renvoie donc quasiment jamais, et le chiffre
 *  d'affaires de ce poste affichait 0 face à des proformas pourtant réglées. La vente, elle,
 *  est gravée sur la ligne de proforma : `outcome = VENDUE`.
 *
 *  Une ligne rendue au client (`RETOUR_PRESENTOIR`) n'est pas une vente. Quand l'outcome
 *  manque — vieille ligne tranchée avant la colonne — une proforma REGLEE à une seule
 *  monture ne peut être qu'une vente : le serveur ne règle que si une monture au moins a
 *  été encaissée, il annule sinon.
 *
 *  Même reconstruction que soldFromProformas() de src/vendeuse.tsx : les deux postes
 *  doivent compter les mêmes ventes.
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
        // La fiche monture porte les attributs que la ligne de proforma ne recopie pas.
        // Ce que la ligne dit prime : c'est l'état du jour de la vente.
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

function useStoreData(stationId: number | null, stationName: string, enabled: boolean) {
  const [data, setData] = useState<StoreData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    if (!enabled) return
    setLoading(true)
    setError('')

    const scope = stationId ? `station_id=${stationId}&` : ''
    // allSettled : une liste indisponible ne doit pas vider les six autres. Le poste
    // doit rester utilisable même si un seul endpoint tombe.
    const results = await Promise.allSettled([
      apiFetch(`/inventory/glasses?${scope}status=EN_PRESENTOIR`),
      apiFetch(`/inventory/glasses?${scope}status=RESERVEE`),
      apiFetch(`/inventory/glasses?${scope}status=VENDUE`),
      apiFetch(`/inventory/glasses?${scope}status=EN_LABORATOIRE`),
      apiFetch(`/inventory/glasses?${scope}status=PRETE_A_LIVRER`),
      apiFetch(`/inventory/glasses?${scope}status=EN_STOCK_SOUS_STATION`),
      apiFetch('/inventory/proformas'),
      apiFetch('/inventory/movements?limit=300&offset=0'),
    ])

    const [presentoirR, reservedR, soldR, laboR, pretesR, localR, proformasR, movementsR] = results
    // Le filtre station_id n'est pas garanti sur tous les statuts : on refiltre ici,
    // sinon le responsable verrait le stock des autres magasins dans ses chiffres.
    const glasses = (r: PromiseSettledResult<any>): Glass[] => {
      const list: Glass[] = r.status === 'fulfilled' ? (r.value?.data?.glasses || []) : []
      if (!stationId) return list
      return list.filter(g => g.station_id == null || Number(g.station_id) === stationId)
    }

    const listees: Proforma[] = proformasR.status === 'fulfilled' ? (proformasR.value?.data?.proformas || []) : []

    // /inventory/proformas ne renvoie pas les lignes : presentoir.js:1831 va les chercher
    // une par une sur /inventory/proformas/:id. Sans ce second tour, aucune monture ne
    // peut être rattachée à son client.
    const details = await Promise.allSettled(
      listees.map(proforma => apiFetch(`/inventory/proformas/${proforma.id}`)),
    )
    const proformas = listees.map((proforma, index) => {
      const detail = details[index]
      const complete = detail.status === 'fulfilled' ? detail.value?.data?.proforma : null
      return complete ? { ...proforma, ...complete } : proforma
    })

    const presentoir = glasses(presentoirR)
    const reserved = glasses(reservedR)
    const labo = glasses(laboR)
    const pretes = glasses(pretesR)
    const local = glasses(localR)

    // Les fiches encore en magasin servent de source pour les attributs des ventes
    // reconstituées : la ligne de proforma ne recopie ni la matière ni le genre.
    const fiches = new Map<string, Glass>()
    for (const glass of [...presentoir, ...reserved, ...labo, ...pretes, ...local]) {
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

    // Le journal n'accepte pas de filtre station : on le restreint sur le nom, en gardant
    // les mouvements sans station renseignée plutôt que de vider la liste sur un libellé
    // qui ne correspondrait pas.
    const station = String(stationName || '').trim().toLowerCase()
    const journal: Movement[] = movementsR.status === 'fulfilled' ? (movementsR.value?.data?.movements || []) : []
    const movements = station
      ? journal.filter(m => {
        const from = String(m.from_station_name || '').trim().toLowerCase()
        const to = String(m.to_station_name || '').trim().toLowerCase()
        return (!from && !to) || from === station || to === station
      })
      : journal

    setData({
      presentoir,
      reserved,
      sold: [...vendues, ...encaissees],
      labo,
      pretes,
      local,
      proformas,
      movements,
    })

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed === results.length) setError("Aucune donnée n'a pu être chargée.")
    else if (failed > 0) setError(`${failed} liste${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}.`)
    setLoading(false)
  }

  useEffect(() => { void load() }, [stationId, stationName, enabled])

  return { data, loading, error, reload: load }
}

/** Le parcours de chaque monture dans le journal, du plus ancien au plus récent. Il n'y a
 *  pas d'autre façon de savoir d'où une monture arrive : le mouvement dit où elle va, le
 *  précédent dit d'où elle vient. */
function buildHistoryIndex(movements: Movement[]) {
  const parBarcode = new Map<string, Movement[]>()
  for (const movement of movements) {
    const key = String(movement.barcode || '').trim().toUpperCase()
    if (!key) continue
    const liste = parBarcode.get(key)
    if (liste) liste.push(movement)
    else parBarcode.set(key, [movement])
  }
  for (const liste of parBarcode.values()) {
    liste.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  }
  return parBarcode
}

/** Les mouvements du jour dont le précédent était une mise en réserve : c'est ce couple,
 *  et lui seul, qui distingue une sortie de réserve d'un mouvement ordinaire. */
function sortiesDeReserve(history: Map<string, Movement[]>, jour: string, actions: string[]) {
  const sorties: { movement: Movement; joursReserve: number }[] = []
  for (const liste of history.values()) {
    for (let i = 1; i < liste.length; i++) {
      const precedent = liste[i - 1]
      const courant = liste[i]
      if (dayKey(courant.created_at) !== jour) continue
      if (String(precedent.action || '').toUpperCase() !== ACTION_RESERVATION) continue
      if (!actions.includes(String(courant.action || '').toUpperCase())) continue
      sorties.push({ movement: courant, joursReserve: daysSince(precedent.created_at) })
    }
  }
  return sorties
}

/** Rattache chaque monture à la proforma qui la porte : c'est la seule façon de
 *  connaître le client d'une monture, le backend ne le stocke pas sur la monture. */
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

// ── Fiche détail ──────────────────────────────────────────────────────────────

interface DetailLine { name: string; meta: string; badge?: { text: string; tone: Tone } }
interface DetailStat { label: string; value: string | number }
/** `id` et non le titre comme clé : deux montures partagent souvent la même référence, et
 *  React fusionnerait leurs lignes. */
interface DetailRowData { id: string; title: string; subtitle: string; cells: { label: string; value: string | number; color?: string }[]; badge?: ReactNode }

interface Detail {
  title: string
  subtitle?: string
  icon?: IconFn
  color?: string
  stats?: DetailStat[]
  details?: DetailLine[]
  table?: { title: string; note?: string; rows: DetailRowData[] }
  description?: string
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

/** Le CODE128 d'un code-barres de monture, dessiné sur place.
 *
 *  La maquette passait par api.qrserver.com : une requête réseau par ligne de liste, et le
 *  code-barres du magasin envoyé à un tiers. jsbarcode est déjà une dépendance du projet
 *  (src/vendeuse.tsx, src/App.tsx) et les montures sont suivies en CODE128, pas en QR. */
function Code128({ value, height = 40, showValue = true }: { value: string; height?: number; showValue?: boolean }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    const target = ref.current
    if (!target) return
    // Un champ vide ou un code refusé par la norme ferait jeter jsbarcode : on nettoie le
    // dessin précédent et on s'arrête là plutôt que d'afficher des barres périmées.
    target.replaceChildren()
    if (!value) return
    void import('jsbarcode').then(module => {
      const JsBarcode = (module.default || module) as any
      if (typeof JsBarcode !== 'function') return
      JsBarcode(target, value, {
        format: 'CODE128',
        lineColor: '#0f172a',
        background: '#ffffff',
        width: 1.4,
        height,
        fontSize: 12,
        margin: 4,
        displayValue: showValue,
        valid: (ok: boolean) => { if (!ok) target.replaceChildren() },
      })
      // JsBarcode pose width/height en pixels sans viewBox : sans elle, le code ne peut pas
      // se réduire proportionnellement dans une carte étroite.
      const w = target.getAttribute('width')
      const h = target.getAttribute('height')
      if (w && h) target.setAttribute('viewBox', `0 0 ${w} ${h}`)
      target.removeAttribute('width')
      target.removeAttribute('height')
    }).catch(() => {
      // Le code reste lisible en toutes lettres à côté : une ligne sans barres se saisit
      // encore à la main.
    })
  }, [value, height, showValue])

  return <svg ref={ref} className="w-full h-full" preserveAspectRatio="xMidYMid meet" />
}

function Bar({ percent, color }: { percent: number | string; color: string }) {
  return (
    <div className="bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
      <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>
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

function Trend({ current, previous, label }: { current: number; previous: number; label: string }) {
  // Sans point de comparaison, un « +100 % » ne voudrait rien dire.
  if (!previous) return <span className="mt-1 block text-xs text-slate-400">{label} : —</span>
  const pct = (((current - previous) / previous) * 100).toFixed(1)
  const up = current > previous
  const color = current === previous ? C.muted : up ? C.success : C.danger
  return (
    <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold tabular-nums" style={{ color }}>
      {up ? ic.up('w-3.5 h-3.5') : ic.down('w-3.5 h-3.5')}
      {pct}% {label}
    </span>
  )
}

/** Liste de montures, même gabarit partout : réf, client, une méta, un badge. */
function GlassRow({ glass, client, meta, badge, tinted }: {
  glass: Glass; client: string; meta?: string; badge?: ReactNode; tinted?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 transition-colors ${tinted ? 'bg-green-50/60 dark:bg-green-500/5' : ''}`}>
      <Pastille color={tinted ? C.success : C.primary}>{tinted ? ic.check() : ic.glasses()}</Pastille>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
        <p className="text-xs text-slate-400 truncate">{client}</p>
        {meta && <p className="text-xs text-slate-400 truncate">{meta}</p>}
      </div>
      {badge}
    </div>
  )
}

function Repartition({ title, subtitle, icon, rows, color, total, empty, onClick }: {
  title: string
  subtitle?: string
  icon?: IconFn
  rows: { label: string; count: number }[]
  color: string
  total: number
  empty?: string
  onClick?: () => void
}) {
  const corps = (
    <>
      <div className="flex items-center gap-2.5 mb-4">
        {icon && <Pastille color={color}>{icon()}</Pastille>}
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{title}</p>
          {subtitle && <p className="text-xs text-slate-400 truncate">{subtitle}</p>}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">{empty || 'Aucune valeur renseignée sur ce stock.'}</p>
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const percent = total > 0 ? Math.round((row.count / total) * 100) : 0
            return (
              <div key={row.label}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{row.label}</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color }}>{percent}% ({row.count})</span>
                </div>
                <Bar percent={percent} color={color} />
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  if (!onClick) return <div className={CARD}>{corps}</div>
  return <button onClick={onClick} className={CARD_LINK}>{corps}</button>
}

// ── Écran ─────────────────────────────────────────────────────────────────────

function ResponsableMagasinPage() {
  const [dark, setDark] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('tableau')
  const [selectedDetail, setSelectedDetail] = useState<Detail | null>(null)
  const [user, setUser] = useState<any>(null)
  const [ready, setReady] = useState(false)

  // Scans : le marquage reste local, aucun mouvement n'est encore envoyé au serveur.
  const [scannedPresentoir, setScannedPresentoir] = useState<string[]>([])
  const [scanPresentoir, setScanPresentoir] = useState('')
  const [scannedRemise, setScannedRemise] = useState<string[]>([])
  const [scanRemise, setScanRemise] = useState('')

  // Les deux étapes doivent avoir été franchies : un jeton valide de rôle
  // RESPONSABLE_STATION, et le passage par /magasin.html (qui pose `poste`). Sans le
  // second, on y renvoie — sinon la double vérification se contournerait en tapant l'URL.
  useEffect(() => {
    const token = getToken()
    if (!token) {
      window.location.replace('/magasin.html')
      return
    }
    if (window.localStorage.getItem('poste') !== 'responsable') {
      window.location.replace('/magasin.html')
      return
    }

    void (async () => {
      try {
        const payload = await apiFetch('/auth/me')
        const me = payload?.data?.user
        if (!me) throw new Error('session invalide')
        if (getRoleName(me) !== 'RESPONSABLE_STATION') {
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
  const stationName = String(user?.station_name || '')
  const { data, loading, error, reload } = useStoreData(stationId, stationName, ready)

  const clientIndex = useMemo(() => buildClientIndex(data.proformas), [data.proformas])
  const clientOf = (glass: Glass) => {
    const proforma = clientIndex.get(String(glass.barcode || '').toUpperCase())
      || clientIndex.get(String(glass.reference || '').toUpperCase())
    return proforma?.client_name || 'Client non rattaché'
  }

  // ── Chiffres dérivés ────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const now = new Date()
    const iso = now.toISOString()
    const today = iso.slice(0, 10)
    const yesterday = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
    const month = iso.slice(0, 7)
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7)
    const year = iso.slice(0, 4)
    const lastYear = String(Number(year) - 1)
    const weekFloor = new Date(now.getTime() - 6 * 86400000).toISOString().slice(0, 10)
    const prevWeekFloor = new Date(now.getTime() - 13 * 86400000).toISOString().slice(0, 10)

    const soldToday = data.sold.filter(g => soldDay(g) === today)
    const soldYesterday = data.sold.filter(g => soldDay(g) === yesterday)
    const soldWeek = data.sold.filter(g => soldDay(g) >= weekFloor)
    // La semaine d'avant s'arrête là où celle-ci commence, sinon les deux se chevauchent
    // d'un jour et la comparaison se compare en partie à elle-même.
    const soldPrevWeek = data.sold.filter(g => soldDay(g) >= prevWeekFloor && soldDay(g) < weekFloor)
    const soldMonth = data.sold.filter(g => soldDay(g).startsWith(month))
    const soldLastMonth = data.sold.filter(g => soldDay(g).startsWith(lastMonth))
    const soldYear = data.sold.filter(g => soldDay(g).startsWith(year))
    const soldLastYear = data.sold.filter(g => soldDay(g).startsWith(lastYear))

    const proformasToday = data.proformas.filter(p => dayKey(p.created_at) === today)
    // « Soldée » se lit sur l'outcome des lignes depuis que la colonne existe (AGENTS.md) :
    // la Caisse a tranché partout, en vente ou en retour. is_pending reste le repli pour
    // les lignes tranchées avant l'arrivée de la colonne.
    const soldeesToday = proformasToday.filter(p => {
      const items = p.items || []
      return items.length > 0 && items.every(i => Boolean(i.outcome) || i.is_pending === false)
    })

    // Ce que la Caisse a encaissé aujourd'hui, monture par monture : une proforma soldée
    // peut en porter plusieurs.
    const payeesToday = soldToday

    const history = buildHistoryIndex(data.movements)
    const livreesToday = data.movements.filter(m =>
      String(m.action || '').toUpperCase() === ACTION_LIVRAISON && dayKey(m.created_at) === today)
    const livreesBarcodes = new Set(
      data.movements
        .filter(m => String(m.action || '').toUpperCase() === ACTION_LIVRAISON)
        .map(m => String(m.barcode || '').trim().toUpperCase()),
    )

    // Les deux sorties de réserve du jour, distinguées par leur destination.
    const reserveVersLabo = sortiesDeReserve(history, today, [ACTION_LABORATOIRE])
    const reserveVersStock = sortiesDeReserve(history, today, ACTIONS_RETOUR_STOCK)

    const reserveProche = data.reserved.filter(g => daysSince(g.updated_at || g.created_at) >= RESERVE_LIMITE_JOURS - 1)

    // Tout ce que le magasin détient, tous statuts confondus : la base des répartitions.
    const stockTotal = [...data.local, ...data.presentoir, ...data.labo, ...data.reserved, ...data.pretes]

    const parReference = new Map<string, number>()
    for (const glass of stockTotal) {
      const key = glassRef(glass)
      parReference.set(key, (parReference.get(key) || 0) + 1)
    }
    const critiques = Array.from(parReference.entries()).filter(([, n]) => n <= REFERENCE_CRITIQUE)

    return {
      today, yesterday,
      caToday: sumPrice(soldToday), caYesterday: sumPrice(soldYesterday),
      caWeek: sumPrice(soldWeek), caPrevWeek: sumPrice(soldPrevWeek),
      caMonth: sumPrice(soldMonth), caLastMonth: sumPrice(soldLastMonth),
      caYear: sumPrice(soldYear), caLastYear: sumPrice(soldLastYear),
      soldToday, soldWeek, soldPrevWeek,
      ticketMoyen: soldWeek.length > 0 ? Math.round(sumPrice(soldWeek) / soldWeek.length) : 0,
      ticketMoyenPrev: soldPrevWeek.length > 0 ? Math.round(sumPrice(soldPrevWeek) / soldPrevWeek.length) : 0,
      proformasToday, soldeesToday,
      montantSoldeesToday: soldeesToday.reduce((total, p) => total + (Number(p.total_amount) || 0), 0),
      payeesToday,
      livreesToday, livreesBarcodes,
      reserveVersLabo, reserveVersStock,
      reserveProche,
      stockTotal,
      critiques,
      // Les références se comptent en références, pas en montures : les rapporter au
      // total d'unités mélangerait deux unités (même écueil que dashboardMetrics.ts).
      references: parReference.size,
      formes: groupByAttr(stockTotal, g => g.shape),
      matieres: groupByAttr(stockTotal, g => g.material),
      genres: groupByAttr(stockTotal, g => g.gender),
      ventesParForme: groupByAttr(data.sold, g => g.shape),
    }
  }, [data])

  const dateDuJour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const tabCourant = TABS.find(t => t.id === activeTab)
  const nomAffiche = fullName(user) || 'Responsable'

  const glassRows = (list: Glass[], meta: (g: Glass) => string): DetailRowData[] =>
    list.map((glass, index) => ({
      id: glass.barcode || `${glassRef(glass)}-${index}`,
      title: glassRef(glass),
      subtitle: clientOf(glass),
      cells: [
        { label: 'Détail', value: meta(glass) },
        { label: 'Prix', value: fmtFCFA(glass.price) },
      ],
    }))

  // Le journal ne porte que le code-barres : la fiche complète se retrouve dans les listes
  // déjà chargées. Une monture partie du magasin depuis n'y est plus, d'où les replis.
  const ficheIndex = useMemo(() => {
    const index = new Map<string, Glass>()
    for (const glass of [...data.local, ...data.presentoir, ...data.labo, ...data.reserved, ...data.pretes, ...data.sold]) {
      if (glass.barcode) index.set(String(glass.barcode).toUpperCase(), glass)
    }
    return index
  }, [data])

  const movementRows = (
    list: { movement: Movement; joursReserve?: number }[],
    label: string,
    badge?: (entree: { movement: Movement; joursReserve?: number }) => ReactNode,
  ): DetailRowData[] =>
    list.map((entree, index) => {
      const { movement, joursReserve } = entree
      const fiche = ficheIndex.get(String(movement.barcode || '').toUpperCase())
      return {
        id: `${movement.barcode || 'mvt'}-${movement.created_at || index}`,
        title: fiche ? glassRef(fiche) : (movement.reference || movement.barcode || '—'),
        subtitle: fiche ? clientOf(fiche) : (movement.barcode || 'Monture non retrouvée'),
        cells: [
          {
            label,
            value: joursReserve != null
              ? `${joursReserve} jour${joursReserve > 1 ? 's' : ''}`
              : fmtDate(movement.created_at),
            color: joursReserve != null && joursReserve >= RESERVE_LIMITE_JOURS ? C.amber : undefined,
          },
          { label: 'Prix', value: fiche ? fmtFCFA(fiche.price) : '—' },
        ],
        badge: badge?.(entree),
      }
    })

  // Les 8 tuiles du résumé du jour, toutes calculées sur les listes chargées.
  const resumeDuJour: { label: string; value: number; color: string; icon: IconFn; desc: string; detail: Omit<Detail, 'title'> }[] = [
    {
      label: 'Montures au laboratoire',
      value: data.labo.length,
      color: C.violet,
      icon: ic.flask,
      desc: 'En cours de montage',
      detail: {
        icon: ic.flask,
        table: {
          title: 'Montures au laboratoire',
          rows: glassRows(data.labo, g => `Entrée le ${fmtDate(g.updated_at || g.created_at)}`),
        },
      },
    },
    {
      label: 'Prêtes à remettre',
      value: data.pretes.length,
      color: C.cyan,
      icon: ic.hand,
      desc: 'Le labo a terminé',
      detail: {
        icon: ic.hand,
        table: {
          title: 'Montures prêtes à remettre',
          rows: glassRows(data.pretes, g => `Prête depuis le ${fmtDate(g.updated_at || g.created_at)}`),
        },
      },
    },
    {
      label: "Lunettes payées aujourd'hui",
      value: metrics.payeesToday.length,
      color: C.primary,
      icon: ic.cash,
      desc: 'Paiement reçu aujourd’hui',
      detail: {
        icon: ic.cash,
        description: "Montures encaissées par la Caisse aujourd'hui. Une proforma peut en porter plusieurs. Payer n'est pas retirer : la monture part ensuite au laboratoire.",
        table: {
          title: "Montures encaissées aujourd'hui",
          rows: glassRows(metrics.payeesToday, g => `Encaissée le ${fmtDate(g.sold_at || g.updated_at)}`),
        },
      },
    },
    {
      label: "Remises aujourd'hui",
      value: metrics.livreesToday.length,
      color: C.success,
      icon: ic.cart,
      desc: 'Sorties du magasin',
      detail: {
        icon: ic.cart,
        description: "Montures livrées au client aujourd'hui, relevées sur les mouvements LIVRAISON. Ces clients avaient payé avant : c'est la sortie du magasin, pas l'encaissement.",
        table: {
          title: "Montures remises aujourd'hui",
          rows: movementRows(metrics.livreesToday.map(movement => ({ movement })), 'Remise le'),
        },
      },
    },
    {
      label: 'Proformas du jour',
      value: metrics.proformasToday.length,
      color: C.amber,
      icon: ic.doc,
      desc: `${metrics.soldeesToday.length} soldée(s)`,
      detail: {
        icon: ic.doc,
        table: {
          title: 'Proformas créées aujourd’hui',
          note: "Soldée se déduit des lignes : is_pending à false sur toutes. Le backend ne porte pas d'issue par ligne.",
          rows: metrics.proformasToday.map(proforma => ({
            title: proforma.code || `Proforma ${proforma.id}`,
            subtitle: proforma.client_name || 'Client non renseigné',
            cells: [
              { label: 'Montures', value: (proforma.items || []).length },
              { label: 'Total', value: fmtFCFA(proforma.total_amount) },
            ],
            badge: <Badge tone={(proforma.items || []).every(i => i.is_pending === false) && (proforma.items || []).length > 0 ? 'green' : 'amber'}>
              {(proforma.items || []).every(i => i.is_pending === false) && (proforma.items || []).length > 0 ? 'Soldée' : 'En attente'}
            </Badge>,
          })),
        },
      },
    },
    {
      label: 'En présentoir',
      value: data.presentoir.length,
      color: C.violetDeep,
      icon: ic.eye,
      desc: 'Disponibles à la vente',
      detail: {
        icon: ic.eye,
        table: {
          title: 'Montures en présentoir',
          rows: glassRows(data.presentoir, g => g.location_code || 'Emplacement non renseigné'),
        },
      },
    },
    {
      label: 'En réserve',
      value: data.reserved.length,
      color: C.primary,
      icon: ic.pkg,
      desc: `Limite ${RESERVE_LIMITE_JOURS} jours`,
      detail: {
        icon: ic.pkg,
        table: {
          title: 'Montures en réserve',
          rows: data.reserved.map(glass => {
            const jours = daysSince(glass.updated_at || glass.created_at)
            return {
              title: glassRef(glass),
              subtitle: clientOf(glass),
              cells: [
                { label: 'Depuis', value: `${jours} jour${jours > 1 ? 's' : ''}`, color: jours >= RESERVE_LIMITE_JOURS - 1 ? C.amber : undefined },
                { label: 'Prix', value: fmtFCFA(glass.price) },
              ],
              badge: <Badge tone={jours >= RESERVE_LIMITE_JOURS ? 'red' : jours >= RESERVE_LIMITE_JOURS - 1 ? 'amber' : 'slate'}>
                {jours >= RESERVE_LIMITE_JOURS ? 'Dépassée' : jours >= RESERVE_LIMITE_JOURS - 1 ? 'Proche limite' : 'OK'}
              </Badge>,
            }
          }),
        },
      },
    },
    {
      label: 'Réserve à échéance',
      value: metrics.reserveProche.length,
      color: C.danger,
      icon: ic.alert,
      desc: `${RESERVE_LIMITE_JOURS - 1} jours ou plus`,
      detail: {
        icon: ic.alert,
        description: `Au-delà de ${RESERVE_LIMITE_JOURS} jours, la paire retourne au stock local et le client perd son option.`,
        table: {
          title: 'Réserves proches de la limite',
          rows: metrics.reserveProche.map(glass => {
            const jours = daysSince(glass.updated_at || glass.created_at)
            return {
              title: glassRef(glass),
              subtitle: clientOf(glass),
              cells: [
                { label: 'Depuis', value: `${jours} jour${jours > 1 ? 's' : ''}`, color: C.amber },
                { label: 'Prix', value: fmtFCFA(glass.price) },
              ],
            }
          }),
        },
      },
    },
    {
      label: 'Stock local',
      value: data.local.length,
      color: C.muted,
      icon: ic.glasses,
      desc: 'À placer en présentoir',
      detail: {
        icon: ic.glasses,
        table: {
          title: 'Stock local de la station',
          rows: glassRows(data.local, g => [g.shape, g.color].filter(Boolean).join(' · ') || g.barcode),
        },
      },
    },
  ]

  // Rien tant que /auth/me n'a pas répondu : afficher l'écran puis le retirer ferait
  // clignoter des chiffres devant quelqu'un qui n'y a peut-être pas droit.
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
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">R. Magasin</p>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition-all ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
              >
                <span className="flex-shrink-0">{tab.icon('w-4 h-4')}</span>
                <span className="truncate font-medium">{tab.label}</span>
              </button>
            ))}
          </nav>

          <div className="px-4 py-3 border-t border-slate-800 space-y-3 flex-shrink-0">
            <button onClick={() => setDark(d => !d)} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
              {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
              <span className="text-xs">{dark ? 'Thème clair' : 'Thème sombre'}</span>
            </button>
            <button onClick={logoutToLogin} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
              {ic.x('w-4 h-4')}
              <span className="text-xs">Déconnexion</span>
            </button>
            <div className="flex items-center gap-2 min-w-0">
              {/* Violet : la couleur du poste Responsable dans magasin.tsx. */}
              <div className="w-7 h-7 rounded-xl flex items-center justify-center text-white text-xs font-black flex-shrink-0" style={{ background: C.violet }}>
                {(nomAffiche[0] || 'R').toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-white font-semibold truncate">{nomAffiche}</p>
                <p className="text-xs text-slate-500 truncate">{user?.station_name || 'R. Magasin'}</p>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">

          {/* ── TopBar ────────────────────────────────────────────────────── */}
          <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-14 flex items-center gap-3 flex-shrink-0">
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">{tabCourant?.label}</h1>
              <p className="text-xs text-slate-400 truncate first-letter:uppercase">{dateDuJour}</p>
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
          </header>

          <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 overflow-auto">
            {error && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-400">
                {error}
              </div>
            )}
            {!stationId && (
              <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-400">
                Aucune station rattachée à ce compte : les chiffres portent sur l'ensemble des magasins.
              </div>
            )}

            {/* ── TABLEAU DE BORD ──────────────────────────────────────────── */}
            {activeTab === 'tableau' && (
              <div>
                {/* Chiffre d'affaires */}
                <div className={CARD}>
                  <div className="grid gap-5 md:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <Pastille color={C.primary}>{ic.cash()}</Pastille>
                        <p className="text-xs text-slate-400">Chiffre d'affaires aujourd'hui</p>
                      </div>
                      <p className="mt-3 text-3xl font-black tabular-nums" style={{ color: C.primary }}>
                        {fmt(metrics.caToday)} <span className="text-lg">FCFA</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-400 tabular-nums">
                        {metrics.soldToday.length} monture{metrics.soldToday.length > 1 ? 's' : ''} remise{metrics.soldToday.length > 1 ? 's' : ''}
                      </p>
                    </div>
                    {[
                      { label: 'Hier', value: metrics.caYesterday, compare: null },
                      { label: 'Ce mois-ci', value: metrics.caMonth, compare: { previous: metrics.caLastMonth, label: 'vs mois dernier' } },
                      { label: 'Cette année', value: metrics.caYear, compare: { previous: metrics.caLastYear, label: 'vs an dernier' } },
                    ].map(col => (
                      <div key={col.label} className="md:border-l md:border-slate-100 dark:md:border-slate-700 md:pl-5">
                        <p className="text-xs text-slate-400">{col.label}</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-slate-900 dark:text-white">{fmt(col.value)} FCFA</p>
                        {col.compare && <Trend current={col.value} previous={col.compare.previous} label={col.compare.label} />}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Résumé du jour */}
                <SectionTitle>État du magasin</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {resumeDuJour.map(stat => (
                    <button
                      key={stat.label}
                      onClick={() => setSelectedDetail({
                        ...stat.detail,
                        title: stat.label,
                        subtitle: stat.desc,
                        color: stat.color,
                        stats: [{ label: stat.label, value: stat.value }],
                      })}
                      className={CARD_LINK}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400 leading-snug">{stat.label}</p>
                          <p className="mt-2 text-3xl font-black tabular-nums" style={{ color: stat.color }}>{stat.value}</p>
                          <p className="mt-1 text-xs text-slate-400">{stat.desc}</p>
                        </div>
                        <Pastille color={stat.color}>{stat.icon()}</Pastille>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Répartitions */}
                <SectionTitle>Composition du stock ({metrics.stockTotal.length} montures)</SectionTitle>
                <div className="grid gap-3 lg:grid-cols-3">
                  <Repartition title="Formes" rows={metrics.formes} color={C.primary} total={metrics.stockTotal.length} />
                  <Repartition title="Matières" rows={metrics.matieres} color={C.cyan} total={metrics.stockTotal.length} />
                  <Repartition title="Genres" rows={metrics.genres} color={C.amber} total={metrics.stockTotal.length} />
                </div>
              </div>
            )}

            {/* ── VENTES ───────────────────────────────────────────────────── */}
            {activeTab === 'ventes' && (
              <div>
                <SectionTitle>Sept derniers jours</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    { label: 'Chiffre d’affaires', value: fmt(metrics.caWeek), unit: 'FCFA', color: C.primary, icon: ic.cash },
                    { label: 'Ticket moyen', value: fmt(metrics.ticketMoyen), unit: 'FCFA', color: C.success, icon: ic.doc },
                    { label: 'Montures remises', value: String(metrics.soldWeek.length), unit: '', color: C.amber, icon: ic.cart },
                  ].map(tile => (
                    <div key={tile.label} className={CARD}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400">{tile.label}</p>
                          <p className="mt-2 text-3xl font-black tabular-nums" style={{ color: tile.color }}>
                            {tile.value}{tile.unit && <span className="text-lg"> {tile.unit}</span>}
                          </p>
                        </div>
                        <Pastille color={tile.color}>{tile.icon()}</Pastille>
                      </div>
                    </div>
                  ))}
                </div>

                <SectionTitle>Ventes par forme</SectionTitle>
                <div className={CARD}>
                  {metrics.ventesParForme.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucune vente enregistrée.</p>
                  ) : (
                    <div className="space-y-3">
                      {metrics.ventesParForme.map(row => {
                        const percent = Math.round((row.count / data.sold.length) * 100)
                        return (
                          <div key={row.label}>
                            <div className="flex justify-between mb-1.5">
                              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{row.label}</span>
                              <span className="text-xs font-bold tabular-nums" style={{ color: C.cyan }}>{percent}% ({row.count})</span>
                            </div>
                            <Bar percent={percent} color={C.cyan} />
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <SectionTitle>Dernières ventes</SectionTitle>
                <div className={`${CARD} overflow-x-auto`}>
                  {data.sold.length === 0 ? (
                    <p className="text-xs text-slate-400">Aucune vente enregistrée.</p>
                  ) : (
                    <table className="w-full text-sm min-w-[560px]">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                          <th className="text-left py-2 pr-3 text-xs font-semibold text-slate-400">Référence</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Client</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Monture</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Montant</th>
                          <th className="text-right py-2 pl-3 text-xs font-semibold text-slate-400">Remise le</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.sold]
                          .sort((a, b) => soldDay(b).localeCompare(soldDay(a)))
                          .slice(0, 15)
                          .map(glass => (
                            <tr key={glass.barcode} className="border-b border-slate-50 dark:border-slate-700/60 last:border-0">
                              <td className="py-3 pr-3 font-medium text-slate-900 dark:text-white">{glassRef(glass)}</td>
                              <td className="py-3 px-3 text-slate-400 truncate max-w-[160px]">{clientOf(glass)}</td>
                              <td className="py-3 px-3 text-slate-400">{[glass.shape, glass.color].filter(Boolean).join(' · ') || '—'}</td>
                              <td className="py-3 px-3 font-bold tabular-nums" style={{ color: C.primary }}>{fmtFCFA(glass.price)}</td>
                              <td className="py-3 pl-3 text-right tabular-nums text-slate-400">{fmtDate(glass.sold_at || glass.updated_at)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── REMISE CLIENT ────────────────────────────────────────────── */}
            {activeTab === 'remise' && (
              <div className="space-y-3">
                <div className={CARD}>
                  <div className="flex items-center gap-2.5">
                    <Pastille color={C.cyan}>{ic.hand()}</Pastille>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">Remettre au client</p>
                      <p className="text-xs text-slate-400">Scannez le code-barres de la monture pour la pointer comme remise</p>
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="refRemise">
                      Code-barres ou référence
                    </label>
                    <input
                      id="refRemise"
                      type="text"
                      value={scanRemise}
                      onChange={e => {
                        const value = e.target.value
                        setScanRemise(value)
                        // La douchette envoie le code d'un bloc : on valide dès qu'il correspond,
                        // sans attendre un Entrée que tous les lecteurs n'émettent pas.
                        const found = data.pretes.find(g => g.barcode === value.trim() || glassRef(g) === value.trim().toUpperCase())
                        if (found && !scannedRemise.includes(found.barcode)) {
                          setScannedRemise([...scannedRemise, found.barcode])
                          setScanRemise('')
                        }
                      }}
                      placeholder="Scanner ou saisir…"
                      autoFocus
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {[
                      { label: 'À remettre', value: data.pretes.length, color: C.cyan },
                      { label: 'Pointées', value: scannedRemise.length, color: C.success },
                      { label: 'Reste', value: Math.max(0, data.pretes.length - scannedRemise.length), color: C.amber },
                    ].map(s => (
                      <div key={s.label} className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
                        <p className="text-xs text-slate-400">{s.label}</p>
                        <p className="mt-1 text-3xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4">
                    <Bar percent={data.pretes.length > 0 ? (scannedRemise.length / data.pretes.length) * 100 : 0} color={C.success} />
                  </div>

                  <div className="mt-3">
                    <Note tone="amber">
                      Le pointage reste sur ce poste : aucun mouvement n'est encore envoyé au serveur, la monture
                      garde son statut <strong>PRETE_A_LIVRER</strong>.
                    </Note>
                  </div>
                </div>

                <div className={`${CARD} p-0 overflow-hidden`}>
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      Montures prêtes <span className="tabular-nums text-slate-400">({scannedRemise.length}/{data.pretes.length})</span>
                    </p>
                  </div>
                  <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/60">
                    {loading && data.pretes.length === 0 ? (
                      <Empty>Chargement…</Empty>
                    ) : data.pretes.length === 0 ? (
                      <Empty>Aucune monture prête à remettre.</Empty>
                    ) : (
                      data.pretes.map(glass => {
                        const pointee = scannedRemise.includes(glass.barcode)
                        return (
                          <GlassRow
                            key={glass.barcode}
                            glass={glass}
                            client={clientOf(glass)}
                            meta={glass.barcode}
                            tinted={pointee}
                            badge={
                              <Badge tone={pointee ? 'green' : 'amber'}>
                                {pointee ? ic.check('w-3.5 h-3.5') : ic.clock('w-3.5 h-3.5')}
                                {pointee ? 'Pointée' : 'En attente'}
                              </Badge>
                            }
                          />
                        )
                      })
                    )}
                  </div>
                </div>

                {scannedRemise.length > 0 && (
                  <button
                    onClick={() => { setScannedRemise([]); setScanRemise('') }}
                    className="w-full rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    Réinitialiser le pointage
                  </button>
                )}
              </div>
            )}

            {/* ── MISE EN PRÉSENTOIR ───────────────────────────────────────── */}
            {activeTab === 'presentoir' && (
              <div className="space-y-3">
                <div className={CARD}>
                  <div className="flex items-center gap-2.5">
                    <Pastille color={C.primary}>{ic.scan()}</Pastille>
                    <div>
                      <p className="text-sm font-bold text-slate-900 dark:text-white">Sortie du stock local</p>
                      <p className="text-xs text-slate-400">Montures à placer en présentoir</p>
                    </div>
                  </div>
                  <div className="mt-4">
                    <input
                      type="text"
                      placeholder="Code-barres ou référence…"
                      value={scanPresentoir}
                      onChange={e => {
                        const value = e.target.value
                        setScanPresentoir(value)
                        const found = data.local.find(g => g.barcode === value.trim() || glassRef(g) === value.trim().toUpperCase())
                        if (found && !scannedPresentoir.includes(found.barcode)) {
                          setScannedPresentoir([...scannedPresentoir, found.barcode])
                          setScanPresentoir('')
                        }
                      }}
                      autoFocus
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="mt-4">
                    <Bar percent={data.local.length > 0 ? (scannedPresentoir.length / data.local.length) * 100 : 0} color={C.primary} />
                    <p className="mt-2 text-xs text-slate-400 tabular-nums">
                      {scannedPresentoir.length} / {data.local.length} pointée(s)
                    </p>
                  </div>
                  <div className="mt-3">
                    <Note tone="amber">
                      Le pointage reste sur ce poste : le passage en <strong>EN_PRESENTOIR</strong> n'est pas encore
                      envoyé au serveur.
                    </Note>
                  </div>
                </div>

                <div className={`${CARD} p-0 overflow-hidden`}>
                  <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                    <p className="text-sm font-bold text-slate-900 dark:text-white">
                      Stock local <span className="tabular-nums text-slate-400">({data.local.length})</span>
                    </p>
                  </div>
                  <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/60">
                    {loading && data.local.length === 0 ? (
                      <Empty>Chargement…</Empty>
                    ) : data.local.length === 0 ? (
                      <Empty>Le stock local est vide.</Empty>
                    ) : (
                      data.local.map(glass => {
                        const pointee = scannedPresentoir.includes(glass.barcode)
                        return (
                          <GlassRow
                            key={glass.barcode}
                            glass={glass}
                            client={[glass.brand, glass.shape, glass.color].filter(Boolean).join(' · ') || glass.barcode}
                            tinted={pointee}
                            badge={glass.location_code ? <Badge tone={pointee ? 'green' : 'cyan'}>{glass.location_code}</Badge> : undefined}
                          />
                        )
                      })
                    )}
                  </div>
                </div>

                {scannedPresentoir.length > 0 && (
                  <button
                    onClick={() => { setScannedPresentoir([]); setScanPresentoir('') }}
                    className="w-full rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    Réinitialiser le pointage
                  </button>
                )}
              </div>
            )}

            {/* ── STOCK ────────────────────────────────────────────────────── */}
            {activeTab === 'stock' && (
              <div>
                <div className="grid gap-3 lg:grid-cols-3">
                  <Repartition title="Formes" rows={metrics.formes} color={C.primary} total={metrics.stockTotal.length} />
                  <Repartition title="Matières" rows={metrics.matieres} color={C.cyan} total={metrics.stockTotal.length} />
                  <Repartition title="Genres" rows={metrics.genres} color={C.amber} total={metrics.stockTotal.length} />
                </div>

                {/* Références critiques */}
                <div className="mt-3">
                  <button
                    onClick={() => setSelectedDetail({
                      title: 'Références critiques',
                      subtitle: `${REFERENCE_CRITIQUE} montures ou moins en stock`,
                      icon: ic.alert,
                      color: C.amber,
                      stats: [
                        { label: 'Références critiques', value: metrics.critiques.length },
                        { label: 'Références suivies', value: metrics.references },
                      ],
                      details: metrics.critiques.map(([reference, count]) => ({
                        name: reference,
                        meta: 'À réapprovisionner',
                        badge: { text: `${count} en stock`, tone: 'amber' as Tone },
                      })),
                      description: `Même seuil que la vue Direction : une référence est critique à ${REFERENCE_CRITIQUE} montures ou moins, tous statuts confondus.`,
                    })}
                    className={CARD_LINK}
                  >
                    <div className="flex items-center gap-3">
                      <Pastille color={C.amber}>{ic.alert()}</Pastille>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">Références critiques</p>
                        <p className="text-xs text-slate-400">{REFERENCE_CRITIQUE} montures ou moins en stock — à réapprovisionner</p>
                      </div>
                      <p className="text-3xl font-black tabular-nums flex-shrink-0" style={{ color: C.amber }}>
                        {metrics.critiques.length}
                      </p>
                    </div>
                  </button>
                </div>

                {/* Réserve */}
                <SectionTitle>Réserve ({data.reserved.length})</SectionTitle>
                <div className={`${CARD} p-0 overflow-hidden`}>
                  <div className="max-h-[500px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/60">
                    {loading && data.reserved.length === 0 ? (
                      <Empty>Chargement…</Empty>
                    ) : data.reserved.length === 0 ? (
                      <Empty>Aucune monture en réserve.</Empty>
                    ) : (
                      [...data.reserved]
                        .sort((a, b) => daysSince(b.updated_at || b.created_at) - daysSince(a.updated_at || a.created_at))
                        .map(glass => {
                          const jours = daysSince(glass.updated_at || glass.created_at)
                          const urgence = jours >= RESERVE_LIMITE_JOURS - 1
                          return (
                            <div key={glass.barcode} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))_auto] sm:items-center">
                              <div className="min-w-0">
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
                                <p className="text-xs text-slate-400 truncate">{clientOf(glass)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Depuis le</p>
                                <p className="text-sm font-medium tabular-nums text-slate-900 dark:text-white">{fmtDate(glass.updated_at || glass.created_at)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-400">Ancienneté</p>
                                <p className="text-sm font-bold tabular-nums" style={{ color: urgence ? C.amber : C.muted }}>
                                  {jours} jour{jours > 1 ? 's' : ''}
                                </p>
                              </div>
                              <div className="sm:justify-self-end">
                                <Badge tone={jours >= RESERVE_LIMITE_JOURS ? 'red' : urgence ? 'amber' : 'slate'}>
                                  {jours >= RESERVE_LIMITE_JOURS ? 'Dépassée' : urgence ? 'Proche limite' : 'OK'}
                                </Badge>
                              </div>
                            </div>
                          )
                        })
                    )}
                  </div>
                </div>
                <div className="mt-3">
                  <Note>
                    Les paires restent en réserve <strong>maximum {RESERVE_LIMITE_JOURS} jours</strong>. L'ancienneté est
                    calculée depuis la dernière modification de la monture, le backend ne datant pas la mise en réserve.
                  </Note>
                </div>
              </div>
            )}
          </main>
        </div>

        {/* ── Navigation mobile ─────────────────────────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40">
          <div className="flex">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors ${activeTab === tab.id ? 'text-blue-600' : 'text-slate-400'}`}
              >
                {tab.icon('w-5 h-5')}
                <span className="text-[10px] font-semibold leading-none">{tab.short}</span>
              </button>
            ))}
          </div>
        </nav>

        {/* ── Modale de détail ──────────────────────────────────────────────── */}
        {selectedDetail && <DetailModal detail={selectedDetail} onClose={() => setSelectedDetail(null)} />}
      </div>
    </div>
  )
}

// ── Modale de détail ──────────────────────────────────────────────────────────

function DetailModal({ detail, onClose }: { detail: Detail; onClose: () => void }) {
  const color = detail.color || C.primary

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className={`w-full ${detail.table ? 'max-w-3xl' : 'max-w-lg'} max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xl`}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3.5 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-700">
          {detail.icon && <Pastille color={color}>{detail.icon()}</Pastille>}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{detail.title}</p>
            {detail.subtitle && <p className="text-xs text-slate-400 truncate">{detail.subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
            aria-label="Fermer"
          >
            {ic.x('w-5 h-5')}
          </button>
        </div>

        <div className="p-4 space-y-3">
          {detail.stats && detail.stats.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {detail.stats.map(stat => (
                <div key={stat.label} className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
                  <p className="text-xs text-slate-400">{stat.label}</p>
                  <p className="mt-1 text-lg font-black tabular-nums" style={{ color }}>{stat.value}</p>
                </div>
              ))}
            </div>
          )}

          {detail.table && (
            <div className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
              <div className="px-3 py-2.5 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-100 dark:border-slate-700">
                <p className="text-xs font-bold text-slate-900 dark:text-white">{detail.table.title}</p>
                {detail.table.note && <p className="mt-0.5 text-xs text-slate-400">{detail.table.note}</p>}
              </div>
              <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/60">
                {detail.table.rows.length === 0 ? (
                  <Empty>Aucune ligne.</Empty>
                ) : (
                  detail.table.rows.map(row => (
                    <div key={row.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{row.title}</p>
                        <p className="text-xs text-slate-400 truncate">{row.subtitle}</p>
                      </div>
                      {row.cells.map(cell => (
                        <div key={cell.label} className="min-w-0">
                          <p className="text-xs text-slate-400">{cell.label}</p>
                          <p
                            className={`text-sm font-medium tabular-nums truncate ${cell.color ? '' : 'text-slate-900 dark:text-white'}`}
                            style={cell.color ? { color: cell.color } : undefined}
                          >
                            {cell.value}
                          </p>
                        </div>
                      ))}
                      <div className="sm:justify-self-end">{row.badge}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {detail.details && detail.details.length > 0 && (
            <div className="rounded-xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-50 dark:divide-slate-700/60 max-h-[400px] overflow-y-auto">
              {detail.details.map(item => (
                <div key={item.name} className="flex items-center justify-between gap-3 px-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{item.name}</p>
                    <p className="text-xs text-slate-400 truncate">{item.meta}</p>
                  </div>
                  <Badge tone={item.badge?.tone}>{item.badge?.text}</Badge>
                </div>
              ))}
            </div>
          )}

          {detail.description && <Note>{detail.description}</Note>}
        </div>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ResponsableMagasinPage />
  </React.StrictMode>,
)
