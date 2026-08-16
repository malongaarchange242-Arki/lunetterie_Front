import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'
import { GlassTable, downloadCSV } from './GlassTable'
import { calculateGlassSimilarity, getGamme, normalizeAttr, rankSimilarGlasses } from './glassSimilarity'
import { buildAssistantPayload, buildStockDigest } from './chatContext'

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

function fullName(user: any) {
  return `${String(user?.first_name || '').trim()} ${String(user?.last_name || '').trim()}`.trim()
}

function glassRef(glass: Glass) {
  return glass.reference || glass.barcode || '—'
}

function priceOf(glass: Glass) {
  const n = Number(glass.price)
  return Number.isNaN(n) ? 0 : n
}

function sumPrice(glasses: Glass[]) {
  return glasses.reduce((total, glass) => total + priceOf(glass), 0)
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

/** Le meuble du présentoir : la partie fixe de `location_code` (« PR03-12 » →
 *  « PR03 », AGENTS.md § Emplacements), la position après le dernier tiret variant à
 *  l'intérieur d'un même bloc. Sans emplacement renseigné, la monture n'est encore
 *  affectée à aucun bloc physique. */
function blocKeyOf(glass: Glass) {
  const code = String(glass.location_code || '').trim()
  if (!code) return 'Non affecté'
  const idx = code.lastIndexOf('-')
  return idx > 0 ? code.slice(0, idx) : code
}

/**
 * Score de recommandation pour la **recherche de remplacement** — à ne pas confondre
 * avec la similarité du Présentoir. Celle-ci répond à « à quoi cette monture
 * ressemble-t-elle ? » (cosinus pondéré genre/forme/gamme, glassSimilarity.ts) ; le
 * score ci-dessous répond à « que proposer à la place ? » et ajoute donc la marque et
 * la couleur, que la cliente a sous les yeux.
 *
 * Ses poids (0.6 / 0.2 / 0.2) lui sont propres et n'entrent jamais dans
 * calculateGlassSimilarity(). Il ne sert qu'à ordonner searchSimilar(), dont il ne
 * change pas les filtres métier.
 */
function calculateRecommendationScore(a: Glass, b: Glass): number {
  // Poids attribués : base (genre/forme/gamme) 0.6, marque 0.2, couleur 0.2
  const BASE_WEIGHT = 0.6
  const BRAND_WEIGHT = 0.2
  const COLOR_WEIGHT = 0.2

  const base = calculateGlassSimilarity(a, b)

  const aBrand = a?.brand ? normalizeAttr(a.brand) : undefined
  const bBrand = b?.brand ? normalizeAttr(b.brand) : undefined
  const brandScore = (aBrand !== undefined && bBrand !== undefined) ? (aBrand === bBrand ? 1 : 0) : undefined

  const aColor = a?.color ? normalizeAttr(a.color) : undefined
  const bColor = b?.color ? normalizeAttr(b.color) : undefined
  const colorScore = (aColor !== undefined && bColor !== undefined) ? (aColor === bColor ? 1 : 0) : undefined

  let sum = 0
  let weightSum = 0
  if (base !== undefined) { sum += BASE_WEIGHT * base; weightSum += BASE_WEIGHT }
  if (brandScore !== undefined) { sum += BRAND_WEIGHT * brandScore; weightSum += BRAND_WEIGHT }
  if (colorScore !== undefined) { sum += COLOR_WEIGHT * colorScore; weightSum += COLOR_WEIGHT }
  if (weightSum === 0) return 0
  return sum / weightSum
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

type Screen = 'dashboard' | 'proforma' | 'ventes' | 'scan' | 'bloc' | 'remise' | 'reclamation' | 'stats'

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
  signOut: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>,
  back: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>,
  refresh: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" /></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M20 6L9 17l-5-5" /></svg>,
  hand: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>,
  clock: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  search: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  download: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><path d="M12 15V3" /></svg>,
  bot: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7M9 7h6"/><circle cx="9" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/></svg>,
  whatsapp: (c = 'w-6 h-6') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2.5A9.5 9.5 0 0 0 4.1 16.8L3.5 20.5l3.8-.6a9.5 9.5 0 1 0 4.74-17.4Zm5.2 13.4c-.2.6-.98 1.1-1.6 1.2-.4.1-.9.1-1.5-.1-.4-.1-.9-.3-1.5-.6a7.2 7.2 0 0 1-2.6-2.3c-.5-.6-.9-1.2-1.1-1.8-.1-.4 0-.8.3-1.1l.4-.4c.1-.1.2-.2.3-.2.1 0 .2 0 .3.1l.3.2c.1.1.2.2.2.4l.1.3c0 .2-.1.4-.2.5-.1.1-.2.2-.3.3-.1.1-.2.2-.1.3.1.3.2.6.4.9.3.5.7 1 .9 1.4.2.3.4.6.6.9.1.2.2.3.2.5 0 .1-.1.2-.2.3l-.2.2c-.2.2-.4.3-.7.4ZM12 6.1c-.4 0-.7.3-.7.7v.6c0 .3.2.5.5.6.6.1 1.2.2 1.7.5.5.3.9.7 1.2 1.2.2.3.2.7.1 1.1a.7.7 0 0 1-.6.5H13c-.4 0-.7.3-.7.7 0 .3.3.6.6.7.6.2 1.2.3 1.8.3 1.3 0 2.5-.5 3.3-1.4.8-.9 1.2-2.1 1.2-3.3 0-2.2-1.5-4-3.6-4.4-.7-.1-1.4-.1-2.1-.1Z"/></svg>,
  send: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>,
  mic: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>,
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
  // L'écran porte deux choses : la recherche d'une monture au scan, et la liste du
  // présentoir. Le libellé ne nommait que la première, si bien qu'on cherchait le
  // présentoir dans un menu où il figurait déjà. « short » reste court : la barre du bas,
  // sur téléphone, n'a pas la place des deux mots.
  { id: 'scan', label: 'Scan monture / Présentoir', short: 'Scan', icon: ic.scan },
  { id: 'bloc', label: 'Présentoir par bloc', short: 'Blocs', icon: ic.glasses },
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

/** Le présentoir, sur le tableau commun à tous les postes (src/GlassTable.tsx).
 *
 *  La vendeuse conseille : elle a besoin du prix sous les yeux à chaque monture, et du
 *  code-barres pour la porter sur une proforma. */
function PresentoirTable({ glasses }: { glasses: Glass[] }) {
  const [compareKey, setCompareKey] = useState('')

  const glassByKey = useMemo(() => {
    const m = new Map<string, Glass>()
    glasses.forEach((g, i) => {
      const key = String(g.barcode || `presentoir-${i}`)
      m.set(key, g)
    })
    return m
  }, [glasses])

  const similarities = useMemo(() => {
    if (!compareKey) return new Map<string, number>()
    const ref = glassByKey.get(compareKey)
    if (!ref) return new Map<string, number>()
    const m = new Map<string, number>()
    for (const [key, g] of glassByKey.entries()) {
      m.set(key, calculateGlassSimilarity(ref, g))
    }
    return m
  }, [compareKey, glassByKey])

  const rows = glasses.map((glass, index) => {
    const key = String(glass.barcode || `presentoir-${index}`)
    const sim = similarities.get(key) || 0
    return {
      key,
      photo: glass.photo_monture_url,
      branchPhoto: branchePhoto(glass) ?? undefined,
      reference: glassRef(glass),
      brand: glass.brand,
      gender: glass.gender,
      shape: glass.shape,
      location: glass.location_code || glass.station_name,
      entry: glass.created_at,
      before: [glass.barcode],
      after: [compareKey ? `${Math.round(sim * 100)}%` : '', fmtFCFA(glass.price)],
      status: { label: 'en rayon', tone: 'green' as const },
    }
  })

  return (
    <div className="rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100 dark:border-slate-700">
        <label className="text-xs font-semibold text-slate-600">Comparer à</label>
        <select
          value={compareKey}
          onChange={e => setCompareKey(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm outline-none"
        >
          <option value="">—</option>
          {glasses.map((g, i) => (
            <option key={g.barcode || i} value={String(g.barcode || `presentoir-${i}`)}>
              {glassRef(g)} · {getGamme(g.price)}
            </option>
          ))}
        </select>
        {compareKey && (
          <button type="button" onClick={() => setCompareKey('')} className="text-xs text-slate-500 hover:underline">
            Effacer
          </button>
        )}
      </div>

      <GlassTable
        emptyLabel="Aucune monture au présentoir."
        title="presentoir"
        before={[{ header: 'Code-barres', mono: true }]}
        after={[{ header: 'Sim.' }, { header: 'Prix', align: 'right' }]}
        rows={rows}
      />
    </div>
  )
}

/** Le présentoir regroupé par bloc (meuble), un onglet par bloc — complète PresentoirTable
 *  ci-dessus, qui reste la vue à plat pour comparer une monture à une autre. Répond à
 *  « qu'y a-t-il sur ce meuble ? », utile pour orienter une cliente vers un rayon précis. */
function PresentoirParBloc({ glasses }: { glasses: Glass[] }) {
  const [activeBlocKey, setActiveBlocKey] = useState('')
  const [preview, setPreview] = useState<Glass | null>(null)

  const blocs = useMemo(() => {
    const groupes = new Map<string, Glass[]>()
    for (const glass of glasses) {
      const cle = blocKeyOf(glass)
      const liste = groupes.get(cle)
      if (liste) liste.push(glass)
      else groupes.set(cle, [glass])
    }
    return Array.from(groupes.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'fr'))
      .map(([cle, montures]) => ({
        cle,
        montures,
        total: sumPrice(montures),
        moyenne: montures.length > 0 ? Math.round(sumPrice(montures) / montures.length) : 0,
        formes: groupByAttr(montures, g => g.shape),
        couleurs: groupByAttr(montures, g => g.color),
      }))
  }, [glasses])

  if (blocs.length === 0) return null
  const blocCourant = blocs.find(b => b.cle === activeBlocKey) || blocs[0]

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3 overflow-x-auto">
        {blocs.map(bloc => (
          <button
            key={bloc.cle}
            onClick={() => setActiveBlocKey(bloc.cle)}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
              bloc.cle === blocCourant.cle
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
            }`}
          >
            Bloc {bloc.cle}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Bloc {blocCourant.cle}</p>
          <span className="flex-shrink-0 rounded-full bg-blue-50 dark:bg-blue-500/15 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
            {blocCourant.montures.length} monture{blocCourant.montures.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
            <p className="text-xs text-slate-400">Prix total du bloc</p>
            <p className="mt-1 text-lg font-black tabular-nums text-blue-600 dark:text-blue-400">{fmtFCFA(blocCourant.total)}</p>
            <p className="text-xs text-slate-400">{fmtFCFA(blocCourant.moyenne)} moy.</p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
            <p className="text-xs text-slate-400">Nombre de formes</p>
            <p className="mt-1 text-lg font-black tabular-nums text-cyan-600 dark:text-cyan-400">{blocCourant.formes.length}</p>
            <p className="text-xs text-slate-400">variante{blocCourant.formes.length > 1 ? 's' : ''}</p>
          </div>
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
            <p className="text-xs text-slate-400">Nombre de couleurs</p>
            <p className="mt-1 text-lg font-black tabular-nums text-amber-600 dark:text-amber-400">{blocCourant.couleurs.length}</p>
            <p className="text-xs text-slate-400">variante{blocCourant.couleurs.length > 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold text-slate-900 dark:text-white">Distribution des formes</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {blocCourant.formes.map(f => {
              const percent = blocCourant.montures.length > 0 ? Math.round((f.count / blocCourant.montures.length) * 100) : 0
              return (
                <div key={f.label} className="rounded-xl border border-slate-100 dark:border-slate-700 p-3 text-center">
                  <p className="text-2xl font-black tabular-nums text-blue-600 dark:text-blue-400">{percent}%</p>
                  <p className="mt-1 text-xs text-slate-400 truncate">{f.label}</p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold text-slate-900 dark:text-white">Distribution des couleurs</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {blocCourant.couleurs.map(c => {
              const percent = blocCourant.montures.length > 0 ? Math.round((c.count / blocCourant.montures.length) * 100) : 0
              return (
                <div key={c.label} className="rounded-xl border border-slate-100 dark:border-slate-700 p-3 text-center">
                  <p className="text-2xl font-black tabular-nums text-purple-600 dark:text-purple-400">{percent}%</p>
                  <p className="mt-1 text-xs text-slate-400 truncate">{c.label}</p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold text-slate-900 dark:text-white">Montures du bloc</p>
          <div className="rounded-xl border border-slate-100 dark:border-slate-700 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr className="border-b border-slate-100 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Référence</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Forme</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Couleur</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Emplacement</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-slate-400">Prix</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {blocCourant.montures.map(glass => (
                  <tr key={glass.barcode}>
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{glassRef(glass)}</td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{glass.shape || '—'}</td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{glass.color || '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-slate-500 dark:text-slate-400">{glass.location_code || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-bold tabular-nums text-blue-600 dark:text-blue-400">{fmtFCFA(glass.price)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={() => setPreview(glass)}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                      >
                        Aperçu
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPreview(null)}>
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3.5 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{glassRef(preview)}</p>
                <p className="text-xs text-slate-400 truncate">Bloc {blocKeyOf(preview)}</p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                aria-label="Fermer"
              >
                {ic.x('w-5 h-5')}
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="h-40 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900 flex items-center justify-center">
                {preview.photo_monture_url
                  ? <img src={preview.photo_monture_url} alt={glassRef(preview)} className="h-full w-full object-cover" />
                  : <span className="text-xs text-slate-400">Pas de photo de monture</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Forme</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{preview.shape || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Couleur</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{preview.color || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Emplacement</p>
                  <p className="mt-1 text-sm font-mono text-slate-900 dark:text-white">{preview.location_code || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Prix</p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-blue-600 dark:text-blue-400">{fmtFCFA(preview.price)}</p>
                </div>
              </div>
            </div>
          </div>
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
/** Une monture expédiée vers ce poste mais pas encore arrivée.
 *
 *  Le magasin qui l'envoie n'a fait que l'expédier : elle est EN_TRANSIT, sortie de son stock
 *  et absente du présentoir. Il faut la scanner ici pour qu'elle arrive — sans cette liste,
 *  rien n'annonce qu'elle attend, et elle peut rester en transit indéfiniment. */
interface IncomingGlass {
  barcode: string
  transferId: number
  since?: string
}

interface StoreData {
  presentoir: Glass[]
  /** Expédiées vers ce poste, en attente du scan qui les fera arriver. */
  incoming: IncomingGlass[]
  reserved: Glass[]
  sold: Glass[]
  /** Montage terminé au laboratoire : elles attendent que le client vienne les chercher. */
  pretes: Glass[]
  proformas: Proforma[]
  movements: Movement[]
  claims: Claim[]
}

const EMPTY_DATA: StoreData = { presentoir: [], incoming: [], reserved: [], sold: [], pretes: [], proformas: [], movements: [], claims: [] }

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

  async function load(silent = false) {
    if (!silent) setLoading(true)
    setError('')
    // allSettled : une liste indisponible ne doit pas vider les cinq autres. Le poste
    // doit rester utilisable même si un seul endpoint tombe.
    const results = await Promise.allSettled([
      stationId ? apiFetch(`/inventory/glasses?station_id=${stationId}&status=EN_PRESENTOIR`) : Promise.resolve({}),
      apiFetch('/inventory/glasses?status=RESERVEE'),
      apiFetch('/inventory/glasses?status=VENDUE'),
      apiFetch('/inventory/proformas'),
      apiFetch('/inventory/movements?limit=300&offset=0'),
      // TOUS les transferts en cours, pas seulement ceux qui visent ce poste : une monture
      // peut traîner une vieille ligne jamais réceptionnée puis repartir ailleurs, et seul
      // son transfert le plus récent dit où elle va vraiment.
      apiFetch('/inventory/transfers?status=IN_TRANSIT'),
      // Les montures réellement en voyage. Le transfert seul ne suffit pas : sa ligne reste
      // IN_TRANSIT pour toujours si personne ne la scanne à l'arrivée, y compris après que
      // la monture a été vendue et est passée à tout autre chose. C'est le statut de la
      // monture qui dit si elle voyage, le transfert seulement vers où.
      apiFetch('/inventory/glasses?status=EN_TRANSIT'),
      // Le laboratoire a fini son montage : ces montures attendent que le client vienne les
      // chercher, et c'est la vendeuse qui les lui remet.
      stationId ? apiFetch(`/inventory/glasses?station_id=${stationId}&status=PRETE_A_LIVRER`) : Promise.resolve({}),
    ])

    const [presentoirR, reservedR, soldR, proformasR, movementsR, transfersR, transitR, pretesR] = results
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

    // Pour chaque monture encore en transit, seul son DERNIER transfert dit où elle va. Une
    // ligne ancienne jamais réceptionnée reste IN_TRANSIT indéfiniment : la prendre pour
    // destination ferait attendre ici une monture repartie ailleurs depuis longtemps.
    const transferts: any[] = transfersR.status === 'fulfilled'
      ? (transfersR.value?.data?.transfers || transfersR.value?.data || [])
      : []
    const dernier = new Map<string, { to: number; transferId: number; since?: string }>()
    for (const transfert of Array.isArray(transferts) ? transferts : []) {
      const quand = String(transfert?.created_at || '')
      for (const item of transfert?.items || []) {
        if (String(item?.status || '').toUpperCase() !== 'IN_TRANSIT') continue
        const barcode = String(item?.barcode || '')
        if (!barcode) continue
        const connu = dernier.get(barcode)
        if (connu && String(connu.since || '') >= quand) continue
        dernier.set(barcode, { to: Number(transfert.to_station_id), transferId: Number(transfert.id), since: quand })
      }
    }
    // Deux conditions, et il faut les deux : la monture est EN_TRANSIT (elle voyage
    // vraiment), et son dernier transfert vise ce poste (elle vient ici).
    const enTransit = new Set<string>(
      (transitR.status === 'fulfilled' ? (transitR.value?.data?.glasses || []) : [])
        .map((glass: any) => String(glass?.barcode || ''))
        .filter(Boolean),
    )
    const incoming: IncomingGlass[] = []
    for (const [barcode, voyage] of dernier) {
      if (voyage.to !== stationId) continue
      if (!enTransit.has(barcode)) continue
      incoming.push({ barcode, transferId: voyage.transferId, since: voyage.since })
    }

    setData({
      presentoir: glasses(presentoirR),
      incoming,
      reserved: glasses(reservedR),
      sold: [...vendues, ...encaissees],
      pretes: glasses(pretesR),
      proformas,
      movements: movementsR.status === 'fulfilled' ? (movementsR.value?.data?.movements || []) : [],
      claims: Array.isArray(claims) ? claims : [],
    })

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed === results.length) setError('Aucune donnée n\'a pu être chargée.')
    else if (failed > 0) setError(`${failed} liste${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}.`)
    setLoading(false)
  }

  useEffect(() => {
    void load()

    // silent : le rafraîchissement automatique ne doit pas réafficher le squelette de
    // chargement — seul le montage initial (ou un reload() explicite après un scan) le
    // fait. Même cadence que la Direction (App.tsx) : 15 s, uniquement onglet visible.
    const handleWindowFocus = () => { void load(true) }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleWindowFocus()
    }
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') handleWindowFocus()
    }, 15000)
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [stationId])

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
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        <DashTile
          label="Lunette en présentoir"
          color="#0891b2"
          icon={ic.scan}
          primary={fmt(data.presentoir.length)}
          note={`${data.presentoir.length} monture${data.presentoir.length > 1 ? 's' : ''}`}
          onClick={() => onNavigate('scan')}
        />
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

      {/* Rien n'annonçait qu'une monture était en route : le magasin l'expédie, elle sort de
          son stock, et elle n'apparaît ici qu'une fois scannée. Entre les deux, personne ne
          savait qu'il y avait un geste à faire — et elle pouvait rester en transit des jours. */}
      {data.incoming.length > 0 && (
        <div>
          <SectionTitle
            action={
              <button
                onClick={() => onNavigate('scan')}
                className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400"
              >
                Scanner →
              </button>
            }
          >
            En route vers le présentoir
          </SectionTitle>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {data.incoming.length} monture{data.incoming.length > 1 ? 's' : ''} expédiée{data.incoming.length > 1 ? 's' : ''} vers ce poste,
              en attente de scan
            </p>
            <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-300/80">
              Elles ne sont ni dans le stock du magasin ni au présentoir tant qu'elles n'ont pas été
              scannées ici. Un passage par « Scanner une monture » termine leur voyage.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {data.incoming.map(item => (
                <span
                  key={`${item.transferId}-${item.barcode}`}
                  className="rounded-lg bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-amber-900 dark:bg-slate-900 dark:text-amber-200"
                >
                  {item.barcode}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <SectionTitle
          action={
            data.presentoir.length > 6
              ? (
                <button
                  onClick={() => onNavigate('scan')}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                >
                  Voir les {data.presentoir.length} montures →
                </button>
              )
              : <span className="text-xs text-slate-500 dark:text-slate-400">{data.presentoir.length} monture{data.presentoir.length > 1 ? 's' : ''}</span>
          }
        >
          Présentoir
        </SectionTitle>
        {data.presentoir.length === 0 ? (
          <EmptyState>Aucune monture au présentoir.</EmptyState>
        ) : (
          // Le tableau de bord n'en montre que les six premières : la liste complète vit sur
          // l'écran Scan, où elle a la place de dérouler.
          <PresentoirTable glasses={data.presentoir.slice(0, 6)} />
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

// Un casier de présentoir libéré aujourd'hui (vente, réserve, mise en caisse), avec la
// monture qui l'occupait — models.EmptySlot côté serveur (location_repository.go
// FindEmptyPresentoirSlotsToday). Le code de l'emplacement dit quoi remplir, la monture
// dit quoi y remettre.
interface ReplacementSlot {
  code: string
  barcode: string
  reference?: string
  brand?: string
}

const REPLACEMENT_COLUMNS: Column<ReplacementSlot>[] = [
  { key: 'code', label: 'Emplacement', value: s => s.code },
  { key: 'ref', label: 'Référence', value: s => s.reference || '' },
  { key: 'brand', label: 'Marque', value: s => s.brand || '' },
  { key: 'barcode', label: 'Code-barres', value: s => s.barcode || '' },
]

/** Charge les casiers présentoir vidés aujourd'hui, à la demande (l'onglet
 *  « Remplacement » n'est pas toujours consulté) plutôt qu'à chaque ouverture de
 *  « Lunettes vendues ». */
function useReplacementSlots(stationId: number | null) {
  const [slots, setSlots] = useState<ReplacementSlot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)

  function load() {
    if (!stationId) return
    setLoading(true)
    setError('')
    apiFetch(`/inventory/presentoir/empty-slots?station_id=${stationId}`)
      .then(payload => {
        setSlots(Array.isArray(payload?.data?.slots) ? payload.data.slots : [])
        setLoaded(true)
      })
      .catch((err: any) => setError(err?.message || 'Impossible de charger les emplacements à remplacer.'))
      .finally(() => setLoading(false))
  }

  return { slots, loading, error, loaded, load }
}

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
  // Sous-onglet de « Lunettes vendues » : quoi remplacer au présentoir, à côté de ce
  // qui a été vendu — les deux vues partagent la même page plutôt qu'une nouvelle tuile.
  const [soldSubTab, setSoldSubTab] = useState<'ventes' | 'remplacement'>('ventes')
  const replacement = useReplacementSlots(stationId)

  useEffect(() => {
    if (table === 'lunettes' && soldSubTab === 'remplacement' && !replacement.loaded && !replacement.loading) {
      replacement.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, soldSubTab])

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
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setSoldSubTab('ventes')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${soldSubTab === 'ventes' ? 'bg-blue-600 text-white' : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500'}`}
            >
              Lunettes vendues
            </button>
            <button
              onClick={() => setSoldSubTab('remplacement')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${soldSubTab === 'remplacement' ? 'bg-blue-600 text-white' : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500'}`}
            >
              Remplacement
            </button>
          </div>

          {soldSubTab === 'ventes' ? (
            <DataTable columns={SOLD_COLUMNS} rows={data.sold} filename={`lunettes-vendues-${stamp}`} empty="Aucune vente enregistrée." />
          ) : replacement.loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Chargement…</p>
          ) : replacement.error ? (
            <p className="py-10 text-center text-sm text-red-500">{replacement.error}</p>
          ) : (
            <>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Casiers de présentoir libérés aujourd'hui (vente, réserve, mise en caisse) — la monture qui les occupait dit quoi y remettre.
              </p>
              <DataTable columns={REPLACEMENT_COLUMNS} rows={replacement.slots} filename={`remplacement-presentoir-${stamp}`} empty="Aucun emplacement à remplacer aujourd'hui." />
            </>
          )}
        </>
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

/** Mouvements affichés par page dans « Mes actions ». La liste entière était coupée à 15
 *  sans moyen de voir la suite : le reste de l'historique était simplement inatteignable. */
const ACTIONS_PAR_PAGE = 8

/** Le silence après lequel la recherche part seule. Assez long pour qu'une douchette ait
 *  fini d'écrire son code — elle le tape en quelques dizaines de millisecondes — et pour
 *  qu'une frappe au clavier ne parte pas à mi-code. */
const SCAN_PAUSE_MS = 450

/** En deçà, on n'interroge pas : aucune référence du parc n'est aussi courte, et un code
 *  à moitié tapé ne vaut pas un aller-retour serveur. Le bouton, lui, n'a pas ce seuil. */
const SCAN_MIN_LENGTH = 4

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
  // Le dernier code effectivement cherché. Sans lui, un code introuvable resterait dans le
  // champ et repartirait en boucle à chaque rendu.
  const lastScanRef = useRef('')
  const [societes, setSocietes] = useState<Societe[]>([])
  const [societesError, setSocietesError] = useState('')

  // La douchette écrit là où est le curseur : le champ le reprend après chaque ajout.
  useEffect(() => { scanRef.current?.focus() }, [montures.length])

  // Recherche automatique, déclenchée sur la pause de saisie et non sur la frappe : la
  // douchette envoie le code d'un bloc puis s'arrête, et une saisie au clavier s'arrête
  // aussi quand elle est finie. Chercher à chaque caractère interrogerait le serveur pour
  // « G », « GF », « GFD »… et noierait l'écran sous « Aucune monture ne porte ce code ».
  //
  // Le bouton Ajouter et la touche Entrée restent branchés : ils passent devant l'attente,
  // et acceptent les codes plus courts que le seuil.
  useEffect(() => {
    const value = code.trim()
    if (scanBusy || value.length < SCAN_MIN_LENGTH || value === lastScanRef.current) return

    const timer = window.setTimeout(() => { void addMonture() }, SCAN_PAUSE_MS)
    return () => window.clearTimeout(timer)
  }, [code, scanBusy])

  // La liste est fermée : la vendeuse choisit une société existante, elle n'en saisit plus.
  // Un échec de chargement n'empêche pas d'émettre la proforma — la société est facultative,
  // et bloquer une vente sur une liste indisponible serait pire que l'absence du champ.
  useEffect(() => {
    let annule = false
    void (async () => {
      try {
        const payload = await apiFetch('/inventory/societes')
        if (annule) return
        const liste: Societe[] = payload?.data?.societes || payload?.data || []
        setSocietes(Array.isArray(liste) ? liste : [])
        setSocietesError('')
      } catch (error: any) {
        if (annule) return
        setSocietes([])
        setSocietesError(error?.message || 'Liste des sociétés indisponible.')
      }
    })()
    return () => { annule = true }
  }, [])

  // Le formulaire s'ouvre sur « PARTICULIER » depuis toujours : dès que la liste arrive, on
  // rattache ce nom à sa fiche pour que le cas courant parte avec son identifiant sans que
  // la vendeuse ait à toucher au champ.
  useEffect(() => {
    if (rx.societeId || societes.length === 0) return
    const defaut = societes.find(s => s.name.trim().toUpperCase() === rx.societe.trim().toUpperCase())
    if (defaut) setRx(prev => ({ ...prev, societeId: defaut.id, societe: defaut.name }))
  }, [societes, rx.societeId, rx.societe])

  const monturesTotal = montures.reduce((sum, line) => sum + (line.offerte ? 0 : Number(line.glass.price) || 0), 0)
  const totals = computeTotals(rx, monturesTotal)

  function patch(next: Partial<Prescription>) {
    setRx(prev => ({ ...prev, ...next }))
    setMessage('')
  }

  async function addMonture() {
    const value = code.trim()
    if (!value) return
    // Mémorisé ici et non dans l'effet : la recherche automatique et le bouton passent tous
    // les deux par cette fonction, et un code déjà tenté ne doit pas repartir tout seul.
    lastScanRef.current = value
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
            societe_id: rx.societeId || undefined,
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

        <Card>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-3">Client</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Société">
              <select
                value={rx.societeId ? String(rx.societeId) : ''}
                onChange={e => {
                  const id = Number(e.target.value)
                  const choisie = societes.find(s => s.id === id)
                  // Le nom part avec l'identifiant : le serveur recopie les deux, et c'est
                  // lui qui s'imprime sur le document.
                  patch({ societeId: choisie ? choisie.id : 0, societe: choisie ? choisie.name : '' })
                }}
                className={FIELD}
              >
                <option value="">{societesError ? 'Liste indisponible' : 'Non renseignée'}</option>
                {societes.map(societe => (
                  <option key={societe.id} value={societe.id}>{societe.name}</option>
                ))}
              </select>
              {societesError && (
                <p className="mt-1 text-[11px] leading-snug text-amber-600 dark:text-amber-400">
                  {societesError} La proforma reste possible sans société.
                </p>
              )}
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
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mb-3">Scannez l'étiquette : la recherche part toute seule. Au clavier, marquez une pause ou appuyez sur Entrée.</p>

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

/** Une société conventionnée, telle que la sert `/inventory/societes`. La liste est tenue
 *  par la Direction : le poste la lit, il n'y écrit pas. */
interface Societe {
  id: number
  name: string
  active?: boolean
}

interface Prescription {
  societe: string
  /** L'identifiant de la société choisie. Zéro tant qu'aucune ne l'est. Le nom est envoyé
   *  avec lui : le serveur garde les deux, l'un pour compter, l'autre pour que le document
   *  reste lisible si la société est renommée. */
  societeId: number
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
    societe: 'PARTICULIER', societeId: 0, foyer: '', teinte: '',
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

// ── Étiquette de présentoir (code-barres + emplacement) ─────────────────────────
// Même gabarit 56 mm que l'écran Scan côté réception (scan.tsx). Dupliqué plutôt que
// partagé : chaque poste de ce projet vit dans son propre bundle (vite.config.ts),
// sans module commun entre eux hormis GlassTable et glassSimilarity.
const LABEL_CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #000; }
  .lb { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 56mm; padding: 1.6mm; }
  .lb .location { font-size: 10px; font-weight: 800; text-align: center; }
  .lb .shop { font-size: 9px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; }
  .lb .marque { font-size: 12px; font-weight: 700; }
  .lb .ref { font-size: 9px; font-weight: 700; color: #333; font-family: ui-monospace, monospace; }
  .lb svg { margin: 0.5mm 0; max-width: 100%; }
  .lb .meta { display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 8px; font-size: 8px; font-variant-numeric: tabular-nums; }
  .lb .meta span { white-space: nowrap; }
  .lb .meta span:last-child { font-weight: 800; font-size: 9px; }
`

const LABEL_PX = { width: 212, pad: 6, gap: 2, barcodeMargin: 2 }

const LABEL_FONT = {
  location: '800 10px Inter, system-ui, sans-serif',
  shop: '800 9px Inter, system-ui, sans-serif',
  marque: '700 12px Inter, system-ui, sans-serif',
  ref: '700 9px ui-monospace, monospace',
  meta: '8px Inter, system-ui, sans-serif',
}

/** Interlignes : le canvas ne connaît pas line-height, chaque ligne avance à la main. */
const LABEL_LINE = { location: 11, shop: 10, marque: 14, ref: 10, meta: 9 }

/** showValue=false : le texte intégré au SVG rétrécit avec les barres et devient
 *  illisible dans une carte étroite. On l'affiche alors séparément en HTML. */
async function drawBarcode(target: SVGSVGElement, value: string, showValue = true) {
  if (!value) return
  const module = await import('jsbarcode')
  const JsBarcode = (module.default || module) as any
  if (typeof JsBarcode !== 'function') return

  target.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  target.setAttribute('preserveAspectRatio', 'xMidYMid meet')

  JsBarcode(target, value, {
    format: 'CODE128',
    lineColor: '#0f172a',
    background: '#ffffff',
    width: 1.15,
    height: 24,
    fontSize: 20,
    margin: 2,
    displayValue: showValue,
  })

  // JsBarcode fixe parfois seulement les attributs du SVG sans les dimensions de la
  // vue, ou les laisse à 0 quand l'élément est temporaire. Sans viewBox exploitable,
  // la barre n'a ni largeur ni hauteur à l'impression / export d'image.
  const explicitWidth = Number.parseFloat(String(target.getAttribute('width') ?? '')) || 0
  const explicitHeight = Number.parseFloat(String(target.getAttribute('height') ?? '')) || 0
  const vb = target.viewBox?.baseVal
  const vbWidth = vb && vb.width > 0 ? vb.width : 0
  const vbHeight = vb && vb.height > 0 ? vb.height : 0

  if ((explicitWidth > 0 && explicitHeight > 0) || (vbWidth > 0 && vbHeight > 0)) {
    target.setAttribute('viewBox', `0 0 ${Math.max(explicitWidth || vbWidth, 1)} ${Math.max(explicitHeight || vbHeight, 1)}`)
    return
  }

  const fallbackWidth = 200
  const fallbackHeight = 50
  target.setAttribute('width', String(fallbackWidth))
  target.setAttribute('height', String(fallbackHeight))
  target.setAttribute('viewBox', `0 0 ${fallbackWidth} ${fallbackHeight}`)
}

function BarcodePreview({ value, className = '' }: { value: string; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (ref.current) void drawBarcode(ref.current, value, false)
  }, [value])
  return <svg ref={ref} className={`max-w-full h-auto ${className}`} />
}

async function downloadDataUrl(dataUrl: string, filename: string) {
  // Passage par un Blob plutôt que par le data: URL posé directement en href : Safari
  // ignore l'attribut download sur un href data: et se contente d'ouvrir l'image.
  const blob = await fetch(dataUrl).then(response => response.blob())
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("Le code-barres n'a pas pu être converti en image."))
    image.src = source
  })
}

/** Découpe un texte trop large, comme le ferait le flux HTML de l'étiquette : un nom
 *  de marque long doit descendre d'une ligne, pas déborder de l'image. Coupe aussi
 *  après chaque tiret, comme le ferait un navigateur, pour qu'un code d'emplacement
 *  du type « PR03-12 » se replie correctement. */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const raw = String(text || '').trim()
  if (!raw) return ['—']

  const words = raw.split(/\s+/)
  const tokens: { text: string; spaceBefore: boolean }[] = []
  words.forEach((word, wordIndex) => {
    const parts = word.split(/(?<=-)/)
    parts.forEach((part, partIndex) => {
      tokens.push({ text: part, spaceBefore: partIndex === 0 && wordIndex > 0 })
    })
  })

  const lines: string[] = []
  let line = ''
  for (const token of tokens) {
    const candidate = token.spaceBefore ? `${line} ${token.text}` : `${line}${token.text}`
    if (line === '' || ctx.measureText(candidate).width <= maxWidth) line = candidate
    else {
      lines.push(line)
      line = token.text
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Le contenu d'une étiquette, détaché de ce qu'elle décrit — même structure que
 *  celle de scan.tsx : 56 mm de large, même police, même CODE128. */
interface PrintableLabel {
  title: string
  reference: string
  barcodeValue: string
  metaLeft: string
  metaRight: string
  filePrefix: string
}

/** Redessine l'étiquette sur un canvas au lieu de photographier le HTML : sans
 *  bibliothèque tierce, aucun navigateur ne convertit du HTML en image de façon
 *  fiable. Toute retouche du gabarit imprimé doit être reportée ici. */
async function labelToPngDataUrl(data: PrintableLabel, barcode: { svg: string; width: number; height: number }) {
  const contentWidth = LABEL_PX.width - LABEL_PX.pad * 2

  const ruler = document.createElement('canvas').getContext('2d')
  if (!ruler) throw new Error('Canvas non supporté par ce navigateur.')

  ruler.font = LABEL_FONT.location
  const locationLines = wrapCanvasText(ruler, data.metaLeft || '—', contentWidth)
  ruler.font = LABEL_FONT.marque
  const marqueLines = wrapCanvasText(ruler, data.title || '—', contentWidth)
  ruler.font = LABEL_FONT.ref
  const refLines = wrapCanvasText(ruler, data.reference || '—', contentWidth)

  let barcodeImage: HTMLImageElement | null = null
  let barcodeWidth = 0
  let barcodeHeight = 0
  const safeBarcodeWidth = barcode.width > 0 ? barcode.width : 180
  const safeBarcodeHeight = barcode.height > 0 ? barcode.height : 48
  if (barcode.svg) {
    barcodeImage = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(barcode.svg)}`)
    const ratio = Math.min(1, contentWidth / safeBarcodeWidth)
    barcodeWidth = safeBarcodeWidth * ratio
    barcodeHeight = safeBarcodeHeight * ratio
  }

  const height = LABEL_PX.pad
    + locationLines.length * LABEL_LINE.location
    + LABEL_PX.gap + LABEL_LINE.shop
    + LABEL_PX.gap + marqueLines.length * LABEL_LINE.marque
    + LABEL_PX.gap + refLines.length * LABEL_LINE.ref
    + LABEL_PX.gap + LABEL_LINE.meta
    + (barcodeHeight ? LABEL_PX.gap + LABEL_PX.barcodeMargin * 2 + barcodeHeight : 0)
    + LABEL_PX.pad

  // ×3 : une étiquette de 56 mm rendue à 96 dpi ressort floue dès qu'on la réimprime.
  const scale = 3
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(LABEL_PX.width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas non supporté par ce navigateur.')

  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, LABEL_PX.width, height)
  ctx.textBaseline = 'top'

  const center = LABEL_PX.width / 2
  let y = LABEL_PX.pad

  ctx.textAlign = 'center'
  ctx.fillStyle = '#000000'
  ctx.font = LABEL_FONT.location
  for (const line of locationLines) {
    ctx.fillText(line, center, y)
    y += LABEL_LINE.location
  }
  y += LABEL_PX.gap

  ctx.font = LABEL_FONT.shop
  ;(ctx as any).letterSpacing = '0.5px'
  ctx.fillText('LA LUNETTERIE', center, y)
  ;(ctx as any).letterSpacing = '0px'
  y += LABEL_LINE.shop + LABEL_PX.gap

  ctx.font = LABEL_FONT.marque
  for (const line of marqueLines) {
    ctx.fillText(line, center, y)
    y += LABEL_LINE.marque
  }
  y += LABEL_PX.gap

  ctx.font = LABEL_FONT.ref
  ctx.fillStyle = '#333333'
  for (const line of refLines) {
    ctx.fillText(line, center, y)
    y += LABEL_LINE.ref
  }

  ctx.font = LABEL_FONT.meta
  ctx.fillStyle = '#000000'
  ctx.textAlign = 'center'
  ctx.fillText(data.metaRight || '—', center, y + 2)
  y += LABEL_LINE.meta

  if (barcodeImage) {
    y += LABEL_PX.gap + LABEL_PX.barcodeMargin
    ctx.drawImage(barcodeImage, center - barcodeWidth / 2, y, barcodeWidth, barcodeHeight)
    y += barcodeHeight + LABEL_PX.barcodeMargin
  }

  return canvas.toDataURL('image/png')
}

/** Dessine le code-barres dans un nœud attaché — JsBarcode a besoin de mesurer un
 *  élément rendu, un nœud détaché ressort sans dimensions — puis le sérialise à la
 *  fois pour l'impression HTML (`markup`) et pour l'export PNG (`svg`, avec xmlns
 *  explicite : c'est ce que charge l'<img> qui redessine l'étiquette sur le canvas). */
async function captureBarcodeSvg(value: string) {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:absolute;left:-9999px;top:0'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  holder.appendChild(svg)
  document.body.appendChild(holder)

  try {
    await drawBarcode(svg, value, false)
    const markup = svg.outerHTML
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    return {
      markup,
      svg: new XMLSerializer().serializeToString(clone),
      width: Number(svg.getAttribute('width')) || Number(svg.viewBox?.baseVal.width) || 180,
      height: Number(svg.getAttribute('height')) || Number(svg.viewBox?.baseVal.height) || 48,
    }
  } finally {
    holder.remove()
  }
}

/** Une copie image part sur le disque : la vendeuse doit pouvoir retrouver l'étiquette
 *  d'une monture reçue sans avoir à la réimprimer. */
async function downloadLabel(data: PrintableLabel) {
  const barcode = await captureBarcodeSvg(data.barcodeValue)
  const dataUrl = await labelToPngDataUrl(data, barcode)
  await downloadDataUrl(dataUrl, `${data.filePrefix}-${data.barcodeValue || 'etiquette'}.png`)
}

/** L'étiquette part dans une fenêtre séparée plutôt qu'en masquant le reste de la
 *  page : toute l'application vit sous un unique #root. */
async function printLabel(data: PrintableLabel) {
  const barcode = await captureBarcodeSvg(data.barcodeValue)
  const popup = window.open('', '_blank', 'width=420,height=560')

  // Téléchargée dans tous les cas, impression bloquée comprise : c'est justement quand
  // rien ne sort de l'imprimante que la copie image sert le plus.
  void labelToPngDataUrl(data, barcode)
    .then(dataUrl => downloadDataUrl(dataUrl, `${data.filePrefix}-${data.barcodeValue || 'etiquette'}.png`))
    .catch(error => console.error("Échec du téléchargement de l'étiquette", error))

  if (!popup) {
    window.alert("L'impression a été bloquée par le navigateur. L'étiquette part quand même en image dans vos téléchargements ; autorisez les fenêtres surgissantes pour l'imprimer.")
    return
  }
  const esc = (v: string) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  popup.document.write(
    `<!doctype html><html lang="fr"><head><meta charset="utf-8" />`
    + `<title>Étiquette ${esc(data.barcodeValue)}</title><style>${LABEL_CSS}</style></head><body>`
    + `<div class="lb">`
    + `<div class="location">${esc(data.metaLeft || '—')}</div>`
    + `<div class="shop">La Lunetterie</div>`
    + `<div class="marque">${esc(data.title || '—')}</div>`
    + `<div class="ref">${esc(data.reference || '—')}</div>`
    + `<div class="meta"><span>${esc(data.metaRight || '—')}</span></div>`
    + barcode.markup
    + `</div>`
    + `<script>window.onload=function(){window.print();}<\/script></body></html>`,
  )
  popup.document.close()
}

/** Popup ouverte à la première réception d'une monture au présentoir (scan qui la
 *  fait passer de EN_TRANSIT à EN_PRESENTOIR) : le code-barres et le casier attribué,
 *  avec de quoi imprimer l'étiquette ou en garder une copie PNG. */
function PresentoirLabelModal({ label, onClose }: { label: PrintableLabel; onClose: () => void }) {
  const [busy, setBusy] = useState<'print' | 'download' | ''>('')

  async function handlePrint() {
    setBusy('print')
    try {
      await printLabel(label)
    } finally {
      setBusy('')
    }
  }

  async function handleDownload() {
    setBusy('download')
    try {
      await downloadLabel(label)
    } catch (error) {
      console.error("Échec du téléchargement de l'étiquette", error)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{label.title || '—'}</p>
            <p className="text-xs text-slate-400 truncate">{label.reference}</p>
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
            aria-label="Fermer"
          >
            {ic.x('w-5 h-5')}
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex flex-col items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700">
            <BarcodePreview value={label.barcodeValue} className="h-16" />
            <p className="font-mono text-sm font-bold tabular-nums text-slate-900">{label.barcodeValue}</p>
          </div>

          <div className="rounded-xl bg-blue-50 dark:bg-blue-500/10 p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Emplacement présentoir
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-blue-700 dark:text-blue-300">
              {label.metaLeft || '—'}
            </p>
          </div>
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={busy !== ''}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300"
          >
            {busy === 'download' ? 'Téléchargement…' : 'Télécharger en PNG'}
          </button>
          <button
            type="button"
            onClick={() => void handlePrint()}
            disabled={busy !== ''}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === 'print' ? 'Impression…' : 'Imprimer'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Scan monture / présentoir ──────────────────────────────────────────────────
function ScanScreen({ data, stationId, onReceived }: {
  data: StoreData
  stationId: number | null
  /** Le scan d'une monture en transit vaut réception : elle entre au présentoir et quitte
   *  la liste « en route ». Sans ce rappel, le tableau de bord continuerait de réclamer un
   *  scan déjà fait — précisément le genre de mensonge qu'on essaie d'éliminer. */
  onReceived: () => void
}) {
  const [code, setCode] = useState('')
  // Le casier de présentoir choisi à la main. Vide : le serveur attribue le premier libre,
  // comme il l'a toujours fait.
  const [casier, setCasier] = useState('')
  const [found, setFound] = useState<Glass | null>(null)
  const [status, setStatus] = useState('Prêt à scanner.')
  const [tone, setTone] = useState<'error' | 'success' | ''>('')
  const [busy, setBusy] = useState(false)
  const [similar, setSimilar] = useState<Glass[] | null>(null)
  const [similarBusy, setSimilarBusy] = useState(false)
  const [similarError, setSimilarError] = useState('')
  // L'étiquette de la monture qui vient d'arriver au présentoir pour la 1ère fois : la
  // popup ne s'ouvre qu'à cette occasion, pas pour une simple recherche d'une monture
  // déjà exposée.
  const [receptionLabel, setReceptionLabel] = useState<PrintableLabel | null>(null)
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
      // Le serveur a pu réceptionner la monture au passage : le scan avec `station_id`
      // déclenche PlaceOnDisplay, qui clôt un transfert en cours. On le dit, et on relit
      // les listes du poste pour que « en route » et « présentoir » suivent.
      const attendue = data.incoming.some(item => item.barcode === glass.barcode)
      let message = attendue ? `${glassRef(glass)} reçue au présentoir.` : `${glassRef(glass)} trouvée.`
      let echec = false
      // Défaut = le casier que le serveur a attribué tout seul au passage en
      // EN_PRESENTOIR ; remplacé plus bas si un casier précis a été demandé à la main.
      let emplacementFinal = glass.location_code || ''

      // Le casier se pose après le scan, jamais avant : c'est le scan qui vaut réception et
      // fait passer la monture EN_PRESENTOIR. Désigner une place pour une monture qui n'est
      // pas encore exposée serait refusé par le serveur.
      const voulu = casier.trim()
      if (voulu) {
        if (!stationId) {
          message += " Casier non attribué : aucune station rattachée à ce compte."
          echec = true
        } else {
          try {
            const range = await apiFetch('/inventory/presentoir/assign-slot', {
              method: 'POST',
              body: JSON.stringify({ station_id: stationId, barcode: glass.barcode, location_code: voulu }),
            })
            const pose = range?.data?.location?.code || voulu.toUpperCase()
            // La fiche affichée doit montrer le casier qu'on vient de lui donner, pas celui
            // que le serveur avait attribué tout seul une seconde plus tôt.
            setFound({ ...glass, location_code: pose })
            emplacementFinal = pose
            message += ` Rangée en ${pose}.`
            setCasier('')
          } catch (error: any) {
            // Le serveur nomme l'occupant d'un casier déjà pris : ce message doit passer,
            // sinon la vendeuse repose la monture sur une place occupée.
            message += ` Casier refusé : ${error?.message || 'erreur serveur'}.`
            echec = true
          }
        }
      }

      if (attendue) {
        onReceived()
        // Popup imprimable/téléchargeable, uniquement à la 1ère réception : une
        // recherche d'une monture déjà au présentoir n'a pas besoin d'une nouvelle
        // étiquette.
        setReceptionLabel({
          title: glass.brand || '—',
          reference: glassRef(glass),
          barcodeValue: glass.barcode,
          metaLeft: emplacementFinal || 'Emplacement non attribué',
          metaRight: fmtFCFA(glass.price),
          filePrefix: 'etiquette',
        })
      }
      setStatus(message)
      setTone(echec ? 'error' : 'success')
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

      // Trier par score de recommandation sans modifier le filtrage métier.
      matches.sort((a, b) => calculateRecommendationScore(glass, b) - calculateRecommendationScore(glass, a))
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
          {/* Le casier où la monture est physiquement posée. Laissé vide, le serveur en
              attribue un automatiquement — c'est ce qu'il faisait seul jusqu'ici, et rien
              n'oblige à le renseigner monture par monture. */}
          <input
            type="text"
            value={casier}
            onChange={e => setCasier(e.target.value)}
            placeholder="Casier (PR01-1)"
            autoComplete="off"
            className="sm:w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600"
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
            <div className="flex flex-shrink-0 items-center gap-3">
              <p className="text-lg font-black tabular-nums" style={{ color: '#2563eb' }}>{fmtFCFA(found.price)}</p>
              <button
                type="button"
                onClick={() => downloadCSV(
                  `monture-${found.barcode || glassRef(found)}`,
                  ['Référence', 'Code-barres', 'Marque', 'Forme', 'Couleur', 'Matière', 'Genre',
                    'Gamme', 'Statut', 'Emplacement', 'Station', 'Prix', 'Enregistrée le'],
                  [[
                    glassRef(found), found.barcode || '', found.brand || '', found.shape || '',
                    found.color || '', found.material || '', found.gender || '',
                    getGamme(found.price), String(found.status || ''), found.location_code || '',
                    found.station_name || '', String(found.price ?? ''), fmtDate(found.created_at),
                  ]],
                )}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
                </svg>
                Télécharger en excel
              </button>
            </div>
          </div>
          <div className="mt-5 flex flex-col lg:flex-row gap-4">
            <div className="flex-1 flex flex-col gap-4">
              <Photo src={monturePhoto(found)} label="Monture" />
              <Photo src={branchePhoto(found)} label="Branche" />
            </div>

            <div className="w-full lg:w-[45%]">
              {/* L'emplacement sort de la grille : c'est le seul champ qui déclenche un
                  déplacement — la vendeuse le lit pour aller chercher la monture. Noyé
                  parmi dix attributs descriptifs, il se cherchait à chaque fois. */}
              <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/50">
                <p className="text-[11px] text-slate-400 dark:text-slate-500">Emplacement</p>
                <p className="font-mono text-sm font-bold leading-tight text-slate-900 break-words dark:text-white">
                  {found.location_code || '—'}
                </p>
                {found.station_name && (
                  <p className="mt-0.5 text-[11px] text-slate-400">{found.station_name}</p>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                {[
                  ['Marque', found.brand], ['Forme', found.shape], ['Couleur', found.color],
                  ['Matière', found.material], ['Genre', found.gender],
                  ['Gamme', getGamme(found.price)], ['Statut', found.status],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">{label}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200 break-words">{value || '—'}</p>
                  </div>
                ))}
              </div>
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
        <SectionTitle
          action={
            <div className="text-right">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {data.presentoir.length} monture{data.presentoir.length > 1 ? 's' : ''}
              </span>
              <span className="block text-xs text-slate-400 dark:text-slate-500">
                {new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </span>
            </div>
          }
        >
          Présentoir
        </SectionTitle>
        {data.presentoir.length === 0 ? (
          <EmptyState>Aucune monture au présentoir.</EmptyState>
        ) : (
          <PresentoirTable glasses={data.presentoir} />
        )}
      </div>

      {receptionLabel && (
        <PresentoirLabelModal
          label={receptionLabel}
          onClose={() => {
            setReceptionLabel(null)
            inputRef.current?.focus()
          }}
        />
      )}
    </div>
  )
}

// ── Présentoir par bloc ──────────────────────────────────────────────────────────
/** Écran dédié, séparé du Scan : le regroupement par meuble sert à orienter une cliente
 *  vers un rayon précis, une tâche différente de la recherche par code-barres. */
function PresentoirBlocScreen({ data }: { data: StoreData }) {
  return (
    <div className="space-y-4">
      <SectionTitle>Présentoir par bloc</SectionTitle>
      {data.presentoir.length === 0 ? (
        <EmptyState>Aucune monture au présentoir.</EmptyState>
      ) : (
        <PresentoirParBloc glasses={data.presentoir} />
      )}
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

  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(mine.length / ACTIONS_PAR_PAGE))
  // Bornée à chaque rendu plutôt que remise à zéro par un effet : un rechargement des
  // mouvements peut raccourcir la liste sous la page courante, qui afficherait alors du
  // vide. On retombe sur la dernière page existante sans faire clignoter la première.
  const pageSure = Math.min(page, pages - 1)
  const visibles = mine.slice(pageSure * ACTIONS_PAR_PAGE, pageSure * ACTIONS_PAR_PAGE + ACTIONS_PAR_PAGE)

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
            {visibles.map((movement, index) => (
              <Card key={`${movement.barcode}-${pageSure}-${index}`} className="flex items-center gap-3">
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

            {/* Masquée sur une seule page : deux boutons inertes sous une liste courte
                donnent l'impression qu'il manque quelque chose. */}
            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={pageSure === 0}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Précédent
                </button>

                {/* Le total, pas seulement le numéro de page : c'est lui qui dit combien
                    d'actions on a à son nom, et il est utile en soi sur cet écran. */}
                <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
                  Page {pageSure + 1} / {pages} · {mine.length} action{mine.length > 1 ? 's' : ''}
                </span>

                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                  disabled={pageSure >= pages - 1}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  Suivant
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Remise client ──────────────────────────────────────────────────────────────
/** Rendre au client les lunettes que le laboratoire a terminées.
 *
 *  Cet écran vivait au poste R. Magasin. Il est ici parce que c'est la vendeuse qui reçoit
 *  le client : celui qui vient chercher ses lunettes se présente devant elle, pas devant le
 *  responsable.
 *
 *  Le pointage est local jusqu'à la validation : on scanne les paires du client, on relit,
 *  puis on enregistre d'un geste. C'est `POST /inventory/deliveries/handover` qui acte la
 *  sortie — statut `LIVREE` et mouvement `REMISE_CLIENT` — après quoi les montures quittent
 *  la liste des paires en attente. */
function RemiseScreen({ data, loading, stationId, onDone }: {
  data: StoreData
  loading: boolean
  stationId: number | null
  onDone: () => void
}) {
  const [pointees, setPointees] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'error' | 'success' | ''>('')

  // Le client se lit sur la proforma qui porte la monture : le backend ne le stocke pas sur
  // la fiche. Sans lui, la vendeuse ne saurait pas à qui rendre la paire qu'elle tient.
  const clientParBarcode = useMemo(() => {
    const index = new Map<string, string>()
    for (const proforma of data.proformas) {
      for (const item of proforma.items || []) {
        for (const cle of [item.barcode, item.reference]) {
          const key = String(cle || '').trim().toUpperCase()
          if (key && proforma.client_name) index.set(key, proforma.client_name)
        }
      }
    }
    return index
  }, [data.proformas])

  const clientDe = (glass: Glass) =>
    clientParBarcode.get(String(glass.barcode || '').trim().toUpperCase())
      || clientParBarcode.get(String(glass.reference || '').trim().toUpperCase())
      || 'Client non rattaché'

  const reste = Math.max(0, data.pretes.length - pointees.length)

  /** Enregistre les paires pointées. Tant qu'on n'a pas cliqué, rien n'est parti : la
   *  vendeuse scanne, vérifie, puis valide — le client est devant elle, elle ne doit pas
   *  déclencher une sortie de stock à chaque bip. */
  async function remettre() {
    if (pointees.length === 0 || busy) return
    if (!stationId) {
      setMessage("Aucune station rattachée à ce compte : impossible d'enregistrer la remise.")
      setTone('error')
      return
    }

    setBusy(true)
    setMessage('')
    try {
      const payload = await apiFetch('/inventory/deliveries/handover', {
        method: 'POST',
        body: JSON.stringify({ station_id: stationId, barcodes: pointees }),
      })

      const remises: string[] = payload?.data?.handed_over || []
      const refusees: { barcode?: string; reason?: string }[] = payload?.data?.skipped || []

      let texte = `${remises.length} monture${remises.length > 1 ? 's' : ''} remise${remises.length > 1 ? 's' : ''} au client.`
      // Les refus sont nommés, pas tus : la vendeuse tient les paires en main et doit savoir
      // laquelle n'est pas passée avant que le client reparte avec.
      if (refusees.length > 0) {
        const detail = refusees.map(item => `${item.barcode || '?'} — ${item.reason || 'refusée'}`).join(' · ')
        texte += ` ${refusees.length} refusée${refusees.length > 1 ? 's' : ''} : ${detail}.`
      }

      setMessage(texte)
      setTone(refusees.length > 0 ? 'error' : 'success')
      setPointees([])
      setCode('')
      // Les montures remises quittent PRETE_A_LIVRER : la liste doit se relire, sinon elles
      // resteraient affichées comme si le client attendait toujours.
      onDone()
    } catch (error: any) {
      setMessage(error?.message || "Impossible d'enregistrer la remise.")
      setTone('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-2.5">
          <span className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#0891b218', color: '#0891b2' }}>
            {ic.hand()}
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">Remettre au client</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">Scannez le code-barres de la monture pour la pointer comme remise</p>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
          <div>
            <label className="block text-xs font-medium text-slate-400 dark:text-slate-500 mb-1" htmlFor="refRemise">
              Code-barres ou référence
            </label>
            <input
              id="refRemise"
              type="text"
              value={code}
              onChange={e => {
                const value = e.target.value
                setCode(value)
                // La douchette envoie le code d'un bloc : on valide dès qu'il correspond,
                // sans attendre un Entrée que tous les lecteurs n'émettent pas.
                const saisie = value.trim()
                const trouvee = data.pretes.find(g => g.barcode === saisie || glassRef(g) === saisie.toUpperCase())
                if (trouvee && !pointees.includes(trouvee.barcode)) {
                  setPointees(liste => [...liste, trouvee.barcode])
                  setCode('')
                }
              }}
              placeholder="Scanner ou saisir…"
              autoFocus
              autoComplete="off"
              className={FIELD}
            />
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              La saisie se valide seule dès qu'elle correspond à une monture prête.
            </p>
          </div>

          {/* Le code se redessine à la frappe : contrôle visuel face à l'étiquette, et code
              à présenter quand la douchette est en panne. */}
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-full h-[92px] rounded-xl border-2 bg-white p-2 flex items-center justify-center" style={{ borderColor: '#0891b2' }}>
              {code.trim()
                ? <ProformaBarcode value={code.trim()} />
                : <span className="text-xs text-slate-400 text-center">En attente<br />d'un scan</span>}
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">CODE128</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {[
            { label: 'À remettre', value: data.pretes.length, color: '#0891b2' },
            { label: 'Pointées', value: pointees.length, color: '#16a34a' },
            { label: 'Reste', value: reste, color: '#d97706' },
          ].map(tuile => (
            <div key={tuile.label} className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
              <p className="text-xs text-slate-400 dark:text-slate-500">{tuile.label}</p>
              <p className="mt-1 text-3xl font-black tabular-nums" style={{ color: tuile.color }}>{tuile.value}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${data.pretes.length > 0 ? (pointees.length / data.pretes.length) * 100 : 0}%`,
              backgroundColor: '#16a34a',
            }}
          />
        </div>
      </Card>

      <div>
        <SectionTitle
          action={<span className="text-xs text-slate-400 tabular-nums">{pointees.length}/{data.pretes.length}</span>}
        >
          Montures prêtes
        </SectionTitle>
        <div className="space-y-2">
          {loading && data.pretes.length === 0 ? (
            <EmptyState>Chargement…</EmptyState>
          ) : data.pretes.length === 0 ? (
            <EmptyState>Aucune monture prête à remettre.</EmptyState>
          ) : (
            data.pretes.map(glass => {
              const pointee = pointees.includes(glass.barcode)
              return (
                <div
                  key={glass.barcode}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                    pointee
                      ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                      : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{glassRef(glass)}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{clientDe(glass)}</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate font-mono">{glass.barcode}</p>
                  </div>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap flex-shrink-0 ${
                    pointee
                      ? 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                      : 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                  }`}>
                    {pointee ? ic.check('w-3.5 h-3.5') : ic.clock('w-3.5 h-3.5')}
                    {pointee ? 'Pointée' : 'En attente'}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {message && (
        <p className={`text-xs leading-snug ${tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
          {message}
        </p>
      )}

      {pointees.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button
            onClick={() => void remettre()}
            disabled={busy}
            className="flex-1 rounded-xl bg-green-600 hover:bg-green-700 px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          >
            {busy
              ? 'Enregistrement…'
              : `Remettre ${pointees.length} monture${pointees.length > 1 ? 's' : ''} au client`}
          </button>
          <button
            onClick={() => { setPointees([]); setCode(''); setMessage('') }}
            disabled={busy}
            className="rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-60"
          >
            Annuler le pointage
          </button>
        </div>
      )}
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
          {ic.signOut('w-4 h-4')}
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
      {/* Déconnexion vit dans la barre latérale ; sur mobile elle n'existe pas, elle
          remonte donc ici. */}
      <button
        onClick={logoutToLogin}
        className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0"
        aria-label="Se déconnecter"
      >
        {ic.signOut('w-4 h-4')}
      </button>
    </header>
  )
}

// ── Chatbot ────────────────────────────────────────────────────────────────────
// Même assistant que celui de la Direction (App.tsx), mais avec un digest volontairement
// réduit : ni les autres magasins, ni la liste des employés, ni les commandes fournisseur.
// Une vendeuse n'a pas à voir le stock ou le personnel d'une autre ville — seulement ce qui
// se passe dans son propre magasin.
interface ChatMsg { role: 'user' | 'assistant'; content: string }

function sanitizeForSpeech(text: string) {
  return text
    // Liens et images : seul le texte visible se prononce, pas l'URL.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Gras/italique/barré, du plus large délimiteur au plus étroit pour ne pas couper
    // un ** au milieu d'un ***.
    .replace(/(\*\*\*|___)(.*?)\1/g, '$2')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    // Code : les blocs disparaissent (illisibles à l'oral), l'inline garde son contenu.
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    // Titres, citations, puces et numérotation en début de ligne.
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    // Ce qui subsiste (astérisque isolé, dièse, tilde...) : supprimé plutôt qu'épelé.
    .replace(/[*_#>`~]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function VendeuseChatBot({ onClose, stationId, stationName, screen }: {
  onClose: () => void
  stationId: number | null
  stationName?: string
  screen: Screen
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', content: "Bonjour ! Je suis Lunette, votre assistant IA. Posez-moi vos questions sur le stock et les ventes de votre magasin." },
  ])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [status, setStatus] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  // Le digest est chargé dès l'ouverture du chat, mais `send` peut partir avant la fin :
  // on garde la promesse pour l'attendre plutôt que de partir avec un contexte vide.
  const digestRef = useRef<Promise<Record<string, unknown>> | null>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  useEffect(() => { digestRef.current = loadAssistantDigest() }, [stationId])

  // Un seul appel, filtré sur la station : contrairement au digest de la Direction, celui-ci
  // ne croise ni employés ni commandes fournisseur — la vendeuse n'a besoin de voir ni l'un
  // ni l'autre pour répondre à une cliente.
  async function loadAssistantDigest(): Promise<Record<string, unknown>> {
    if (!stationId) return {}

    const results = await Promise.allSettled([
      apiFetch(`/inventory/glasses?station_id=${stationId}`),
      apiFetch('/inventory/movements?limit=300&offset=0'),
    ])
    const [glassesR, movementsR] = results
    const glasses = glassesR.status === 'fulfilled' ? (glassesR.value?.data?.glasses || []) : []

    // Le journal ne se filtre pas par station côté serveur : on ne garde que les
    // mouvements qui touchent ce magasin, comme le fait déjà responsable.tsx.
    const station = String(stationName || '').trim().toLowerCase()
    const allMovements = movementsR.status === 'fulfilled' ? (movementsR.value?.data?.movements || []) : []
    const movements = station
      ? allMovements.filter((m: any) => {
        const from = String(m.from_station_name || '').trim().toLowerCase()
        const to = String(m.to_station_name || '').trim().toLowerCase()
        return from === station || to === station
      })
      : allMovements

    const digest = buildStockDigest({ glasses, movements, users: [], stations: [], receptionCommands: [], supplierOrders: [] })

    // Détail des montures au présentoir, avec pour chacune ses meilleures alternatives —
    // même calcul que le tableau Présentoir à l'écran (genre 20 % / forme 50 % / gamme
    // 30 %, glassSimilarity.ts) : la vendeuse doit obtenir du chatbot les mêmes
    // correspondances que celles qu'elle verrait en comparant elle-même à l'écran, pas une
    // estimation approximative faite au jugé sur la liste brute.
    const presentoirGlasses = glasses.filter((g: any) => String(g.status || '').toUpperCase() === 'EN_PRESENTOIR')
    const presentoir = presentoirGlasses.map((glass: any) => ({
      barcode: glass.barcode,
      reference: glass.reference,
      marque: glass.brand,
      genre: glass.gender,
      forme: glass.shape,
      couleur: glass.color,
      matiere: glass.material,
      gamme: getGamme(glass.price),
      prix: glass.price,
      emplacement: glass.location_code,
      montures_similaires: rankSimilarGlasses(glass, presentoirGlasses)
        .filter(entry => entry.score > 0.5)
        .slice(0, 5)
        .map(entry => ({
          barcode: entry.glass.barcode,
          reference: entry.glass.reference,
          marque: entry.glass.brand,
          couleur: entry.glass.color,
          similarite_pourcent: Math.round(entry.score * 100),
        })),
    }))

    return { ...digest, presentoir_detail: presentoir }
  }

  async function send() {
    if (!input.trim() || isSending) return
    const q = input.trim()
    const history = messages
    setMessages(prev => [...prev, { role: 'user', content: q }])
    setInput('')
    setIsSending(true)
    setStatus('')

    try {
      const token = getToken()
      const digest = await (digestRef.current ?? Promise.resolve({}))
      const response = await fetch(`${API_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildAssistantPayload(q, history, {
          screen: `vendeuse:${screen}`,
          summary: { stationId, stationName },
          digest,
        })),
      })

      const payload = await response.json().catch(() => ({}))
      const reply = payload?.data?.reply || "Je ne peux pas joindre le service IA pour le moment."
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(sanitizeForSpeech(reply))
        u.lang = 'fr-FR'; u.rate = 0.9
        speechSynthesis.cancel(); speechSynthesis.speak(u)
      }
    } catch {
      const fallback = 'Le service de chat est actuellement indisponible. Réessayez dans un instant.'
      setMessages(prev => [...prev, { role: 'assistant', content: fallback }])
      setStatus('Service indisponible')
    } finally {
      setIsSending(false)
    }
  }

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) return
    const r = new SR(); r.lang = 'fr-FR'
    r.onresult = (e: any) => { setInput(e.results[0][0].transcript); setListening(false) }
    r.onerror = () => setListening(false); r.onend = () => setListening(false)
    if (listening) { r.stop(); setListening(false) } else { r.start(); setListening(true) }
  }

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-white dark:bg-slate-950 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden z-50" style={{ height: 400 }}>
      <div className="px-4 py-3 bg-gradient-to-r from-blue-600 to-blue-700 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          {ic.bot('w-4 h-4 text-white')}
          <span className="font-bold text-white text-sm">Lunette AI</span>
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
        </div>
        <button onClick={onClose} className="text-blue-200 hover:text-white transition-colors">{ic.x('w-4 h-4')}</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed ${m.role === 'user' ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-bl-sm'}`}>
              {m.content}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="px-3 py-2.5 border-t border-slate-100 dark:border-slate-800 flex gap-2 flex-shrink-0">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} disabled={isSending} placeholder="Posez une question..." className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-900 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 border border-slate-200 dark:border-slate-700 disabled:opacity-60" />
        <button onClick={toggleMic} className={`p-2 rounded-xl transition-all ${listening ? 'bg-red-500 text-white scale-110' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-blue-600'}`}>{ic.mic()}</button>
        <button onClick={send} disabled={isSending} className="p-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors active:scale-95 disabled:opacity-60">{ic.send()}</button>
      </div>
      {status && <p className="px-3 pb-2 text-[11px] text-slate-500 dark:text-slate-400">{status}</p>}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
function VendeusePage() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [screen, setScreen] = useState<Screen>('dashboard')
  const [table, setTable] = useState<TableId | null>(null)
  const [dark, setDark] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  // Bouton flottant déplaçable, même geste que la Direction (App.tsx) : le pouce peut le
  // sortir du coin s'il masque un bouton de l'écran en dessous.
  const [chatButtonPos, setChatButtonPos] = useState<{ x: number; y: number } | null>(null)
  const chatButtonDragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0, moved: false })
  const preventChatButtonClickRef = useRef(false)

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

  // Glisser le bouton compte comme un déplacement, pas comme un clic : sans ce garde-fou,
  // relâcher après un glissement rouvrirait le chat au même geste.
  function handleChatButtonPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const originX = chatButtonPos?.x ?? rect.left
    const originY = chatButtonPos?.y ?? rect.top

    chatButtonDragRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
      moved: false,
    }
    preventChatButtonClickRef.current = false

    const handleMove = (moveEvent: PointerEvent) => {
      if (!chatButtonDragRef.current.active) return
      const dx = moveEvent.clientX - chatButtonDragRef.current.startX
      const dy = moveEvent.clientY - chatButtonDragRef.current.startY

      if (!chatButtonDragRef.current.moved && Math.abs(dx) + Math.abs(dy) < 4) return
      chatButtonDragRef.current.moved = true

      const nextX = chatButtonDragRef.current.originX + dx
      const nextY = chatButtonDragRef.current.originY + dy
      const clampedX = Math.max(12, Math.min(nextX, window.innerWidth - 64))
      const clampedY = Math.max(12, Math.min(nextY, window.innerHeight - 64))
      setChatButtonPos({ x: clampedX, y: clampedY })
    }

    const handleUp = () => {
      if (chatButtonDragRef.current.active && chatButtonDragRef.current.moved) {
        preventChatButtonClickRef.current = true
      }
      chatButtonDragRef.current.active = false
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleChatButtonClick() {
    if (preventChatButtonClickRef.current) {
      preventChatButtonClickRef.current = false
      return
    }
    setChatOpen(v => !v)
  }

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
                {screen === 'scan' && <ScanScreen data={data} stationId={stationId} onReceived={() => void reload()} />}
                {screen === 'bloc' && <PresentoirBlocScreen data={data} />}
                {screen === 'reclamation' && <ReclamationScreen stationId={stationId} onDone={() => void reload()} />}
                {screen === 'stats' && <StatsScreen data={data} user={user} />}
              </>
            )}
          </main>
        </div>

        <MobileNav current={screen} onNavigate={navigate} />

        <button
          onClick={handleChatButtonClick}
          onPointerDown={handleChatButtonPointerDown}
          className="fixed z-50 flex items-center justify-center w-16 h-16 rounded-full bg-blue-600 shadow-[0_10px_30px_rgba(37,99,235,0.35)] hover:bg-blue-500 transition-all active:scale-95"
          style={{ touchAction: 'none', ...(chatButtonPos ? { left: chatButtonPos.x, top: chatButtonPos.y } : { bottom: 20, right: 20 }) }}
          aria-label="Ouvrir Lunette AI"
        >
          {ic.whatsapp('w-8 h-8 text-white')}
        </button>

        {chatOpen && (
          <VendeuseChatBot
            onClose={() => setChatOpen(false)}
            stationId={stationId}
            stationName={user?.station_name}
            screen={screen}
          />
        )}
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <VendeusePage />
  </React.StrictMode>,
)
