import React, { useState, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { buildAssistantPayload, buildStockDigest, mapChatActionToScreen } from './chatContext'
import { summarizeStockSummary } from './dashboardMetrics'
// Importé plutôt que référencé par URL : il n'y a pas de dossier public/ ici, donc un
// chemin littéral ne serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'

// ── Types ─────────────────────────────────────────────────────────────────────
type ModuleId = 'register' | 'reception' | 'employees' | 'orders' | 'supplier' | 'history'

type Block = 'total' | 'ca' | 'suivi'

type SuiviSection = 'stock' | 'labo' | 'presentoire' | 'placement'

type NavScreen =
  | { type: 'dashboard' }
  | { type: 'pays'; block: Block }
  | { type: 'city'; block: 'total' | 'ca'; pays: string; city: string }
  | { type: 'suivi-detail'; pays: string; city: string; section: SuiviSection }
  | { type: 'frame'; ref: string; city: string }
  | { type: 'module'; id: ModuleId }

interface CityStats {
  local: number; presentoir: number; labo: number; reserve: number
  vendues: number; transit: number; color: string; revenue: number
}

interface CountryItem {
  id?: number
  name: string
  code?: string
  flag: string
  cities: string[]
}

interface FrameRecord {
  ref: string
  marque: string
  /** Employé ayant enregistré la monture — la table glasses ne porte pas d'auteur. */
  enregistrePar: string
  date: string
  status: string
  genre?: string
  forme?: string
  entree?: string
  photo?: string
  gamme?: string
  price?: number | string
  emplacement?: string
}

interface Employee {
  id: number
  name: string
  role: string
  station: string
  group: 'Station Générale' | 'Sous-stations' | 'Laboratoire'
  status: string
  avatar: string
}

type MvtStage = 'ordered' | 'shipped' | 'received' | 'transferred' | 'display' | 'sold'

function getEmployeeGroup(stationName?: string) {
  const normalized = String(stationName || '').toLowerCase()
  if (normalized.includes('laboratoire') || normalized.includes('labo')) return 'Laboratoire'
  if (normalized.includes('général') || normalized.includes('general') || normalized.includes('principal') || normalized.includes('station générale') || normalized.includes('station generale')) {
    return 'Station Générale'
  }
  return 'Sous-stations'
}

function getEmployeeAvatar(name?: string) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'EU'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

interface Movement {
  id: string; stage: MvtStage; frames: number
  from: string; to: string; date: string; time: string
  operator: string; notes?: string
}

function normalizeMovementStage(action?: string, toStationName?: string): MvtStage {
  const normalizedAction = String(action || '').trim().toUpperCase()
  const normalizedStation = String(toStationName || '').trim().toLowerCase()

  if (normalizedAction === 'RECEPTION_FOURNISSEUR') return 'ordered'
  if (normalizedAction === 'EXPEDITION') return 'shipped'
  if (normalizedAction === 'RECEPTION_STATION') return 'received'
  if (normalizedAction === 'RANGEMENT') return 'transferred'
  if (normalizedAction === 'PRESENTOIR' || normalizedStation.includes('présentoir') || normalizedStation.includes('presentoir')) return 'display'
  if (normalizedAction === 'LIVRAISON' || normalizedAction === 'VENTE' || normalizedAction === 'VENDUE') return 'sold'

  if (normalizedStation.includes('laboratoire') || normalizedStation.includes('labo')) return 'display'
  if (normalizedStation.includes('présentoir') || normalizedStation.includes('presentoir')) return 'display'

  return 'received'
}

function formatMovementDate(dateValue?: string) {
  const raw = dateValue || new Date().toISOString()
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return { date: raw.slice(0, 10), time: raw.slice(11, 16) }
  }

  return {
    date: date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    time: date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  }
}

interface ChatMsg { role: 'user' | 'assistant'; content: string }

// ── Data ──────────────────────────────────────────────────────────────────────
const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

function logoutAndRedirectToIndex() {
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('user')
  window.location.assign('/index.html')
}

if (typeof window !== 'undefined' && window.fetch) {
  const originalFetch = window.fetch.bind(window) as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  const patchedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = async (input, init) => {
    const response = await originalFetch(input, init)
    if (response.status === 401 || response.status === 403) {
      logoutAndRedirectToIndex()
    }
    return response
  }
  window.fetch = patchedFetch as unknown as typeof window.fetch
}

const COUNTRIES: CountryItem[] = []

const REVENUE_ROWS: Record<string, { ref: string; montant: number; date: string; client: string; status: string }[]> = {}

function normalizeShapeName(value?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const mapping: Record<string, string> = {
    'rectangle': 'Rectangle',
    'rectangulaire': 'Rectangle',
    'rond': 'Rond',
    'ronde': 'Rond',
    'ovale': 'Ovale',
    'carre': 'Carré',
    'carré': 'Carré',
    'papillon': 'Papillon',
    'aviateur': 'Aviateur',
    'wayfarer': 'Wayfarer',
    'cat-eye': 'Cat-eye',
    'cat eye': 'Cat-eye',
    'clubmaster': 'Clubmaster',
    'browline': 'Browline',
    'hexagonal': 'Hexagonal',
    'pantos': 'Pantos',
    'masque': 'Masque',
    'papillon oversize': 'Papillon oversize',
  }

  return mapping[normalized] || raw
}

function normalizeGammeName(value?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const mapping: Record<string, string> = {
    'premium': 'luxe',
    'luxe': 'luxe',
    'standard': 'moyenne',
    'moyenne': 'moyenne',
    'eco': 'classique',
    'classic': 'classique',
    'classique': 'classique',
    'moyen': 'moyenne',
  }

  return mapping[normalized] || ''
}

function classifyGammeFromPrice(price?: number | string) {
  const numericPrice = Number(price ?? 0)
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) return 'classique'
  if (numericPrice <= 70000) return 'classique'
  if (numericPrice <= 90000) return 'moyenne'
  return 'luxe'
}

function resolveFrameGamme(value?: string, price?: number | string) {
  const normalized = normalizeGammeName(value)
  if (normalized) return normalized
  return classifyGammeFromPrice(price)
}

const SHAPE_FILTER_OPTIONS = ['all', 'Rectangle', 'Rond', 'Ovale', 'Carré', 'Papillon', 'Aviateur', 'Wayfarer', 'Cat-eye', 'Clubmaster', 'Browline', 'Hexagonal', 'Pantos', 'Masque', 'Papillon oversize'] as const
const GAMME_FILTER_OPTIONS = ['all', 'classique', 'moyenne', 'luxe'] as const
// Genres de monture — à ne pas confondre avec le genre d'un employé (Homme/Femme/Autre),
// qui décrit une personne et n'a rien à voir avec ces valeurs.
const GENRE_FILTER_OPTIONS = ['all', 'Homme', 'Femme', 'Enfant', 'Unisexe'] as const
type GenreFilterValue = typeof GENRE_FILTER_OPTIONS[number]

type ShapeFilterValue = typeof SHAPE_FILTER_OPTIONS[number]
type GammeFilterValue = typeof GAMME_FILTER_OPTIONS[number]

function mapGlassStatusToUI(status?: string) {
  const normalized = String(status || '').trim().toUpperCase()

  if (normalized === 'EN_STOCK_GENERAL') return 'Stock général'
  if (normalized === 'EN_STOCK_SOUS_STATION') return 'Stock magasin'
  if (normalized === 'EN_PRESENTOIR') return 'Présentoir'
  if (normalized === 'EN_LABORATOIRE') return 'Laboratoire'
  if (normalized === 'RESERVEE' || normalized === 'RESERVE') return 'Réservé'
  if (normalized === 'VENDUE' || normalized === 'VENDU') return 'Vendu'

  return 'Stock général'
}

function buildFrameRowsFromGlasses(glasses: any[], stationMap: Map<number, string>) {
  const rowsByCity: Record<string, FrameRecord[]> = {}

  glasses.forEach((glass: any) => {
    const stationId = Number(glass.station_id)
    const city = stationId && stationMap.has(stationId) ? stationMap.get(stationId)! : 'Pointe-Noire'
    const ref = String(glass.reference || glass.barcode || 'REF-SANS-NOM')
    const createdAt = glass.created_at ? String(glass.created_at) : new Date().toISOString()
    const date = createdAt.slice(0, 10)
    const time = createdAt.includes('T') ? createdAt.slice(11, 16) : createdAt.slice(11, 16)
    const row: FrameRecord = {
      ref,
      marque: glass.brand || '—',
      enregistrePar: glass.registered_by || '—',
      date,
      status: mapGlassStatusToUI(glass.status),
      genre: glass.gender || '—',
      forme: normalizeShapeName(glass.shape) || '—',
      entree: `${date} ${time}`,
      photo: glass.photo_monture_url || '',
      gamme: resolveFrameGamme(glass.material, glass.price),
      price: glass.price ?? 0,
      emplacement: glass.location_code || glass.station_name || '—',
    }

    if (!rowsByCity[city]) rowsByCity[city] = []
    rowsByCity[city].push(row)
  })

  return rowsByCity
}

const MOVEMENTS_DATA: Movement[] = []

const STOCK_STATUSES = ['EN_STOCK_GENERAL', 'EN_STOCK_SOUS_STATION', 'EN_PRESENTOIR', 'EN_LABORATOIRE', 'RESERVE'] as const

// Tous les statuts de models/enums.go. Le chatbot reçoit la base entière, vendues et
// pertes comprises, et filtre lui-même sur le champ `status`.
const ALL_GLASS_STATUSES = [
  'RECU_FOURNISSEUR', 'EN_STOCK_GENERAL', 'EN_TRANSIT', 'EN_STOCK_SOUS_STATION',
  'EN_PRESENTOIR', 'RESERVEE', 'EN_LABORATOIRE', 'PRETE_A_LIVRER',
  'VENDUE', 'PERDUE', 'CASSEE', 'RETOURNEE',
] as const

const EMPLOYEES: Array<{ id: number; name: string; role: string; station: string; group: string; status: string; avatar: string }> = []

interface ReceptionSessionResult {
  id?: number
  orderId: number
  code: string
  targetCount: number
  registeredCount?: number
  status: string
  compareText?: string
}

const RECEPTION_SESSIONS: Array<{ id: string; orderId?: number; date: string; time: string; frames: number; status: string; operator: string; note?: string; quantity?: number }> = []

const SUPPLIER_ORDERS_INIT: Array<{ id: string; supplier: string; quantity: number; sent: number; date: string; note: string; status: 'partial' | 'complete' | 'pending' }> = []

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`
  return String(n)
}
function fmtFCFA(n: number) { return `${fmt(n)} FCFA` }

function normalizeStationCityName(station: { id?: number; name?: string; city?: string }) {
  const raw = String(station.city || station.name || '').trim()
  if (!raw) return ''
  return raw.replace(/^station\s+/i, '').trim()
}

function isStoreStation(station: { id?: number; name?: string; city?: string; type?: string }) {
  if (!station || !station.name) return false
  const type = String(station.type || '').toUpperCase()
  const name = String(station.name || '').toLowerCase()

  if (type === 'STOCK_GENERAL') return false
  if (type === 'SOUS_STATION') {
    if (name.includes('présentoir') || name.includes('presentoir') || name.includes('laboratoire') || name.includes('labo')) {
      return false
    }
    return true
  }

  return true
}

function getCityTotal(stats?: CityStats) {
  return stats ? (stats.local + stats.presentoir + stats.labo + stats.reserve) : 0
}

function isGeneralStockStatus(status: string) {
  const normalized = String(status || '').trim().toUpperCase()
  return normalized === 'EN_STOCK_GENERAL'
}

function isLocalStockStatus(status: string) {
  const normalized = String(status || '').trim().toUpperCase()
  return normalized === 'EN_STOCK_SOUS_STATION'
}

// ── Stock magasin : manquants ─────────────────────────────────────────────────
// Les manquants d'un magasin viennent uniquement de son panier de demande, c'est-à-dire
// des recherches client réellement enregistrées par le chatbot.
type StockAction = '' | 'PANIER' | 'ENVOI'

function normalizeGenderName(value?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (normalized.startsWith('femme')) return 'Femme'
  if (normalized.startsWith('homme')) return 'Homme'
  if (normalized.startsWith('enfant') || normalized.startsWith('junior')) return 'Enfant'
  if (normalized.startsWith('unisex') || normalized.startsWith('mixte')) return 'Unisexe'
  return raw
}

function getGlassRef(glass: any) {
  return String(glass.reference || glass.barcode || '—')
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => (
    char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '"' ? '&quot;' : '&#39;'
  ))
}

// ── Envoi d'une session de réception vers un magasin ──────────────────────────
function exportSessionListCSV(magasin: string, sessionCode: string, glasses: any[]) {
  const headers = ['Référence', 'Code-barres', 'Marque', 'Genre', 'Forme', 'Taille', 'Emplacement']
  const lines = glasses.map(glass => [
    getGlassRef(glass),
    glass.barcode || '—',
    glass.brand || '—',
    normalizeGenderName(glass.gender) || '—',
    normalizeShapeName(glass.shape) || '—',
    glass.size || '—',
    glass.location_code || '—',
  ])
  const csv = '﻿' + [headers, ...lines].map(row => row.join(';')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `envoi-${sessionCode}-${magasin}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link); link.click()
  document.body.removeChild(link); URL.revokeObjectURL(url)
}

function printSessionList(magasin: string, sessionCode: string, glasses: any[]) {
  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) {
    window.alert("Impossible d'ouvrir la fenêtre d'impression. Autorisez les pop-ups pour ce site.")
    return
  }

  const body = glasses.map(glass => `
    <tr>
      <td>${escapeHtml(getGlassRef(glass))}</td>
      <td>${escapeHtml(String(glass.barcode || '—'))}</td>
      <td>${escapeHtml(String(glass.brand || '—'))}</td>
      <td>${escapeHtml(normalizeGenderName(glass.gender) || '—')}</td>
      <td>${escapeHtml(normalizeShapeName(glass.shape) || '—')}</td>
      <td>${escapeHtml(String(glass.location_code || '—'))}</td>
      <td class="tick"></td>
    </tr>`).join('')

  printWindow.document.write(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Envoi ${escapeHtml(sessionCode)} vers ${escapeHtml(magasin)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { font-size: 12px; color: #475569; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; }
  .tick { width: 40px; }
</style></head>
<body>
  <h1>Envoi vers ${escapeHtml(magasin)}</h1>
  <p>Session ${escapeHtml(sessionCode)} · ${glasses.length} monture(s) · ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</p>
  <table>
    <thead><tr><th>Réf</th><th>Code-barres</th><th>Marque</th><th>Genre</th><th>Forme</th><th>Emplacement</th><th>Fait</th></tr></thead>
    <tbody>${body || '<tr><td colspan="7">Aucune monture dans cette session.</td></tr>'}</tbody>
  </table>
</body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

interface SendListLine {
  id: string
  forme: ShapeFilterValue
  genre: 'all' | 'Homme' | 'Femme' | 'Enfant' | 'Unisexe'
  gamme: GammeFilterValue
}

function createSendListLine(): SendListLine {
  return {
    id: `line-${Math.random().toString(36).slice(2, 10)}`,
    forme: 'all',
    genre: 'all',
    gamme: 'all',
  }
}

// ── Paniers de demande ────────────────────────────────────────────────────────
// Un panier par magasin (= une ville). Chaque recherche de monture faite via le chatbot y
// dépose une ligne ; le compteur du panier est le nombre de lignes encore ouvertes.
interface BasketItem {
  id: number
  city: string
  genre?: string
  forme?: string
  gamme?: string
  taille?: string
  source: string
  status: string
  created_at: string
}

// Le chatbot et l'écran stock vivent dans deux composants sans parent commun : le chatbot
// signale par cet événement qu'il vient de déposer une demande, l'écran stock rafraîchit
// ses compteurs.
const BASKET_UPDATED_EVENT = 'lunetterie:basket-updated'

async function postBasketDemand(demand: { city: string; genre?: string; forme?: string; gamme?: string; taille?: string }) {
  const token = window.localStorage.getItem('token')
  if (!token) return false

  try {
    const response = await fetch(`${API_URL}/inventory/baskets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        city: demand.city,
        genre: demand.genre || '',
        forme: demand.forme || '',
        gamme: demand.gamme || '',
        taille: demand.taille || '',
        source: 'CHATBOT',
      }),
    })
    if (!response.ok) return false
    window.dispatchEvent(new CustomEvent(BASKET_UPDATED_EVENT))
    return true
  } catch {
    return false
  }
}

// La taille demandée est comparée par inclusion : le client dit « 52 » alors que la base
// stocke souvent la mesure complète (« 52C18-140 »).
function sizeMatchesDemand(demandSize: string | undefined, glassSize: unknown) {
  const wanted = String(demandSize || '').trim().toLowerCase()
  if (!wanted) return true
  return String(glassSize || '').trim().toLowerCase().includes(wanted)
}

// Une monture du stock principal satisfait une demande quand CHAQUE critère exprimé
// correspond. Un critère absent de la demande n'exclut rien.
function matchesDemand(glass: any, demand: BasketItem) {
  if (demand.genre && normalizeGenderName(demand.genre) !== normalizeGenderName(glass.gender)) return false
  if (demand.forme && normalizeShapeName(demand.forme) !== normalizeShapeName(glass.shape)) return false
  if (demand.gamme && demand.gamme.trim().toLowerCase() !== resolveFrameGamme(glass.material, glass.price)) return false
  if (!sizeMatchesDemand(demand.taille, glass.size)) return false
  return true
}

interface DemandMatchRow {
  demand: BasketItem
  match: any | null
}

// Rapproche chaque demande du stock principal. Une monture déjà attribuée n'est pas
// reproposée : deux clients qui cherchent la même chose ne doivent pas se voir promettre
// la même monture.
function buildDemandMatches(demands: BasketItem[], generalGlasses: any[]): DemandMatchRow[] {
  const pool = generalGlasses.map((glass, index) => ({ glass, key: String(glass.id ?? `g-${index}`) }))
  const taken = new Set<string>()

  return demands.map(demand => {
    const hit = pool.find(entry => !taken.has(entry.key) && matchesDemand(entry.glass, demand))
    if (hit) taken.add(hit.key)
    return { demand, match: hit ? hit.glass : null }
  })
}

function formatDemandCriteria(demand: BasketItem) {
  return [demand.genre, demand.forme, demand.gamme, demand.taille].filter(Boolean).join(' · ') || '—'
}

function exportDemandCSV(city: string, rows: DemandMatchRow[]) {
  const headers = ['Genre', 'Forme', 'Gamme', 'Taille', 'Disponible', 'Monture proposée', 'Emplacement']
  const lines = rows.map(({ demand, match }) => [
    demand.genre || '—',
    demand.forme || '—',
    demand.gamme || '—',
    demand.taille || '—',
    match ? 'oui' : 'non',
    match ? getGlassRef(match) : '—',
    match ? (match.location_code || match.station_name || '—') : '—',
  ])
  const csv = '﻿' + [headers, ...lines].map(row => row.join(';')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `demande-stock-principal-${city}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link); link.click()
  document.body.removeChild(link); URL.revokeObjectURL(url)
}

function printDemandList(city: string, rows: DemandMatchRow[]) {
  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) {
    window.alert("Impossible d'ouvrir la fenêtre d'impression. Autorisez les pop-ups pour ce site.")
    return
  }

  const body = rows.map(({ demand, match }) => `
    <tr>
      <td>${escapeHtml(demand.genre || '—')}</td>
      <td>${escapeHtml(demand.forme || '—')}</td>
      <td>${escapeHtml(demand.gamme || '—')}</td>
      <td>${escapeHtml(demand.taille || '—')}</td>
      <td>${match ? escapeHtml(getGlassRef(match)) : '<em>à commander</em>'}</td>
      <td>${match ? escapeHtml(String(match.location_code || match.station_name || '—')) : '—'}</td>
    </tr>`).join('')

  printWindow.document.write(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Demande au stock principal ${escapeHtml(city)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { font-size: 12px; color: #475569; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; }
  em { color: #b45309; font-style: normal; }
</style></head>
<body>
  <h1>Demande au stock principal — ${escapeHtml(city)}</h1>
  <p>${rows.length} demande(s) client · ${rows.filter(r => r.match).length} disponible(s) en stock principal · ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</p>
  <table>
    <thead><tr><th>Genre</th><th>Forme</th><th>Gamme</th><th>Taille</th><th>Monture proposée</th><th>Emplacement</th></tr></thead>
    <tbody>${body || '<tr><td colspan="6">Aucune demande.</td></tr>'}</tbody>
  </table>
</body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

// Le bon de préparation ne retient que les demandes que le stock principal peut satisfaire :
// une monture physique à aller chercher en rayon, et la demande client qu'elle couvre.
interface PreparationRow {
  demand: BasketItem
  glass: any
}

function buildPreparationRows(demands: BasketItem[], generalGlasses: any[]): PreparationRow[] {
  return buildDemandMatches(demands, generalGlasses)
    .filter(row => row.match)
    .map(row => ({ demand: row.demand, glass: row.match }))
}

function exportPreparationCSV(magasin: string, rows: PreparationRow[]) {
  const headers = ['Référence', 'Marque', 'Genre', 'Forme', 'Taille', 'Emplacement', 'Demande couverte']
  const lines = rows.map(({ demand, glass }) => [
    getGlassRef(glass),
    glass.brand || glass.marque || '—',
    normalizeGenderName(glass.gender) || '—',
    normalizeShapeName(glass.shape) || '—',
    glass.size || '—',
    glass.location_code || glass.station_name || '—',
    formatDemandCriteria(demand),
  ])
  const csv = '﻿' + [headers, ...lines].map(row => row.join(';')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `bon-preparation-${magasin}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link); link.click()
  document.body.removeChild(link); URL.revokeObjectURL(url)
}

function printPreparationList(magasin: string, rows: PreparationRow[]) {
  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) {
    window.alert("Impossible d'ouvrir la fenêtre d'impression. Autorisez les pop-ups pour ce site.")
    return
  }

  const body = rows.map(({ demand, glass }) => `
    <tr>
      <td>${escapeHtml(getGlassRef(glass))}</td>
      <td>${escapeHtml(String(glass.brand || glass.marque || '—'))}</td>
      <td>${escapeHtml(normalizeGenderName(glass.gender) || '—')}</td>
      <td>${escapeHtml(normalizeShapeName(glass.shape) || '—')}</td>
      <td>${escapeHtml(String(glass.location_code || glass.station_name || '—'))}</td>
      <td>${escapeHtml(formatDemandCriteria(demand))}</td>
      <td class="tick"></td>
    </tr>`).join('')

  printWindow.document.write(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Bon de préparation ${escapeHtml(magasin)}</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; color: #0f172a; margin: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { font-size: 12px; color: #475569; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
  th { background: #f1f5f9; }
  .tick { width: 40px; }
</style></head>
<body>
  <h1>Bon de préparation — ${escapeHtml(magasin)}</h1>
  <p>${rows.length} monture(s) à sortir du stock général · ${escapeHtml(new Date().toLocaleDateString('fr-FR'))}</p>
  <table>
    <thead><tr><th>Réf</th><th>Marque</th><th>Genre</th><th>Forme</th><th>Emplacement</th><th>Demande couverte</th><th>Fait</th></tr></thead>
    <tbody>${body || '<tr><td colspan="7">Aucune monture à préparer.</td></tr>'}</tbody>
  </table>
</body></html>`)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

function buildFallbackCityCounts(totalUnits: number): Record<string, CityStats> {
  if (!Number.isFinite(totalUnits) || totalUnits <= 0) return {}

  return {
    'Pointe-Noire': {
      local: totalUnits,
      presentoir: 0,
      labo: 0,
      reserve: 0,
      vendues: 0,
      transit: 0,
      color: '#2563eb',
      revenue: 0,
    },
  }
}

function buildFallbackCountriesFromCityCounts(cityStockCounts: Record<string, CityStats>) {
  const cities = Object.keys(cityStockCounts).sort()
  if (cities.length === 0) return []

  return [{
    id: 1,
    name: 'Congo',
    code: 'CG',
    flag: '🇨🇬',
    cities,
  }]
}

function buildCityStockCounts(
  stations: Array<{ id?: number; name?: string; city?: string; type?: string }>,
  glasses: Array<{ station_id?: number | string; status?: string }>
) {
  const cityByStationId = new Map<number, string>()

  stations.forEach(station => {
    if (station?.id == null) return

    const cityName = normalizeStationCityName(station)
    if (!cityName) return

    if (isStoreStation(station)) {
      cityByStationId.set(Number(station.id), cityName)
      return
    }

    const name = String(station.name || '').toLowerCase()
    if (name.includes('présentoir') || name.includes('presentoir') || name.includes('laboratoire') || name.includes('labo')) {
      cityByStationId.set(Number(station.id), 'Pointe-Noire')
    }
  })

  const counts: Record<string, CityStats> = {}
  glasses.forEach(glass => {
    const stationId = Number(glass.station_id)
    if (!Number.isFinite(stationId)) return
    const city = cityByStationId.get(stationId) || 'Pointe-Noire'

    if (!counts[city]) {
      counts[city] = {
        local: 0,
        presentoir: 0,
        labo: 0,
        reserve: 0,
        vendues: 0,
        transit: 0,
        color: '#0891b2',
        revenue: 0,
      }
    }

    const status = String(glass.status || '').trim().toUpperCase()
    if (isLocalStockStatus(status)) {
      counts[city].local += 1
    } else if (isGeneralStockStatus(status)) {
      // Stock général est distinct du stock magasin ; il ne doit pas augmenter "Stock magasin".
      counts[city].local += 0
    } else if (status === 'EN_PRESENTOIR') {
      counts[city].presentoir += 1
    } else if (status === 'EN_LABORATOIRE') {
      counts[city].labo += 1
    } else if (status === 'RESERVE' || status === 'RESERVEE') {
      counts[city].reserve += 1
    } else {
      counts[city].local += 0
    }
  })

  return counts
}

function getFlagEmoji(code?: string) {
  if (!code) return '🌍'
  const normalized = code.toUpperCase()
  if (!/^[A-Z]{2}$/.test(normalized)) return '🌍'
  return String.fromCodePoint(...[...normalized].map(char => 0x1F1E6 + char.charCodeAt(0) - 65))
}

const STATUS_COLOR: Record<string, string> = {
  partial: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  complete: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  closed: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  'Stock général': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Stock magasin': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'Présentoir': 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  'Laboratoire': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  'En stock': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Réservé': 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  'Vendu': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  'Payé': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Actif': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Inactif': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  'Annulé': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'En attente': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}

function getReceptionCardState(linkedCommand: ReceptionSessionResult | undefined, receivedCount: number, totalCount: number) {
  if (!linkedCommand) return 'idle'
  if (totalCount > 0 && receivedCount >= totalCount) return 'complete'
  if (receivedCount > 0) return 'recording'
  return 'activated'
}

function getReceptionCardClass(state: string) {
  switch (state) {
    case 'activated':
      return 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
    case 'recording':
      return 'bg-orange-50 border-orange-200 dark:bg-orange-900/20 dark:border-orange-700'
    case 'complete':
      return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-900/20 dark:border-emerald-700'
    default:
      return 'bg-slate-300 dark:bg-slate-800 border-slate-400 dark:border-slate-700'
  }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const ic = {
  glasses: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/><path d="M3 12h0M21 12h0M11 12h2"/></svg>,
  home: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  plus: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>,
  tag: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1.5" fill="currentColor" stroke="none"/></svg>,
  order: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M6 4h12v16H6z"/><path d="M6 8h12"/></svg>,
  plane: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M2 12l18-8-2 8 2 8-18-8z"/><path d="M12 4v16"/></svg>,
  box: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5v-9z"/><path d="M12 3v18"/><path d="M3 7.5l9 4.5 9-4.5"/></svg>,
  transfer: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16"/><path d="M14 6l6 6-6 6"/><path d="M10 6l-6 6 6 6"/></svg>,
  display: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/><path d="M8 15l2-2 2 3 3-4"/></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M5 13l4 4L19 7"/></svg>,
  chart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-8"/></svg>,
  users: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  cart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  store: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  hist: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>,
  sun: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  moon: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  bot: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7M9 7h6"/><circle cx="9" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/></svg>,
  whatsapp: (c = 'w-6 h-6') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2.5A9.5 9.5 0 0 0 4.1 16.8L3.5 20.5l3.8-.6a9.5 9.5 0 1 0 4.74-17.4Zm5.2 13.4c-.2.6-.98 1.1-1.6 1.2-.4.1-.9.1-1.5-.1-.4-.1-.9-.3-1.5-.6a7.2 7.2 0 0 1-2.6-2.3c-.5-.6-.9-1.2-1.1-1.8-.1-.4 0-.8.3-1.1l.4-.4c.1-.1.2-.2.3-.2.1 0 .2 0 .3.1l.3.2c.1.1.2.2.2.4l.1.3c0 .2-.1.4-.2.5-.1.1-.2.2-.3.3-.1.1-.2.2-.1.3.1.3.2.6.4.9.3.5.7 1 .9 1.4.2.3.4.6.6.9.1.2.2.3.2.5 0 .1-.1.2-.2.3l-.2.2c-.2.2-.4.3-.7.4ZM12 6.1c-.4 0-.7.3-.7.7v.6c0 .3.2.5.5.6.6.1 1.2.2 1.7.5.5.3.9.7 1.2 1.2.2.3.2.7.1 1.1a.7.7 0 0 1-.6.5H13c-.4 0-.7.3-.7.7 0 .3.3.6.6.7.6.2 1.2.3 1.8.3 1.3 0 2.5-.5 3.3-1.4.8-.9 1.2-2.1 1.2-3.3 0-2.2-1.5-4-3.6-4.4-.7-.1-1.4-.1-2.1-.1Z"/></svg>,
  send: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>,
  mic: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>,
  x: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  search: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>,
  trash: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>,
  back: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>,
  chevRight: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
  chevDown: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
  map: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>,
  download: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>,
  share: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>,
  cal: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>,
  filter: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>,
  pkg: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  flask: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M9 2h6M10 2v6.4a2 2 0 0 1-.4 1.2L4.7 17a2 2 0 0 0 1.6 3.2h11.4a2 2 0 0 0 1.6-3.2l-4.9-7.4a2 2 0 0 1-.4-1.2V2"/></svg>,
}

// Bloc de base repris de historique.html : --surface, --line, --radius-lg (20px), --shadow-sm.
const BLOCK_CLASS = 'rounded-[20px] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900'

// Carte-sélecteur : carrousel à accroche sur mobile, grille à partir de sm.
const CARD_ROW_CLASS = '-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:overflow-x-visible sm:px-0 sm:pb-0'
const CARD_CLASS = 'flex w-[62%] flex-shrink-0 snap-start flex-col items-start gap-2.5 rounded-[20px] border p-5 text-left shadow-sm transition-all hover:-translate-y-[3px] hover:shadow-lg sm:w-auto sm:flex-shrink'

const STAGE_META: Record<MvtStage, { label: string; color: string; bg: string; icon: ReactNode }> = {
  ordered: { label: 'Commande', color: '#d97706', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: ic.order() },
  shipped: { label: 'En transit', color: '#2563eb', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: ic.plane() },
  received: { label: 'Réceptionné', color: '#16a34a', bg: 'bg-green-50 dark:bg-green-900/20', icon: ic.box() },
  transferred: { label: 'Transfert station', color: '#0891b2', bg: 'bg-cyan-50 dark:bg-cyan-900/20', icon: ic.transfer() },
  display: { label: 'Mis en présentoir', color: '#9333ea', bg: 'bg-purple-50 dark:bg-purple-900/20', icon: ic.display() },
  sold: { label: 'Vendu', color: '#059669', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: ic.check() },
}

const ROLE_COLOR: Record<string, string> = {
  VENDEUR: '#2563eb', MAGASINIER: '#16a34a', LABORATOIRE: '#9333ea',
  RESPONSABLE_STATION: '#d97706', CAISSIER: '#0891b2',
}
const ROLE_LABEL: Record<string, string> = {
  VENDEUR: 'Vendeur', MAGASINIER: 'Magasinier', LABORATOIRE: 'Labo',
  RESPONSABLE_STATION: 'Resp. Station', CAISSIER: 'Caissier',
}

// Gabarit du tableau de suivi, partagé par l'en-tête et les lignes : dupliqué, les deux
// finissent toujours par diverger d'une colonne.
const SUIVI_GRID_COLUMNS = '110px minmax(150px, 1.3fr) minmax(110px, 1fr) minmax(110px, 1fr) minmax(80px, 0.8fr) minmax(90px, 0.8fr) minmax(110px, 1fr) minmax(110px, 0.9fr) auto'

const MONTH_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const DAY_FR = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

function exportCSV(frames: FrameRecord[], city: string) {
  const headers = ['Référence', 'Marque', 'Enregistré par', 'Date', 'Statut']
  const rows = frames.map(f => [f.ref, f.marque, f.enregistrePar, f.date, f.status])
  const csv = '﻿' + [headers, ...rows].map(r => r.join(';')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lunettes-${city}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

const SIDEBAR_MODULES: { id: ModuleId; label: string; icon: (c?: string) => React.ReactElement }[] = [
  { id: 'reception', label: 'Expédition', icon: ic.tag },
  { id: 'history', label: 'Suivi Global', icon: ic.hist },
]

// ── Shared UI ─────────────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_COLOR[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

function formatReceptionNote(note: string | undefined, operator: string) {
  const parts = (note || '')
    .split('|')
    .map(part => part.trim())
    .filter(Boolean)

  const deduped: string[] = []
  const seen = new Set<string>()

  for (const part of parts) {
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(part)
  }

  if (deduped.length === 0) {
    return `Pays: ${operator}`
  }

  return deduped.join(' | ')
}

function InputField({ label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      <input {...props} className="mt-1 w-full px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )
}

function GlassesIllustration({ className = 'w-full h-full' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 280 120" fill="none">
      <rect x="20" y="25" width="100" height="65" rx="14" stroke="#374151" strokeWidth="7" fill="white"/>
      <rect x="160" y="25" width="100" height="65" rx="14" stroke="#374151" strokeWidth="7" fill="white"/>
      <path d="M120 53 Q140 43 160 53" stroke="#374151" strokeWidth="6" fill="none" strokeLinecap="round"/>
      <path d="M20 55 Q6 55 3 65" stroke="#374151" strokeWidth="6" fill="none" strokeLinecap="round"/>
      <path d="M260 55 Q274 55 277 65" stroke="#374151" strokeWidth="6" fill="none" strokeLinecap="round"/>
    </svg>
  )
}

function FramePhoto({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  const [hasError, setHasError] = useState(false)

  if (!src || hasError) {
    return (
      <div className="w-full h-full bg-slate-100 dark:bg-slate-700 rounded-lg flex items-center justify-center overflow-hidden">
        <GlassesIllustration className={className || 'w-10 h-6'} />
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className || 'w-full h-full object-cover rounded-lg'}
      onError={() => setHasError(true)}
      loading="lazy"
    />
  )
}

// ── Calendar Modal ─────────────────────────────────────────────────────────────
function CalendarModal({ year, month, selectedDay, onSelectDay, onClose, onPrevMonth, onNextMonth }: {
  year: number; month: number; selectedDay: number | null
  onSelectDay: (d: number | null) => void; onClose: () => void
  onPrevMonth: () => void; onNextMonth: () => void
}) {
  const firstDay = new Date(year, month, 1).getDay()
  const offset = firstDay === 0 ? 6 : firstDay - 1
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-xs overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <button onClick={onPrevMonth} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500">
            {ic.back('w-4 h-4')}
          </button>
          <span className="text-sm font-bold text-slate-900 dark:text-white">{MONTH_FR[month]} {year}</span>
          <button onClick={onNextMonth} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500">
            {ic.chevRight('w-4 h-4')}
          </button>
        </div>
        <div className="p-4">
          <div className="grid grid-cols-7 mb-2">
            {DAY_FR.map((d, i) => (
              <div key={i} className="text-center text-xs font-semibold text-slate-400 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => (
              <button
                key={i}
                disabled={d === null}
                onClick={() => { onSelectDay(d === selectedDay ? null : d); onClose() }}
                className={`aspect-square rounded-xl text-sm font-medium flex items-center justify-center transition-all ${
                  d === null ? 'cursor-default' :
                  d === selectedDay
                    ? 'bg-blue-600 text-white shadow-md scale-105'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {d || ''}
              </button>
            ))}
          </div>
          {selectedDay && (
            <button
              onClick={() => { onSelectDay(null); onClose() }}
              className="w-full mt-3 py-2 text-xs text-slate-400 hover:text-red-500 transition-colors"
            >
              Effacer le filtre
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function DashboardScreen({ onNavigate, stockSummary, cityStockCounts, stationCities }: { onNavigate: (s: NavScreen) => void; stockSummary: any[]; cityStockCounts: Record<string, CityStats>; stationCities: string[] }) {
  const [selectedCity, setSelectedCity] = useState('')
  const cityNames = Object.keys(cityStockCounts).length > 0 ? Object.keys(cityStockCounts).sort() : stationCities.slice().sort()
  const stats = cityStockCounts[selectedCity]

  useEffect(() => {
    if (cityNames.length === 0) return
    if (!selectedCity || !cityNames.includes(selectedCity)) {
      const preferredCity = cityNames.find(name => name.toLowerCase() === 'pointe-noire')
      setSelectedCity(preferredCity || cityNames[0])
    }
  }, [cityNames.length, selectedCity, cityNames.join(',')])

  const summary = summarizeStockSummary(stockSummary)
  const selectedCityTotal = getCityTotal(stats)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { block: 'total' as Block, label: 'Total lunette', color: '#2563eb', bg: 'border-blue-200 dark:border-blue-800', icon: ic.glasses },
          { block: 'ca' as Block, label: "Chiffre d'affaire", color: '#16a34a', bg: 'border-green-200 dark:border-green-800', icon: ic.chart },
          { block: 'suivi' as Block, label: 'Suivi des lunettes', color: '#9333ea', bg: 'border-purple-200 dark:border-purple-800', icon: ic.map },
        ].map(item => {
          const value = item.block === 'total' && summary.hasData ? summary.totalUnits.toLocaleString('fr-FR')
            : item.block === 'suivi' && summary.hasData ? summary.totalUnits.toLocaleString('fr-FR')
            : '—'
          const note = item.block === 'total' && summary.hasData ? `${summary.totalUnits.toLocaleString('fr-FR')} monture${summary.totalUnits > 1 ? 's' : ''}`
            : item.block === 'suivi' && summary.hasData ? `${summary.totalUnits.toLocaleString('fr-FR')} monture${summary.totalUnits > 1 ? 's' : ''}`
            : 'Aucune donnée disponible'

          return (
            <button
              type="button"
              key={item.block}
              onClick={() => onNavigate({ type: 'pays', block: item.block as Block })}
              className={`group w-full bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 text-left ${item.bg}`}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-3 transition-all" style={{ backgroundColor: `${item.color}18` }}>
                <span style={{ color: item.color }}>{item.icon('w-5 h-5')}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{item.label}</p>
              <p className="text-xl font-bold text-slate-400 dark:text-slate-500 mt-0.5 leading-tight">{value}</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">{note}</p>
            </button>
          )
        })}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Villes</p>
          {selectedCity && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{selectedCityTotal.toLocaleString('fr-FR')} monture{selectedCityTotal > 1 ? 's' : ''} à {selectedCity}</p>
          )}
        </div>
        {cityNames.length === 0 ? (
          <button
            type="button"
            onClick={() => onNavigate({ type: 'pays', block: 'total' })}
            className="w-full rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-4 text-left text-sm text-slate-500 dark:text-slate-400"
          >
            Aucune donnée disponible pour le moment.
          </button>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {cityNames.map(city => (
              <button
                key={city}
                onClick={() => setSelectedCity(city)}
                className={`px-3.5 py-1.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
                  selectedCity === city ? 'text-white shadow-md scale-105' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:scale-105'
                }`}
                style={selectedCity === city ? { backgroundColor: cityStockCounts[city]?.color || '#94a3b8' } : {}}
              >
                {city}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Stock général', value: summary.hasData ? summary.generalUnits : '—', color: '#2563eb' },
          { label: 'Stock local', value: summary.hasData ? summary.localUnits : '—', color: '#0891b2' },
          { label: 'Présentoir', value: summary.hasData ? summary.presentoirUnits : '—', color: '#7c3aed' },
          { label: 'Références critiques', value: summary.hasData ? summary.criticalReferences : '—', color: '#059669' },
        ].map(item => (
          <div key={item.label} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
            <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">{item.label}</p>
            <p className="text-3xl font-black mt-1 tabular-nums" style={{ color: item.color }}>{item.value}</p>
            {summary.hasData && (
              <div className="mt-2.5 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (Number(item.value) / Math.max(1, summary.totalUnits)) * 100)}%`, backgroundColor: item.color }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pays screen ───────────────────────────────────────────────────────────────
function PaysScreen({ block, onNavigate, cityStockCounts, stationCities, stockSummary }: { block: Block; onNavigate: (s: NavScreen) => void; cityStockCounts: Record<string, CityStats>; stationCities: string[]; stockSummary: any[] }) {
  const [countries, setCountries] = useState(COUNTRIES.map(c => ({ ...c })))
  const [expandedCountries, setExpandedCountries] = useState<string[]>([])
  const [isLoadingCountries, setIsLoadingCountries] = useState(false)
  const [expandedCities, setExpandedCities] = useState<string[]>([])

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsLoadingCountries(true)
    fetch(`${API_URL}/inventory/countries`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (!response.ok) throw new Error('countries unavailable')
        const payload = await response.json().catch(() => ({}))
        const baseCountries: CountryItem[] = (payload?.data?.countries || []).map((country: any) => ({
          id: country.id,
          name: country.name,
          code: country.code,
          flag: getFlagEmoji(country.code),
          cities: [],
        }))

        if (baseCountries.length === 0) {
          const fallbackCountries = buildFallbackCountriesFromCityCounts(cityStockCounts)
          const realCitiesFallback = stationCities.length > 0 ? [{ id: 1, name: 'Congo', code: 'CG', flag: '🇨🇬', cities: stationCities }] : fallbackCountries
          setCountries(realCitiesFallback.length > 0 ? realCitiesFallback : COUNTRIES.map(c => ({ ...c })))
          return
        }

        const nextCountries = await Promise.all(baseCountries.map(async country => {
          if (!country.id) return country
          try {
            const citiesResponse = await fetch(`${API_URL}/inventory/cities?country_id=${country.id}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!citiesResponse.ok) return country
            const citiesPayload = await citiesResponse.json().catch(() => ({}))
            const cities = (citiesPayload?.data?.cities || []).map((city: any) => city.name).filter(Boolean)
            return { ...country, cities }
          } catch {
            return country
          }
        }))

        const finalCountries = nextCountries.some(country => (country.cities || []).length > 0)
          ? nextCountries
          : (stationCities.length > 0 ? [{ id: 1, name: 'Congo', code: 'CG', flag: '🇨🇬', cities: stationCities }] : buildFallbackCountriesFromCityCounts(cityStockCounts))

        setCountries(finalCountries.length > 0 ? finalCountries : COUNTRIES.map(c => ({ ...c })))
      })
      .catch(() => {
        const fallbackCountries = stationCities.length > 0 ? [{ id: 1, name: 'Congo', code: 'CG', flag: '🇨🇬', cities: stationCities }] : buildFallbackCountriesFromCityCounts(cityStockCounts)
        setCountries(fallbackCountries.length > 0 ? fallbackCountries : COUNTRIES.map(c => ({ ...c })))
      })
      .finally(() => setIsLoadingCountries(false))
  }, [cityStockCounts, stationCities])

  const BLOCK_COLOR = { total: '#2563eb', ca: '#16a34a', suivi: '#9333ea' }
  const color = BLOCK_COLOR[block]

  const getCityCount = (city: string) => {
    const stats = cityStockCounts[city]
    return getCityTotal(stats)
  }

  const summary = summarizeStockSummary(stockSummary)
  const computedCityTotal = countries.reduce((sum, country) => {
    const cities = country.cities.length > 0 ? country.cities : stationCities
    return sum + cities.reduce((citySum, city) => citySum + getCityCount(city), 0)
  }, 0)
  const computedCityRevenue = countries.reduce((sum, country) => {
    const cities = country.cities.length > 0 ? country.cities : stationCities
    return sum + cities.reduce((citySum, city) => citySum + (cityStockCounts[city]?.revenue || 0), 0)
  }, 0)
  const totalFrames = summary.hasData && computedCityTotal === 0 ? summary.totalUnits : computedCityTotal
  const totalRevenue = summary.hasData && computedCityRevenue === 0 ? 0 : computedCityRevenue

  function toggleCountry(name: string) {
    setExpandedCountries(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])
  }
  function toggleCity(name: string) {
    setExpandedCities(prev => prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name])
  }

  // Suivi section labels
  const SUIVI_SECTIONS: { id: SuiviSection; label: string; parent: 'reception' | 'placement' }[] = [
    { id: 'stock', label: 'Stock', parent: 'reception' },
    { id: 'labo', label: 'Labo', parent: 'reception' },
    { id: 'presentoire', label: 'Présentoire', parent: 'reception' },
    { id: 'placement', label: 'Placement', parent: 'placement' },
  ]

  function TreeNode({ depth, last }: { depth: number; last?: boolean }) {
    return (
      <div className="absolute left-0 top-0 bottom-0 w-px" style={{ marginLeft: depth * 20 + 'px', backgroundColor: '#e2e8f0' }} />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Pays</p>
      </div>

      {(block === 'total' || block === 'ca') && (
        <div className="space-y-4">
          <div className={`rounded-2xl border px-4 py-4 ${block === 'total' ? 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700' : 'bg-green-50 border-green-100 dark:bg-green-900/20 dark:border-green-900/40'}`}>
            <div>
              <p className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500">
                {block === 'total' ? 'Total lunette' : "Chiffre d'affaire"}
              </p>
              <p className={`text-3xl font-black ${block === 'total' ? 'text-slate-900 dark:text-white' : 'text-green-700 dark:text-green-300'} tabular-nums`}>
                {block === 'total' ? totalFrames.toLocaleString('fr-FR') : fmtFCFA(totalRevenue)}
              </p>
            </div>
          </div>
        </div>
      )}

      {isLoadingCountries ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-4 text-sm text-slate-500 dark:text-slate-400">
          Chargement des pays...
        </div>
      ) : countries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-4 text-sm text-slate-500 dark:text-slate-400">
          Aucune donnée disponible pour le moment.
        </div>
      ) : (
      <div className="space-y-3">
        {countries.map(country => {
          const countryExpanded = expandedCountries.includes(country.name)
          const displayCities = country.cities.length > 0 ? country.cities : stationCities
          return (
            <div key={country.name} className="relative">
              {/* Vertical rail */}
              <div className="absolute left-4 top-12 bottom-0 w-px bg-slate-200 dark:bg-slate-700" style={{ display: countryExpanded && country.cities.length ? 'block' : 'none' }} />

              {/* Country node */}
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 rounded-full border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 flex-shrink-0 z-10" />
                <button
                  onClick={() => toggleCountry(country.name)}
                  className="flex-1 flex items-center justify-between px-5 py-3.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl hover:shadow-sm transition-all"
                >
                  <span className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2.5">
                    <span className="text-2xl leading-none drop-shadow-sm">{country.flag}</span>
                    <span>{country.name}</span>
                  </span>
                  <div className="flex items-center gap-3">
                    {(block === 'total' || block === 'ca' || block === 'suivi') && (
                      <span className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                        {block === 'ca'
                          ? fmtFCFA(displayCities.reduce((sum, city) => sum + (cityStockCounts[city]?.revenue || 0), 0))
                          : displayCities.reduce((sum, city) => sum + getCityTotal(cityStockCounts[city]), 0).toLocaleString('fr-FR')
                        }
                      </span>
                    )}
                    <span className="text-slate-400">{countryExpanded ? ic.chevDown() : ic.chevRight()}</span>
                  </div>
                </button>
              </div>

              {/* Cities */}
              {countryExpanded && (
                <div className="ml-6 border-l border-dashed border-slate-200 dark:border-slate-700 pl-4 space-y-2">
                  {displayCities.map(city => {
                    const cityExpanded = expandedCities.includes(city)
                    const stats = cityStockCounts[city] || {
                      local: 0,
                      presentoir: 0,
                      labo: 0,
                      reserve: 0,
                      vendues: 0,
                      transit: 0,
                      color: '#94a3b8',
                      revenue: 0,
                    }

                    return (
                      <div key={city} className="relative">
                        {/* Horizontal branch to city */}
                        <div className="absolute -left-4 top-4 w-4 h-px bg-slate-200 dark:bg-slate-700" />

                        {block === 'ca' ? (
                          <div className="flex items-center gap-2">
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 flex-shrink-0 z-10" />
                            <button
                              onClick={() => onNavigate({ type: 'city', block: 'ca', pays: country.name, city })}
                              className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all group"
                            >
                              <span className="font-semibold text-slate-800 dark:text-slate-200">{city}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold tabular-nums" style={{ color: stats?.color || '#94a3b8' }}>
                                  {fmtFCFA(stats?.revenue || 0)}
                                </span>
                                {ic.chevRight('w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors')}
                              </div>
                            </button>
                          </div>
                        ) : (block === 'total' || block === 'suivi') ? (
                          <div className="flex items-center gap-2">
                            <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 flex-shrink-0 z-10" />
                            <div className="flex-1">
                              <button
                                onClick={() => toggleCity(city)}
                                className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all group"
                              >
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{city}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-bold tabular-nums" style={{ color: stats?.color || '#94a3b8' }}>
                                    {stats?.local || '—'}
                                  </span>
                                  {cityExpanded ? ic.chevDown('w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors') : ic.chevRight('w-3 h-3 text-slate-300 group-hover:text-slate-500 transition-colors')}
                                </div>
                              </button>

                              {cityExpanded && (
                                <div className="relative mt-2 ml-3 pl-4">
                                  <div className="absolute left-0 top-0 bottom-0 w-px bg-slate-200 dark:bg-slate-700" />
                                  <div className="absolute left-0 top-3.5 w-3 h-px bg-slate-200 dark:bg-slate-700" />
                                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60 p-2 space-y-1.5">
                                    <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                                      Sous-stations
                                    </div>
                                    {[
                                      { label: 'Stock magasin', value: stats.local, color: '#2563eb', section: 'stock' as SuiviSection },
                                      { label: 'Présentoir', value: stats.presentoir, color: '#0891b2', section: 'presentoire' as SuiviSection },
                                      { label: 'Laboratoire', value: stats.labo, color: '#7c3aed', section: 'labo' as SuiviSection },
                                      { label: 'Réserve', value: stats.reserve, color: '#059669', section: 'placement' as SuiviSection },
                                    ].map(item => (
                                      <button
                                        key={item.label}
                                        type="button"
                                        onClick={() => onNavigate({ type: 'suivi-detail', pays: country.name, city, section: item.section })}
                                        className="relative w-full pl-3 text-left"
                                      >
                                        <div className="absolute left-0 top-3.5 w-2.5 h-px bg-slate-200 dark:bg-slate-700" />
                                        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-white dark:bg-slate-800 shadow-sm hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-all">
                                          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{item.label}</span>
                                          <span className="text-sm font-black tabular-nums" style={{ color: item.color }}>{item.value}</span>
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          /* Suivi: city is expandable → Reception + Placement sub-tree */
                          <div>
                            <div className="flex items-center gap-2">
                              <div className="w-3.5 h-3.5 rounded-full border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 flex-shrink-0 z-10" />
                              <button
                                onClick={() => toggleCity(city)}
                                className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 transition-all"
                              >
                                <span className="font-semibold text-slate-800 dark:text-slate-200">{city}</span>
                                <span className="text-slate-400">{cityExpanded ? ic.chevDown('w-3 h-3') : ic.chevRight('w-3 h-3')}</span>
                              </button>
                            </div>

                            {cityExpanded && (
                              <div className="ml-6 mt-2 space-y-2 relative">
                                {/* City rail */}
                                <div className="absolute left-0 top-0 bottom-2 w-px bg-slate-200 dark:bg-slate-700" />

                                {/* Réception group */}
                                <div className="relative">
                                  <div className="absolute -left-0 top-4 w-3 h-px bg-slate-200 dark:bg-slate-700" />
                                  <div className="flex items-center gap-2 pl-4">
                                    <div className="w-3 h-3 rounded-full border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 flex-shrink-0" />
                                    <div className="flex-1 px-3 py-2 text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                      Réception
                                    </div>
                                  </div>
                                  {/* Stock / Labo / Présentoire leaves */}
                                  <div className="ml-10 mt-1.5 space-y-1.5 relative">
                                    <div className="absolute left-0 top-0 bottom-2 w-px bg-slate-200 dark:bg-slate-700" />
                                    {(['stock', 'labo', 'presentoire'] as SuiviSection[]).map(section => {
                                      const sLabel = section === 'stock' ? `Stock ${city.split('-')[0]}` : section === 'labo' ? 'Labo' : 'Présentoire'
                                      const sVal = section === 'stock' ? stats?.local : section === 'labo' ? stats?.labo : stats?.presentoir
                                      return (
                                        <div key={section} className="relative">
                                          <div className="absolute -left-0 top-3 w-3 h-px bg-slate-200 dark:bg-slate-700" />
                                          <div className="pl-4">
                                            <button
                                              onClick={() => onNavigate({ type: 'suivi-detail', pays: country.name, city, section })}
                                              className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-all group"
                                            >
                                              <div className="flex items-center gap-1.5">
                                                <div className="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0" style={{ borderColor: color, backgroundColor: 'white' }} />
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">{sLabel}</span>
                                              </div>
                                              <div className="flex items-center gap-1.5">
                                                <span className="font-black tabular-nums" style={{ color }}>{sVal ?? '—'}</span>
                                                {ic.chevRight('w-3 h-3 text-slate-300 group-hover:text-purple-400')}
                                              </div>
                                            </button>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>

                                {/* Placement leaf */}
                                <div className="relative">
                                  <div className="absolute -left-0 top-3.5 w-3 h-px bg-slate-200 dark:bg-slate-700" />
                                  <div className="pl-4">
                                    <button
                                      onClick={() => onNavigate({ type: 'suivi-detail', pays: country.name, city, section: 'placement' })}
                                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 hover:border-purple-300 dark:hover:border-purple-700 hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-all group"
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full border-2 flex-shrink-0" style={{ borderColor: color, backgroundColor: 'white' }} />
                                        <span className="font-semibold text-slate-700 dark:text-slate-300">Placement</span>
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <span className="font-black tabular-nums" style={{ color }}>{stats?.reserve ?? '—'}</span>
                                        {ic.chevRight('w-3 h-3 text-slate-300 group-hover:text-purple-400')}
                                      </div>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {country.cities.length === 0 && (
                    <p className="text-xs text-slate-400 italic pl-4">Aucune ville enregistrée</p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}

// ── Suivi detail screen ───────────────────────────────────────────────────────
function SuiviDetailScreen({ pays, city, section, cityStockCounts, framesByCity }: { pays: string; city: string; section: SuiviSection; cityStockCounts: Record<string, CityStats>; framesByCity: Record<string, FrameRecord[]> }) {
  const [calYear, setCalYear] = useState(2026)
  const [calMonth, setCalMonth] = useState(7)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [formeFilter, setFormeFilter] = useState<ShapeFilterValue>('all')
  const [genreFilter, setGenreFilter] = useState<'all' | 'Homme' | 'Femme' | 'Enfant'>('all')
  const [gammeFilter, setGammeFilter] = useState<GammeFilterValue>('all')

  function prevMonth() { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) } else setCalMonth(m => m - 1) }
  function nextMonth() { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) } else setCalMonth(m => m + 1) }

  const filterByDate = (dateStr: string) => !selectedDay || parseInt(dateStr.split('-')[2]) === selectedDay

  const SECTION_LABEL: Record<SuiviSection, string> = {
    stock: `Stock magasin - ${city}`,
    labo: 'Labo',
    presentoire: 'Présentoire',
    placement: 'Placement',
  }

  const SECTION_STATUS: Record<SuiviSection, string> = {
    stock: 'Stock magasin', labo: 'Laboratoire', presentoire: 'Présentoir', placement: 'Réservé',
  }

  const SECTION_COLOR = '#16a34a'

  // Filter frames by section status
  const statusFilter: Record<SuiviSection, string[]> = {
    stock: ['Stock magasin'],
    labo: ['Laboratoire'],
    presentoire: ['Présentoir'],
    placement: ['Réservé'],
  }

  const frames = (framesByCity[city] || []).filter(f => {
    const haystack = [f.ref, f.marque, f.genre, f.forme, f.entree, f.date, f.status, f.enregistrePar]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    const matchesForme = formeFilter === 'all' || normalizeShapeName(f.forme) === formeFilter
    const matchesGenre = genreFilter === 'all' || f.genre === genreFilter
    const computedGamme = resolveFrameGamme(f.gamme, f.price)
    const matchesGamme = gammeFilter === 'all' || computedGamme === gammeFilter

    return filterByDate(f.date) &&
      statusFilter[section].includes(f.status) &&
      matchesForme && matchesGenre && matchesGamme &&
      (search === '' || haystack.includes(search.toLowerCase()))
  })

  const stats = cityStockCounts[city] || {
    local: 0,
    presentoir: 0,
    labo: 0,
    reserve: 0,
    vendues: 0,
    transit: 0,
    color: '#94a3b8',
    revenue: 0,
  }
  const sectionCount = section === 'stock' ? stats.local
    : section === 'labo' ? stats.labo
    : section === 'presentoire' ? stats.presentoir
    : stats.reserve

  const todayLabel = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })

  return (
    <div className="space-y-3">
      {/* Section stat */}
      <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl border border-green-100 dark:border-green-900/40 px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">{pays} · {city}</p>
          <p className="text-sm font-bold text-green-800 dark:text-green-200 mt-0.5">{SECTION_LABEL[section]}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-black tabular-nums" style={{ color: SECTION_COLOR }}>{sectionCount ?? 0}</p>
          <p className="text-xs text-green-500">montures</p>
        </div>
      </div>

      {/* Search + calendar icon */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search()}</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Référence, marque, genre..."
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
          />
        </div>
        <button
          onClick={() => setCalOpen(true)}
          className={`px-3 rounded-xl border text-sm font-semibold flex items-center gap-1.5 transition-all ${selectedDay ? 'text-white border-transparent' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300'}`}
          style={selectedDay ? { backgroundColor: SECTION_COLOR } : {}}
        >
          {ic.cal()}
          {selectedDay ? `${String(selectedDay).padStart(2, '0')}/${String(calMonth + 1).padStart(2, '0')}/${String(calYear).slice(-2)}` : todayLabel}
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        {[
          { label: 'Forme', value: formeFilter, options: SHAPE_FILTER_OPTIONS, onChange: setFormeFilter },
          { label: 'Genre', value: genreFilter, options: ['all', 'Homme', 'Femme', 'Enfant'] as const, onChange: setGenreFilter },
          { label: 'Gamme', value: gammeFilter, options: GAMME_FILTER_OPTIONS, onChange: setGammeFilter },
        ].map(filter => (
          <div key={filter.label} className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-green-700 dark:text-green-300 mb-1.5">{filter.label}</p>
            <div className="flex flex-wrap gap-1.5">
              {filter.options.map(option => {
                const active = filter.value === option
                const label = option === 'all' ? 'Tous' : option
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => filter.onChange(option as never)}
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-all ${active ? 'bg-green-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-green-200 dark:border-green-700'}`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div
              className="border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-white"
              style={{ backgroundColor: SECTION_COLOR, display: 'grid', gridTemplateColumns: SUIVI_GRID_COLUMNS }}
            >
              {['Photo', 'Réf', 'Marque', 'Enregistré', 'Genre', 'Forme', 'Emplacement', 'Entrée', 'Statut'].map(h => (
                <div key={h} className="px-2 py-2.5 text-left">{h}</div>
              ))}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {frames.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">
                  {selectedDay ? `Aucune monture le ${selectedDay} ${MONTH_FR[calMonth]}` : 'Aucune monture dans cette section'}
                </div>
              ) : frames.map(f => (
                <div
                  key={f.ref + f.date}
                  className="items-center hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors"
                  style={{ display: 'grid', gridTemplateColumns: SUIVI_GRID_COLUMNS }}
                >
                  <div className="px-2 py-3 flex justify-start">
                    <div className="w-14 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-700">
                      <FramePhoto src={f.photo} alt={f.ref} className="w-full h-full object-cover" />
                    </div>
                  </div>
                  <div className="px-2 py-3 text-xs font-bold text-slate-900 dark:text-white truncate">{f.ref}</div>
                  <div className="px-2 py-3 text-xs text-slate-600 dark:text-slate-400 truncate">{f.marque}</div>
                  <div className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400 truncate">{f.enregistrePar || '—'}</div>
                  <div className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400 truncate">{f.genre || '—'}</div>
                  <div className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400 truncate">{f.forme || '—'}</div>
                  {/* Pas de `truncate` ici : le code se replie sur les tirets (point de
                      coupure naturel) pour rester lisible en entier. */}
                  <div className="px-2 py-3 font-mono text-[11px] leading-tight text-slate-500 dark:text-slate-400">{f.emplacement || '—'}</div>
                  <div className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
                    <div className="truncate">{f.entree ? f.entree.split(' ')[0] : (f.date ? f.date : '—')}</div>
                    <div className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                      {f.entree ? f.entree.split(' ')[1] || '—' : '—'}
                    </div>
                  </div>
                  <div className="px-2 py-3 flex justify-end"><Badge status={f.status} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {calOpen && (
        <CalendarModal
          year={calYear} month={calMonth} selectedDay={selectedDay}
          onSelectDay={setSelectedDay} onClose={() => setCalOpen(false)}
          onPrevMonth={prevMonth} onNextMonth={nextMonth}
        />
      )}
    </div>
  )
}

// ── City detail screen ────────────────────────────────────────────────────────
function CityDetailScreen({ block, pays, city, onNavigate, cityStockCounts, framesByCity }: {
  block: 'total' | 'ca'; pays: string; city: string; onNavigate: (s: NavScreen) => void; cityStockCounts: Record<string, CityStats>; framesByCity: Record<string, FrameRecord[]>
}) {
  const [calYear, setCalYear] = useState(2026)
  const [calMonth, setCalMonth] = useState(7)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)

  function prevMonth() { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) } else setCalMonth(m => m - 1) }
  function nextMonth() { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) } else setCalMonth(m => m + 1) }

  function copyLink() {
    navigator.clipboard.writeText(`OptiManager — ${city} — ${MONTH_FR[calMonth]} ${calYear}`)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const filterByDate = (dateStr: string) => !selectedDay || parseInt(dateStr.split('-')[2]) === selectedDay

  const ACCENT = { total: '#2563eb', ca: '#16a34a', suivi: '#9333ea' }
  const accent = ACCENT[block]

  // Header bar with calendar icon + filters
  const FilterBar = ({ placeholder }: { placeholder: string }) => (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search()}</span>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={placeholder}
          className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 transition-all"
          style={{ '--tw-ring-color': accent } as React.CSSProperties}
        />
      </div>
      <button
        onClick={() => setCalOpen(true)}
        className={`px-3 rounded-xl border text-sm font-semibold flex items-center gap-1.5 transition-all ${
          selectedDay ? 'text-white border-transparent' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
        }`}
        style={selectedDay ? { backgroundColor: accent } : {}}
      >
        {ic.cal()}
        {selectedDay ? `${selectedDay} ${MONTH_FR[calMonth].slice(0, 3)}` : MONTH_FR[calMonth].slice(0, 3)}
      </button>
    </div>
  )

  const cityStats = cityStockCounts[city] || {
    local: 0,
    presentoir: 0,
    labo: 0,
    reserve: 0,
    vendues: 0,
    transit: 0,
    color: '#94a3b8',
    revenue: 0,
  }

  if (block === 'total') {
    const frames = (framesByCity[city] || []).filter(f =>
      filterByDate(f.date) && (search === '' || f.ref.toLowerCase().includes(search.toLowerCase()) || f.marque.toLowerCase().includes(search.toLowerCase()))
    )
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={() => exportCSV(frames, city)} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:border-blue-400 hover:text-blue-600 transition-all active:scale-95">
            {ic.download()} Exporter Excel
          </button>
          <button onClick={copyLink} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold transition-all active:scale-95" style={{ color: copied ? '#16a34a' : '' }}>
            {ic.share()} {copied ? 'Copié !' : 'Partager'}
          </button>
        </div>

        <div className="bg-slate-50 dark:bg-slate-900/20 rounded-2xl border border-slate-200 dark:border-slate-700 px-4 py-3 flex justify-between items-center">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            Total {selectedDay ? `${selectedDay} ${MONTH_FR[calMonth]}` : MONTH_FR[calMonth]}
          </span>
          <span className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{frames.length.toLocaleString('fr-FR')}</span>
        </div>

        <FilterBar placeholder="Référence, marque..." />

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="grid grid-cols-5 border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-white" style={{ backgroundColor: accent }}>
            {['Photo', 'Référence', 'Marque', 'Enregistré', 'Statut'].map(h => (
              <div key={h} className="px-3 py-2.5">{h}</div>
            ))}
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {frames.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                {selectedDay ? `Aucune monture le ${selectedDay} ${MONTH_FR[calMonth]}` : 'Aucune monture trouvée'}
              </div>
            ) : frames.map(frame => (
              <button key={frame.ref + frame.date} onClick={() => onNavigate({ type: 'frame', ref: frame.ref, city })}
                className="w-full grid grid-cols-5 items-center hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors text-left group">
                <div className="px-3 py-2.5">
                  <div className="w-11 h-7 rounded-lg overflow-hidden">
                    <FramePhoto src={frame.photo} alt={frame.ref} className="w-11 h-7 object-cover" />
                  </div>
                </div>
                <div className="px-3 py-2.5 text-xs font-bold text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors">{frame.ref}</div>
                <div className="px-3 py-2.5 text-xs text-slate-600 dark:text-slate-400">{frame.marque}</div>
                <div className="px-3 py-2.5 text-xs text-slate-400 truncate">{frame.enregistrePar}</div>
                <div className="px-3 py-2.5"><Badge status={frame.status} /></div>
              </button>
            ))}
          </div>
        </div>

        {calOpen && <CalendarModal year={calYear} month={calMonth} selectedDay={selectedDay} onSelectDay={setSelectedDay} onClose={() => setCalOpen(false)} onPrevMonth={prevMonth} onNextMonth={nextMonth} />}
      </div>
    )
  }

  if (block === 'ca') {
    const rows = (REVENUE_ROWS[city] || []).filter(r =>
      filterByDate(r.date) && (search === '' || r.ref.toLowerCase().includes(search.toLowerCase()) || r.client.toLowerCase().includes(search.toLowerCase()))
    )
    const total = rows.reduce((s, r) => s + r.montant, 0)

    return (
      <div className="space-y-3">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-2xl border border-green-100 dark:border-green-900/40 px-4 py-3 flex justify-between items-center">
          <span className="text-sm font-semibold text-green-700 dark:text-green-300">
            Total {selectedDay ? `${selectedDay} ${MONTH_FR[calMonth]}` : MONTH_FR[calMonth]}
          </span>
          <span className="text-xl font-black text-green-700 dark:text-green-300 tabular-nums">{fmtFCFA(total)}</span>
        </div>

        <FilterBar placeholder="Commande, client..." />

        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
          <div className="grid grid-cols-4 border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-white" style={{ backgroundColor: accent }}>
            {['Référence', 'Client', 'Montant', 'Statut'].map(h => (
              <div key={h} className="px-3 py-2.5">{h}</div>
            ))}
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {rows.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">Aucune vente{selectedDay ? ` le ${selectedDay}` : ''}</div>
            ) : rows.map(r => (
              <div key={r.ref} className="grid grid-cols-4 items-center hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-colors">
                <div className="px-3 py-3 text-xs font-bold text-slate-900 dark:text-white">{r.ref}</div>
                <div className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 truncate">{r.client}</div>
                <div className="px-3 py-3 text-xs font-black tabular-nums" style={{ color: accent }}>{fmtFCFA(r.montant)}</div>
                <div className="px-3 py-3"><Badge status={r.status} /></div>
              </div>
            ))}
          </div>
        </div>

        {calOpen && <CalendarModal year={calYear} month={calMonth} selectedDay={selectedDay} onSelectDay={setSelectedDay} onClose={() => setCalOpen(false)} onPrevMonth={prevMonth} onNextMonth={nextMonth} />}
      </div>
    )
  }

}

// ── Frame detail ──────────────────────────────────────────────────────────────
function FrameDetailScreen({ frameRef, city, framesByCity }: { frameRef: string; city: string; framesByCity: Record<string, FrameRecord[]> }) {
  const frame = framesByCity[city]?.find(f => f.ref === frameRef)
  return (
    <div className="space-y-4 max-w-sm mx-auto">
      <div className="bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-3xl overflow-hidden aspect-video flex items-center justify-center">
        <div className="w-56 h-36 p-4">
          <GlassesIllustration className="w-full h-full" />
        </div>
      </div>
      {frame && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
          {[
            ['Référence', frame.ref],
            ['Marque', frame.marque],
            ['Enregistré par', frame.enregistrePar],
            ['Date', frame.date],
            ['Ville', city],
            ['Statut', frame.status],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center px-4 py-3.5">
              <span className="text-sm text-slate-400 dark:text-slate-500">{k}</span>
              {k === 'Statut' ? <Badge status={v} /> : <span className="text-sm font-semibold text-slate-900 dark:text-white">{v}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── History view — live movement feed ─────────────────────────────────────────
function HistoryView() {
  const [activeTab, setActiveTab] = useState<'lunettes' | 'employes'>('lunettes')
  // La grille d'étapes reste affichée en permanence et sert de sélecteur : seul le détail
  // en dessous change. Une étape est donc toujours sélectionnée.
  const [selectedStage, setSelectedStage] = useState<MvtStage>('ordered')
  const [liveItems, setLiveItems] = useState<Movement[]>(MOVEMENTS_DATA)

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setLiveItems([])
      return
    }

    const headers = { Authorization: `Bearer ${token}` }

    fetch(`${API_URL}/inventory/movements?limit=300&offset=0`, { headers })
      .then(async response => {
        if (!response.ok) throw new Error('movements unavailable')
        const payload = await response.json().catch(() => ({}))
        const items = Array.isArray(payload?.data?.movements) ? payload.data.movements : []

        const mapped: Movement[] = items
          .map((entry: any): Movement => {
            const stage = normalizeMovementStage(entry.action, entry.to_station_name)
            const from = String(entry.from_station_name || 'Inconnu').trim() || 'Inconnu'
            const to = String(entry.to_station_name || 'Inconnu').trim() || 'Inconnu'
            const operator = [entry.user_first_name, entry.user_last_name].filter(Boolean).join(' ') || 'Système'
            const { date, time } = formatMovementDate(entry.created_at)
            const ref = String(entry.reference || entry.barcode || `MVT-${entry.id ?? 'n/a'}`)

            return {
              id: String(entry.id ?? `${stage}-${ref}-${date}-${time}`),
              stage,
              frames: Number(entry.quantity || 1),
              from,
              to,
              date,
              time,
              operator,
              notes: entry.notes || undefined,
            }
          })
          .filter((item: Movement) => item.from && item.to)
          .sort((a: Movement, b: Movement) => {
            const da = new Date(`${b.date} ${b.time}`.replace(/\//g, '-')).getTime()
            const db = new Date(`${a.date} ${a.time}`.replace(/\//g, '-')).getTime()
            return da - db
          })

        setLiveItems(mapped.slice(0, 60))
      })
      .catch(() => setLiveItems([]))
  }, [])

  const pipeline: MvtStage[] = ['ordered', 'shipped', 'received', 'transferred', 'display', 'sold']

  const stageItems = liveItems.filter(m => m.stage === selectedStage)
  const activeMeta = STAGE_META[selectedStage]

  return (
    <div className="space-y-5">
      {/* .page-title */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold text-slate-900 dark:text-white">
            <span className="text-blue-600">{ic.hist('w-5 h-5')}</span>
            Suivi Global
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Traçabilité complète des montures : commandes, transits, réceptions, transferts, présentoir, ventes.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('lunettes')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${activeTab === 'lunettes' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900'}`}
          >
            Lunettes
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('employes')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition-all ${activeTab === 'employes' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900'}`}
          >
            Employés
          </button>
        </div>
      </div>

      {activeTab !== 'lunettes' ? (
        <EmployeesView />
      ) : (
      <>
        {/* .stage-grid — sélecteur du détail, toujours affiché.
            Mobile : carrousel horizontal à accroche, les cartes débordent volontairement
            de la marge du conteneur (-mx-4/px-4) pour que le défilement aille bord à bord.
            sm+ : sm:grid reprend la main sur le flex et on revient à une vraie grille. */}
        <div className={`${CARD_ROW_CLASS} sm:grid-cols-3 xl:grid-cols-6`}>
          {pipeline.map(stage => {
            const items = liveItems.filter(m => m.stage === stage)
            const frames = items.reduce((sum, m) => sum + m.frames, 0)
            const meta = STAGE_META[stage]
            const isActive = stage === selectedStage
            return (
              <button
                key={stage}
                type="button"
                onClick={() => setSelectedStage(stage)}
                aria-pressed={isActive}
                className={`${CARD_CLASS} sm:aspect-square ${isActive
                  ? 'bg-white dark:bg-slate-900'
                  : 'border-slate-200 bg-white hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900'}`}
                style={isActive ? { borderColor: meta.color, backgroundColor: `${meta.color}0f` } : undefined}
              >
                <span
                  className="flex h-[42px] w-[42px] items-center justify-center rounded-lg"
                  style={isActive
                    ? { backgroundColor: meta.color, color: '#fff' }
                    : { backgroundColor: `${meta.color}1f`, color: meta.color }}
                >
                  {meta.icon}
                </span>
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{meta.label}</span>
                <span className="mt-auto text-[28px] font-extrabold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">{items.length}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{frames} monture(s)</span>
              </button>
            )
          })}
        </div>

        {/* .stage-activity — le détail de l'étape sélectionnée, directement sous les cartes */}
        <div className={`overflow-hidden ${BLOCK_CLASS}`}>
            <h3 className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 text-[15px] font-bold text-slate-900 dark:border-slate-700 dark:text-white">
              <span style={{ color: activeMeta.color }}>{ic.hist('w-[17px] h-[17px]')}</span>
              {activeMeta.label}
              <span className="ml-1 text-sm font-medium text-slate-500 dark:text-slate-400">· {stageItems.length} mouvement(s)</span>
            </h3>

            {stageItems.length === 0 ? (
              <div className="px-5 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucun mouvement pour cette étape.
              </div>
            ) : (
              <div className="flex flex-col">
                {stageItems.map((mvt, idx) => {
                  const meta = STAGE_META[mvt.stage]
                  return (
                    <div key={mvt.id} className="flex items-center gap-3.5 border-b border-slate-100 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                      {/* .glass-photo — pas de photo sur un mouvement, l'icône tient la place */}
                      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800">
                        {ic.glasses('w-[18px] h-[18px]')}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          {/* .badge, teinté à la couleur de l'étape */}
                          <span className="inline-block rounded-full px-[11px] py-1 text-xs font-bold" style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}>
                            {meta.label}
                          </span>
                          <span className="font-mono text-xs text-slate-400 dark:text-slate-500">{mvt.id}</span>
                          {idx === 0 && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Nouveau</span>
                          )}
                        </div>
                        {mvt.notes && <p className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">{mvt.notes}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs">
                          <span className="text-slate-600 dark:text-slate-300">
                            {mvt.from} <span className="text-slate-400">→</span> {mvt.to}
                          </span>
                          <span className="text-slate-400">{mvt.date} à {mvt.time} · {mvt.operator}</span>
                        </div>
                      </div>

                      <div className="flex-shrink-0 text-right">
                        <p className="text-xl font-black leading-none tabular-nums" style={{ color: meta.color }}>{mvt.frames}</p>
                        <p className="text-[11px] text-slate-400">montures</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
        </div>
      </>
      )}
    </div>
  )
}

// ── Reception view ────────────────────────────────────────────────────────────
function ReceptionView() {
  const [sessions, setSessions] = useState(RECEPTION_SESSIONS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<(typeof RECEPTION_SESSIONS)[number] | null>(null)
  const [detailSearch, setDetailSearch] = useState('')
  const [detailStatusFilter, setDetailStatusFilter] = useState<'all' | 'Reçu' | 'En attente'>('all')
  const [detailFormeFilter, setDetailFormeFilter] = useState<ShapeFilterValue>('all')
  const [detailGenreFilter, setDetailGenreFilter] = useState<GenreFilterValue>('all')
  const [detailGammeFilter, setDetailGammeFilter] = useState<GammeFilterValue>('all')
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [isSavingSupplier, setIsSavingSupplier] = useState(false)
  const [receptionSession, setReceptionSession] = useState<ReceptionSessionResult | null>(null)
  const [receptionCommands, setReceptionCommands] = useState<ReceptionSessionResult[]>([])
  const [detailSessionGlasses, setDetailSessionGlasses] = useState<any[]>([])
  const [isLoadingDetailSessionGlasses, setIsLoadingDetailSessionGlasses] = useState(false)
  const [showReceptionSessionCard, setShowReceptionSessionCard] = useState(true)
  const [isCreatingReceptionSession, setIsCreatingReceptionSession] = useState(false)
  const [isDeletingSessionId, setIsDeletingSessionId] = useState<number | null>(null)
  const [showStockPage, setShowStockPage] = useState(false)
  const [stockGlasses, setStockGlasses] = useState<any[]>([])
  const [isLoadingStock, setIsLoadingStock] = useState(false)
  // 'GENERAL' = liste du stock général ; sinon le nom du magasin dont on regarde les manquants.
  const [stockScope, setStockScope] = useState<string>('GENERAL')
  const [stockAction, setStockAction] = useState<StockAction>('')
  const [stockRayonFilter, setStockRayonFilter] = useState<string>('all')
  const [stockEtagereFilter, setStockEtagereFilter] = useState<string>('all')
  const [stockBacFilter, setStockBacFilter] = useState<string>('all')
  const [excludedPreparationKeys, setExcludedPreparationKeys] = useState<string[]>([])
  const [basketCounts, setBasketCounts] = useState<Record<string, number>>({})
  const [basketItems, setBasketItems] = useState<BasketItem[]>([])
  const [isLoadingBasket, setIsLoadingBasket] = useState(false)
  const [excludedDemandIds, setExcludedDemandIds] = useState<number[]>([])
  const [isSendingDemand, setIsSendingDemand] = useState(false)
  // Envoi de la liste d'une session terminée vers un magasin.
  const [sendListSession, setSendListSession] = useState<(typeof RECEPTION_SESSIONS)[number] | null>(null)
  const [sendListMagasin, setSendListMagasin] = useState('')
  const [sendListGlasses, setSendListGlasses] = useState<any[]>([])
  const [isLoadingSendList, setIsLoadingSendList] = useState(false)
  const [isSubmittingSendList, setIsSubmittingSendList] = useState(false)
  const [sendListSent, setSendListSent] = useState(false)
  // Composition de la liste : autant de lignes que de lots à envoyer, chacune qualifiée
  // par Forme / Genre / Gamme. Le nombre affiché est le total des montures correspondantes.
  const [sendListLines, setSendListLines] = useState<SendListLine[]>([createSendListLine()])
  const sendListShapeOptions = useMemo(() => {
    const shapes = new Set<string>()
    sendListGlasses.forEach(glass => {
      const shape = normalizeShapeName(glass.shape)
      if (shape) shapes.add(shape)
    })
    return ['all', ...Array.from(shapes).sort((a, b) => a.localeCompare(b, 'fr'))]
  }, [sendListGlasses])
  const sendListGenreOptions = useMemo(() => {
    const genres = new Set<string>()
    sendListGlasses.forEach(glass => {
      const genre = normalizeGenderName(glass.gender)
      if (genre) genres.add(genre)
    })
    return ['all', ...Array.from(genres).sort((a, b) => a.localeCompare(b, 'fr'))]
  }, [sendListGlasses])
  const sendListGammeOptions = useMemo(() => {
    const gammes = new Set<string>()
    sendListGlasses.forEach(glass => {
      const gamme = resolveFrameGamme(glass.material, glass.price)
      if (gamme) gammes.add(gamme)
    })
    return ['all', ...Array.from(gammes).sort((a, b) => a.localeCompare(b, 'fr'))]
  }, [sendListGlasses])
  // Codes des sessions dont la liste est déjà partie : leur bouton reste grisé, pour ne
  // pas envoyer deux fois le même colis au stock général.
  // Villes déjà desservies par session : une session peut être envoyée en plusieurs fois
  // vers des magasins différents (la liste se compose par forme/genre/gamme/nombre), d'où
  // un tableau de villes et non une seule.
  const [sentListSessions, setSentListSessions] = useState<Record<string, string[]>>({})
  const [magasinOptions, setMagasinOptions] = useState<Array<{ city: string; country: string }>>([])
  const [countryOptions, setCountryOptions] = useState<Array<{ id: number; name: string; code?: string }>>([])
  const [cityOptions, setCityOptions] = useState<Array<{ id: number; name: string; country_id: number }>>([])
  const [isLoadingCountries, setIsLoadingCountries] = useState(false)
  const [isLoadingCities, setIsLoadingCities] = useState(false)
  const [showCountriesView, setShowCountriesView] = useState(false)
  const [countryList, setCountryList] = useState<Array<{ id: number; name: string; code?: string }>>([])
  const [supplierForm, setSupplierForm] = useState({ supplier: 'Dubai', quantity: '', date: '', note: '', country: '', city: '' })
  const barcodeRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return

    void loadSessions()
    void loadReceptionCommands()
    void loadSentLists()

    const handleWindowFocus = () => {
      void loadReceptionCommands()
      void loadSentLists()
    }
    window.addEventListener('focus', handleWindowFocus)

    setIsLoadingCountries(true)
    fetch(`${API_URL}/inventory/countries`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (!response.ok) throw new Error('countries unavailable')
        const payload = await response.json().catch(() => ({}))
        setCountryOptions(payload?.data?.countries || [])
      })
      .catch(() => setCountryOptions([]))
      .finally(() => setIsLoadingCountries(false))

    return () => {
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [])

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token || !supplierForm.country) {
      setCityOptions([])
      return
    }

    const selectedCountry = countryOptions.find(country => country.name === supplierForm.country)
    if (!selectedCountry) {
      setCityOptions([])
      return
    }

    setIsLoadingCities(true)
    fetch(`${API_URL}/inventory/cities?country_id=${selectedCountry.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (!response.ok) throw new Error('cities unavailable')
        const payload = await response.json().catch(() => ({}))
        setCityOptions(payload?.data?.cities || [])
      })
      .catch(() => setCityOptions([]))
      .finally(() => setIsLoadingCities(false))
  }, [countryOptions, supplierForm.country])

  // Destinations possibles pour l'envoi : toutes les villes enregistrées (table `villes`,
  // via /inventory/cities), complétées par les stations magasin dont la ville ne serait pas
  // encore déclarée — sans quoi un magasin existant disparaîtrait silencieusement du choix.
  // /inventory/cities exige un country_id : on éclate donc la requête par pays.
  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token || countryOptions.length === 0) return

    let cancelled = false

    void (async () => {
      const headers = { Authorization: `Bearer ${token}` }

      const cityResults = await Promise.allSettled(countryOptions.map(async country => {
        const response = await fetch(`${API_URL}/inventory/cities?country_id=${country.id}`, { headers })
        if (!response.ok) throw new Error('cities unavailable')
        const payload = await response.json().catch(() => ({}))
        return (payload?.data?.cities || []).map((city: any) => ({
          city: String(city.name || '').trim(),
          country: country.name,
        }))
      }))

      const stationNames = await fetch(`${API_URL}/auth/stations`, { headers })
        .then(async response => {
          if (!response.ok) throw new Error('stations unavailable')
          const payload = await response.json().catch(() => ({}))
          return (payload?.data?.stations || [])
            .filter(isStoreStation)
            .map((station: any) => normalizeStationCityName(station) || String(station.name || '').trim())
            .filter(Boolean) as string[]
        })
        .catch(() => [] as string[])

      if (cancelled) return

      const options: Array<{ city: string; country: string }> = cityResults
        .flatMap(result => (result.status === 'fulfilled' ? result.value : []))
        .filter((option: { city: string }) => option.city)

      const seen = new Set(options.map(option => option.city.toLowerCase()))
      for (const name of stationNames) {
        if (seen.has(name.toLowerCase())) continue
        seen.add(name.toLowerCase())
        options.push({ city: name, country: '' })
      }

      setMagasinOptions(options.sort((a, b) => a.city.localeCompare(b.city, 'fr')))
    })()

    return () => { cancelled = true }
  }, [countryOptions])

  // Charge les montures enregistrées sous la session, qui composent la liste à envoyer.
  async function openSendList(session: (typeof RECEPTION_SESSIONS)[number]) {
    setSendListSession(session)
    setSendListMagasin('')
    setSendListGlasses([])
    setSendListSent(false)
    setSendListLines([createSendListLine()])

    const linkedCommand = receptionCommands.find(cmd => cmd.orderId === session.orderId)
    if (!linkedCommand?.id) return

    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsLoadingSendList(true)
    try {
      const response = await fetch(`${API_URL}/inventory/glasses?reception_command_id=${linkedCommand.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('glasses unavailable')
      const payload = await response.json().catch(() => ({}))
      setSendListGlasses(payload?.data?.glasses || [])
    } catch {
      setSendListGlasses([])
    } finally {
      setIsLoadingSendList(false)
    }
  }

  // Relit les listes déjà parties pour que le bouton reste grisé après un rechargement :
  // sans ça l'état de la carte ne survivrait qu'à la session courante du navigateur.
  async function loadSentLists() {
    const token = window.localStorage.getItem('token')
    if (!token) return

    try {
      const response = await fetch(`${API_URL}/inventory/send-lists`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('send lists unavailable')
      const payload = await response.json().catch(() => ({}))
      const bySession: Record<string, string[]> = {}
      for (const list of payload?.data?.lists || []) {
        const code = String(list.session_code || '').trim()
        const city = String(list.city || '').trim()
        if (!code || !city) continue
        if (!bySession[code]) bySession[code] = []
        if (!bySession[code].includes(city)) bySession[code].push(city)
      }
      setSentListSessions(bySession)
    } catch {
      // Route absente ou réseau coupé : on ne grise rien plutôt que de bloquer l'envoi.
      setSentListSessions({})
    }
  }

  // Applique les critères de composition aux montures de la session. `matches` sert au
  // compteur affiché, `selected` est ce qui part réellement — plafonné par le nombre
  // demandé, ou tout si le champ est laissé vide.
  function getSendListSelection() {
    const lines = sendListLines.map(line => {
      const hasCriteria = line.forme !== 'all' || line.genre !== 'all' || line.gamme !== 'all'
      const matches = hasCriteria ? sendListGlasses.filter((glass: any) => {
        if (line.forme !== 'all' && normalizeShapeName(glass.shape) !== normalizeShapeName(line.forme)) return false
        if (line.genre !== 'all' && normalizeGenderName(glass.gender) !== normalizeGenderName(line.genre)) return false
        if (line.gamme !== 'all' && resolveFrameGamme(glass.material, glass.price) !== normalizeGammeName(line.gamme)) return false
        return true
      }) : []
      const selected = matches
      return { line, matches, selected }
    })

    return {
      lines,
      matches: lines.flatMap(({ matches }) => matches),
      selected: lines.flatMap(({ selected }) => selected),
    }
  }

  // Écrit la liste en base, puis affiche la confirmation. Rien d'autre : c'est
  // l'enregistrement qui prévient le stock général, l'impression reste à la demande.
  async function submitSendList() {
    if (!sendListSession || !sendListMagasin) return

    const { selected } = getSendListSelection()
    if (selected.length === 0) return

    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsSubmittingSendList(true)
    try {
      const response = await fetch(`${API_URL}/inventory/send-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          session_code: sendListSession.id,
          city: sendListMagasin,
          items: selected.map((glass: any) => ({
            glass_id: glass.id ?? null,
            barcode: glass.barcode || '',
            reference: glass.reference || '',
            brand: glass.brand || '',
            location_code: glass.location_code || '',
          })),
        }),
      })
      if (!response.ok) throw new Error('send list failed')

      setSendListSent(true)
      setSentListSessions(prev => {
        const cities = prev[sendListSession.id] || []
        if (cities.includes(sendListMagasin)) return prev
        return { ...prev, [sendListSession.id]: [...cities, sendListMagasin] }
      })
    } catch {
      window.alert("Impossible d'envoyer la liste pour le moment.")
    } finally {
      setIsSubmittingSendList(false)
    }
  }

  async function loadSessions() {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setSessions([])
      return
    }

    setIsLoadingSessions(true)
    try {
      const response = await fetch(`${API_URL}/inventory/expeditions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('expeditions unavailable')
      const payload = await response.json().catch(() => ({}))
      const list = payload?.data?.orders || []
      const nextSessions = list.map((order: any) => {
        const orderDate = order.order_date ? new Date(order.order_date) : new Date()
        const dateLabel = orderDate.toLocaleDateString('fr-FR')
        const timeLabel = orderDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        return {
          id: `EXP-${order.id}`,
          orderId: order.id,
          date: dateLabel,
          time: timeLabel,
          frames: Number(order.quantity || 0),
          status: 'Enregistré',
          operator: order.supplier || '—',
          note: order.note || '',
          quantity: Number(order.quantity || 0),
        }
      })
      setSessions(nextSessions)
    } catch {
      setSessions([])
    } finally {
      setIsLoadingSessions(false)
    }
  }

  async function deleteReceptionSession(orderId?: number) {
    if (!orderId) return
    if (!window.confirm('Voulez-vous supprimer cette session de réception ?')) return

    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsDeletingSessionId(orderId)
    try {
      const response = await fetch(`${API_URL}/inventory/supplier-orders/${encodeURIComponent(String(orderId))}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      if (!response.ok) throw new Error('delete failed')
      setSessions(prev => prev.filter(session => session.orderId !== orderId))
      setReceptionCommands(prev => prev.filter(cmd => cmd.orderId !== orderId))
      setExpandedId(prev => (prev === `EXP-${orderId}` ? null : prev))
      setReceptionSession(prev => (prev?.orderId === orderId ? null : prev))
    } catch {
      window.alert('Impossible de supprimer cette session pour le moment.')
    } finally {
      setIsDeletingSessionId(null)
    }
  }

  async function loadCountriesView() {
    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsLoadingCountries(true)
    try {
      const response = await fetch(`${API_URL}/inventory/countries`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('countries unavailable')
      const payload = await response.json().catch(() => ({}))
      setCountryList(payload?.data?.countries || [])
      setShowCountriesView(true)
    } catch {
      setCountryList([])
      setShowCountriesView(true)
    } finally {
      setIsLoadingCountries(false)
    }
  }

  async function saveSupplierOrder(e: React.FormEvent) {
    e.preventDefault()
    const token = window.localStorage.getItem('token')
    const quantity = Number(supplierForm.quantity)

    if (!token || !supplierForm.supplier.trim() || !quantity || !supplierForm.date) return

    setIsSavingSupplier(true)
    try {
      const response = await fetch(`${API_URL}/inventory/expeditions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          supplier: supplierForm.supplier.trim(),
          quantity,
          order_date: supplierForm.date,
          note: supplierForm.note.trim(),
          country: supplierForm.country,
          city: supplierForm.city,
        }),
      })

      if (!response.ok) throw new Error('save failed')
      const payload = await response.json().catch(() => ({}))
      const order = payload?.data?.order
      await loadSessions()
      if (order?.id) {
        await createReceptionSession(Number(order.id), quantity, order.supplier || supplierForm.supplier.trim())
      }
      setShowSupplierModal(false)
      setSupplierForm({ supplier: 'Dubai', quantity: '', date: '', note: '', country: '', city: '' })
    } catch {
      window.alert('Impossible d\'enregistrer la commande fournisseur pour le moment.')
    } finally {
      setIsSavingSupplier(false)
    }
  }

  async function loadReceptionCommands() {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setReceptionCommands([])
      return [] as ReceptionSessionResult[]
    }

    try {
      const response = await fetch(`${API_URL}/inventory/reception-commands`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('reception commands unavailable')
      const payload = await response.json().catch(() => ({}))
      const commands = payload?.data?.commands || []
      const loaded: ReceptionSessionResult[] = commands.map((command: any) => ({
        id: Number(command.id || 0),
        orderId: Number(command.supplier_order_id || 0),
        code: String(command.code || ''),
        targetCount: Number(command.target_count || 0),
        registeredCount: Number(command.registered_count || 0),
        status: String(command.status || ''),
      })).filter((cmd: ReceptionSessionResult) => cmd.orderId > 0 && cmd.code)
      setReceptionCommands(loaded)
      return loaded
    } catch {
      setReceptionCommands([])
      return [] as ReceptionSessionResult[]
    }
  }

  async function viewReceptionBarcode(orderId: number | undefined) {
    if (!orderId) return
    let existing = receptionCommands.find(cmd => cmd.orderId === orderId)
    if (!existing) {
      const loaded = await loadReceptionCommands()
      existing = loaded.find(cmd => cmd.orderId === orderId)
    }
    if (!existing) return
    setReceptionSession(existing)
    setShowReceptionSessionCard(true)
  }

  async function loadReceptionSessionGlasses(receptionCommandId?: number) {
    if (!receptionCommandId) {
      setDetailSessionGlasses([])
      return [] as any[]
    }

    const token = window.localStorage.getItem('token')
    if (!token) {
      setDetailSessionGlasses([])
      return [] as any[]
    }

    setIsLoadingDetailSessionGlasses(true)
    try {
      const response = await fetch(`${API_URL}/inventory/glasses?reception_command_id=${receptionCommandId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('glasses unavailable')
      const payload = await response.json().catch(() => ({}))
      const glasses = payload?.data?.glasses || []
      setDetailSessionGlasses(glasses)
      return glasses
    } catch {
      setDetailSessionGlasses([])
      return [] as any[]
    } finally {
      setIsLoadingDetailSessionGlasses(false)
    }
  }

  async function loadBasketCounts() {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setBasketCounts({})
      return
    }

    try {
      const response = await fetch(`${API_URL}/inventory/baskets/counts`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('counts unavailable')
      const payload = await response.json().catch(() => ({}))
      const counts: Record<string, number> = {}
      for (const row of payload?.data?.counts || []) {
        counts[String(row.city)] = Number(row.count || 0)
      }
      setBasketCounts(counts)
    } catch {
      setBasketCounts({})
    }
  }

  async function loadBasketItems(city: string) {
    const token = window.localStorage.getItem('token')
    if (!token || !city) {
      setBasketItems([])
      return
    }

    setIsLoadingBasket(true)
    try {
      const response = await fetch(`${API_URL}/inventory/baskets?city=${encodeURIComponent(city)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('basket unavailable')
      const payload = await response.json().catch(() => ({}))
      setBasketItems(payload?.data?.items || [])
    } catch {
      setBasketItems([])
    } finally {
      setIsLoadingBasket(false)
    }
  }

  // Clôt les demandes reprises dans la liste adressée au stock principal : elles sortent
  // du panier, donc du compteur.
  async function markDemandsSent(city: string, ids: number[]) {
    if (ids.length === 0) return
    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsSendingDemand(true)
    try {
      const response = await fetch(`${API_URL}/inventory/baskets/sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ids }),
      })
      if (!response.ok) throw new Error('mark sent failed')
      setExcludedDemandIds([])
      await Promise.all([loadBasketItems(city), loadBasketCounts()])
    } catch {
      window.alert('Impossible de clôturer ces demandes pour le moment.')
    } finally {
      setIsSendingDemand(false)
    }
  }

  async function loadStockGlasses() {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setStockGlasses([])
      return
    }

    setIsLoadingStock(true)
    try {
      const response = await fetch(`${API_URL}/inventory/glasses`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('glasses unavailable')
      const payload = await response.json().catch(() => ({}))
      const glasses = payload?.data?.glasses || []
      // Stock général ET stock magasin : comparer les deux est tout l'objet de l'écran.
      setStockGlasses(glasses || [])
    } catch {
      setStockGlasses([])
    } finally {
      setIsLoadingStock(false)
    }
  }

  function selectStockScope(scope: string) {
    setStockScope(scope)
    setStockAction('')
    setExcludedPreparationKeys([])
    setExcludedDemandIds([])
  }

  // Cliquer un panier ouvre directement la demande du magasin : c'est le chemin le plus court
  // entre « il y a 4 demandes à Kinshasa » et « voilà ce qu'on peut leur envoyer ».
  function openBasket(magasin: string) {
    setStockScope(magasin)
    setStockAction('PANIER')
    setExcludedPreparationKeys([])
    setExcludedDemandIds([])
  }

  function parseStockLocationCode(locationCode: string): { rayon: string; etagere: string; bac: string } | null {
    const normalized = String(locationCode || '').trim().toUpperCase()
    if (!normalized) return null
    const match = normalized.match(/^RAYON-([A-Z])-ETA-([0-9]+)-BAC-([A-Z]+)/i)
    if (!match) return null
    return {
      rayon: String(match[1]).toUpperCase(),
      etagere: String(match[2]).toUpperCase(),
      bac: String(match[3]).toUpperCase(),
    }
  }

  function matchesStockFilters(glass: any) {
    const locationCode = String(glass?.location_code || glass?.station_name || '')
    const parsed = parseStockLocationCode(locationCode)
    if (!parsed && (stockRayonFilter !== 'all' || stockEtagereFilter !== 'all' || stockBacFilter !== 'all')) {
      return false
    }
    if (!parsed) return true
    if (stockRayonFilter !== 'all' && parsed.rayon !== stockRayonFilter) return false
    if (stockEtagereFilter !== 'all' && parsed.etagere !== stockEtagereFilter) return false
    if (stockBacFilter !== 'all' && parsed.bac !== stockBacFilter) return false
    return true
  }

  function renderStockPage() {
    const generalGlasses = (stockGlasses || []).filter((g: any) => isGeneralStockStatus(g.status))
    const magasinGlasses = (stockGlasses || []).filter((g: any) => isLocalStockStatus(g.status))

    const fixedMagasins = ['Pointe-Noire', 'Kinshasa']
    const discoveredMagasins = magasinGlasses
      .map((g: any) => String(g.station_name || '').trim())
      .filter(Boolean)
    // Une ville peut avoir un panier sans avoir encore de stock : elle doit quand même
    // apparaître, c'est précisément le magasin qui a tout à recevoir.
    const magasins = Array.from(new Set([...fixedMagasins, ...discoveredMagasins, ...Object.keys(basketCounts)]))

    const selectedMagasin = stockScope === 'GENERAL' ? '' : stockScope
    const filteredGeneralGlasses = generalGlasses.filter(matchesStockFilters)

    const stockRayonOptions = Array.from(new Set(
      generalGlasses
        .map((g: any) => parseStockLocationCode(g.location_code || ''))
        .filter(Boolean)
        .map((parsed: any) => parsed.rayon)
    )).sort((a, b) => a.localeCompare(b))

    const stockEtagereOptions = Array.from(new Set(
      generalGlasses
        .map((g: any) => parseStockLocationCode(g.location_code || ''))
        .filter(Boolean)
        .map((parsed: any) => parsed.etagere)
    )).sort((a, b) => a.localeCompare(b))

    const stockBacOptions = Array.from(new Set(
      generalGlasses
        .map((g: any) => parseStockLocationCode(g.location_code || ''))
        .filter(Boolean)
        .map((parsed: any) => parsed.bac)
    )).sort((a, b) => a.localeCompare(b))

    const header = selectedMagasin
      ? {
        title: stockAction === 'PANIER'
          ? `Panier — ${selectedMagasin}`
          : stockAction === 'ENVOI'
            ? `Envoyer le stock — ${selectedMagasin}`
            : `Stock magasin — ${selectedMagasin}`,
        subtitle: stockAction === 'PANIER'
          ? 'Recherches client enregistrées par le chatbot pour ce magasin.'
          : stockAction === 'ENVOI'
            ? 'Bon de préparation des montures à sortir du stock général.'
            : "Choisissez l'action à effectuer sur ce magasin.",
      }
      : { title: 'Stock général', subtitle: 'Liste des lunettes enregistrées en base.' }

    return (
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-2">
            <button
              onClick={() => setShowStockPage(false)}
              aria-label="Retour aux sessions de réception"
              className="mt-0.5 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {ic.back('w-5 h-5')}
            </button>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{header.title}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{header.subtitle}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select value={stockScope} onChange={e => selectStockScope(e.target.value)} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-200">
              <option value="GENERAL">Stock général</option>
              <optgroup label="Stock magasin">
                {magasins.map(magasin => <option key={magasin} value={magasin}>{magasin}</option>)}
              </optgroup>
            </select>
            <select
              value={stockAction}
              disabled={!selectedMagasin}
              onChange={e => { setStockAction(e.target.value as StockAction); setExcludedPreparationKeys([]) }}
              className={`rounded-xl border px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed ${selectedMagasin && !stockAction
                ? 'border-amber-300 bg-amber-50 text-amber-700 ring-2 ring-amber-200 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200 dark:ring-amber-900'
                : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200'}`}
            >
              <option value="">Action…</option>
              <option value="PANIER">Voir le panier</option>
              <option value="ENVOI">Envoyer le stock</option>
            </select>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-800/60">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Rayon</label>
              <select value={stockRayonFilter} onChange={e => setStockRayonFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <option value="all">Tous</option>
                {stockRayonOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Étagère</label>
              <select value={stockEtagereFilter} onChange={e => setStockEtagereFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <option value="all">Toutes</option>
                {stockEtagereOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Bac</label>
              <select value={stockBacFilter} onChange={e => setStockBacFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                <option value="all">Tous</option>
                {stockBacOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
              <button onClick={() => { setStockRayonFilter('all'); setStockEtagereFilter('all'); setStockBacFilter('all') }} className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700">Reset</button>
            </div>
          </div>
        </div>

        {renderBasketRow(magasins, selectedMagasin)}

        {!selectedMagasin && renderGeneralStockTable(filteredGeneralGlasses)}
        {selectedMagasin && !stockAction && renderStockActionChooser(selectedMagasin)}
        {selectedMagasin && stockAction === 'PANIER' && renderBasketAnalysis(selectedMagasin, filteredGeneralGlasses)}
        {selectedMagasin && stockAction === 'ENVOI' && renderStockPreparation(selectedMagasin, filteredGeneralGlasses)}
      </div>
    )
  }

  function renderBasketRow(magasins: string[], selectedMagasin: string) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Paniers de demande</span>
        {magasins.map(magasin => {
          const count = basketCounts[magasin] || 0
          const isActive = magasin === selectedMagasin && stockAction === 'PANIER'
          return (
            <button
              key={`basket-${magasin}`}
              onClick={() => openBasket(magasin)}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition-colors ${isActive
                ? 'border-blue-500 bg-blue-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800'}`}
            >
              {ic.cart('w-4 h-4')}
              {magasin}
              <span className={`min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${count > 0
                ? 'bg-amber-500 text-white'
                : isActive ? 'bg-blue-500 text-blue-100' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                {count}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  function renderGeneralStockTable(generalGlasses: any[]) {
    return (
      <div className="overflow-x-auto rounded-2xl border border-green-200 dark:border-green-700">
        <div className="min-w-[720px]">
          <table className="w-full min-w-full divide-y divide-green-200 dark:divide-green-700 text-xs sm:text-sm">
            <thead className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-200">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">Photo</th>
                <th className="px-2 py-2 text-left font-semibold">Réf</th>
                <th className="px-2 py-2 text-left font-semibold">Marque</th>
                <th className="px-2 py-2 text-left font-semibold">Forme</th>
                <th className="px-2 py-2 text-left font-semibold">Genre</th>
                <th className="px-2 py-2 text-left font-semibold">Statut</th>
                <th className="px-2 py-2 text-left font-semibold">Date</th>
                <th className="px-2 py-2 text-left font-semibold">Emplacement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-green-200 dark:divide-green-700 bg-white dark:bg-slate-900">
              {isLoadingStock ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-green-700">Chargement...</td></tr>
              ) : generalGlasses.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-green-700">Aucune lunette trouvée.</td></tr>
              ) : (
                generalGlasses.map((g: any, idx: number) => (
                  <tr key={`stock-${g.id || idx}`} className="hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                    <td className="px-2 py-2">
                      {g.photo_monture_url ? (
                        <img src={g.photo_monture_url} alt={g.reference || g.barcode || ''} className="h-12 w-12 rounded-md object-cover" />
                      ) : (
                        <span className="inline-block rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-slate-900 dark:text-white">{g.reference || g.barcode || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{g.brand || g.marque || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{g.shape || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{g.gender || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{g.status || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{g.created_at ? String(g.created_at).slice(0, 10) : '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{g.location_code || g.station_name || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function renderStockActionChooser(magasin: string) {
    const choices: Array<{ action: StockAction; icon: React.ReactElement; label: string; hint: string; accent: string }> = [
      {
        action: 'PANIER',
        icon: ic.cart('w-5 h-5'),
        label: 'Voir le panier',
        hint: `Les recherches client enregistrées pour ${magasin}, et ce que le stock général peut couvrir.`,
        accent: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200',
      },
      {
        action: 'ENVOI',
        icon: ic.transfer('w-5 h-5'),
        label: 'Envoyer le stock',
        hint: 'Préparer la liste des montures à sortir du stock général.',
        accent: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
      },
    ]

    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {choices.map(choice => (
          <button
            key={choice.action}
            onClick={() => { setStockAction(choice.action); setExcludedPreparationKeys([]) }}
            className={`flex flex-col items-start gap-2 rounded-2xl border p-4 text-left transition-colors active:scale-[0.99] ${choice.accent}`}
          >
            {choice.icon}
            <span className="text-sm font-semibold">{choice.label}</span>
            <span className="text-xs opacity-80">{choice.hint}</span>
          </button>
        ))}
      </div>
    )
  }

  function renderBasketAnalysis(magasin: string, generalGlasses: any[]) {
    const matchRows = buildDemandMatches(basketItems, generalGlasses)
    const keptRows = matchRows.filter(row => !excludedDemandIds.includes(row.demand.id))
    const availableCount = matchRows.filter(row => row.match).length

    function toggleDemand(id: number) {
      setExcludedDemandIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    }

    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-3">
            <div className="rounded-2xl border border-slate-200 px-3 py-2 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400">Demandes</p>
              <p className="text-lg font-black tabular-nums text-slate-900 dark:text-white">{matchRows.length}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-800 dark:bg-emerald-900/20">
              <p className="text-xs text-emerald-700 dark:text-emerald-300">Disponibles</p>
              <p className="text-lg font-black tabular-nums text-emerald-700 dark:text-emerald-300">{availableCount}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-900/20">
              <p className="text-xs text-amber-700 dark:text-amber-300">À commander</p>
              <p className="text-lg font-black tabular-nums text-amber-700 dark:text-amber-300">{matchRows.length - availableCount}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => exportDemandCSV(magasin, keptRows)}
              disabled={keptRows.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {ic.download('w-4 h-4')} Exporter
            </button>
            <button
              onClick={() => printDemandList(magasin, keptRows)}
              disabled={keptRows.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {ic.box('w-4 h-4')} Imprimer
            </button>
            <button
              onClick={() => void markDemandsSent(magasin, keptRows.map(row => row.demand.id))}
              disabled={keptRows.length === 0 || isSendingDemand}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {ic.send('w-4 h-4')} {isSendingDemand ? 'Envoi…' : 'Envoyer au stock principal'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-green-200 dark:border-green-700">
          <div className="min-w-[680px]">
            <table className="w-full min-w-full divide-y divide-green-200 dark:divide-green-700 text-xs sm:text-sm">
              <thead className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-200">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">Retenir</th>
                  <th className="px-2 py-2 text-left font-semibold">Genre</th>
                  <th className="px-2 py-2 text-left font-semibold">Forme</th>
                  <th className="px-2 py-2 text-left font-semibold">Gamme</th>
                  <th className="px-2 py-2 text-left font-semibold">Taille</th>
                  <th className="px-2 py-2 text-left font-semibold">Stock principal</th>
                  <th className="px-2 py-2 text-left font-semibold">Emplacement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-green-200 dark:divide-green-700 bg-white dark:bg-slate-900">
                {isLoadingBasket ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-green-700">Chargement du panier...</td></tr>
                ) : matchRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-green-700">Panier vide : aucune recherche client enregistrée pour {magasin}.</td></tr>
                ) : (
                  matchRows.map(({ demand, match }) => {
                    const isKept = !excludedDemandIds.includes(demand.id)
                    return (
                      <tr key={`demand-${demand.id}`} className={isKept ? '' : 'opacity-40'}>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={isKept} onChange={() => toggleDemand(demand.id)} className="h-4 w-4 accent-emerald-600" />
                        </td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{demand.genre || '—'}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{demand.forme || '—'}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{demand.gamme || '—'}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{demand.taille || '—'}</td>
                        <td className="px-2 py-2">
                          {match ? (
                            <span className="font-mono text-emerald-700 dark:text-emerald-300">{getGlassRef(match)}</span>
                          ) : (
                            <span className="text-amber-700 dark:text-amber-300">à commander</span>
                          )}
                        </td>
                        <td className="px-2 py-2 font-mono text-slate-700 dark:text-slate-200">
                          {match ? (match.location_code || match.station_name || '—') : '—'}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Chaque ligne est une recherche client déposée par le chatbot. « Envoyer au stock principal » sort les lignes retenues du panier — le stock lui-même n'est pas déplacé.
        </p>
      </div>
    )
  }

  // Le bon de préparation découle du panier : on ne sort du stock général que ce qui répond
  // à une demande client réellement enregistrée.
  function renderStockPreparation(magasin: string, generalGlasses: any[]) {
    const preparationRows = buildPreparationRows(basketItems, generalGlasses)
    const keptRows = preparationRows.filter(row => !excludedPreparationKeys.includes(String(row.demand.id)))
    const uncovered = basketItems.length - preparationRows.length

    function togglePreparationRow(key: string) {
      setExcludedPreparationKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
    }

    return (
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button onClick={() => { setStockAction('PANIER'); setExcludedPreparationKeys([]) }} className="self-start rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">
            Revoir le panier
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => exportPreparationCSV(magasin, keptRows)}
              disabled={keptRows.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {ic.download('w-4 h-4')} Exporter
            </button>
            <button
              onClick={() => printPreparationList(magasin, keptRows)}
              disabled={keptRows.length === 0}
              className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
            >
              {ic.box('w-4 h-4')} Imprimer le bon
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          {basketItems.length} demande(s) au panier · {preparationRows.length} couverte(s) par le stock général · {keptRows.length} retenue(s) pour l'envoi
          {uncovered > 0 ? ` · ${uncovered} à commander` : ''}.
          {' '}Rien n'est déplacé en base : ce bon sert à préparer physiquement le colis.
        </p>

        <div className="overflow-x-auto rounded-2xl border border-green-200 dark:border-green-700">
          <div className="min-w-[680px]">
            <table className="w-full min-w-full divide-y divide-green-200 dark:divide-green-700 text-xs sm:text-sm">
              <thead className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-200">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">Prendre</th>
                  <th className="px-2 py-2 text-left font-semibold">Réf</th>
                  <th className="px-2 py-2 text-left font-semibold">Marque</th>
                  <th className="px-2 py-2 text-left font-semibold">Genre</th>
                  <th className="px-2 py-2 text-left font-semibold">Forme</th>
                  <th className="px-2 py-2 text-left font-semibold">Emplacement</th>
                  <th className="px-2 py-2 text-left font-semibold">Demande couverte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-green-200 dark:divide-green-700 bg-white dark:bg-slate-900">
                {isLoadingStock || isLoadingBasket ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-green-700">Chargement...</td></tr>
                ) : preparationRows.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-green-700">Aucune demande du panier ne peut être couverte par le stock général.</td></tr>
                ) : (
                  preparationRows.map(row => {
                    const key = String(row.demand.id)
                    const isKept = !excludedPreparationKeys.includes(key)
                    return (
                      <tr key={`prep-${key}`} className={isKept ? '' : 'opacity-40'}>
                        <td className="px-2 py-2">
                          <input type="checkbox" checked={isKept} onChange={() => togglePreparationRow(key)} className="h-4 w-4 accent-emerald-600" />
                        </td>
                        <td className="px-2 py-2 font-mono text-slate-900 dark:text-white">{getGlassRef(row.glass)}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.glass.brand || row.glass.marque || '—'}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{normalizeGenderName(row.glass.gender) || '—'}</td>
                        <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{normalizeShapeName(row.glass.shape) || '—'}</td>
                        <td className="px-2 py-2 font-mono text-slate-700 dark:text-slate-200">{row.glass.location_code || row.glass.station_name || '—'}</td>
                        <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatDemandCriteria(row.demand)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  async function openReceptionDetail(session: (typeof RECEPTION_SESSIONS)[number]) {
    setDetailSession(session)
    setDetailSearch('')
    setDetailStatusFilter('all')
    setDetailFormeFilter('all')
    setDetailGenreFilter('all')
    setDetailGammeFilter('all')

    let linkedCommand = receptionCommands.find(cmd => cmd.orderId === session.orderId)
    if (!linkedCommand) {
      const loaded = await loadReceptionCommands()
      linkedCommand = loaded.find(cmd => cmd.orderId === session.orderId)
    }

    if (linkedCommand?.id) {
      await loadReceptionSessionGlasses(linkedCommand.id)
    } else {
      setDetailSessionGlasses([])
    }
  }

  async function createReceptionSession(orderId: number | undefined, targetCount: number, supplier: string) {
    if (!orderId || targetCount < 1) return
    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsCreatingReceptionSession(true)
    try {
      const response = await fetch(`${API_URL}/inventory/reception-commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          target_count: targetCount,
          supplier_order_id: orderId,
        }),
      })
      if (!response.ok) throw new Error('save failed')

      const payload = await response.json().catch(() => ({}))
      const command = payload?.data?.command
      if (!command || !command.code) throw new Error('invalid response')

      const newCommand: ReceptionSessionResult = {
        id: Number(command.id || 0),
        orderId,
        code: command.code,
        targetCount: Number(command.target_count || targetCount),
        registeredCount: Number(command.registered_count || 0),
        status: String(command.status || 'pending'),
        compareText: `Commande ${supplier} · ${targetCount} monture(s)`,
      }
      setReceptionSession(newCommand)
      setReceptionCommands(prev => [...prev.filter(cmd => cmd.orderId !== orderId), newCommand])
      setShowReceptionSessionCard(true)
    } catch {
      window.alert('Impossible de générer la session de réception pour le moment.')
    } finally {
      setIsCreatingReceptionSession(false)
    }
  }

  async function downloadDataUrl(dataUrl: string, filename: string) {
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async function svgToPngDataUrl(svg: SVGSVGElement) {
    const serializer = new XMLSerializer()
    const svgString = serializer.serializeToString(svg)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('Impossible de charger le SVG'))
        img.src = url
      })

      const width = image.naturalWidth || svg.clientWidth || 320
      const height = image.naturalHeight || svg.clientHeight || 120
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas non supporté')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(image, 0, 0, width, height)
      return canvas.toDataURL('image/png')
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  async function downloadBarcodeImage() {
    if (!barcodeRef.current || !receptionSession) return
    const dataUrl = await svgToPngDataUrl(barcodeRef.current)
    await downloadDataUrl(dataUrl, `session-${receptionSession.code}.png`)
  }

  async function downloadAndPrintBarcode() {
    if (!barcodeRef.current || !receptionSession) return
    const dataUrl = await svgToPngDataUrl(barcodeRef.current)
    await downloadDataUrl(dataUrl, `session-${receptionSession.code}.png`)

    const popup = window.open('', '_blank', 'width=600,height=700')
    if (!popup) {
      window.alert('Autorisez les fenêtres surgissantes pour imprimer.');
      return
    }
    popup.document.write(`<html><head><title>Imprimer session ${receptionSession.code}</title><style>body{margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;text-align:center;}img{max-width:100%;height:auto;}</style></head><body><h2>${receptionSession.code}</h2><img src="${dataUrl}" alt="Code-barres" /><script>window.onload=function(){window.print();};</script></body></html>`)
    popup.document.close()
    popup.focus()
  }

  useEffect(() => {
    if (!receptionSession || !barcodeRef.current) return

    import('jsbarcode').then(module => {
      const JsBarcode = (module.default || module) as any
      if (typeof JsBarcode === 'function') {
        JsBarcode(barcodeRef.current, receptionSession.code, {
          format: 'CODE128',
          width: 2,
          height: 72,
          displayValue: true,
          margin: 10,
        })
      }
    }).catch(() => {
      // barcode rendering is optional; fail silently if module cannot be loaded
    })
    // showStockPage : la page stock démonte le <svg>, il faut le redessiner au retour.
  }, [receptionSession, showStockPage, showReceptionSessionCard])

  useEffect(() => {
    if (!showStockPage) return

    void loadBasketCounts()

    // Le chatbot vit dans un autre composant : il signale par cet événement qu'il vient de
    // déposer une demande, ce qui fait monter le compteur sans recharger la page.
    const handleBasketUpdate = () => { void loadBasketCounts() }
    window.addEventListener(BASKET_UPDATED_EVENT, handleBasketUpdate)
    return () => window.removeEventListener(BASKET_UPDATED_EVENT, handleBasketUpdate)
  }, [showStockPage])

  useEffect(() => {
    if (!showStockPage || stockScope === 'GENERAL') return
    if (stockAction !== 'PANIER' && stockAction !== 'ENVOI') return
    void loadBasketItems(stockScope)
  }, [showStockPage, stockScope, stockAction])

  function renderDetailSession() {
    if (!detailSession) return null

    const rows = detailSessionGlasses.map((glass: any) => {
      const createdAt = glass.created_at ? String(glass.created_at) : ''
      const date = createdAt ? createdAt.slice(0, 10) : detailSession.date
      const heure = createdAt.includes('T') ? createdAt.slice(11, 16) : ''
      const gamme = resolveFrameGamme(glass.material, glass.price)
      return {
        reference: String(glass.reference || glass.barcode || '—'),
        photo: String(glass.photo_monture_url || glass.photo_branche_url || '—'),
        gamme,
        genre: String(glass.gender || '—'),
        enregistréPar: String(glass.station_name || glass.location_code || '—'),
        heure: heure || '—',
        forme: String(glass.shape || '—'),
        quantity: 1,
        date,
        status: 'Reçu' as const,
      }
    })

    const fallbackRows = rows.length === 0 ? [{
      reference: `REF-${detailSession.id}`,
      photo: 'photo-1.jpg',
      gamme: 'classique',
      genre: 'Homme',
      enregistréPar: 'A. Diop',
      heure: '09:15',
      forme: 'Rectangle',
      quantity: 1,
      date: detailSession.date,
      status: 'Reçu' as const,
    }] : []

    const allRows = [...rows, ...fallbackRows]
    const detailShapeOptions = ['all', ...Array.from(new Set(
      allRows.map(row => normalizeShapeName(row.forme)).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'fr'))]
    const detailGenreOptions = ['all', ...Array.from(new Set(
      allRows.map(row => String(row.genre || '').trim()).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'fr'))]
    const detailGammeOptions = ['all', ...Array.from(new Set(
      allRows.map(row => normalizeGammeName(row.gamme)).filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'fr'))]
    const filteredRows = allRows.filter(row => {
      const matchesSearch = `${row.reference} ${row.photo} ${row.gamme} ${row.genre} ${row.forme}`.toLowerCase().includes(detailSearch.toLowerCase())
      const matchesStatus = detailStatusFilter === 'all' || row.status === detailStatusFilter
      const matchesForme = detailFormeFilter === 'all' || normalizeShapeName(row.forme) === normalizeShapeName(detailFormeFilter)
      const matchesGenre = detailGenreFilter === 'all' || normalizeGenderName(row.genre) === normalizeGenderName(detailGenreFilter)
      const matchesGamme = detailGammeFilter === 'all' || normalizeGammeName(row.gamme) === normalizeGammeName(detailGammeFilter)
      return matchesSearch && matchesStatus && matchesForme && matchesGenre && matchesGamme
    })
    const totalCount = Math.max(1, Number(detailSession.frames || rows.length))
    const receivedCount = rows.filter(row => row.status === 'Reçu').length
    const detailTableAccent = '#16a34a'

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setDetailSession(null)}>
        <div className="w-full max-w-5xl rounded-3xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
          <div className="flex flex-col gap-3 md:gap-0 md:flex-row md:items-start md:justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Détail de réception</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{detailSession.id} · {detailSession.date} à {detailSession.time}</p>
            </div>
            <button onClick={() => setDetailSession(null)} className="self-start text-slate-400 hover:text-slate-600">{ic.x()}</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <div className="rounded-xl border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-300">
              <span className="font-semibold">{receivedCount}/{totalCount}</span>
            </div>
            <input value={detailSearch} onChange={e => setDetailSearch(e.target.value)} placeholder="Rechercher référence, photo, gamme..." className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300" />
            <select value={detailStatusFilter} onChange={e => setDetailStatusFilter(e.target.value as 'all' | 'Reçu' | 'En attente')} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              <option value="all">Tous les statuts</option>
              <option value="Reçu">Reçu</option>
              <option value="En attente">En attente</option>
            </select>
            <select value={detailFormeFilter} onChange={e => setDetailFormeFilter(e.target.value as ShapeFilterValue)} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {detailShapeOptions.map(option => (
                <option key={option} value={option}>{option === 'all' ? 'Toutes formes' : option}</option>
              ))}
            </select>
            <select value={detailGenreFilter} onChange={e => setDetailGenreFilter(e.target.value as GenreFilterValue)} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {detailGenreOptions.map(option => (
                <option key={option} value={option}>{option === 'all' ? 'Tous genres' : option}</option>
              ))}
            </select>
            <select value={detailGammeFilter} onChange={e => setDetailGammeFilter(e.target.value as GammeFilterValue)} className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300">
              {detailGammeOptions.map(option => (
                <option key={option} value={option}>{option === 'all' ? 'Toutes gammes' : option}</option>
              ))}
            </select>
            <button type="button" onClick={() => {
              const csv = ['Référence;Photo;Gamme;Genre;Enregistré par;Heure;Forme;Quantité;Date;Statut', ...filteredRows.map(row => [row.reference, row.photo, row.gamme, row.genre, row.enregistréPar, row.heure, row.forme, row.quantity, row.date, row.status].join(';'))].join('\r\n')
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = `reception-${detailSession.id}.csv`
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
              URL.revokeObjectURL(url)
            }} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              {ic.download('w-4 h-4')} Export CSV
            </button>
            <button onClick={() => setDetailSession(null)} className="text-slate-400 hover:text-slate-600">{ic.x()}</button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
            <div className="min-w-[720px]">
              <table className="w-full min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-xs sm:text-sm">
                <thead className="text-white" style={{ backgroundColor: detailTableAccent }}>
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold">Photo</th>
                    <th className="px-2 py-2 text-left font-semibold">Réf</th>
                    <th className="px-2 py-2 text-left font-semibold">Gamme</th>
                    <th className="px-2 py-2 text-left font-semibold">Genre</th>
                    <th className="px-2 py-2 text-left font-semibold">Par</th>
                    <th className="px-2 py-2 text-left font-semibold">Heure</th>
                    <th className="px-2 py-2 text-left font-semibold">Forme</th>
                    <th className="px-2 py-2 text-left font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                  {filteredRows.map((row, idx) => (
                    <tr key={`${detailSession.id}-${idx}`} className="hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-colors">
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                        {row.photo && row.photo.startsWith('http') ? (
                          <img src={row.photo} alt={row.reference} className="h-16 w-16 rounded-md object-cover" />
                        ) : (
                          <span className="inline-block rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">{row.photo}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-slate-900 dark:text-white">{row.reference}</td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.gamme}</td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.genre}</td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.enregistréPar}</td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.heure}</td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.forme}</td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.date}</td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Aucune monture n&apos;est associée à cette session pour le moment.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Le stock occupe toute la page : il remplace la liste des sessions au lieu de s'y superposer.
  if (showStockPage) return renderStockPage()

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Sessions de réception</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => { setShowStockPage(true); void loadStockGlasses() }} className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors active:scale-95">
            {ic.box('w-4 h-4')} Voir mon stock
          </button>
          <button onClick={() => setShowSupplierModal(true)} className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors active:scale-95">
            {ic.plus('w-4 h-4')} Nouvelle
          </button>
        </div>
        </div>
      {receptionSession && !showReceptionSessionCard && (() => {
        const currentState = getReceptionCardState(receptionSession, Number(receptionSession.registeredCount || 0), Number(receptionSession.targetCount || 0))
        return (
          <div className={`${getReceptionCardClass(currentState)} rounded-3xl p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/60`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Session d&apos;enregistrement</p>
                <p className="text-sm text-slate-700 dark:text-slate-200">Session créée — revoir le code-barres</p>
              </div>
              <button type="button" onClick={() => setShowReceptionSessionCard(true)} className="rounded-full bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                Revoir le code-barres
              </button>
            </div>
          </div>
        )
      })()}
      {receptionSession && showReceptionSessionCard && (() => {
        const currentState = getReceptionCardState(receptionSession, Number(receptionSession.registeredCount || 0), Number(receptionSession.targetCount || 0))
        return (
          <div className={`${getReceptionCardClass(currentState)} rounded-3xl p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/70`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Session d&apos;enregistrement</p>
                <h3 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Étiquette à scanner</h3>
              </div>
              <button type="button" onClick={() => setReceptionSession(null)} className="text-sm font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                Fermer
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <svg ref={barcodeRef} className="w-full max-w-[320px] mx-auto" />
                <p className="mt-3 text-center text-sm font-semibold text-slate-900 dark:text-white">{receptionSession.code}</p>
              </div>
              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                <p>Monture(s) prévues</p>
                <p className="mt-2 text-3xl font-black text-blue-600 dark:text-blue-400 tabular-nums">{receptionSession.targetCount}</p>
                <div className="mt-3 rounded-full bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">● En attente</div>
                {receptionSession.compareText && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{receptionSession.compareText}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={downloadAndPrintBarcode} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    Imprimer et télécharger
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      {showCountriesView ? (
        <div className="space-y-3 rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">Pays enregistrés</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">Liste des pays disponibles en base.</p>
            </div>
            <button onClick={() => setShowCountriesView(false)} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
              Retour
            </button>
          </div>
          {isLoadingCountries ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Chargement des pays...
            </div>
          ) : countryList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              Aucun pays disponible pour le moment.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {countryList.map(country => (
                <div key={country.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200">
                  <div className="font-semibold">{country.name}</div>
                  {country.code && <div className="text-xs text-slate-500 dark:text-slate-400">Code: {country.code}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : isLoadingSessions ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-4 text-sm text-slate-500 dark:text-slate-400">
          Chargement des enregistrements...
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-4 text-sm text-slate-500 dark:text-slate-400">
          <div className="flex items-center justify-between gap-3">
            <span>Aucune donnée disponible pour le moment.</span>
            <button onClick={() => void loadCountriesView()} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Voir tous les pays
            </button>
          </div>
        </div>
      ) : sessions.map(s => {
        const isExpanded = expandedId === s.id
        const linkedCommand = receptionCommands.find(cmd => cmd.orderId === s.orderId)
        const receivedCount = linkedCommand ? Number(linkedCommand.registeredCount || 0) : 0
        const totalCount = Number(s.frames || 0)
        const receptionState = getReceptionCardState(linkedCommand, receivedCount, totalCount)
        const cardBgClass = getReceptionCardClass(receptionState)
        return (
          <div key={s.id} className={`${cardBgClass} rounded-2xl border p-4 transition-all ${receptionState === 'idle' ? 'hover:border-slate-500 dark:hover:border-slate-600 hover:shadow-sm' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="font-bold text-slate-900 dark:text-white text-sm">{s.id}</span><Badge status={s.status} /></div>
                <p className="text-xs text-slate-400 mt-1">{s.date} à {s.time}</p>
                <div className="mt-2 inline-flex max-w-full items-center rounded-lg border border-blue-100 bg-blue-50/80 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/20 dark:text-blue-300">
                  <span className="truncate">{formatReceptionNote(s.note, s.operator)}</span>
                </div>
                {/* Destination(s) de la session, une fois sa liste envoyée. Plusieurs villes
                    possibles : la liste se compose par lots et peut partir en plusieurs fois. */}
                {(sentListSessions[s.id] || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Destination</span>
                    {sentListSessions[s.id].map(city => (
                      <span key={city} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                        {ic.store('w-3.5 h-3.5')} {city}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {s.orderId !== undefined && receptionCommands.some(cmd => cmd.orderId === s.orderId) && (
                    <button type="button" onClick={() => void viewReceptionBarcode(s.orderId)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700">
                      Revoir le code-barres
                    </button>
                  )}
                  {/* La session est complète (carte verte) : elle peut partir en magasin.
                      Une fois la liste envoyée, le bouton est grisé et inerte. */}
                  {receptionState === 'complete' && (() => {
                    const alreadySent = (sentListSessions[s.id] || []).length > 0
                    return (
                      <button
                        type="button"
                        onClick={() => void openSendList(s)}
                        disabled={alreadySent}
                        title={alreadySent ? 'La liste de cette session a déjà été envoyée au stock général' : undefined}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${alreadySent
                          ? 'cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'}`}
                      >
                        {alreadySent ? ic.check('w-3.5 h-3.5') : ic.send('w-3.5 h-3.5')}
                        {alreadySent ? 'Liste envoyée' : 'Envoyer la liste'}
                      </button>
                    )
                  })()}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 text-right">
                <div>
                  <p className="text-3xl font-black text-blue-600 dark:text-blue-400 tabular-nums">{s.frames}</p>
                  <p className="text-xs text-slate-400">quantité</p>
                </div>
                {s.orderId !== undefined && (
                  <button
                    type="button"
                    onClick={() => void deleteReceptionSession(s.orderId)}
                    disabled={isDeletingSessionId === s.orderId}
                    className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/40"
                  >
                    {ic.trash('w-4 h-4')}
                    {isDeletingSessionId === s.orderId ? 'Suppression...' : 'Supprimer'}
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 border-t border-slate-400/40 dark:border-slate-700/70 pt-3">
              <button type="button" onClick={() => setExpandedId(isExpanded ? null : s.id)} className="w-full flex items-center justify-between text-sm font-semibold text-slate-700 dark:text-slate-200">
                <span>Réception</span>
                <span className="text-xs text-slate-500">{isExpanded ? '▲' : '▼'}</span>
              </button>
              {isExpanded && (
                <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50/90 p-3 dark:border-slate-700 dark:bg-slate-900/60">
                  <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={receivedCount > 0} readOnly />
                    <span>Reçu</span>
                  </label>
                  <div className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${receptionState === 'recording' ? 'bg-orange-50 text-orange-800 dark:bg-orange-900/20 dark:text-orange-200' : receptionState === 'complete' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200' : 'bg-white/80 text-slate-600 dark:bg-slate-800/70 dark:text-slate-300'}`}>
                    <span>Nombre</span>
                    <span className="font-semibold">{receivedCount}/{totalCount}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => void openReceptionDetail(s)} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                      Voir tous
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}

      {renderDetailSession()}

      {sendListSession && (() => {
        const { matches, selected } = getSendListSelection()
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setSendListSession(null)}>
          <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Envoyer la liste</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Session {sendListSession.id} · {isLoadingSendList ? 'chargement…' : `${sendListGlasses.length} monture(s)`}
                </p>
              </div>
              <button onClick={() => setSendListSession(null)} className="self-start text-slate-400 hover:text-slate-600">{ic.x()}</button>
            </div>

            {sendListSent ? (
              <>
                <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-900/20">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    {ic.check('w-5 h-5')}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">Liste envoyée au stock général</p>
                    <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                      Session {sendListSession.id} · destination {sendListMagasin} · {selected.length} monture(s).
                      Le poste de scan est prévenu et prépare le colis.
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => printSessionList(sendListMagasin, sendListSession!.id, selected)}
                    className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    {ic.box('w-4 h-4')} Imprimer le bon
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendListSession(null)}
                    className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
                  >
                    Fermer
                  </button>
                </div>
              </>
            ) : (
            <>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Vers quel stock magasin ?
            </p>

            {magasinOptions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Aucune ville disponible. Vérifiez que des villes sont enregistrées en base.
              </div>
            ) : (
              <div className="grid max-h-64 gap-2 overflow-y-auto pr-1 sm:grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {magasinOptions.map(option => {
                  const isActive = option.city === sendListMagasin
                  return (
                    <button
                      key={`${option.country}-${option.city}`}
                      type="button"
                      onClick={() => setSendListMagasin(option.city)}
                      aria-pressed={isActive}
                      className={`flex items-center gap-2.5 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-colors ${isActive
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800'}`}
                    >
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'}`}>
                        {ic.store('w-4 h-4')}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-medium uppercase tracking-wide opacity-60">
                          {option.country || 'Stock magasin'}
                        </span>
                        <span className="block truncate">{option.city}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}

            <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Que faut-il envoyer ?
            </p>
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_2.5rem] gap-2 bg-slate-100 px-3 py-3 text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <span>Forme</span>
                <span>Genre</span>
                <span>Gamme</span>
                <span>Nombre</span>
                <span className="sr-only">Actions</span>
              </div>
              <div className="space-y-2 p-3">
                {sendListLines.map((line, index) => (
                  <div key={line.id} className="grid grid-cols-[2fr_1fr_1fr_1fr_2.5rem] gap-2 items-center rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                    <select
                      value={line.forme}
                      onChange={e => setSendListLines(prev => prev.map(item => item.id === line.id ? { ...item, forme: e.target.value as ShapeFilterValue } : item))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {(sendListShapeOptions.length > 1 ? sendListShapeOptions : SHAPE_FILTER_OPTIONS).map(option => (
                        <option key={option} value={option}>{option === 'all' ? 'Toutes formes' : option}</option>
                      ))}
                    </select>
                    <select
                      value={line.genre}
                      onChange={e => setSendListLines(prev => prev.map(item => item.id === line.id ? { ...item, genre: e.target.value as 'all' | 'Homme' | 'Femme' | 'Enfant' | 'Unisexe' } : item))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {(sendListGenreOptions.length > 1 ? sendListGenreOptions : ['all', 'Homme', 'Femme', 'Enfant', 'Unisexe']).map(option => (
                        <option key={option} value={option}>{option === 'all' ? 'Tous genres' : option}</option>
                      ))}
                    </select>
                    <select
                      value={line.gamme}
                      onChange={e => setSendListLines(prev => prev.map(item => item.id === line.id ? { ...item, gamme: e.target.value as GammeFilterValue } : item))}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    >
                      {(sendListGammeOptions.length > 1 ? sendListGammeOptions : GAMME_FILTER_OPTIONS).map(option => (
                        <option key={option} value={option}>{option === 'all' ? 'Toutes gammes' : option}</option>
                      ))}
                    </select>
                    <div className="w-full rounded-xl border border-slate-200 bg-slate-100 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                      {(line.forme === 'all' && line.genre === 'all' && line.gamme === 'all') ? 0 : sendListGlasses.filter((glass: any) => {
                        if (line.forme !== 'all' && normalizeShapeName(glass.shape) !== normalizeShapeName(line.forme)) return false
                        if (line.genre !== 'all' && normalizeGenderName(glass.gender) !== normalizeGenderName(line.genre)) return false
                        if (line.gamme !== 'all' && resolveFrameGamme(glass.material, glass.price) !== normalizeGammeName(line.gamme)) return false
                        return true
                      }).length}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSendListLines(prev => prev.filter(item => item.id !== line.id))}
                      disabled={sendListLines.length === 1}
                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-600 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                      ×
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={() => setSendListLines(prev => [...prev, createSendListLine()])}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  {ic.plus('w-4 h-4')} Ajouter une ligne
                </button>
              </div>
            </div>

            <div className={`mt-3 rounded-xl px-3 py-2 text-xs font-medium ${selected.length === 0
              ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
              {matches.length === 0
                ? 'Aucune monture de la session ne correspond à ces critères.'
                : <>{matches.length} monture(s) correspondent · <span className="font-bold">{selected.length} retenue(s)</span> pour l'envoi</>}
            </div>

            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              Rien n'est déplacé en base : la liste sert à préparer et accompagner l'envoi physique.
            </p>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => exportSessionListCSV(sendListMagasin, sendListSession!.id, selected)}
                disabled={!sendListMagasin || selected.length === 0}
                className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {ic.download('w-4 h-4')} Exporter
              </button>
              <button
                type="button"
                onClick={() => void submitSendList()}
                disabled={!sendListMagasin || selected.length === 0 || isSubmittingSendList}
                className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                {ic.send('w-4 h-4')} {isSubmittingSendList ? 'Envoi…' : `Envoyer ${selected.length || ''}`.trim()}
              </button>
            </div>
            </>
            )}
          </div>
        </div>
        )
      })()}

      {showSupplierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowSupplierModal(false)}>
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Nouvelle expédition</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Enregistrez ici chaque commande envoyée au stock, en sélectionnant le pays de destination.</p>
              </div>
              <button onClick={() => setShowSupplierModal(false)} className="text-slate-400 hover:text-slate-600">{ic.x()}</button>
            </div>
            <form onSubmit={saveSupplierOrder} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Fournisseur *</label>
                  <input required value={supplierForm.supplier} onChange={e => setSupplierForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Dubai" className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Quantité commandée *</label>
                  <input required type="number" min="1" step="1" value={supplierForm.quantity} onChange={e => setSupplierForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Ex. 500" className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Date de commande</label>
                  <input type="date" value={supplierForm.date} onChange={e => setSupplierForm(f => ({ ...f, date: e.target.value }))} className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Pays de destination</label>
                  <select value={supplierForm.country} onChange={e => setSupplierForm(f => ({ ...f, country: e.target.value }))} className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" disabled={isLoadingCountries}>
                    <option value="">{isLoadingCountries ? 'Chargement...' : 'Sélectionner un pays'}</option>
                    {countryOptions.map(country => (
                      <option key={country.id} value={country.name}>{country.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Note (optionnel)</label>
                  <input value={supplierForm.note} onChange={e => setSupplierForm(f => ({ ...f, note: e.target.value }))} placeholder="Référence, transporteur..." className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={isSavingSupplier} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{isSavingSupplier ? 'Enregistrement...' : 'Enregistrer la commande'}</button>
                <button type="button" onClick={() => setShowSupplierModal(false)} className="px-4 py-2 text-slate-500 text-sm">Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Supplier view ─────────────────────────────────────────────────────────────
function SupplierView() {
  const [orders, setOrders] = useState(SUPPLIER_ORDERS_INIT)
  const [showForm, setShowForm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState({ supplier: 'Dubai', quantity: '', date: '', note: '' })

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return

    fetch(`${API_URL}/inventory/supplier-orders`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async response => {
        if (!response.ok) throw new Error('supplier orders unavailable')
        const payload = await response.json().catch(() => ({}))
        const list = payload?.data?.orders || []
        setOrders(list.map((order: any) => ({
          id: `CMD-${order.id}`,
          supplier: order.supplier,
          quantity: order.quantity,
          sent: 0,
          date: order.order_date ? new Date(order.order_date).toISOString().slice(0, 10) : '',
          note: order.note || '',
          status: 'pending' as const,
        })))
      })
      .catch(() => setOrders([]))
  }, [])

  async function addOrder(e: React.FormEvent) {
    e.preventDefault()
    const token = window.localStorage.getItem('token')
    const quantity = Number(form.quantity)

    if (!token || !form.supplier.trim() || !quantity || !form.date) return

    setIsSaving(true)
    try {
      const response = await fetch(`${API_URL}/inventory/supplier-orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          supplier: form.supplier.trim(),
          quantity,
          order_date: form.date,
          note: form.note.trim(),
        }),
      })

      if (!response.ok) throw new Error('save failed')

      const payload = await response.json().catch(() => ({}))
      const order = payload?.data?.order
      setOrders(prev => [{
        id: `CMD-${order?.id ?? 'new'}`,
        supplier: order?.supplier || form.supplier.trim(),
        quantity: order?.quantity ?? quantity,
        sent: 0,
        date: order?.order_date ? new Date(order.order_date).toISOString().slice(0, 10) : form.date,
        note: order?.note || form.note.trim(),
        status: 'pending' as const,
      }, ...prev])
      setShowForm(false)
      setForm({ supplier: 'Dubai', quantity: '', date: '', note: '' })
    } catch {
      window.alert('Impossible d\'enregistrer la commande fournisseur pour le moment.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Commandes Fournisseur</h2>
        <button onClick={() => setShowForm(v => !v)} className="flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors active:scale-95">
          {ic.plus('w-4 h-4')} Nouvelle
        </button>
      </div>
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowForm(false)}>
          <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Nouvelle commande fournisseur</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Enregistrez ici chaque commande passée à un fournisseur, comme Dubai.</p>
              </div>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">{ic.x()}</button>
            </div>
            <form onSubmit={addOrder} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Fournisseur *</label>
                  <input required value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="Dubai" className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Quantité commandée *</label>
                  <input required type="number" min="1" step="1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Ex. 500" className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Date de commande</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Note (optionnel)</label>
                  <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Référence, transporteur..." className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{isSaving ? 'Enregistrement...' : 'Enregistrer la commande'}</button>
                <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-slate-500 text-sm">Annuler</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-4 text-sm text-slate-500 dark:text-slate-400">
          Aucune donnée disponible pour le moment.
        </div>
      ) : orders.map(order => {
        const pct = order.quantity > 0 ? (order.sent / order.quantity) * 100 : 0
        return (
          <div key={order.id} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-slate-900 dark:text-white text-sm">{order.supplier}</span><Badge status={order.status} /></div>
                <p className="text-xs text-slate-400 mt-0.5">{order.id} · {order.date}</p>
                {order.note && <p className="text-xs text-slate-500 mt-1 italic">{order.note}</p>}
              </div>
            </div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-slate-500">Commandé <strong className="text-slate-800 dark:text-slate-200">{order.quantity}</strong></span>
              <span className="text-slate-500">Envoyé <strong className="text-green-600">{order.sent}</strong></span>
              <span className="text-slate-500">Reste <strong className="text-orange-500">{order.quantity - order.sent}</strong></span>
            </div>
            <div className="bg-slate-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
              <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: order.status === 'complete' ? '#16a34a' : '#2563eb' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Une couleur et une icône par groupe, comme STAGE_META pour les étapes : c'est ce qui
// teinte la carte sélectionnée et l'en-tête de la liste.
const ROLE_OPTIONS = [
  { id: 1, label: 'Super administrateur', value: 'SUPER_ADMIN' },
  { id: 2, label: 'Administrateur', value: 'ADMIN' },
  { id: 3, label: 'Magasinier', value: 'MAGASINIER' },
  { id: 4, label: 'Vendeur', value: 'VENDEUR' },
  { id: 5, label: 'Laboratoire', value: 'LABORATOIRE' },
  { id: 6, label: 'Responsable de station', value: 'RESPONSABLE_STATION' },
  // id 9 : fixé par la migration 025_caisse (7 = DIRECTION, 8 = SUPER_DIRECTEUR).
  { id: 9, label: 'Caissier', value: 'CAISSIER' },
]

const EMPLOYEE_GROUP_META: Record<string, { color: string; icon: (c?: string) => React.ReactElement }> = {
  'Station Générale': { color: '#2563eb', icon: ic.box },
  'Sous-stations': { color: '#0891b2', icon: ic.store },
  'Laboratoire': { color: '#9333ea', icon: ic.flask },
}

function EmployeesView() {
  const [search, setSearch] = useState('')
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasError, setHasError] = useState(false)
  const [stations, setStations] = useState<Array<{ id: number; name: string }>>([])
  const [cities, setCities] = useState<Array<{ id: number; name: string }>>([])
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [employeeForm, setEmployeeForm] = useState({
    fullName: '',
    gender: '',
    phone: '',
    email: '',
    city: '',
    roleId: '',
    stationId: '',
  })
  const [isSavingEmployee, setIsSavingEmployee] = useState(false)
  const [employeeFormError, setEmployeeFormError] = useState('')
  const groups = ['Station Générale', 'Sous-stations', 'Laboratoire']
  // Même principe que les étapes : les cartes restent affichées, seule la liste change.
  const [selectedGroup, setSelectedGroup] = useState<string>(groups[0])

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return

    setIsLoading(true)
    setHasError(false)

    Promise.all([
      fetch(`${API_URL}/auth/users`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/auth/stations`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/inventory/cities?country_id=1`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(async ([usersResponse, stationsResponse, citiesResponse]) => {
        if (!usersResponse.ok) throw new Error('users unavailable')
        if (!stationsResponse.ok) throw new Error('stations unavailable')
        if (!citiesResponse.ok) throw new Error('cities unavailable')

        const usersPayload = await usersResponse.json().catch(() => ({}))
        const stationsPayload = await stationsResponse.json().catch(() => ({}))
        const citiesPayload = await citiesResponse.json().catch(() => ({}))
        const users = Array.isArray(usersPayload?.data?.users) ? usersPayload.data.users : []
        const stations = Array.isArray(stationsPayload?.data?.stations) ? stationsPayload.data.stations : []
        const citiesData = Array.isArray(citiesPayload?.data?.cities)
          ? citiesPayload.data.cities
          : Array.isArray(citiesPayload?.cities)
            ? citiesPayload.cities
            : []

        setStations(stations.map((station: any) => ({ id: Number(station.id) || 0, name: String(station.name || 'Non assigné') })))
        setCities(citiesData.map((city: any) => ({ id: Number(city.id) || 0, name: String(city.nom || city.name || 'Sans nom') })))
        return users
      })
      .then((users: any[]) => {
        setEmployees(users.map((user: any) => ({
          id: Number(user.id) || 0,
          name: `${String(user.first_name || '').trim()} ${String(user.last_name || '').trim()}`.trim() || 'Utilisateur',
          role: String(user.role_name || user.role || 'INCONNU').toUpperCase(),
          station: String(user.station_name || 'Non assigné').trim() || 'Non assigné',
          group: getEmployeeGroup(user.station_name),
          status: user.is_active ? 'Actif' : 'Inactif',
          avatar: getEmployeeAvatar(`${user.first_name || ''} ${user.last_name || ''}`),
        })))
      })
      .catch(() => {
        setHasError(true)
        setEmployees([])
      })
      .finally(() => setIsLoading(false))
  }, [])

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.station.toLowerCase().includes(search.toLowerCase()) ||
    e.role.toLowerCase().includes(search.toLowerCase())
  )

  const activeMeta = EMPLOYEE_GROUP_META[selectedGroup]
  const members = filtered.filter(e => e.group === selectedGroup)

  const fullNameParts = employeeForm.fullName.trim().split(/\s+/)
  const firstName = fullNameParts.slice(0, -1).join(' ') || fullNameParts[0] || ''
  const lastName = fullNameParts.slice(-1).join(' ') || ''

  async function saveEmployee() {
    const token = window.localStorage.getItem('token')
    if (!token) return

    if (!employeeForm.fullName.trim() || !employeeForm.gender || !employeeForm.phone.trim() || !employeeForm.city.trim() || !employeeForm.roleId) {
      setEmployeeFormError('Veuillez remplir au moins le nom, le genre, le téléphone, la ville et le rôle.')
      return
    }

    setIsSavingEmployee(true)
    setEmployeeFormError('')

    try {
      const response = await fetch(`${API_URL}/auth/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          first_name: firstName,
          last_name: lastName,
          email: employeeForm.email.trim(),
          phone: employeeForm.phone.trim(),
          gender: employeeForm.gender,
          city: employeeForm.city.trim(),
          role_id: Number(employeeForm.roleId),
          station_id: employeeForm.stationId ? Number(employeeForm.stationId) : null,
        }),
      })

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload?.message || 'Impossible d’ajouter l’employé')
      }

      const payload = await response.json().catch(() => ({}))
      const user = payload?.data?.user
      if (user) {
        setEmployees(prev => [
          {
            id: Number(user.id) || 0,
            name: `${String(user.first_name || '').trim()} ${String(user.last_name || '').trim()}`.trim() || 'Utilisateur',
            role: String(user.role_name || user.role || 'INCONNU').toUpperCase(),
            station: String(user.station_name || 'Non assigné').trim() || 'Non assigné',
            group: getEmployeeGroup(user.station_name),
            status: user.is_active ? 'Actif' : 'Inactif',
            avatar: getEmployeeAvatar(`${user.first_name || ''} ${user.last_name || ''}`),
          },
          ...prev,
        ])
      }

      setShowAddEmployee(false)
      setEmployeeForm({ fullName: '', gender: '', phone: '', email: '', city: '', roleId: '', stationId: '' })
    } catch (error: any) {
      setEmployeeFormError(error?.message || 'Erreur lors de la création de l’employé.')
    } finally {
      setIsSavingEmployee(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search()}</span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher un employé..." className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button type="button" onClick={() => setShowAddEmployee(true)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
          {ic.plus('w-4 h-4')}
          Ajouter un employé
        </button>
      </div>

      {showAddEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={() => setShowAddEmployee(false)}>
          <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-slate-900 p-6 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Ajouter un employé</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Remplissez les informations de base pour créer un compte.</p>
              </div>
              <button type="button" onClick={() => setShowAddEmployee(false)} className="text-slate-400 hover:text-slate-600">{ic.x()}</button>
            </div>

            <div className="space-y-4">
              {employeeFormError && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  {employeeFormError}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Nom complet *</label>
                  <input value={employeeForm.fullName} onChange={e => setEmployeeForm(f => ({ ...f, fullName: e.target.value }))} placeholder="Jean Dupont" className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Genre *</label>
                  <select value={employeeForm.gender} onChange={e => setEmployeeForm(f => ({ ...f, gender: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    <option value="">Sélectionner</option>
                    <option value="Homme">Homme</option>
                    <option value="Femme">Femme</option>
                    <option value="Autre">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Téléphone *</label>
                  <input value={employeeForm.phone} onChange={e => setEmployeeForm(f => ({ ...f, phone: e.target.value }))} placeholder="+242 06 123 4567" className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Email</label>
                  <input type="email" value={employeeForm.email} onChange={e => setEmployeeForm(f => ({ ...f, email: e.target.value }))} placeholder="jean.dupont@lunetterie.com" className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Ville *</label>
                  <select value={employeeForm.city} onChange={e => setEmployeeForm(f => ({ ...f, city: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    <option value="">Sélectionner</option>
                    {cities.map(city => (
                      <option key={city.id} value={city.name}>{city.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Rôle *</label>
                  <select value={employeeForm.roleId} onChange={e => setEmployeeForm(f => ({ ...f, roleId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    <option value="">Sélectionner</option>
                    {ROLE_OPTIONS.map(role => (
                      <option key={role.id} value={role.id}>{role.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Station</label>
                  <select value={employeeForm.stationId} onChange={e => setEmployeeForm(f => ({ ...f, stationId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    <option value="">Aucune station</option>
                    {stations.map(station => {
                      const label = station.name === 'Station Pointe-Noire' ? 'Stock magasin' : station.name === 'Stock Principal' ? 'Stock principal' : station.name
                      return <option key={station.id} value={station.id}>{label}</option>
                    })}
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button type="button" disabled={isSavingEmployee} onClick={saveEmployee} className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                  {isSavingEmployee ? 'Enregistrement...' : 'Enregistrer'}
                </button>
                <button type="button" onClick={() => setShowAddEmployee(false)} className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  Annuler
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-4 text-sm text-slate-500 dark:text-slate-400">
          Chargement des employés…
        </div>
      ) : hasError ? (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-700 bg-rose-50 dark:bg-rose-900/30 p-4 text-sm text-rose-700 dark:text-rose-200">
          Impossible de charger la liste des employés pour le moment.
        </div>
      ) : (
        <>
          {/* Cartes de groupe — mêmes blocs que les étapes, carrousel sur mobile */}
          <div className={`${CARD_ROW_CLASS} sm:grid-cols-3`}>
            {groups.map(group => {
              const groupMembers = filtered.filter(e => e.group === group)
              const meta = EMPLOYEE_GROUP_META[group]
              const isActive = group === selectedGroup
              return (
                <button
                  key={group}
                  type="button"
                  onClick={() => setSelectedGroup(group)}
                  aria-pressed={isActive}
                  className={`${CARD_CLASS} ${isActive
                    ? 'bg-white dark:bg-slate-900'
                    : 'border-slate-200 bg-white hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900'}`}
                  style={isActive ? { borderColor: meta.color, backgroundColor: `${meta.color}0f` } : undefined}
                >
                  <span
                    className="flex h-[42px] w-[42px] items-center justify-center rounded-lg"
                    style={isActive
                      ? { backgroundColor: meta.color, color: '#fff' }
                      : { backgroundColor: `${meta.color}1f`, color: meta.color }}
                  >
                    {meta.icon()}
                  </span>
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{group}</span>
                  <span className="mt-auto text-[28px] font-extrabold leading-none tracking-tight tabular-nums text-slate-900 dark:text-white">{groupMembers.length}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">employé{groupMembers.length > 1 ? 's' : ''}</span>
                </button>
              )
            })}
          </div>

          {/* .stage-activity — la liste du groupe sélectionné */}
          <div className={`overflow-hidden ${BLOCK_CLASS}`}>
            <h3 className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 text-[15px] font-bold text-slate-900 dark:border-slate-700 dark:text-white">
              <span style={{ color: activeMeta.color }}>{activeMeta.icon('w-[17px] h-[17px]')}</span>
              {selectedGroup}
              <span className="ml-1 text-sm font-medium text-slate-500 dark:text-slate-400">· {members.length} employé{members.length > 1 ? 's' : ''}</span>
            </h3>

            {members.length === 0 ? (
              <div className="px-5 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
                {search ? 'Aucun employé ne correspond à cette recherche.' : 'Aucun employé dans ce groupe.'}
              </div>
            ) : (
              <div className="flex flex-col">
                {members.map(emp => (
                  <div key={emp.id} className="flex items-center gap-3.5 border-b border-slate-100 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                    <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg text-xs font-black text-white shadow-sm" style={{ backgroundColor: ROLE_COLOR[emp.role] || '#6b7280' }}>{emp.avatar}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{emp.name}</p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{ROLE_LABEL[emp.role] || emp.role} · {emp.station}</p>
                    </div>
                    <Badge status={emp.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function PlaceholderView({ title }: { title: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-64 text-center gap-3">
      <div className="w-16 h-16 rounded-3xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500">{ic.pkg('w-7 h-7')}</div>
      <div>
        <h3 className="font-bold text-slate-900 dark:text-white text-lg">{title}</h3>
        <p className="text-sm text-slate-400 mt-1">Module en cours de développement</p>
      </div>
    </div>
  )
}

// ── Chatbot ────────────────────────────────────────────────────────────────────
function ChatBot({ onClose, onNavigate, currentScreen, stockSummary }: { onClose: () => void; onNavigate: (s: NavScreen) => void; currentScreen: NavScreen; stockSummary: Array<any> }) {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: 'assistant', content: "Bonjour ! Je suis Lunette, votre assistant IA. Posez-moi vos questions sur les stocks, ventes et mouvements." }
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

  useEffect(() => { digestRef.current = loadAssistantDigest() }, [])

  // Rassemble tout ce à quoi le chatbot doit avoir accès. Chaque source est indépendante :
  // une 403 sur les commandes fournisseur ne doit pas priver le chatbot du stock.
  async function loadAssistantDigest(): Promise<Record<string, unknown>> {
    const token = window.localStorage.getItem('token')
    if (!token) return {}

    const headers = { Authorization: `Bearer ${token}` }
    const get = async (path: string, key: string) => {
      const response = await fetch(`${API_URL}${path}`, { headers })
      if (!response.ok) throw new Error(`${path} unavailable`)
      const payload = await response.json().catch(() => ({}))
      return payload?.data?.[key] || []
    }

    const results = await Promise.allSettled([
      get(`/inventory/glasses?status=${ALL_GLASS_STATUSES.join(',')}`, 'glasses'),
      get('/inventory/movements?limit=500&offset=0', 'movements'),
      get('/auth/users', 'users'),
      get('/auth/stations', 'stations'),
      get('/inventory/reception-commands', 'commands'),
      get('/inventory/supplier-orders', 'orders'),
    ])
    const [glasses, movements, users, stations, receptionCommands, supplierOrders] =
      results.map(result => (result.status === 'fulfilled' ? result.value : []))

    return buildStockDigest({ glasses, movements, users, stations, receptionCommands, supplierOrders })
  }

  function getScreenContext(screen: NavScreen) {
    switch (screen.type) {
      case 'pays': return `pays:${screen.block}`
      case 'city': return `ville:${screen.pays}/${screen.city}`
      case 'suivi-detail': return `suivi:${screen.section}`
      case 'frame': return `ref:${screen.ref}`
      case 'module': return `module:${screen.id}`
      default: return 'dashboard'
    }
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
      const token = window.localStorage.getItem('token')
      const digest = await (digestRef.current ?? Promise.resolve({}))
      const response = await fetch(`${API_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(buildAssistantPayload(q, history, {
          screen: getScreenContext(currentScreen),
          stockSummary,
          summary: { currentScreen: currentScreen.type },
          digest,
        })),
      })

      const payload = await response.json().catch(() => ({}))
      const reply = payload?.data?.reply || "Je ne peux pas joindre le service IA pour le moment."
      const actions = payload?.data?.actions || []
      setMessages(prev => [...prev, { role: 'assistant', content: reply }])

      // Chaque recherche de monture repérée par le chatbot alimente le panier de demande
      // du magasin concerné : c'est ce qui fait monter le compteur côté écran stock.
      const searchActions = actions.filter((action: any) => action?.type === 'search' && action?.ville)
      for (const action of searchActions) {
        await postBasketDemand({
          city: String(action.ville),
          genre: action.genre,
          forme: action.forme,
          gamme: action.gamme,
          taille: action.taille,
        })
      }

      const firstAction = actions[0]
      const screenTarget = firstAction ? mapChatActionToScreen(firstAction) : null
      if (screenTarget) {
        setTimeout(() => onNavigate(screenTarget), 700)
      }

      if ('speechSynthesis' in window) {
        const u = new SpeechSynthesisUtterance(reply)
        u.lang = 'fr-FR'; u.rate = 0.9
        speechSynthesis.cancel(); speechSynthesis.speak(u)
      }
    } catch {
      const fallback = "Le service de chat est actuellement indisponible. Réessayez dans un instant."
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

// ── Sidebar ────────────────────────────────────────────────────────────────────
function Sidebar({ currentScreen, onNavigate, dark, onToggleDark, onLogout }: {
  currentScreen: NavScreen; onNavigate: (s: NavScreen) => void
  dark: boolean; onToggleDark: () => void
  onLogout: () => void
}) {
  const isDash = ['dashboard', 'pays', 'city', 'frame'].includes(currentScreen.type)

  return (
    <aside className="hidden md:flex flex-col w-56 lg:w-60 bg-slate-900 dark:bg-slate-950 h-screen sticky top-0 flex-shrink-0">
      {/* Même composition que la sidebar de direction.html : le logo en grand, centré, avec
          le rôle dessous. Pas de texte « La Lunetterie » — le logo porte déjà le nom.
          Le fond blanc est nécessaire ici, le JPEG n'a pas de transparence. */}
      <div className="px-4 py-5 border-b border-slate-800 flex-shrink-0">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <div className="w-full max-w-[180px] rounded-xl bg-white px-3 py-2">
            <img src={logoUrl} alt="La Lunetterie" className="w-full h-auto object-contain" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Direction</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        <button
          onClick={() => onNavigate({ type: 'dashboard' })}
          className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition-all ${isDash ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
        >
          <span className="flex-shrink-0">{ic.home('w-4 h-4')}</span>
          <span className="truncate font-semibold">Tableau de bord</span>
        </button>

        <div className="my-2 h-px bg-slate-800" />

        {SIDEBAR_MODULES.map(mod => {
          const active = currentScreen.type === 'module' && (currentScreen as any).id === mod.id
          return (
            <button key={mod.id} onClick={() => onNavigate({ type: 'module', id: mod.id })}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition-all ${active ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}
            >
              <span className="flex-shrink-0">{mod.icon('w-4 h-4')}</span>
              <span className="truncate font-medium">{mod.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 space-y-3 flex-shrink-0">
        <button onClick={onToggleDark} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
          {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
          <span className="text-xs">{dark ? 'Thème clair' : 'Thème sombre'}</span>
        </button>
        <button onClick={onLogout} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors w-full">
          {ic.x('w-4 h-4')}
          <span className="text-xs">Déconnexion</span>
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-xl bg-blue-600 flex items-center justify-center text-white text-xs font-black">D</div>
          <div><p className="text-xs text-white font-semibold">Direction</p><p className="text-xs text-slate-500">Accès complet</p></div>
        </div>
      </div>
    </aside>
  )
}

// ── Mobile nav ────────────────────────────────────────────────────────────────
function MobileNav({ currentScreen, onNavigate }: { currentScreen: NavScreen; onNavigate: (s: NavScreen) => void }) {
  const isDash = ['dashboard', 'pays', 'city', 'frame'].includes(currentScreen.type)
  const isExped = currentScreen.type === 'module' && (currentScreen as any).id === 'reception'
  const isGlobal = currentScreen.type === 'module' && (currentScreen as any).id === 'history'

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40">
      <div className="flex">
        {[
          { label: 'Tableau de bord', icon: ic.home, active: isDash, nav: { type: 'dashboard' } as NavScreen },
          { label: 'Expédition', icon: ic.tag, active: isExped, nav: { type: 'module', id: 'reception' } as NavScreen },
          { label: 'Suivi global', icon: ic.hist, active: isGlobal, nav: { type: 'module', id: 'history' } as NavScreen },
        ].map(tab => (
          <button key={tab.label} onClick={() => onNavigate(tab.nav)}
            className={`flex-1 flex flex-col items-center py-3 gap-1 transition-colors ${tab.active ? 'text-blue-600' : 'text-slate-400'}`}
          >
            {tab.icon('w-5 h-5')}
            <span className="text-[10px] font-semibold leading-none">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

// ── TopBar ────────────────────────────────────────────────────────────────────
function TopBar({ navStack, onBack, dark, onToggleDark, onOpenChat }: {
  navStack: NavScreen[]; onBack: () => void
  dark: boolean; onToggleDark: () => void; onOpenChat: () => void
}) {
  const current = navStack[navStack.length - 1]
  const canGoBack = navStack.length > 1

  const SUIVI_SECTION_LABEL: Record<SuiviSection, string> = {
    stock: 'Stock', labo: 'Labo', presentoire: 'Présentoire', placement: 'Placement',
  }

  function getTitle(s: NavScreen): string {
    if (s.type === 'dashboard') return 'Tableau de bord'
    if (s.type === 'pays') return s.block === 'total' ? 'Total lunette' : s.block === 'ca' ? "Chiffre d'affaire" : 'Suivie lunette'
    if (s.type === 'city') return s.city
    if (s.type === 'suivi-detail') return SUIVI_SECTION_LABEL[s.section]
    if (s.type === 'frame') return `Réf: ${s.ref}`
    if (s.type === 'module') return SIDEBAR_MODULES.find(m => m.id === s.id)?.label || s.id
    return ''
  }

  function getSubtitle(s: NavScreen): string {
    if (s.type === 'city') return `${s.pays} · ${s.block === 'total' ? 'Total lunette' : 'CA'}`
    if (s.type === 'suivi-detail') return `${s.pays} · ${s.city} · Suivi lunette`
    if (s.type === 'frame') return s.city
    return ''
  }

  const subtitle = getSubtitle(current)

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-14 flex items-center gap-3 flex-shrink-0">
      {canGoBack && (
        <button onClick={onBack} className="p-1.5 text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-all flex-shrink-0">
          {ic.back('w-5 h-5')}
        </button>
      )}
      <div className="flex-1 min-w-0">
        <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">{getTitle(current)}</h1>
        {subtitle && <p className="text-xs text-slate-400 truncate">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={onToggleDark} className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors">
          {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
        </button>
      </div>
    </header>
  )
}

// ── Module router ─────────────────────────────────────────────────────────────
function renderModuleView(id: ModuleId) {
  switch (id) {
    case 'reception': return <ReceptionView />
    case 'history': return <HistoryView />
  }
}

// ── App ────────────────────────────────────────────────────────────────────────
export default function App() {
  const [navStack, setNavStack] = useState<NavScreen[]>([{ type: 'dashboard' }])
  const [dark, setDark] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [stockSummary, setStockSummary] = useState<any[]>([])
  const [cityStockCounts, setCityStockCounts] = useState<Record<string, CityStats>>({})
  const [stationCities, setStationCities] = useState<string[]>([])
  const [framesByCity, setFramesByCity] = useState<Record<string, FrameRecord[]>>({})
  const [chatButtonPos, setChatButtonPos] = useState<{ x: number; y: number } | null>(null)
  const chatButtonDragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0, moved: false })
  const preventChatButtonClickRef = useRef(false)

  const current = navStack[navStack.length - 1]

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return

    const headers = { Authorization: `Bearer ${token}` }

    const stockSummaryPromise = fetch(`${API_URL}/inventory/stock-summary`, { headers })
      .then(async response => {
        if (!response.ok) throw new Error('stock summary unavailable')
        const payload = await response.json().catch(() => ({}))
        return payload?.data?.items || []
      })

    const stationsPromise = fetch(`${API_URL}/auth/stations`, { headers })
      .then(async response => {
        if (!response.ok) throw new Error('stations unavailable')
        const payload = await response.json().catch(() => ({}))
        return payload?.data?.stations || []
      })

    const activeGlassesPromise = fetch(`${API_URL}/inventory/glasses?status=${STOCK_STATUSES.join(',')}`, { headers })
      .then(async response => {
        if (!response.ok) throw new Error('active glasses unavailable')
        const payload = await response.json().catch(() => ({}))
        return payload?.data?.glasses || []
      })

    Promise.allSettled([stockSummaryPromise, stationsPromise, activeGlassesPromise])
      .then(([stockResult, stationsResult, glassesResult]) => {
        const summary = stockResult.status === 'fulfilled' ? summarizeStockSummary(stockResult.value) : { totalUnits: 0, hasData: false }

        if (stockResult.status === 'fulfilled') {
          setStockSummary(stockResult.value)
        } else {
          setStockSummary([])
        }

        const fallbackCounts = summary.hasData ? buildFallbackCityCounts(summary.totalUnits) : {}

        if (stationsResult.status === 'fulfilled') {
          const stationList = stationsResult.value as any[]
          const uniqueCities = Array.from(new Set(
            stationList
              .filter((station: any) => isStoreStation(station))
              .map((station: any) => normalizeStationCityName(station))
              .filter((value): value is string => Boolean(value))
          )) as string[]
          uniqueCities.sort((a, b) => a.localeCompare(b, 'fr'))
          setStationCities(uniqueCities)
        } else if (summary.hasData) {
          setStationCities(Object.keys(fallbackCounts))
        } else {
          setStationCities([])
        }

        if (stationsResult.status === 'fulfilled' && glassesResult.status === 'fulfilled') {
          const stationMap = new Map<number, string>()
          ;(stationsResult.value || []).forEach((station: any) => {
            if (station?.id == null) return
            const cityName = normalizeStationCityName(station)
            if (!cityName) return
            if (isStoreStation(station) || /présentoir|presentoir|laboratoire|labo/i.test(String(station.name || ''))) {
              stationMap.set(Number(station.id), cityName || 'Pointe-Noire')
            }
          })

          const builtCounts = buildCityStockCounts(stationsResult.value, glassesResult.value)
          setCityStockCounts(Object.keys(builtCounts).length > 0 ? builtCounts : fallbackCounts)
          setFramesByCity(buildFrameRowsFromGlasses(glassesResult.value, stationMap))
        } else {
          setCityStockCounts(fallbackCounts)
          setFramesByCity({})
        }
      })
      .catch(() => {
        setStockSummary([])
        setCityStockCounts({})
        setStationCities([])
      })
  }, [])

  function navigate(screen: NavScreen) {
    setNavStack(prev => [...prev, screen])
    setChatOpen(false)
  }

  function goBack() {
    setNavStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev)
  }

  function navigateRoot(screen: NavScreen) {
    setNavStack([{ type: 'dashboard' }, screen])
  }

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

  function renderScreen() {
    switch (current.type) {
      case 'dashboard': return <DashboardScreen onNavigate={navigate} stockSummary={stockSummary} cityStockCounts={cityStockCounts} stationCities={stationCities} />
      case 'pays': return <PaysScreen block={current.block} onNavigate={navigate} cityStockCounts={cityStockCounts} stationCities={stationCities} stockSummary={stockSummary} />
      case 'city': return <CityDetailScreen block={current.block} pays={current.pays} city={current.city} onNavigate={navigate} cityStockCounts={cityStockCounts} framesByCity={framesByCity} />
      case 'suivi-detail': return <SuiviDetailScreen pays={current.pays} city={current.city} section={current.section} cityStockCounts={cityStockCounts} framesByCity={framesByCity} />
      case 'frame': return <FrameDetailScreen frameRef={current.ref} city={current.city} framesByCity={framesByCity} />
      case 'module': return renderModuleView(current.id)
    }
  }

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
        <Sidebar currentScreen={current} onNavigate={navigateRoot} dark={dark} onToggleDark={() => setDark(d => !d)} onLogout={logoutAndRedirectToIndex} />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar navStack={navStack} onBack={goBack} dark={dark} onToggleDark={() => setDark(d => !d)} onOpenChat={() => setChatOpen(v => !v)} />
          <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 overflow-auto">
            {renderScreen()}
          </main>
        </div>

        <button
          onClick={handleChatButtonClick}
          onPointerDown={handleChatButtonPointerDown}
          className="fixed z-50 flex items-center justify-center w-16 h-16 rounded-full bg-blue-600 shadow-[0_10px_30px_rgba(37,99,235,0.35)] hover:bg-blue-500 transition-all active:scale-95"
          style={{ touchAction: 'none', ...(chatButtonPos ? { left: chatButtonPos.x, top: chatButtonPos.y } : { bottom: 20, right: 20 }) }}
          aria-label="Ouvrir Lunette AI"
        >
          {ic.whatsapp('w-8 h-8 text-white')}
        </button>

        <MobileNav currentScreen={current} onNavigate={navigateRoot} />
        {chatOpen && <ChatBot onClose={() => setChatOpen(false)} onNavigate={screen => { navigateRoot(screen); setChatOpen(false) }} currentScreen={current} stockSummary={stockSummary} />}
      </div>
    </div>
  )
}
