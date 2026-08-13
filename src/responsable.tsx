import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'
import type { ReactElement, ReactNode } from 'react'
import { GlassTable, fmtPrix } from './GlassTable'

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
  photo_monture_url?: string
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
  // « XAF » et non un signe dollar : la monnaie du magasin est le franc CFA, et un $ sur un
  // tableau de bord congolais se lit comme une devise étrangère. En texte plutôt qu'en
  // tracé — le franc CFA n'a pas de symbole normalisé, son code ISO est ce qui le désigne.
  cash: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" fill="currentColor" stroke="none"><text x="12" y="16" textAnchor="middle" fontSize="10" fontWeight="700" letterSpacing="-0.6">XAF</text></svg>,
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
  // Carton aux rabats ouverts : le colis qui arrive, distinct du cube plein de « Stock ».
  carton: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 9.5V19a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9.5"/><path d="M2.5 6.5 5 3.5h14l2.5 3-2 3H4.5z"/><path d="M9.5 13h5"/></svg>,
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
type TabId = 'tableau' | 'ventes' | 'cartons' | 'presentoir' | 'stock'

// Les libellés sont ceux de la maquette. Les identifiants, eux, disent ce que l'onglet fait
// côté métier — « presentoir » expédie au Présentoir — et servent au code qui envoie les
// transferts : les renommer brouillerait la lecture.
//
// « Remise client » a été déplacé au poste Vendeuse : c'est elle qui accueille le client
// venu chercher ses lunettes, ce poste-ci ne le voit jamais.
const TABS: { id: TabId; label: string; short: string; icon: IconFn }[] = [
  { id: 'tableau', label: 'Tableau de bord', short: 'Bord', icon: ic.home },
  { id: 'ventes', label: 'Ventes', short: 'Ventes', icon: ic.chart },
  { id: 'cartons', label: 'Cartons reçus', short: 'Cartons', icon: ic.carton },
  { id: 'presentoir', label: 'Scanner', short: 'Scanner', icon: ic.scan },
  { id: 'stock', label: 'Stock', short: 'Stock', icon: ic.pkg },
]

// ── Cartons reçus ─────────────────────────────────────────────────────────────
/** Un colis parti du stock général vers ce magasin.
 *
 *  `item_count` est ce que le carton annonce, figé au départ. Ce qui est réellement arrivé se
 *  lit dans le transfert qu'il transporte, jamais dans le navigateur : deux postes peuvent
 *  pointer le même carton, et une reprise après rechargement doit retrouver l'avancement réel. */
interface SendBox {
  id: number
  code: string
  reference: string
  city: string
  session_code?: string
  item_count: number
  status: string
  transfer_id?: number
  missing_count?: number
  created_at?: string
}

interface SendBoxItem {
  id: number
  glass_id?: number
  barcode?: string
  reference?: string
  /** D'où la monture est partie : une case du stock général, sans usage ici. */
  location_code?: string
  /** Où la ranger dans CE magasin, attribué au pointage. Nul tant qu'elle est en transit. */
  stock_location_code?: string
  /** Repris de la fiche monture : on reconnaît une monture en main à sa photo et à sa
   *  marque avant son code-barres. */
  photo_monture_url?: string
  price?: number | string
  brand?: string
  shape?: string
  color?: string
  gender?: string
  /** Date d'enregistrement de la monture, distincte de celle de la ligne de carton. */
  glass_created_at?: string
  /** Cette monture est entrée en stock. Vient du serveur, pas du pointage local. */
  received: boolean
}

/** Au-delà, la paire retourne au stock local (règle métier du magasin). */
const RESERVE_LIMITE_JOURS = 10
/** Même seuil que le is_critical de ../Frontend/admin.js:626. */
const REFERENCE_CRITIQUE = 2

// Les actions du journal de mouvements (table ACTION_LABELS de ../Frontend/historique.js:10).
//
// REMISE_CLIENT et non LIVRAISON : cette dernière est écrite par le LABORATOIRE quand il
// termine un montage (delivery_service.go CreateDelivery). Compter dessus faisait passer
// des fins de montage pour des sorties de magasin — le libellé « Remises aujourd'hui »
// annonçait des paires encore en rayon, que personne n'était venu chercher.
const ACTION_REMISE = 'REMISE_CLIENT'

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

/** Liste de montures, même gabarit partout : réf, client, une méta, un badge.
 *  `code` remplace la pastille par le CODE128 de la monture, pour les listes qu'on pointe
 *  à la douchette : l'opérateur voit ce qu'il vise. */
function GlassRow({ glass, client, meta, badge, tinted, code }: {
  glass: Glass; client: string; meta?: string; badge?: ReactNode; tinted?: boolean; code?: boolean
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3 transition-colors ${tinted ? 'bg-green-50/60 dark:bg-green-500/5' : ''}`}>
      {code && glass.barcode ? (
        <div className={`w-16 h-11 rounded-xl bg-white p-1 flex-shrink-0 border-2 ${tinted ? 'border-green-500' : 'border-amber-400'}`}>
          <Code128 value={glass.barcode} height={26} showValue={false} />
        </div>
      ) : (
        <Pastille color={tinted ? C.success : C.primary}>{tinted ? ic.check() : ic.glasses()}</Pastille>
      )}
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

  // Le pointage du présentoir reste local jusqu'à l'envoi, qui se conclut par un vrai
  // transfert (envoyerAuPresentoir).
  const [scannedPresentoir, setScannedPresentoir] = useState<string[]>([])
  const [scanPresentoir, setScanPresentoir] = useState('')
  // La liste à prendre s'affiche avant le premier scan : le responsable part au meuble en
  // sachant ce qu'il vient chercher, plutôt que de découvrir chaque monture au douchage.
  const [presentoirDemarre, setPresentoirDemarre] = useState(false)

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

  // Le Présentoir est un poste à part entière en base, pas une zone du magasin : c'est
  // vers lui que part le transfert. Son id ne se devine pas — presentoir.js:135 le
  // retrouve par son nom exact dans /auth/stations, on fait pareil.
  const [presentoirStationId, setPresentoirStationId] = useState<number | null>(null)
  useEffect(() => {
    if (!ready) return
    void (async () => {
      try {
        const payload = await apiFetch('/auth/stations')
        const stations: any[] = payload?.data?.stations || []
        const presentoir = stations.find(s => String(s.name || '').trim().toLowerCase() === 'présentoir')
        setPresentoirStationId(presentoir ? Number(presentoir.id) : null)
      } catch {
        // Sans la liste, l'envoi se refuse de lui-même avec un message explicite. Inutile
        // de bloquer le reste de l'écran, qui ne dépend pas de cette station.
        setPresentoirStationId(null)
      }
    })()
  }, [ready])

  // ── Cartons reçus ───────────────────────────────────────────────────────────
  // Les montures d'un carton voyagent EN_TRANSIT : elles n'entrent au stock du magasin qu'au
  // scan de leur code-barres ici. Rien n'est donc pointé localement — chaque scan part au
  // serveur, et c'est sa réponse qui fait foi.
  const [cartonsAttendus, setCartonsAttendus] = useState<SendBox[]>([])
  const [cartonsLoading, setCartonsLoading] = useState(false)
  const [cartonsErreur, setCartonsErreur] = useState('')
  const [carton, setCarton] = useState<SendBox | null>(null)
  const [cartonItems, setCartonItems] = useState<SendBoxItem[]>([])
  const [scanCarton, setScanCarton] = useState('')
  const [scanMonture, setScanMonture] = useState('')
  const [cartonBusy, setCartonBusy] = useState(false)
  const [cartonMessage, setCartonMessage] = useState('')
  const [cartonTone, setCartonTone] = useState<Tone>('blue')
  const [cartonManquantes, setCartonManquantes] = useState<SendBoxItem[]>([])
  const montureRef = useRef<HTMLInputElement>(null)
  /** Un carton ne s'ouvre que par le scan de son étiquette : la liste des colis attendus
   *  n'ouvre donc rien, elle renvoie la douchette vers ce champ. */
  const cartonRef = useRef<HTMLInputElement>(null)

  const chargerCartons = useCallback(async () => {
    if (!stationId) return
    setCartonsLoading(true)
    setCartonsErreur('')
    try {
      const payload = await apiFetch(`/inventory/send-boxes/pending?station_id=${stationId}`)
      setCartonsAttendus(payload?.data?.boxes || [])
    } catch (err) {
      // Un échec ne doit pas se déguiser en « aucun colis » : les deux mènent à une liste
      // vide, mais l'un demande d'attendre le camion et l'autre d'appeler l'administrateur.
      // Le scan direct du code-barres reste possible dans les deux cas.
      setCartonsAttendus([])
      setCartonsErreur(err instanceof Error ? err.message : 'Liste des colis indisponible.')
    } finally {
      setCartonsLoading(false)
    }
  }, [stationId])

  useEffect(() => { void chargerCartons() }, [chargerCartons])

  /** Ouvre — ou reprend — le pointage d'un carton. Le serveur renvoie le contenu annoncé et
   *  ce qui est déjà entré en stock : rouvrir après un rechargement ne fait rien perdre. */
  async function ouvrirCarton(code: string) {
    const propre = String(code || '').trim()
    if (!propre || cartonBusy || !stationId) return

    setCartonBusy(true)
    try {
      const payload = await apiFetch('/inventory/send-boxes/open', {
        method: 'POST',
        body: JSON.stringify({ code: propre, station_id: stationId }),
      })
      const ouvert: SendBox = payload?.data?.box
      const items: SendBoxItem[] = payload?.data?.items || []
      setCarton(ouvert)
      setCartonItems(items)
      setCartonManquantes([])
      setScanCarton('')
      setScanMonture('')
      const restant = items.filter(item => !item.received).length
      setCartonMessage(restant === 0
        ? 'Toutes les montures de ce carton sont déjà reçues : vous pouvez le clôturer.'
        : `Carton ouvert : ${restant} monture${restant > 1 ? 's' : ''} à scanner.`)
      setCartonTone(restant === 0 ? 'green' : 'blue')
      window.setTimeout(() => montureRef.current?.focus(), 0)
    } catch (err) {
      setCartonMessage(err instanceof Error ? err.message : "Impossible d'ouvrir ce carton.")
      setCartonTone('red')
    } finally {
      setCartonBusy(false)
    }
  }

  /** Un scan = une monture qui entre réellement au stock. L'état local n'est pas deviné : on
   *  reprend la ligne renvoyée par le serveur, seule à savoir si le transfert s'est clos. */
  async function recevoirMonture(barcode: string) {
    const propre = String(barcode || '').trim()
    if (!propre || cartonBusy || !carton || !stationId) return

    setCartonBusy(true)
    try {
      const payload = await apiFetch('/inventory/send-boxes/receive', {
        method: 'POST',
        body: JSON.stringify({ code: carton.code, barcode: propre, station_id: stationId }),
      })
      // L'emplacement attribué est le seul renseignement qui compte à cet instant : le
      // magasinier a la monture en main et cherche où la poser.
      const emplacement: string = payload?.data?.location?.code || ''
      const cible = propre.toLowerCase()
      setCartonItems(items => items.map(item =>
        String(item.barcode || '').toLowerCase() === cible || String(item.reference || '').toLowerCase() === cible
          ? { ...item, received: true, stock_location_code: emplacement || item.stock_location_code }
          : item))
      setCartonMessage(emplacement
        ? `« ${propre} » reçue — à ranger en ${emplacement}`
        : `« ${propre} » reçue et rangée en stock.`)
      setCartonTone('green')
      setScanMonture('')
      // Le stock local vient de changer : les compteurs des autres onglets sont périmés.
      void reload()
    } catch (err) {
      setCartonMessage(err instanceof Error ? err.message : 'Monture refusée.')
      setCartonTone('red')
      montureRef.current?.select()
    } finally {
      setCartonBusy(false)
    }
  }

  /** Clôt le pointage, même incomplet : un carton arrive parfois amputé, et le laisser ouvert
   *  indéfiniment n'y changerait rien. Les manquantes restent EN_TRANSIT — hors du stock. */
  async function cloturerCarton() {
    if (!carton || cartonBusy || !stationId) return

    const manquantes = cartonItems.filter(item => !item.received).length
    if (manquantes > 0 && !window.confirm(
      `${manquantes} monture(s) n'ont pas été scannées.\n\n`
      + "Elles resteront en transit et n'entreront pas dans votre stock. Clôturer quand même ?",
    )) return

    setCartonBusy(true)
    try {
      const payload = await apiFetch('/inventory/send-boxes/close', {
        method: 'POST',
        body: JSON.stringify({ code: carton.code, station_id: stationId }),
      })
      const absentes: SendBoxItem[] = payload?.data?.missing || []
      setCartonManquantes(absentes)
      setCarton(null)
      setCartonItems([])
      setCartonMessage(absentes.length === 0
        ? `Carton ${carton.code} clôturé : tout le contenu est en stock.`
        : `Carton ${carton.code} clôturé avec ${absentes.length} manquante${absentes.length > 1 ? 's' : ''}.`)
      setCartonTone(absentes.length === 0 ? 'green' : 'amber')
      void chargerCartons()
      void reload()
    } catch (err) {
      setCartonMessage(err instanceof Error ? err.message : 'Clôture impossible.')
      setCartonTone('red')
    } finally {
      setCartonBusy(false)
    }
  }

  const cartonRecues = cartonItems.filter(item => item.received).length

  const [envoiBusy, setEnvoiBusy] = useState(false)
  const [envoiMessage, setEnvoiMessage] = useState('')
  const [envoiErreur, setEnvoiErreur] = useState(false)

  /** Sort du stock local les montures pointées et les expédie au poste Présentoir.
   *
   *  Trois appels, comme confirmTransferToStation() de presentoir.js:1478 : créer le
   *  transfert, y ajouter chaque monture, puis l'expédier. C'est le seul chemin vers
   *  EN_PRESENTOIR depuis un magasin — une simple recherche de code-barres n'y suffit
   *  pas (display_service.go PlaceOnDisplay), et sans ce passage la vendeuse ne voit
   *  rien à vendre et la proforma ne peut pas pousser les montures en caisse.
   *
   *  Rien d'atomique : une monture refusée ne retient pas les autres, elle est nommée
   *  dans le compte rendu. */
  async function envoyerAuPresentoir() {
    if (envoiBusy || scannedPresentoir.length === 0) return
    if (!stationId) {
      setEnvoiMessage("Aucune station rattachée à ce compte : impossible d'expédier.")
      setEnvoiErreur(true)
      return
    }
    if (!presentoirStationId) {
      setEnvoiMessage('Station « Présentoir » introuvable en base : le transfert ne peut pas être adressé.')
      setEnvoiErreur(true)
      return
    }

    setEnvoiBusy(true)
    setEnvoiMessage('')
    setEnvoiErreur(false)
    const pointees = [...scannedPresentoir]
    try {
      const creation = await apiFetch('/inventory/transfers', {
        method: 'POST',
        body: JSON.stringify({ from_station_id: stationId, to_station_id: presentoirStationId }),
      })
      const transferId = creation?.data?.id
      if (!transferId) throw new Error("Le serveur n'a pas renvoyé de transfert.")

      const refuses: string[] = []
      for (const barcode of pointees) {
        try {
          await apiFetch(`/inventory/transfers/${transferId}/items`, {
            method: 'POST',
            body: JSON.stringify({ barcode }),
          })
        } catch {
          const glass = data.local.find(g => g.barcode === barcode)
          refuses.push(glass ? glassRef(glass) : barcode)
        }
      }
      // Expédier un transfert vide laisserait une coquille en base sans rien déplacer.
      if (refuses.length === pointees.length) {
        throw new Error(`Aucune monture n'a pu être ajoutée au transfert (${refuses.join(', ')}).`)
      }

      await apiFetch(`/inventory/transfers/${transferId}/dispatch`, { method: 'POST' })

      const envoyees = pointees.length - refuses.length
      // « expédiée », pas « envoyée » : le transfert s'arrête au départ. Les montures sont
      // EN_TRANSIT, hors du stock local et pas encore au présentoir — il reste un scan à
      // faire là-bas pour qu'elles y apparaissent. Annoncer une arrivée ferait chercher au
      // présentoir des montures que personne n'y a encore reçues.
      setEnvoiMessage(
        `${envoyees} monture${envoyees > 1 ? 's' : ''} expédiée${envoyees > 1 ? 's' : ''} au présentoir.`
        + ` À scanner là-bas pour finaliser l'arrivée.`
        + (refuses.length ? ` Non expédiées : ${refuses.join(', ')}.` : ''),
      )
      setEnvoiErreur(refuses.length > 0)
      setScannedPresentoir([])
      setScanPresentoir('')
      setPresentoirDemarre(false)
      await reload()
    } catch (error: any) {
      setEnvoiMessage(error?.message || "Échec de l'envoi au présentoir.")
      setEnvoiErreur(true)
    } finally {
      setEnvoiBusy(false)
    }
  }

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
      String(m.action || '').toUpperCase() === ACTION_REMISE && dayKey(m.created_at) === today)
    const livreesBarcodes = new Set(
      data.movements
        .filter(m => String(m.action || '').toUpperCase() === ACTION_REMISE)
        .map(m => String(m.barcode || '').trim().toUpperCase()),
    )

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

  // Où en est une monture déjà encaissée : payer n'est pas retirer, elle passe par le
  // laboratoire avant de revenir. C'est ce que la colonne Statut des ventes donne à lire.
  const laboBarcodes = useMemo(() => new Set(data.labo.map(g => String(g.barcode || '').toUpperCase())), [data.labo])
  const pretesBarcodes = useMemo(() => new Set(data.pretes.map(g => String(g.barcode || '').toUpperCase())), [data.pretes])

  const statutVente = (glass: Glass): { text: string; tone: Tone } => {
    const key = String(glass.barcode || '').toUpperCase()
    if (metrics.livreesBarcodes.has(key)) return { text: 'Remise', tone: 'green' }
    if (pretesBarcodes.has(key)) return { text: 'Prête', tone: 'cyan' }
    if (laboBarcodes.has(key)) return { text: 'Au labo', tone: 'violet' }
    return { text: 'Payée', tone: 'blue' }
  }

  /** Une ligne de fiche détail qui met deux périodes face à face. */
  const comparaison = (label: string, current: number, previous: number): DetailLine => {
    // Sans point de comparaison, un « +100 % » ne voudrait rien dire.
    if (!previous) return { name: label, meta: 'Aucun point de comparaison', badge: { text: '—', tone: 'slate' } }
    const pct = (((current - previous) / previous) * 100).toFixed(1)
    const sens = current > previous ? 'Hausse' : current < previous ? 'Baisse' : 'Stable'
    return {
      name: label,
      meta: `${sens} — ${fmtFCFA(previous)} sur la période précédente`,
      badge: { text: `${pct}%`, tone: current > previous ? 'green' : current < previous ? 'red' : 'slate' },
    }
  }

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
          note: "Soldée : la Caisse a tranché toutes les lignes, en vente ou en retour au présentoir.",
          rows: metrics.proformasToday.map(proforma => ({
            id: String(proforma.id),
            title: proforma.code || `Proforma ${proforma.id}`,
            subtitle: proforma.client_name || 'Client non renseigné',
            cells: [
              { label: 'Montures', value: (proforma.items || []).length },
              { label: 'Total', value: fmtFCFA(proforma.total_amount) },
            ],
            badge: <Badge tone={metrics.soldeesToday.includes(proforma) ? 'green' : 'amber'}>
              {metrics.soldeesToday.includes(proforma) ? 'Soldée' : 'En attente'}
            </Badge>,
          })),
        },
      },
    },
    {
      label: 'Proformas soldés',
      value: metrics.soldeesToday.length,
      color: C.danger,
      icon: ic.check,
      desc: fmtFCFA(metrics.montantSoldeesToday),
      detail: {
        icon: ic.check,
        description: "Proformas du jour dont la Caisse a tranché toutes les lignes, en vente ou en retour au présentoir.",
        table: {
          title: 'Proformas soldées aujourd’hui',
          rows: metrics.soldeesToday.map(proforma => ({
            id: String(proforma.id),
            title: proforma.code || `Proforma ${proforma.id}`,
            subtitle: proforma.client_name || 'Client non renseigné',
            cells: [
              { label: 'Montures', value: (proforma.items || []).length },
              { label: 'Total', value: fmtFCFA(proforma.total_amount) },
            ],
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
          rows: data.reserved.map((glass, index) => {
            const jours = daysSince(glass.updated_at || glass.created_at)
            return {
              id: glass.barcode || `${glassRef(glass)}-${index}`,
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
          rows: metrics.reserveProche.map((glass, index) => {
            const jours = daysSince(glass.updated_at || glass.created_at)
            return {
              id: glass.barcode || `${glassRef(glass)}-${index}`,
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

  // Les quatre répartitions, définies une fois : le tableau de bord et l'onglet Stock
  // affichent les mêmes cartes, elles ne doivent pas pouvoir diverger.
  const repartitions: {
    key: string; title: string; subtitle: string; icon: IconFn; tone: Tone
    rows: { label: string; count: number }[]; color: string; total: number
    empty?: string; description: string
  }[] = [
    {
      key: 'formes', title: 'Formes', subtitle: 'Distribution des modèles', icon: ic.glasses, tone: 'blue',
      rows: metrics.formes, color: C.primary, total: metrics.stockTotal.length,
      description: 'Répartition des formes sur tout ce que le magasin détient, présentoir, réserve, laboratoire et stock local confondus.',
    },
    {
      key: 'matieres', title: 'Matières', subtitle: 'Composition des montures', icon: ic.pkg, tone: 'cyan',
      rows: metrics.matieres, color: C.cyan, total: metrics.stockTotal.length,
      description: 'La matière est saisie à la main à l’enregistrement : les variantes d’orthographe sont regroupées, mais une monture sans matière renseignée ne compte nulle part.',
    },
    {
      key: 'genres', title: 'Genres', subtitle: 'Catégories clients', icon: ic.users, tone: 'amber',
      rows: metrics.genres, color: C.amber, total: metrics.stockTotal.length,
      description: 'Répartition homme / femme / unisexe du stock détenu par le magasin.',
    },
    {
      key: 'ventes', title: 'Ventes par monture', subtitle: 'Formes les plus vendues', icon: ic.chart, tone: 'green',
      rows: metrics.ventesParForme, color: C.success, total: data.sold.length,
      empty: 'Aucune vente enregistrée.',
      description: 'Les formes qui se vendent, à rapprocher de la carte Formes : un modèle très stocké et peu vendu immobilise de la trésorerie.',
    },
  ]

  const ouvrirRepartition = (carte: typeof repartitions[number]) => setSelectedDetail({
    title: carte.title,
    subtitle: carte.subtitle,
    icon: carte.icon,
    color: carte.color,
    stats: [
      { label: 'Valeurs distinctes', value: carte.rows.length },
      { label: 'Montures comptées', value: carte.total },
    ],
    details: carte.rows.map(row => ({
      name: row.label,
      meta: `${carte.total > 0 ? Math.round((row.count / carte.total) * 100) : 0} % du total`,
      badge: { text: `${row.count} monture${row.count > 1 ? 's' : ''}`, tone: carte.tone },
    })),
    description: carte.description,
  })

  const grilleRepartitions = (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {repartitions.map(carte => (
        <Repartition
          key={carte.key}
          title={carte.title}
          subtitle={carte.subtitle}
          icon={carte.icon}
          rows={carte.rows}
          color={carte.color}
          total={carte.total}
          empty={carte.empty}
          onClick={() => ouvrirRepartition(carte)}
        />
      ))}
    </div>
  )

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
                <button
                  onClick={() => setSelectedDetail({
                    title: "Chiffre d'affaires",
                    subtitle: `Analyse complète du ${new Date().toLocaleDateString('fr-FR')}`,
                    icon: ic.cash,
                    color: C.primary,
                    stats: [
                      { label: "Aujourd'hui", value: fmtFCFA(metrics.caToday) },
                      { label: 'Hier', value: fmtFCFA(metrics.caYesterday) },
                      { label: 'Ce mois-ci', value: fmtFCFA(metrics.caMonth) },
                      { label: 'Cette année', value: fmtFCFA(metrics.caYear) },
                    ],
                    details: [
                      comparaison('Aujourd’hui vs hier', metrics.caToday, metrics.caYesterday),
                      comparaison('Ce mois-ci vs mois dernier', metrics.caMonth, metrics.caLastMonth),
                      comparaison('Cette année vs an dernier', metrics.caYear, metrics.caLastYear),
                      comparaison('Sept derniers jours vs semaine précédente', metrics.caWeek, metrics.caPrevWeek),
                    ],
                    description: "Le chiffre d'affaires compte les montures encaissées par la Caisse, pas celles remises au client : les deux dates diffèrent dès que le laboratoire intervient.",
                  })}
                  className={CARD_LINK}
                >
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
                        {metrics.soldToday.length} monture{metrics.soldToday.length > 1 ? 's' : ''} encaissée{metrics.soldToday.length > 1 ? 's' : ''}
                      </p>
                    </div>
                    {[
                      // La colonne « Hier » compare aujourd'hui à hier, pas hier à avant-hier :
                      // c'est la lecture attendue face au grand chiffre du jour.
                      { label: 'Hier', value: metrics.caYesterday, current: metrics.caToday, previous: metrics.caYesterday, trend: 'vs hier' },
                      { label: 'Ce mois-ci', value: metrics.caMonth, current: metrics.caMonth, previous: metrics.caLastMonth, trend: 'vs mois dernier' },
                      { label: 'Cette année', value: metrics.caYear, current: metrics.caYear, previous: metrics.caLastYear, trend: 'vs an dernier' },
                    ].map(col => (
                      <div key={col.label} className="md:border-l md:border-slate-100 dark:md:border-slate-700 md:pl-5">
                        <p className="text-xs text-slate-400">{col.label}</p>
                        <p className="mt-1 text-sm font-bold tabular-nums text-slate-900 dark:text-white">{fmt(col.value)} FCFA</p>
                        <Trend current={col.current} previous={col.previous} label={col.trend} />
                      </div>
                    ))}
                  </div>
                </button>

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
                {grilleRepartitions}
              </div>
            )}

            {/* ── VENTES ───────────────────────────────────────────────────── */}
            {activeTab === 'ventes' && (
              <div>
                <SectionTitle>Sept derniers jours</SectionTitle>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: 'Chiffre d’affaires', value: fmt(metrics.caWeek), unit: 'FCFA',
                      color: C.primary, icon: ic.cash,
                      current: metrics.caWeek, previous: metrics.caPrevWeek,
                      detail: {
                        subtitle: 'Chiffre d’affaires sur sept jours',
                        stats: [
                          { label: 'Sept derniers jours', value: fmtFCFA(metrics.caWeek) },
                          { label: 'Semaine précédente', value: fmtFCFA(metrics.caPrevWeek) },
                        ],
                        details: [
                          comparaison('Semaine sur semaine', metrics.caWeek, metrics.caPrevWeek),
                          { name: 'Montures encaissées', meta: 'Sur les sept jours', badge: { text: String(metrics.soldWeek.length), tone: 'blue' as Tone } },
                          { name: 'Dont aujourd’hui', meta: 'Part du jour', badge: { text: fmtFCFA(metrics.caToday), tone: 'green' as Tone } },
                        ],
                        description: 'La semaine précédente s’arrête là où celle-ci commence : les deux périodes ne se chevauchent pas.',
                      },
                    },
                    {
                      label: 'Ticket moyen', value: fmt(metrics.ticketMoyen), unit: 'FCFA',
                      color: C.success, icon: ic.doc,
                      current: metrics.ticketMoyen, previous: metrics.ticketMoyenPrev,
                      detail: {
                        subtitle: 'Montant moyen par monture encaissée',
                        stats: [
                          { label: 'Sept derniers jours', value: fmtFCFA(metrics.ticketMoyen) },
                          { label: 'Semaine précédente', value: fmtFCFA(metrics.ticketMoyenPrev) },
                        ],
                        details: [
                          comparaison('Semaine sur semaine', metrics.ticketMoyen, metrics.ticketMoyenPrev),
                          { name: 'Montures encaissées', meta: 'Diviseur du calcul', badge: { text: String(metrics.soldWeek.length), tone: 'blue' as Tone } },
                        ],
                        description: 'Moyenne par monture, pas par client : une proforma qui porte deux paires compte deux fois. Les verres et le montage voyagent dans la note de la proforma, ils n’entrent pas dans ce calcul.',
                      },
                    },
                    {
                      label: 'Montures encaissées', value: String(metrics.soldWeek.length), unit: '',
                      color: C.amber, icon: ic.cart,
                      current: metrics.soldWeek.length, previous: metrics.soldPrevWeek.length,
                      detail: {
                        subtitle: 'Volume des sept derniers jours',
                        stats: [
                          { label: 'Sept derniers jours', value: metrics.soldWeek.length },
                          { label: 'Semaine précédente', value: metrics.soldPrevWeek.length },
                        ],
                        details: [
                          comparaison('Semaine sur semaine', metrics.soldWeek.length, metrics.soldPrevWeek.length),
                          { name: 'Encaissées aujourd’hui', meta: 'Part du jour', badge: { text: String(metrics.payeesToday.length), tone: 'blue' as Tone } },
                          { name: 'Remises aujourd’hui', meta: 'Sorties du magasin', badge: { text: String(metrics.livreesToday.length), tone: 'green' as Tone } },
                        ],
                        description: 'Le compte porte sur l’encaissement. Une monture encaissée cette semaine peut n’être remise au client que la semaine suivante, une fois le laboratoire passé.',
                      },
                    },
                  ].map(tile => (
                    <button
                      key={tile.label}
                      onClick={() => setSelectedDetail({
                        ...tile.detail,
                        title: tile.label,
                        icon: tile.icon,
                        color: tile.color,
                      })}
                      className={CARD_LINK}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-400">{tile.label}</p>
                          <p className="mt-2 text-3xl font-black tabular-nums" style={{ color: tile.color }}>
                            {tile.value}{tile.unit && <span className="text-lg"> {tile.unit}</span>}
                          </p>
                          <Trend current={tile.current} previous={tile.previous} label="vs semaine précédente" />
                        </div>
                        <Pastille color={tile.color}>{tile.icon()}</Pastille>
                      </div>
                    </button>
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
                    <table className="w-full text-sm min-w-[780px]">
                      <thead>
                        <tr className="border-b border-slate-100 dark:border-slate-700">
                          {/* La photo ouvre la ligne : on reconnaît une monture à son image
                              bien avant sa référence, et c'est la première question posée
                              devant un client — « laquelle a-t-il prise ? ». */}
                          <th className="text-left py-2 pr-3 text-xs font-semibold text-slate-400">Monture</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Référence</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Client</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Montant</th>
                          <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Statut</th>
                          <th className="text-right py-2 pl-3 text-xs font-semibold text-slate-400">Encaissée le</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...data.sold]
                          .sort((a, b) => soldDay(b).localeCompare(soldDay(a)))
                          .slice(0, 15)
                          .map(glass => {
                            const statut = statutVente(glass)
                            const attributs = [glass.shape, glass.color].filter(Boolean).join(' · ')
                            return (
                              <tr key={glass.barcode} className="border-b border-slate-50 dark:border-slate-700/60 last:border-0">
                                <td className="py-3 pr-3">
                                  <div className="h-9 w-11 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-700 flex-shrink-0">
                                    {glass.photo_monture_url
                                      ? <img src={glass.photo_monture_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                                      : <span className="flex h-full w-full items-center justify-center text-slate-300 dark:text-slate-600">{ic.glasses('w-4 h-4')}</span>}
                                  </div>
                                </td>
                                <td className="py-3 px-3">
                                  <p className="font-medium text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
                                  {/* Forme et couleur passent sous la référence : la colonne
                                      qu'elles occupaient revient à l'emplacement, et la photo
                                      les montre déjà. */}
                                  {attributs && <p className="text-xs text-slate-400 truncate">{attributs}</p>}
                                </td>
                                <td className="py-3 px-3 text-slate-400 truncate max-w-[160px]">{clientOf(glass)}</td>
                                <td className="py-3 px-3 font-bold tabular-nums" style={{ color: C.primary }}>{fmtFCFA(glass.price)}</td>
                                <td className="py-3 px-3"><Badge tone={statut.tone}>{statut.text}</Badge></td>
                                <td className="py-3 pl-3 text-right tabular-nums text-slate-400">{fmtDate(glass.sold_at || glass.updated_at)}</td>
                              </tr>
                            )
                          })}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── CARTONS REÇUS ────────────────────────────────────────────── */}
            {activeTab === 'cartons' && (
              <div className="space-y-3">
                {!stationId && (
                  <Note tone="red">
                    <strong>Aucune station rattachée à ce compte.</strong> Le serveur déduit de votre
                    station la ville des cartons qui vous sont destinés : sans elle, aucun colis ne
                    peut être ni listé ni ouvert. Demandez le rattachement à l'administrateur.
                  </Note>
                )}

                {cartonMessage && (
                  <Note tone={cartonTone}>{cartonMessage}</Note>
                )}

                {/* Les manquantes ne survivent qu'à l'écran, le temps d'être notées pour le
                    transporteur : une fois le carton clos, plus rien ne les rappellera ici. */}
                {cartonManquantes.length > 0 && (
                  <div className={`${CARD} p-0 overflow-hidden`}>
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        Montures manquantes <span className="tabular-nums text-slate-400">({cartonManquantes.length})</span>
                      </p>
                      <button
                        onClick={() => setCartonManquantes([])}
                        className="text-xs font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      >
                        Masquer
                      </button>
                    </div>
                    <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
                      {cartonManquantes.map(item => (
                        <div key={item.id} className="px-4 py-2.5 flex items-center gap-3">
                          <Pastille color={C.amber}>{ic.alert('w-4 h-4')}</Pastille>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                              {item.reference || item.barcode || '—'}
                            </p>
                            <p className="text-xs text-slate-400 truncate">{item.barcode || '—'} · restée en transit</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Aucun carton ouvert : on liste ce qui est attendu, on scanne pour ouvrir */}
                {!carton && (
                  <>
                    <div className={CARD}>
                      <div className="flex items-center gap-2.5">
                        <Pastille color={C.violet}>{ic.carton()}</Pastille>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900 dark:text-white">Ouvrir un carton</p>
                          <p className="text-xs text-slate-400">
                            Scannez l'étiquette collée sur le colis pour démarrer — ou reprendre — son pointage
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="refCarton">
                            Code du carton
                          </label>
                          {/* Un bouton explicite en plus de l'Entrée : ouvrir un carton écrit en
                              base, on ne le déclenche donc pas à chaque frappe. L'ouverture
                              automatique ne vaut que pour un code qui désigne un colis attendu —
                              sans elle, un magasinier dont la liste est vide resterait devant un
                              champ qui ne réagit pas. */}
                          <form
                            onSubmit={e => { e.preventDefault(); void ouvrirCarton(scanCarton) }}
                            className="flex gap-2"
                          >
                            <input
                              id="refCarton"
                              ref={cartonRef}
                              type="text"
                              autoFocus
                              value={scanCarton}
                              onChange={e => {
                                const value = e.target.value
                                setScanCarton(value)
                                // La douchette écrit la trame d'un bloc : dès qu'elle désigne un
                                // colis attendu, on ouvre sans attendre d'Entrée.
                                const trouve = cartonsAttendus.find(box =>
                                  box.code.toLowerCase() === value.trim().toLowerCase()
                                  || box.reference.toLowerCase() === value.trim().toLowerCase())
                                if (trouve) void ouvrirCarton(trouve.code)
                              }}
                              disabled={cartonBusy || !stationId}
                              placeholder="CB-EXP-…"
                              autoComplete="off"
                              className={`${INPUT_CLASS} flex-1 disabled:opacity-50`}
                            />
                            <button
                              type="submit"
                              disabled={cartonBusy || !stationId || !scanCarton.trim()}
                              className="flex-shrink-0 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              {cartonBusy ? 'Ouverture…' : 'Ouvrir'}
                            </button>
                          </form>
                          <p className="mt-2 text-xs text-slate-400">
                            C'est le seul moyen d'ouvrir un carton : le colis doit être devant vous,
                            étiquette scannée. Le code du carton comme sa référence sont acceptés, et un
                            carton déjà entamé se rouvre au même endroit — rien de ce qui a été scanné
                            n'est perdu.
                          </p>
                        </div>

                        <div className="flex flex-col items-center gap-1.5">
                          <div className="w-full h-[92px] rounded-xl border-2 bg-white p-2 flex items-center justify-center" style={{ borderColor: C.violet }}>
                            {scanCarton.trim()
                              ? <Code128 value={scanCarton.trim()} height={44} />
                              : <span className="text-xs text-slate-400 text-center">En attente<br />d'un scan</span>}
                          </div>
                          <p className="text-xs text-slate-400">CODE128</p>
                        </div>
                      </div>
                    </div>

                    <div className={`${CARD} p-0 overflow-hidden`}>
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between gap-3">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          Colis attendus <span className="tabular-nums text-slate-400">({cartonsAttendus.length})</span>
                        </p>
                        <button
                          onClick={() => void chargerCartons()}
                          disabled={cartonsLoading}
                          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white disabled:opacity-50"
                        >
                          {ic.refresh()} Actualiser
                        </button>
                      </div>

                      {cartonsAttendus.length === 0 ? (
                        <div className="p-8 text-center">
                          <p className="text-sm text-slate-400">
                            {cartonsLoading
                              ? 'Chargement…'
                              : cartonsErreur
                                ? `Liste indisponible : ${cartonsErreur}`
                                : 'Aucun colis en attente pour votre magasin.'}
                          </p>
                          {!cartonsLoading && !cartonsErreur && (
                            <p className="mt-1 text-xs text-slate-400">
                              Un carton déjà ouvert n'apparaît plus ici : scannez son étiquette pour reprendre son pointage.
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="divide-y divide-slate-50 dark:divide-slate-700/60">
                          {cartonsAttendus.map(box => (
                            <div key={box.id} className="px-4 py-3 flex items-center gap-3">
                              <Pastille color={C.violet}>{ic.carton('w-4 h-4')}</Pastille>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{box.code}</p>
                                <p className="text-xs text-slate-400 truncate">
                                  {box.item_count} monture{box.item_count > 1 ? 's' : ''} annoncée{box.item_count > 1 ? 's' : ''}
                                  {box.session_code ? ` · ${box.session_code}` : ''}
                                </p>
                              </div>
                              {/* Pas de bouton « Ouvrir » ici : ouvrir un colis qu'on n'a pas en
                                  main fait entrer au stock des montures qui sont encore dans le
                                  camion. Le bouton ne fait que ramener la douchette au champ. */}
                              <button
                                type="button"
                                onClick={() => {
                                  setCartonMessage(`Scannez l'étiquette de ${box.code} pour l'ouvrir.`)
                                  setCartonTone('blue')
                                  cartonRef.current?.focus()
                                }}
                                className="flex-shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:border-slate-600 dark:text-slate-400 dark:hover:text-white"
                              >
                                À scanner
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* ── Carton ouvert : pointage monture par monture */}
                {carton && (
                  <>
                    <div className={CARD}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Pastille color={C.violet}>{ic.carton()}</Pastille>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{carton.code}</p>
                            <p className="text-xs text-slate-400 truncate">
                              {carton.reference} · {carton.city}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => { setCarton(null); setCartonItems([]); setCartonMessage('') }}
                          className="flex-shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          Fermer
                        </button>
                      </div>

                      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                        <div>
                          <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="refMontureCarton">
                            Code-barres de la monture
                          </label>
                          <form onSubmit={e => { e.preventDefault(); void recevoirMonture(scanMonture) }}>
                            <input
                              id="refMontureCarton"
                              ref={montureRef}
                              type="text"
                              value={scanMonture}
                              onChange={e => {
                                const value = e.target.value
                                setScanMonture(value)
                                // Égalité stricte : une saisie partielle ne doit pas valider la
                                // monture dont elle n'est que le préfixe.
                                const cible = value.trim().toLowerCase()
                                const trouve = cartonItems.find(item => !item.received && (
                                  String(item.barcode || '').toLowerCase() === cible
                                  || String(item.reference || '').toLowerCase() === cible))
                                if (trouve) void recevoirMonture(value.trim())
                              }}
                              disabled={cartonBusy}
                              placeholder="Scanner ou saisir…"
                              autoComplete="off"
                              autoFocus
                              className={`${INPUT_CLASS} disabled:opacity-50`}
                            />
                          </form>
                          <p className="mt-2 text-xs text-slate-400">
                            La saisie se valide seule dès qu'elle correspond à une monture du carton.
                          </p>
                        </div>

                        <div className="flex flex-col items-center gap-1.5">
                          <div className="w-full h-[92px] rounded-xl border-2 bg-white p-2 flex items-center justify-center" style={{ borderColor: C.violet }}>
                            {scanMonture.trim()
                              ? <Code128 value={scanMonture.trim()} height={44} />
                              : <span className="text-xs text-slate-400 text-center">En attente<br />d'un scan</span>}
                          </div>
                          <p className="text-xs text-slate-400">CODE128</p>
                        </div>
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-3">
                        {[
                          { label: 'Annoncées', value: cartonItems.length, color: C.violet },
                          { label: 'Reçues', value: cartonRecues, color: C.success },
                          { label: 'Restantes', value: Math.max(0, cartonItems.length - cartonRecues), color: C.amber },
                        ].map(s => (
                          <div key={s.label} className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
                            <p className="text-xs text-slate-400">{s.label}</p>
                            <p className="mt-1 text-3xl font-black tabular-nums" style={{ color: s.color }}>{s.value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4">
                        <Bar percent={cartonItems.length > 0 ? (cartonRecues / cartonItems.length) * 100 : 0} color={C.success} />
                      </div>

                      <div className="mt-3">
                        <Note tone="amber">
                          Chaque scan fait <strong>réellement entrer</strong> la monture dans votre stock. Une monture
                          jamais scannée reste <strong>EN_TRANSIT</strong> : elle ne sera comptée nulle part, ce qui
                          est exactement ce qu'on veut d'un colis incomplet.
                        </Note>
                      </div>

                      <button
                        onClick={() => void cloturerCarton()}
                        disabled={cartonBusy}
                        className="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {cartonBusy ? 'Traitement…' : `Clôturer le carton (${cartonRecues}/${cartonItems.length})`}
                      </button>
                    </div>

                    <div className={`${CARD} p-0 overflow-hidden`}>
                      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          Contenu du carton <span className="tabular-nums text-slate-400">({cartonRecues}/{cartonItems.length})</span>
                        </p>
                      </div>

                      <GlassTable
                        emptyLabel="Ce carton ne contient aucune ligne."
                        title={`carton-${carton.code}`}
                        before={[{ header: 'Code-barres', mono: true }]}
                        after={[{ header: 'Prix', align: 'right' }]}
                        rows={cartonItems.map(item => ({
                          key: item.id,
                          photo: item.photo_monture_url,
                          reference: item.reference || item.barcode,
                          brand: item.brand,
                          gender: item.gender,
                          shape: item.shape,
                          // L'emplacement de CE magasin, pas celui d'où la monture vient :
                          // c'est là qu'il faut aller la poser. Il n'existe qu'après le scan.
                          location: item.stock_location_code || (item.received ? undefined : '— attribué au scan'),
                          entry: item.glass_created_at,
                          before: [item.barcode],
                          after: [fmtPrix(item.price)],
                          done: item.received,
                          status: item.received
                            ? { label: 'en stock', tone: 'green' as const }
                            : { label: 'attendue', tone: 'slate' as const },
                        }))}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── MISE EN PRÉSENTOIR ───────────────────────────────────────── */}
            {activeTab === 'presentoir' && (
              <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
                <div className="space-y-3">
                  <div className={CARD}>
                    <div className="flex items-center gap-2.5">
                      <Pastille color={C.primary}>{ic.scan()}</Pastille>
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">Sortie du stock local</p>
                        <p className="text-xs text-slate-400">Montures à placer en présentoir</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1" htmlFor="refPresentoir">
                          Code-barres ou référence
                        </label>
                        <input
                          id="refPresentoir"
                          type="text"
                          placeholder="Scanner ou saisir…"
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
                        <p className="mt-2 text-xs text-slate-400">
                          La saisie se valide seule dès qu'elle correspond à une monture du stock local.
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-full h-[92px] rounded-xl border-2 bg-white p-2 flex items-center justify-center" style={{ borderColor: C.primary }}>
                          {scanPresentoir.trim() ? (
                            <Code128 value={scanPresentoir.trim()} height={44} />
                          ) : (
                            <span className="text-xs text-slate-400 text-center">En attente<br />d'un scan</span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400">CODE128</p>
                      </div>
                    </div>
                    <div className="mt-4">
                      <Bar percent={data.local.length > 0 ? (scannedPresentoir.length / data.local.length) * 100 : 0} color={C.primary} />
                      <p className="mt-2 text-xs text-slate-400 tabular-nums">
                        {scannedPresentoir.length} / {data.local.length} pointée(s)
                      </p>
                    </div>
                    {/* Rien à dire quand tout va bien : le déroulé du transit s'apprend une
                        fois, le répéter à chaque pointage encombre l'écran. Seul l'obstacle
                        mérite un encadré. */}
                    {!presentoirStationId && (
                      <div className="mt-3">
                        <Note tone="amber">
                          Station « Présentoir » introuvable en base : le pointage reste possible, mais l'envoi
                          sera refusé faute de destination.
                        </Note>
                      </div>
                    )}
                  </div>

                  <div className={`${CARD} p-0 overflow-hidden`}>
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        Montures à scanner <span className="tabular-nums text-slate-400">({scannedPresentoir.length}/{data.local.length})</span>
                      </p>
                    </div>
                    <div className="max-h-[600px] overflow-y-auto">
                      {loading && data.local.length === 0 ? (
                        <Empty>Chargement…</Empty>
                      ) : (
                        <GlassTable
                          emptyLabel="Le stock local est vide."
                          title="stock-local"
                          before={[{ header: 'Code-barres', mono: true }]}
                          after={[{ header: 'Prix', align: 'right' }]}
                          rows={data.local.map(glass => {
                            const pointee = scannedPresentoir.includes(glass.barcode)
                            return {
                              key: glass.barcode,
                              photo: glass.photo_monture_url,
                              reference: glassRef(glass),
                              brand: glass.brand,
                              gender: glass.gender,
                              shape: glass.shape,
                              location: glass.location_code,
                              entry: glass.created_at,
                              before: [glass.barcode],
                              after: [fmtPrix(glass.price)],
                              done: pointee,
                              status: pointee
                                ? { label: '✓ pointée', tone: 'green' as const }
                                : { label: 'en attente', tone: 'amber' as const },
                            }
                          })}
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Colonne de suivi : le compte et l'ordre des scans, visibles sans quitter
                    la liste des yeux. */}
                <div className="space-y-3">
                  <div className={CARD}>
                    <p className="text-xs text-slate-400">Pointées</p>
                    <p
                      className="mt-1 text-5xl font-black tabular-nums"
                      style={{ color: scannedPresentoir.length === data.local.length && data.local.length > 0 ? C.success : C.primary }}
                    >
                      {scannedPresentoir.length}
                    </p>
                    <p className="mt-1 text-xs text-slate-400 tabular-nums">
                      {Math.max(0, data.local.length - scannedPresentoir.length)} restante(s) sur {data.local.length}
                    </p>
                    <div className="mt-4">
                      <Bar
                        percent={data.local.length > 0 ? (scannedPresentoir.length / data.local.length) * 100 : 0}
                        color={scannedPresentoir.length === data.local.length && data.local.length > 0 ? C.success : C.primary}
                      />
                    </div>
                  </div>

                  <div className={`${CARD} p-0 overflow-hidden`}>
                    <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
                      <p className="text-sm font-bold text-slate-900 dark:text-white">Derniers scans</p>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/60">
                      {scannedPresentoir.length === 0 ? (
                        <Empty>Aucun scan.</Empty>
                      ) : (
                        [...scannedPresentoir].reverse().map(barcode => {
                          const glass = data.local.find(g => g.barcode === barcode)
                          if (!glass) return null
                          return (
                            <div key={barcode} className="flex items-center gap-3 px-4 py-3 bg-green-50/60 dark:bg-green-500/5">
                              <Pastille color={C.success}>{ic.check()}</Pastille>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
                                <p className="text-xs text-slate-400 truncate">{glass.location_code || 'Emplacement non renseigné'}</p>
                              </div>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>

                  {envoiMessage && (
                    <div
                      className={envoiErreur
                        ? 'rounded-xl bg-red-50 dark:bg-red-500/15 px-3 py-2.5 text-xs font-medium text-red-700 dark:text-red-300'
                        : 'rounded-xl bg-green-50 dark:bg-green-500/15 px-3 py-2.5 text-xs font-medium text-green-700 dark:text-green-300'}
                    >
                      {envoiMessage}
                    </div>
                  )}

                  {scannedPresentoir.length > 0 && (
                    <div className="space-y-2">
                      {/* Le pointage n'a de valeur qu'une fois expédié : c'est ce bouton, pas la
                          fin du comptage, qui fait sortir les montures du stock local. */}
                      <button
                        onClick={() => void envoyerAuPresentoir()}
                        disabled={envoiBusy}
                        className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ background: C.success }}
                      >
                        {envoiBusy
                          ? 'Envoi en cours…'
                          : `Envoyer ${scannedPresentoir.length} monture${scannedPresentoir.length > 1 ? 's' : ''} au présentoir`}
                      </button>
                      <button
                        onClick={() => { setScannedPresentoir([]); setScanPresentoir(''); setPresentoirDemarre(false); setEnvoiMessage('') }}
                        disabled={envoiBusy}
                        className="w-full rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 transition-colors disabled:opacity-50"
                      >
                        Réinitialiser le pointage
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── STOCK ────────────────────────────────────────────────────── */}
            {activeTab === 'stock' && (
              <div>
                {grilleRepartitions}

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

                {/* Stock magasin — le détail que les répartitions ci-dessus ne donnent pas.
                    Les camemberts disent « 100 % rectangulaire » sans jamais dire de quelle
                    monture il s'agit, ni où elle est rangée. */}
                <SectionTitle>Stock magasin ({data.local.length})</SectionTitle>
                <div className={`${CARD} p-0 overflow-hidden`}>
                  <GlassTable
                    emptyLabel={loading ? 'Chargement…' : 'Aucune monture en stock local.'}
                    title={`stock-magasin-${metrics.today}`}
                    before={[{ header: 'Code-barres', mono: true }]}
                    after={[{ header: 'Prix', align: 'right' }]}
                    rows={data.local.map(glass => ({
                      key: glass.barcode,
                      photo: glass.photo_monture_url,
                      reference: glassRef(glass),
                      brand: glass.brand,
                      gender: glass.gender,
                      shape: glass.shape,
                      location: glass.location_code,
                      entry: glass.created_at,
                      before: [glass.barcode],
                      after: [fmtFCFA(glass.price)],
                      // Le stock local est ce qui attend d'être mis en présentoir : c'est le
                      // geste que ces lignes appellent, et l'onglet « Scanner » le fait.
                      status: { label: 'à placer', tone: 'amber' as const },
                    }))}
                  />
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

        {/* ── Briefing de mise en présentoir ────────────────────────────────── */}
        {/* Pas avant que la liste soit chargée : une modale « 0 monture » ne renseigne
            personne et se referme aussitôt sur des données qui arrivent après. */}
        {activeTab === 'presentoir' && !presentoirDemarre && !loading && data.local.length > 0 && (
          <ReceptionBriefing
            glasses={data.local}
            onStart={() => setPresentoirDemarre(true)}
          />
        )}

        {/* ── Modale de détail ──────────────────────────────────────────────── */}
        {selectedDetail && <DetailModal detail={selectedDetail} onClose={() => setSelectedDetail(null)} />}
      </div>
    </div>
  )
}

// ── Briefing de mise en présentoir ────────────────────────────────────────────

/** La liste de ce qu'il y a à aller chercher, montrée avant le premier scan.
 *  Elle couvre la navigation : sans croix, on ne pourrait plus quitter l'onglet. Fermer et
 *  commencer mènent donc au même écran, la croix ne fait qu'éviter de lire la liste. */
function ReceptionBriefing({ glasses, onStart }: { glasses: Glass[]; onStart: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onStart}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3.5 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-700">
          <Pastille color={C.primary}>{ic.pkg()}</Pastille>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white">Réception du jour</p>
            <p className="text-xs text-slate-400">Montures à prendre du stock local pour le présentoir</p>
          </div>
          <button
            onClick={onStart}
            className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
            aria-label="Fermer"
          >
            {ic.x('w-5 h-5')}
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700/60">
              {glasses.map(glass => (
                <div key={glass.barcode} className="flex items-center gap-3 px-3 py-3">
                  <Pastille color={C.primary}>{ic.glasses()}</Pastille>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {[glass.brand, glass.shape, glass.color].filter(Boolean).join(' · ') || glass.barcode}
                    </p>
                  </div>
                  {glass.location_code && <Badge tone="cyan">{glass.location_code}</Badge>}
                </div>
              ))}
            </div>
          </div>

          <Note>
            <strong>{glasses.length} monture{glasses.length > 1 ? 's' : ''} à scanner.</strong> Chaque monture pointée
            passe au vert dans la liste, et le compteur suit l'avancement.
          </Note>

          <button
            onClick={onStart}
            className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: C.primary }}
          >
            Commencer le scan
          </button>
        </div>
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
