import React, { useState, useRef, useEffect, useMemo, type ReactNode } from 'react'
import { buildAssistantPayload, buildStockDigest, mapChatActionToScreen } from './chatContext'
import { summarizeStockSummary } from './dashboardMetrics'
import { businessBlocKeyOf, businessBlocLabel } from './businessBloc'
// Importé plutôt que référencé par URL : il n'y a pas de dossier public/ ici, donc un
// chemin littéral ne serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'

// ── Types ─────────────────────────────────────────────────────────────────────
type ModuleId = 'register' | 'reception' | 'employees' | 'orders' | 'supplier' | 'history' | 'societes' | 'presentoir-bloc'

type Block = 'total' | 'ca' | 'suivi'

type SuiviSection = 'stock' | 'labo' | 'presentoire' | 'placement'

type NavScreen =
  | { type: 'dashboard' }
  | { type: 'pays'; block: Block }
  | { type: 'city'; block: 'total' | 'ca'; pays: string; city: string }
  | { type: 'suivi-detail'; pays: string; city: string; section: SuiviSection }
  | { type: 'stock-general' }
  | { type: 'critical-references' }
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
  couleur?: string
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

// Le pipeline suit une monture qui existe déjà et qui franchit des frontières : ni son entrée
// dans le parc ni ses déplacements internes n'en font partie.
//
// L'ordre est chronologique et sert tel quel de gabarit aux cartes : le client paie à la
// caisse, la monture part au montage, puis elle est livrée.
type MvtStage = 'shipped' | 'received' | 'display' | 'caisse' | 'labo' | 'sold'

// Actions de mouvement qui n'appartiennent à aucune étape du pipeline, donc absentes de
// l'historique. Détaillé au point de filtrage, dans HistoryView.
const OUT_OF_PIPELINE_ACTIONS = new Set(['RECEPTION_FOURNISSEUR', 'RANGEMENT'])

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
  id: string; numericId: number; stage: MvtStage; frames: number
  from: string; to: string; toRaw: string; date: string; time: string; createdAtIso: string
  operator: string; notes?: string
  barcode: string; reference?: string; brand?: string; photoUrl?: string | null
}

// Champs bruts renvoyés par /inventory/movements pour une monture, utile aussi bien à la
// liste d'activité qu'au panneau « Suivi en direct » — même source de vérité que
// PhotoMontureURL/PhotoBrancheURL côté modèle Go (models/movement.go MovementListItem).
function movementPhotoUrl(entry: any): string | null {
  return (entry && (entry.photo_monture_url || entry.photo_branche_url)) || null
}

type PeriodKey = 'today' | 'week' | 'month' | 'older'
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: "Aujourd'hui" },
  { key: 'week', label: 'Cette semaine' },
  { key: 'month', label: 'Ce mois-ci' },
  { key: 'older', label: 'Plus ancien' },
]

// Période mutuellement exclusive d'après la date du mouvement — la somme des 4 compteurs
// correspond donc toujours au total de l'étape, comme dans historique.html (periodOf).
function periodOf(dateIso?: string): PeriodKey {
  const d = new Date(dateIso || '')
  if (Number.isNaN(d.getTime())) return 'older'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfToday.getTime() - 7 * 24 * 3600 * 1000)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  if (d >= startOfToday) return 'today'
  if (d >= startOfWeek) return 'week'
  if (d >= startOfMonth) return 'month'
  return 'older'
}

// Un seul mouvement par monture (le plus récent) : la position actuelle plutôt que le
// journal brut, comme dedupeByMonture() dans historique.js — deux montures ne se
// distinguent que par leur code-barres, et une monture apparue trois fois ne doit compter
// qu'une fois dans les cartes d'étape.
function dedupeMovementsByBarcode(movements: Movement[]): Movement[] {
  const byBarcode = new Map<string, Movement>()
  for (const m of movements) {
    const existing = byBarcode.get(m.barcode)
    if (!existing || m.createdAtIso > existing.createdAtIso) byBarcode.set(m.barcode, m)
  }
  return Array.from(byBarcode.values()).sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso))
}

function relativeTimeFr(iso?: string) {
  const date = new Date(iso || '')
  if (Number.isNaN(date.getTime())) return ''
  const diffSec = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (diffSec < 5) return 'à l’instant'
  if (diffSec < 60) return `il y a ${diffSec} s`
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `il y a ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `il y a ${diffH} h`
  const diffD = Math.round(diffH / 24)
  return `il y a ${diffD} j`
}

function normalizeMovementStage(action?: string, toStationName?: string): MvtStage {
  const normalizedAction = String(action || '').trim().toUpperCase()
  const normalizedStation = String(toStationName || '').trim().toLowerCase()

  if (normalizedAction === 'EXPEDITION') return 'shipped'
  if (normalizedAction === 'RECEPTION_STATION') return 'received'
  if (normalizedAction === 'PRESENTOIR' || normalizedStation.includes('présentoir') || normalizedStation.includes('presentoir')) return 'display'
  // MISE_EN_CAISSE et LABORATOIRE sont bien émises par le serveur (enums.go), mais aucune
  // n'était reconnue ici : la première retombait dans le repli « Réceptionné », la seconde
  // était happée par la ligne « labo » qui renvoyait 'display'. Les deux étapes existaient
  // donc dans les données, comptées sous une autre carte.
  if (normalizedAction === 'MISE_EN_CAISSE') return 'caisse'
  if (normalizedAction === 'LABORATOIRE' || normalizedAction === 'CONTROLE_QUALITE') return 'labo'
  if (normalizedAction === 'LIVRAISON' || normalizedAction === 'VENTE' || normalizedAction === 'VENDUE') return 'sold'

  // Replis par station, quand l'action ne dit rien : la destination trahit l'étape.
  if (normalizedStation.includes('caisse')) return 'caisse'
  if (normalizedStation.includes('laboratoire') || normalizedStation.includes('labo')) return 'labo'
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

type RevenueRow = { id?: number; ref: string; montant: number; date: string; client: string; status: string }

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

function normalizeReference(value?: string) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s\-_]+/g, '')
    .replace(/[□]/g, '')
    .replace(/[.]/g, '')
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
  if (normalized === 'RESERVEE_ENVOI') return 'En transit vers Stock magasin'
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
      couleur: glass.color || '—',
    }

    if (!rowsByCity[city]) rowsByCity[city] = []
    rowsByCity[city].push(row)
  })

  return rowsByCity
}

const MOVEMENTS_DATA: Movement[] = []

// RESERVEE, avec deux E : c'est la valeur de l'enum. Le handler découpe ce paramètre et
// le passe à un IN (...) sans rien valider, donc un statut mal orthographié ne renvoie
// pas d'erreur — il fait juste disparaître les lignes concernées.
const STOCK_STATUSES = ['EN_STOCK_GENERAL', 'EN_STOCK_SOUS_STATION', 'EN_PRESENTOIR', 'EN_LABORATOIRE', 'RESERVEE'] as const

// Statuts nécessaires au détail d'une référence critique : actifs (général/magasin/
// présentoir, qui déterminent la criticité) ET réserve/labo/transit (visibles dans le
// détail mais qui ne comptent pas dedans). STOCK_STATUSES n'a pas EN_TRANSIT — un
// second jeu plutôt que l'élargir, pour ne pas changer ce que d'autres écrans en tirent.
const REFERENCE_DETAIL_STATUSES = ['EN_STOCK_GENERAL', 'EN_STOCK_SOUS_STATION', 'EN_PRESENTOIR', 'RESERVEE', 'EN_LABORATOIRE', 'EN_TRANSIT'] as const

const EMPLOYEES: Array<{ id: number; name: string; role: string; station: string; group: string; status: string; avatar: string }> = []

interface ReceptionSessionResult {
  id?: number
  orderId: number
  code: string
  targetCount: number
  registeredCount?: number
  status: string
  // Posé au scan du code-barres de session au poste de scan : c'est lui qui coche
  // "Reçu", avant même la première monture enregistrée.
  activatedAt?: string | null
  compareText?: string
}

export function isSessionReceived(linkedCommand?: { activatedAt?: string | null }, receivedCount = 0) {
  return Boolean(linkedCommand?.activatedAt) || receivedCount > 0
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

function priceOf(frame: FrameRecord) {
  const n = Number(frame.price)
  return Number.isNaN(n) ? 0 : n
}

function sumPrice(frames: FrameRecord[]) {
  return frames.reduce((total, frame) => total + priceOf(frame), 0)
}

function groupByAttr(frames: FrameRecord[], pick: (f: FrameRecord) => string | undefined) {
  const counts = new Map<string, number>()
  for (const frame of frames) {
    const raw = String(pick(frame) || '').trim()
    if (!raw || raw === '—') continue
    const key = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

function blocKeyOf(frame: FrameRecord) {
  return businessBlocKeyOf({
    gender: frame.genre,
    price: frame.price,
    status: frame.status,
  })
}

// Le magasin est identifié par sa VILLE partout dans les échanges serveur — les paniers y
// sont indexés — mais il s'affiche « Stock magasin (Ville) » : le poste s'appelle Stock
// magasin, la ville n'en est que le qualificatif. Seul le libellé change, jamais la valeur.
function magasinLabel(city: string) {
  return `Stock magasin (${city})`
}

// Ce qu'il faut renvoyer à un magasin pour le remettre au niveau de sa dernière livraison.
// Une ville jamais livrée n'a pas de ligne : sans carton de référence, il n'y a pas de
// pourcentage à calculer.
interface RestockSuggestion {
  city: string
  last_box_qty: number
  last_box_at: string
  current_stock: number
  to_send: number
  alert: boolean
}

export function resolveStationCity(station: { id?: number; name?: string; city?: string; type?: string }) {
  const cityFromDb = String(station.city || '').trim()
  if (cityFromDb) return cityFromDb.replace(/^station\s+/i, '').trim()

  const raw = String(station.name || '').trim()
  if (!raw) return ''

  const parsedCity = raw.match(/^station\s+(.+)$/i)
  if (parsedCity) return parsedCity[1].trim()

  const name = raw.toLowerCase()
  if (name.includes('présentoir') || name.includes('presentoir') || name.includes('laboratoire') || name.includes('labo')) {
    return ''
  }

  return raw.replace(/^station\s+/i, '').trim()
}

export function mergeCityNames(baseCities: string[] = [], stockCities: string[] = []) {
  return Array.from(new Set([...baseCities, ...stockCities].map(city => String(city || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'fr'))
}

function addMissingZeroCities(counts: Record<string, CityStats>, cities: string[] = []): Record<string, CityStats> {
  const next: Record<string, CityStats> = { ...counts }

  cities.forEach(city => {
    const trimmed = String(city || '').trim()
    if (!trimmed) return
    if (!next[trimmed]) {
      next[trimmed] = {
        local: 0,
        presentoir: 0,
        labo: 0,
        reserve: 0,
        vendues: 0,
        transit: 0,
        color: '#94a3b8',
        revenue: 0,
      }
    }
  })

  return next
}

function normalizeStationCityName(station: { id?: number; name?: string; city?: string }) {
  return resolveStationCity(station as { id?: number; name?: string; city?: string; type?: string })
}

// « Station Pointe-Noire » est un nom de base, pas un nom métier : sur le terrain c'est le
// stock du magasin de la ville. La ville est conservée — c'est elle qui distingue deux
// magasins, et la règle vaut pour toute ville à venir, sans nom écrit en dur.
function stationDisplayLabel(name?: string | null) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  const city = raw.match(/^station\s+(.+)$/i)
  if (city) return `Stock magasin ${city[1].trim()}`
  if (/^stock\s+principal$/i.test(raw)) return 'Stock principal'
  return raw
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

// Découpe un code d'emplacement « RAYON-A-ETA-01-BAC-B-POS-12 ». Hissé au niveau module :
// la page Expédition et l'écran Stock général filtrent sur les mêmes trois axes, deux copies
// finiraient par diverger.
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

// Une monture sans emplacement lisible disparaît dès qu'un filtre est posé : on ne peut pas
// affirmer qu'elle est dans le bac demandé.
function matchesLocationFilters(glass: any, rayon: string, etagere: string, bac: string) {
  const parsed = parseStockLocationCode(String(glass?.location_code || glass?.station_name || ''))
  if (!parsed) return rayon === 'all' && etagere === 'all' && bac === 'all'
  if (rayon !== 'all' && parsed.rayon !== rayon) return false
  if (etagere !== 'all' && parsed.etagere !== etagere) return false
  if (bac !== 'all' && parsed.bac !== bac) return false
  return true
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

    const cityName = resolveStationCity(station)
    if (!cityName) return

    cityByStationId.set(Number(station.id), cityName)
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

/** Le chiffre d'affaires ne se lit pas sur les montures. Un encaissement les passe en
 *  VENDUE puis les expédie aussitôt au laboratoire (EN_TRANSIT), si bien que
 *  `/glasses?status=VENDUE` ne renvoie presque jamais une vente : compter dessus affichait
 *  0 FCFA face à des proformas réglées. Il se lit sur les proformas, seules à porter le
 *  montant encaissé — verres, accessoires et montage compris, que la fiche monture ignore.
 *
 *  `total_amount` est le montant du devis, figé à l'émission (proforma_repository.go:72).
 *  Si la Caisse a rendu une monture au présentoir, la proforma reste comptée à son montant
 *  d'origine et le CA est donc majoré d'autant. La corriger demanderait de charger les
 *  lignes une proforma à la fois (`/proformas/:id` ne les renvoie qu'une par une), soit une
 *  requête par document sur tout l'historique — trop cher pour un tableau de bord. */
function buildCityRevenue(
  stations: Array<{ id?: number; name?: string; city?: string; type?: string }>,
  proformas: Array<{
    id?: number
    code?: string
    station_id?: number | string
    client_name?: string
    total_amount?: number | string
    status?: string
    settled_at?: string
    created_at?: string
  }>
) {
  const cityByStationId = new Map<number, string>()
  stations.forEach(station => {
    if (station?.id == null) return
    const cityName = normalizeStationCityName(station)
    if (!cityName) return
    if (isStoreStation(station) || /présentoir|presentoir|laboratoire|labo/i.test(String(station.name || ''))) {
      cityByStationId.set(Number(station.id), cityName)
    }
  })

  const revenueByCity: Record<string, number> = {}
  const rowsByCity: Record<string, RevenueRow[]> = {}

  proformas.forEach(proforma => {
    // REGLEE et non EN_ATTENTE : un devis en attente n'a rien encaissé, et le serveur ne
    // règle une proforma que si une monture au moins a été vendue.
    if (String(proforma?.status || '').trim().toUpperCase() !== 'REGLEE') return

    const stationId = Number(proforma.station_id)
    const city = (Number.isFinite(stationId) ? cityByStationId.get(stationId) : undefined) || 'Pointe-Noire'
    const montant = Number(proforma.total_amount) || 0

    revenueByCity[city] = (revenueByCity[city] || 0) + montant

    if (!rowsByCity[city]) rowsByCity[city] = []
    rowsByCity[city].push({
      id: proforma.id,
      // Le code sert de clé de liste : sans lui, deux proformas se recouvriraient à
      // l'affichage. L'identifiant prend le relais quand il manque.
      ref: proforma.code || `#${proforma.id ?? rowsByCity[city].length + 1}`,
      montant,
      // La date de règlement prime sur celle d'émission : c'est le jour où l'argent est
      // entré, et c'est sur elle que filtre le calendrier de l'écran ville.
      date: String(proforma.settled_at || proforma.created_at || '').slice(0, 10),
      client: proforma.client_name || '—',
      status: 'Réglée',
    })
  })

  Object.values(rowsByCity).forEach(rows => rows.sort((a, b) => b.date.localeCompare(a.date)))

  return { revenueByCity, rowsByCity }
}

/** Le stock et le CA se comptent sur deux sources séparées, et une ville peut n'apparaître
 *  que dans l'une : un magasin qui a tout vendu n'a plus de monture à compter, mais son
 *  chiffre d'affaires existe. Sans cette entrée créée au besoin, il disparaîtrait du total. */
function mergeRevenueIntoCityCounts(
  counts: Record<string, CityStats>,
  revenueByCity: Record<string, number>
): Record<string, CityStats> {
  const merged: Record<string, CityStats> = { ...counts }

  Object.entries(revenueByCity).forEach(([city, revenue]) => {
    merged[city] = merged[city]
      ? { ...merged[city], revenue }
      : { local: 0, presentoir: 0, labo: 0, reserve: 0, vendues: 0, transit: 0, color: '#16a34a', revenue }
  })

  return merged
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
  // Statut d'une proforma encaissée, pas d'une monture : c'est lui que portent les lignes
  // du chiffre d'affaires, qui se lit sur les documents et non sur le stock.
  'Réglée': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Active': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Inactive': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  'Payé': 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  'Actif': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  'Inactif': 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  'Annulé': 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  'En attente': 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
}

function getReceptionCardState(linkedCommand: ReceptionSessionResult | undefined, receivedCount: number, totalCount: number) {
  if (!linkedCommand) return 'idle'
  if (totalCount > 0 && receivedCount >= totalCount) return 'complete'
  if (receivedCount > 0 || linkedCommand?.activatedAt) return 'recording'
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
  truck: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h9A2.5 2.5 0 0 1 17 7.5v7.5H3z"/><path d="M17 10h3l2 2.5v2.5h-5z"/><circle cx="8" cy="17" r="2"/><circle cx="18" cy="17" r="2"/></svg>,
  box: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5v-9z"/><path d="M12 3v18"/><path d="M3 7.5l9 4.5 9-4.5"/></svg>,
  transfer: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h16"/><path d="M14 6l6 6-6 6"/><path d="M10 6l-6 6 6 6"/></svg>,
  display: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/><path d="M8 15l2-2 2 3 3-4"/></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M5 13l4 4L19 7"/></svg>,
  chart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 3v18h18"/><path d="M7 16l4-4 4 4 4-8"/></svg>,
  users: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  cart: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>,
  store: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
  hist: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>,
  warehouse: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M22 20V8.35a2 2 0 0 0-1.26-1.86l-8-3.2a2 2 0 0 0-1.48 0l-8 3.2A2 2 0 0 0 2 8.35V20"/><path d="M2 20h20"/><path d="M7 20v-7h10v7"/><path d="M7 16.5h10"/></svg>,
  sun: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>,
  moon: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>,
  bot: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M12 11V7M9 7h6"/><circle cx="9" cy="16" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="16" r="1" fill="currentColor" stroke="none"/></svg>,
  whatsapp: (c = 'w-6 h-6') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2.5A9.5 9.5 0 0 0 4.1 16.8L3.5 20.5l3.8-.6a9.5 9.5 0 1 0 4.74-17.4Zm5.2 13.4c-.2.6-.98 1.1-1.6 1.2-.4.1-.9.1-1.5-.1-.4-.1-.9-.3-1.5-.6a7.2 7.2 0 0 1-2.6-2.3c-.5-.6-.9-1.2-1.1-1.8-.1-.4 0-.8.3-1.1l.4-.4c.1-.1.2-.2.3-.2.1 0 .2 0 .3.1l.3.2c.1.1.2.2.2.4l.1.3c0 .2-.1.4-.2.5-.1.1-.2.2-.3.3-.1.1-.2.2-.1.3.1.3.2.6.4.9.3.5.7 1 .9 1.4.2.3.4.6.6.9.1.2.2.3.2.5 0 .1-.1.2-.2.3l-.2.2c-.2.2-.4.3-.7.4ZM12 6.1c-.4 0-.7.3-.7.7v.6c0 .3.2.5.5.6.6.1 1.2.2 1.7.5.5.3.9.7 1.2 1.2.2.3.2.7.1 1.1a.7.7 0 0 1-.6.5H13c-.4 0-.7.3-.7.7 0 .3.3.6.6.7.6.2 1.2.3 1.8.3 1.3 0 2.5-.5 3.3-1.4.8-.9 1.2-2.1 1.2-3.3 0-2.2-1.5-4-3.6-4.4-.7-.1-1.4-.1-2.1-.1Z"/></svg>,
  send: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>,
  mic: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/></svg>,
  x: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  signOut: (c = 'w-4 h-4') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>,
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
  // Un billet plutôt qu'un tiroir-caisse : à 20 px, le tiroir se confond avec la boîte de
  // l'étape « Réceptionné ».
  cash: (c = 'w-5 h-5') => <svg className={c} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>,
}

// Bloc de base repris de historique.html : --surface, --line, --radius-lg (20px), --shadow-sm.
const BLOCK_CLASS = 'rounded-[20px] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900'

// Carte-sélecteur : carrousel à accroche sur mobile, grille à partir de sm.
const CARD_ROW_CLASS = '-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:overflow-x-visible sm:px-0 sm:pb-0'
const CARD_CLASS = 'flex w-[62%] flex-shrink-0 snap-start flex-col items-start gap-2.5 rounded-[20px] border p-5 text-left shadow-sm transition-all hover:-translate-y-[3px] hover:shadow-lg sm:w-auto sm:flex-shrink'

/** L'ordre des teintes suit l'ordre des cartes et a été vérifié au validateur de palette
 *  sur les deux fonds. La pire paire adjacente est vendu/labo à ΔE 7,9 en protanopie :
 *  dans la bande basse, donc admise seulement parce que chaque carte porte en clair son
 *  libellé et son icône. Le cyan de la caisse reprend celui du rôle CAISSIER
 *  (`ROLE_COLOR`) ; l'inverser avec l'ambre du labo mettrait le cyan contre le vert de
 *  « Vendu », indiscernables même en vision normale (ΔE 11,8). */
const STAGE_META: Record<MvtStage, { label: string; color: string; bg: string; icon: ReactNode }> = {
  shipped: { label: 'En transit', color: '#2563eb', bg: 'bg-blue-50 dark:bg-blue-900/20', icon: ic.plane() },
  received: { label: 'Réceptionné', color: '#16a34a', bg: 'bg-green-50 dark:bg-green-900/20', icon: ic.box() },
  display: { label: 'Mis en présentoir', color: '#9333ea', bg: 'bg-purple-50 dark:bg-purple-900/20', icon: ic.display() },
  caisse: { label: 'En caisse', color: '#0891b2', bg: 'bg-cyan-50 dark:bg-cyan-900/20', icon: ic.cash() },
  labo: { label: 'Au laboratoire', color: '#d97706', bg: 'bg-amber-50 dark:bg-amber-900/20', icon: ic.flask() },
  sold: { label: 'Vendu', color: '#059669', bg: 'bg-emerald-50 dark:bg-emerald-900/20', icon: ic.check() },
}

// Le panneau « Suivi en direct » affiche l'historique brut d'une monture, y compris les
// actions hors pipeline (réception fournisseur, rangement) qu'écarte normalizeMovementStage
// pour les cartes d'étape — il lui faut donc son propre libellé par action, comme
// ACTION_LABELS dans historique.js.
const MOVEMENT_ACTION_LABELS: Record<string, string> = {
  RECEPTION_FOURNISSEUR: 'Réception fournisseur',
  RANGEMENT: 'Rangement',
  EXPEDITION: 'Expédition',
  RECEPTION_STATION: 'Réception station',
  PRESENTOIR: 'Mise en présentoir',
  RETRAIT_PRESENTOIR: 'Retrait présentoir',
  RESERVATION: 'Réservation',
  MISE_EN_CAISSE: 'Mise en caisse',
  LABORATOIRE: 'Envoi laboratoire',
  CONTROLE_QUALITE: 'Contrôle qualité',
  LIVRAISON: 'Livraison',
  VENTE: 'Vente',
  VENDUE: 'Vente',
  RETOUR: 'Retour',
  INVENTAIRE: 'Inventaire',
  PERTE: 'Perte',
  CASSE: 'Casse',
}
function movementActionLabel(action?: string) {
  const key = String(action || '').trim().toUpperCase()
  return MOVEMENT_ACTION_LABELS[key] || key || 'Mouvement'
}
function movementActionIcon(action?: string) {
  const key = String(action || '').trim().toUpperCase()
  if (key === 'RECEPTION_FOURNISSEUR' || key === 'RECEPTION_STATION') return ic.box
  if (key === 'EXPEDITION' || key === 'LIVRAISON') return ic.plane
  if (key === 'PRESENTOIR' || key === 'RETRAIT_PRESENTOIR') return ic.store
  if (key === 'LABORATOIRE' || key === 'CONTROLE_QUALITE') return ic.flask
  if (key === 'MISE_EN_CAISSE') return ic.cash
  if (key === 'VENTE' || key === 'VENDUE') return ic.check
  if (key === 'RETOUR') return ic.back
  return ic.glasses
}
function movementActionColor(action?: string) {
  const key = String(action || '').trim().toUpperCase()
  if (key === 'PERTE' || key === 'CASSE') return '#dc2626'
  if (key === 'RESERVATION' || key === 'RETRAIT_PRESENTOIR') return '#d97706'
  if (key === 'PRESENTOIR' || key === 'LIVRAISON' || key === 'RECEPTION_FOURNISSEUR' || key === 'RECEPTION_STATION') return '#16a34a'
  return '#64748b'
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

// `short` sert à la nav mobile, en bas d'écran : trop peu de place pour « Présentoir par
// bloc » en entier, d'où un libellé court par entrée plutôt qu'une troncature à l'affichage.
const SIDEBAR_MODULES: { id: ModuleId; label: string; short: string; icon: (c?: string) => React.ReactElement }[] = [
  { id: 'reception', label: 'Expédition', short: 'Expédition', icon: ic.tag },
  { id: 'history', label: 'Suivi Global', short: 'Suivi', icon: ic.hist },
  { id: 'presentoir-bloc', label: 'Présentoir par bloc', short: 'Blocs', icon: ic.display },
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
  const cityNames = mergeCityNames(stationCities, Object.keys(cityStockCounts))
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
  const targetCity = selectedCity || cityNames[0] || ''

  // Dénominateur écrit en toutes lettres sous chaque pourcentage. « du parc » était du
  // jargon de gestion de flotte : on ne devinait ni ce que le mot désignait, ni qu'il
  // changeait de sens sur la tuile des références.
  const montureDenominator = `sur ${summary.totalUnits.toLocaleString('fr-FR')} monture${summary.totalUnits > 1 ? 's' : ''}`

  const totalRevenue = Object.values(cityStockCounts).reduce((sum, stats) => sum + (stats?.revenue || 0), 0)
  const revenueCities = Object.values(cityStockCounts).filter(stats => (stats?.revenue || 0) > 0).length
  const selectedCityStats = selectedCity ? cityStockCounts[selectedCity] : undefined
  const selectedCityTotalForMetrics = selectedCityStats ? getCityTotal(selectedCityStats) : summary.totalUnits

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { block: 'total' as Block, label: 'Total lunette', color: '#2563eb', bg: 'border-blue-200 dark:border-blue-800', icon: ic.glasses },
          { block: 'ca' as Block, label: "Chiffre d'affaire", color: '#16a34a', bg: 'border-green-200 dark:border-green-800', icon: ic.chart },
          { block: 'suivi' as Block, label: 'Suivi des lunettes', color: '#9333ea', bg: 'border-purple-200 dark:border-purple-800', icon: ic.map },
        ].map(item => {
          // Le CA a sa propre somme : il vient des proformas réglées, quand `summary` ne
          // compte que des montures. Les deux autres tuiles ne pouvaient donc pas le servir.
          const value = item.block === 'ca' ? fmtFCFA(totalRevenue) : summary.totalUnits.toLocaleString('fr-FR')
          const note = item.block === 'ca' ? (totalRevenue > 0 ? `${revenueCities} ville${revenueCities > 1 ? 's' : ''} avec des ventes` : 'Aucune donnée disponible')
            : `${summary.totalUnits.toLocaleString('fr-FR')} monture${summary.totalUnits > 1 ? 's' : ''}`

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
          { label: 'Stock général', value: summary.generalUnits, total: summary.totalUnits, of: montureDenominator, color: '#2563eb', screen: { type: 'stock-general' } as NavScreen },
          { label: 'Stock magasin', value: selectedCity ? (selectedCityStats?.local ?? 0) : summary.localUnits, total: selectedCity ? Math.max(selectedCityTotalForMetrics, 1) : summary.totalUnits, of: selectedCity ? `sur ${selectedCityTotalForMetrics.toLocaleString('fr-FR')} monture${selectedCityTotalForMetrics > 1 ? 's' : ''}` : montureDenominator, color: '#0891b2', screen: targetCity ? { type: 'suivi-detail', pays: targetCity, city: targetCity, section: 'stock' } as NavScreen : { type: 'pays', block: 'suivi' } as NavScreen },
          { label: 'Labo', value: selectedCity ? (selectedCityStats?.labo ?? 0) : summary.laboUnits, total: selectedCity ? Math.max(selectedCityTotalForMetrics, 1) : summary.totalUnits, of: selectedCity ? `sur ${selectedCityTotalForMetrics.toLocaleString('fr-FR')} monture${selectedCityTotalForMetrics > 1 ? 's' : ''}` : montureDenominator, color: '#7c3aed', screen: targetCity ? { type: 'suivi-detail', pays: targetCity, city: targetCity, section: 'labo' } as NavScreen : { type: 'pays', block: 'suivi' } as NavScreen },
          { label: 'Réserve', value: selectedCity ? (selectedCityStats?.reserve ?? 0) : summary.reserveUnits, total: selectedCity ? Math.max(selectedCityTotalForMetrics, 1) : summary.totalUnits, of: selectedCity ? `sur ${selectedCityTotalForMetrics.toLocaleString('fr-FR')} monture${selectedCityTotalForMetrics > 1 ? 's' : ''}` : montureDenominator, color: '#059669', screen: targetCity ? { type: 'suivi-detail', pays: targetCity, city: targetCity, section: 'placement' } as NavScreen : { type: 'pays', block: 'suivi' } as NavScreen },
          { label: 'Présentoir', value: selectedCity ? (selectedCityStats?.presentoir ?? 0) : summary.presentoirUnits, total: selectedCity ? Math.max(selectedCityTotalForMetrics, 1) : summary.totalUnits, of: selectedCity ? `sur ${selectedCityTotalForMetrics.toLocaleString('fr-FR')} monture${selectedCityTotalForMetrics > 1 ? 's' : ''}` : montureDenominator, color: '#f59e0b', screen: targetCity ? { type: 'suivi-detail', pays: targetCity, city: targetCity, section: 'presentoire' } as NavScreen : { type: 'pays', block: 'suivi' } as NavScreen },
        ].map(item => {
          const ratio = item.total > 0 ? item.value / item.total : 0
          return (
            <button
              type="button"
              key={item.label}
              onClick={() => onNavigate(item.screen)}
              className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 text-left transition-all hover:border-slate-300 hover:shadow-sm dark:hover:border-slate-600"
            >
              <p className="text-xs text-slate-400 dark:text-slate-500 font-medium">{item.label}</p>
              <div className="flex items-baseline gap-1.5 mt-1">
                <p className="text-3xl font-black tabular-nums" style={{ color: item.color }}>{item.value}</p>
              </div>
              <div className="mt-2.5 bg-slate-100 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${Math.min(100, ratio * 100)}%`, backgroundColor: item.color }} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{item.of}</p>
            </button>
          )
        })}
      </div>


    </div>
  )
}

// ── Références critiques ─────────────────────────────────────────────────────────
/** Charge ses propres données (montures actives + réserve/labo/transit, stations) plutôt
 *  que de recevoir celles du dashboard par props : ce détail par référence n'a de sens
 *  que sur cet écran, pas de raison de l'y faire vivre en permanence. */
function CriticalReferencesScreen({ onNavigate: _onNavigate }: { onNavigate: (s: NavScreen) => void }) {
  const [glasses, setGlasses] = useState<any[]>([])
  const [stations, setStations] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedReference, setSelectedReference] = useState<string | null>(null)

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) { setIsLoading(false); return }
    const headers = { Authorization: `Bearer ${token}` }

    // silent : les rafraîchissements périodiques ne doivent pas réafficher le squelette de
    // chargement, seul le premier montage le fait.
    const load = (silent: boolean) => {
      if (!silent) setIsLoading(true)
      Promise.allSettled([
        fetch(`${API_URL}/inventory/glasses?status=${REFERENCE_DETAIL_STATUSES.join(',')}`, { headers })
          .then(r => (r.ok ? r.json() : Promise.reject())).then(p => p?.data?.glasses || []),
        fetch(`${API_URL}/auth/stations`, { headers })
          .then(r => (r.ok ? r.json() : Promise.reject())).then(p => p?.data?.stations || []),
      ]).then(([glassesResult, stationsResult]) => {
        setGlasses(glassesResult.status === 'fulfilled' ? glassesResult.value : [])
        setStations(stationsResult.status === 'fulfilled' ? stationsResult.value : [])
      }).finally(() => setIsLoading(false))
    }

    load(false)

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, 15000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load(true)
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const stationCityMap = useMemo(() => {
    const map = new Map<number, string>()
    stations.forEach((station: any) => {
      if (station?.id == null) return
      const city = resolveStationCity(station)
      if (city) map.set(Number(station.id), city)
    })
    return map
  }, [stations])

  const breakdown = useMemo(() => computeReferenceLocationBreakdown(glasses, stationCityMap), [glasses, stationCityMap])

  const referenceBrand = useMemo(() => {
    const map = new Map<string, string>()
    glasses.forEach((glass: any) => {
      const reference = String(glass.reference || '').trim()
      if (!reference || map.has(reference)) return
      if (glass.brand) map.set(reference, String(glass.brand))
    })
    return map
  }, [glasses])

  // Le seuil se calcule sur le même stock actif que le dashboard (activeTotal =
  // général+magasin+présentoir) : reconstruit ici en lignes StockSummaryRow-compatibles
  // pour réutiliser criticalReferenceRows telle quelle plutôt que dupliquer la règle.
  const rows = useMemo(() => {
    const synthetic = Array.from(breakdown.values()).map(entry => ({
      reference: entry.reference,
      brand: referenceBrand.get(entry.reference) || '—',
      qty_total: entry.activeTotal,
    }))
    return criticalReferenceRows(synthetic).filter(row => row.level !== 'ok')
  }, [breakdown, referenceBrand])

  const selectedBreakdown = selectedReference ? breakdown.get(selectedReference) : undefined
  const selectedRow = selectedReference ? rows.find(row => row.reference === selectedReference) : undefined

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Références critiques</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Stock actif (général + magasin + présentoir) au seuil (2 montures) ou en dessous. Réserve, laboratoire et
          transit restent visibles dans le détail de chaque référence, sans compter dans le calcul.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        {isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Aucune référence critique ou en rupture pour le moment.</p>
        ) : (
          <div className="space-y-3">
            {rows.map(row => {
              const levelColor = row.level === 'rupture' ? '#dc2626' : '#d97706'
              const pct = row.threshold > 0 ? Math.min(100, (row.stock / row.threshold) * 100) : 0
              const cities = breakdown.get(row.reference)?.cities || []
              return (
                <button
                  type="button"
                  key={row.reference}
                  onClick={() => setSelectedReference(row.reference)}
                  className="w-full rounded-xl border border-slate-100 p-3 text-left transition-colors hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:hover:border-slate-600"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold text-slate-900 dark:text-white">{row.reference}</p>
                      <p className="truncate text-xs text-slate-400 dark:text-slate-500">
                        {row.brand}{cities.length > 0 ? ` · ${cities.join(', ')}` : ''}
                      </p>
                    </div>
                    <span
                      className="inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: `${levelColor}18`, color: levelColor }}
                    >
                      {row.level === 'rupture' ? 'RUPTURE' : 'CRITIQUE'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                      <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: levelColor }} />
                    </div>
                    <span className="w-12 flex-shrink-0 text-right text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                      {row.stock} / {row.threshold}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {selectedReference && selectedBreakdown && selectedRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedReference(null)}>
          <div
            className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm font-bold text-slate-900 dark:text-white">{selectedReference}</p>
                <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{selectedRow.brand}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedReference(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-700 dark:hover:text-white"
              >
                {ic.x('w-4 h-4')}
              </button>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Stock actif</p>
              <p className="mt-1 text-2xl font-black tabular-nums text-slate-900 dark:text-white">
                {selectedBreakdown.activeTotal} monture{selectedBreakdown.activeTotal > 1 ? 's' : ''}
              </p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex items-center justify-between"><span className="text-slate-500 dark:text-slate-400">Stock général</span><span className="tabular-nums font-semibold text-slate-900 dark:text-white">{selectedBreakdown.general}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500 dark:text-slate-400">Magasin</span><span className="tabular-nums font-semibold text-slate-900 dark:text-white">{selectedBreakdown.magasin}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500 dark:text-slate-400">Présentoir</span><span className="tabular-nums font-semibold text-slate-900 dark:text-white">{selectedBreakdown.presentoir}</span></div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-1 dark:border-slate-700"><span className="font-semibold text-slate-700 dark:text-slate-200">Total actif</span><span className="tabular-nums font-bold text-slate-900 dark:text-white">{selectedBreakdown.activeTotal}</span></div>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Autres positions</p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Ne comptent pas dans le calcul de criticité.</p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="flex items-center justify-between"><span className="text-slate-500 dark:text-slate-400">Réserve</span><span className="tabular-nums font-semibold text-slate-900 dark:text-white">{selectedBreakdown.reserve}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500 dark:text-slate-400">Laboratoire</span><span className="tabular-nums font-semibold text-slate-900 dark:text-white">{selectedBreakdown.labo}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500 dark:text-slate-400">Transit</span><span className="tabular-nums font-semibold text-slate-900 dark:text-white">{selectedBreakdown.transit}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pays screen ───────────────────────────────────────────────────────────────
function PaysScreen({ block, onNavigate, cityStockCounts, stationCities, stockSummary }: { block: Block; onNavigate: (s: NavScreen) => void; cityStockCounts: Record<string, CityStats>; stationCities: string[]; stockSummary: any[] }) {
  const [countries, setCountries] = useState(COUNTRIES.map(c => ({ ...c })))
  const [expandedCountries, setExpandedCountries] = useState<string[]>([])
  const [isLoadingCountries, setIsLoadingCountries] = useState(false)
  const [expandedCities, setExpandedCities] = useState<string[]>([])
  const [stockGeneralExpanded, setStockGeneralExpanded] = useState(false)

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
  // Le bandeau annonce le parc complet enregistré en base, pas seulement ce qui est déjà
  // arrivé en magasin : les lignes en dessous n'en sont qu'une répartition.
  const totalFrames = summary.hasData ? summary.totalUnits : computedCityTotal
  // Les deux branches d'origine rendaient la même valeur : le CA est la somme des villes,
  // sans condition. Contrairement au total des montures, aucune autre source ne l'annonce.
  const totalRevenue = computedCityRevenue
  // Tout ce qui n'est pas encore parti vers un magasin est resté à l'entrepôt central. On le
  // déduit par soustraction plutôt que de le lire d'une autre source : ainsi la somme affichée
  // (pays + stock général) retombe toujours sur le total annoncé, même si les deux requêtes
  // divergeaient. Le plancher à zéro couvre le cas où les deux sources se contrediraient.
  const stockGeneralFrames = Math.max(0, totalFrames - computedCityTotal)

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

      {/* Le suivi compte les mêmes montures que le total : il mérite le même bandeau. */}
      <div className="space-y-4">
        <div className={`rounded-2xl border px-4 py-4 ${block === 'ca' ? 'bg-green-50 border-green-100 dark:bg-green-900/20 dark:border-green-900/40' : 'bg-slate-50 border-slate-200 dark:bg-slate-900/20 dark:border-slate-700'}`}>
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {block === 'ca' ? "Chiffre d'affaire" : 'Total lunette'}
            </p>
            <p className={`text-3xl font-black ${block === 'ca' ? 'text-green-700 dark:text-green-300' : 'text-slate-900 dark:text-white'} tabular-nums`}>
              {block === 'ca' ? fmtFCFA(totalRevenue) : totalFrames.toLocaleString('fr-FR')}
            </p>
            {block !== 'ca' && (
              <p className="mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                {totalFrames.toLocaleString('fr-FR')} monture{totalFrames > 1 ? 's' : ''} en base
              </p>
            )}
          </div>
        </div>
      </div>

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
                                  {/* Le total de la ville, pas son seul stock magasin : le pays
                                      au-dessus additionne les quatre sous-stations, la ville doit
                                      annoncer la même chose sous peine de ne jamais retomber dessus. */}
                                  <span className="text-xs font-bold tabular-nums" style={{ color: stats?.color || '#94a3b8' }}>
                                    {getCityTotal(stats) || '—'}
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

        {/* Stock Général — le reliquat qui n'a pas encore quitté l'entrepôt central. Même
            gabarit que les pays pour que la lecture soit immédiate, avec une bordure
            pointillée : ce n'est pas un pays, c'est ce qui n'est encore parti nulle part.
            En « Total lunette » le clic ouvre l'inventaire ; en « Suivi » il déplie les deux
            flux de l'entrepôt, puisque le suivi parle de mouvements et non de quantités. */}
        {block !== 'ca' && (
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-4 h-4 rounded-full border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 flex-shrink-0 z-10" />
              <button
                onClick={() => block === 'suivi'
                  ? setStockGeneralExpanded(open => !open)
                  : onNavigate({ type: 'stock-general' })}
                className="flex-1 flex items-center justify-between px-5 py-3.5 bg-slate-50 dark:bg-slate-900/40 border border-dashed border-slate-300 dark:border-slate-600 rounded-2xl hover:shadow-sm hover:border-slate-400 dark:hover:border-slate-500 transition-all"
              >
                <span className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2.5">
                  {/* Icône de trait plutôt qu'un emoji : les drapeaux des pays au-dessus sont
                      des emojis parce qu'ils identifient un pays, l'entrepôt central non. */}
                  {ic.warehouse('w-6 h-6 text-slate-400 dark:text-slate-500 flex-shrink-0')}
                  <span>Stock Général</span>
                </span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                    {stockGeneralFrames.toLocaleString('fr-FR')}
                  </span>
                  <span className="text-slate-400">
                    {block === 'suivi' && stockGeneralExpanded ? ic.chevDown() : ic.chevRight()}
                  </span>
                </div>
              </button>
            </div>

            {/* L'entrepôt central n'a pas de villes sous lui, mais deux flux : ce qui y entre
                depuis le fournisseur, ce qui en sort vers les magasins. Les deux mènent au
                module Expédition : c'est là que vivent déjà la création d'un arrivage
                fournisseur (« Nouvelle ») et l'envoi de listes vers le stock magasin. */}
            {block === 'suivi' && stockGeneralExpanded && (
              <div className="ml-6 border-l border-dashed border-slate-200 dark:border-slate-700 pl-4 space-y-2">
                {[
                  { label: 'Arrivage fournisseur', color: '#2563eb' },
                  { label: 'Expédition vers le stock magasin', color: '#0891b2' },
                ].map(flow => (
                  <div key={flow.label} className="relative">
                    <div className="absolute -left-4 top-4 w-4 h-px bg-slate-200 dark:bg-slate-700" />
                    <div className="flex items-center gap-2">
                      <div className="w-3.5 h-3.5 rounded-full border-2 bg-white dark:bg-slate-900 flex-shrink-0 z-10" style={{ borderColor: flow.color }} />
                      <button
                        type="button"
                        onClick={() => onNavigate({ type: 'module', id: 'reception' })}
                        className="flex-1 flex items-center justify-between px-4 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:shadow-sm hover:border-slate-300 dark:hover:border-slate-600 transition-all text-left"
                      >
                        <span className="font-semibold text-slate-800 dark:text-slate-200">{flow.label}</span>
                        {ic.chevRight('w-3.5 h-3.5 text-slate-300')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}

// ── Stock général screen ──────────────────────────────────────────────────────
// Même tableau que la page Expédition, sans les paniers de demande ni le sélecteur
// d'action : ici on consulte le contenu de l'entrepôt central, on n'y prépare pas d'envoi.
const STOCK_GENERAL_PAGE_SIZE = 20
// Table du stock général dans Expédition : plus dense que l'écran dédié, elle partage la
// page avec les filtres et les cartons.
const STOCK_PAGE_SIZE = 15

function StockGeneralScreen({ onNavigate }: { onNavigate: (screen: NavScreen) => void }) {
  const [glasses, setGlasses] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [rayonFilter, setRayonFilter] = useState('all')
  const [etagereFilter, setEtagereFilter] = useState('all')
  const [bacFilter, setBacFilter] = useState('all')
  const [page, setPage] = useState(1)

  // Changer de filtre remet en première page : rester en page 4 d'une liste qui vient d'être
  // réduite à deux pages donnerait un tableau vide sans explication.
  useEffect(() => { setPage(1) }, [rayonFilter, etagereFilter, bacFilter])

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) { setIsLoading(false); return }

    const load = (silent: boolean) => {
      if (!silent) setIsLoading(true)
      fetch(`${API_URL}/inventory/glasses?status=EN_STOCK_GENERAL`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async response => {
          if (!response.ok) throw new Error('general stock unavailable')
          const payload = await response.json().catch(() => ({}))
          return payload?.data?.glasses || []
        })
        // Le serveur pourrait élargir le filtre un jour : on revérifie le statut côté client
        // pour que cet écran ne montre jamais autre chose que du stock général.
        .then((rows: any[]) => setGlasses(rows.filter((g: any) => isGeneralStockStatus(g.status))))
        .catch(() => setGlasses([]))
        .finally(() => setIsLoading(false))
    }

    load(false)

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, 15000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load(true)
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const optionsFor = (pick: (parsed: { rayon: string; etagere: string; bac: string }) => string) =>
    Array.from(new Set(
      glasses
        .map((g: any) => parseStockLocationCode(g.location_code || ''))
        .filter(Boolean)
        .map((parsed: any) => pick(parsed))
    )).sort((a, b) => a.localeCompare(b))

  const rayonOptions = optionsFor(p => p.rayon)
  const etagereOptions = optionsFor(p => p.etagere)
  const bacOptions = optionsFor(p => p.bac)

  const filtered = glasses.filter(g => matchesLocationFilters(g, rayonFilter, etagereFilter, bacFilter))

  const totalPages = Math.max(1, Math.ceil(filtered.length / STOCK_GENERAL_PAGE_SIZE))
  // Page bornée à l'affichage : si la liste rétrécit entre deux rendus, on retombe sur la
  // dernière page existante au lieu d'afficher une tranche vide.
  const currentPage = Math.min(page, totalPages)
  const start = (currentPage - 1) * STOCK_GENERAL_PAGE_SIZE
  const pageRows = filtered.slice(start, start + STOCK_GENERAL_PAGE_SIZE)

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Stock général</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Liste des lunettes enregistrées en base.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-800/60">
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Rayon</label>
          <select value={rayonFilter} onChange={e => setRayonFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="all">Tous</option>
            {rayonOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Étagère</label>
          <select value={etagereFilter} onChange={e => setEtagereFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="all">Toutes</option>
            {etagereOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Bac</label>
          <select value={bacFilter} onChange={e => setBacFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <option value="all">Tous</option>
            {bacOptions.map(option => <option key={option} value={option}>{option}</option>)}
          </select>
          <button
            onClick={() => { setRayonFilter('all'); setEtagereFilter('all'); setBacFilter('all') }}
            className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Reset
          </button>
        </div>
      </div>

      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
        {filtered.length.toLocaleString('fr-FR')} monture{filtered.length > 1 ? 's' : ''}
        {filtered.length !== glasses.length && ` sur ${glasses.length.toLocaleString('fr-FR')}`}
      </p>

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
              {isLoading ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-green-700">Chargement...</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-green-700">Aucune lunette trouvée.</td></tr>
              ) : (
                pageRows.map((g: any, idx: number) => {
                  const frameRef = String(g.reference || g.barcode || g.ref || '').trim()
                  return (
                    <tr
                      key={`stock-general-${g.id || idx}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (!frameRef) return
                        onNavigate({ type: 'frame', ref: frameRef, city: '' })
                      }}
                      onKeyDown={event => {
                        if (!frameRef) return
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onNavigate({ type: 'frame', ref: frameRef, city: '' })
                        }
                      }}
                      className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors focus:outline-none focus:bg-slate-100 dark:focus:bg-slate-800"
                    >
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
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Masquée tant qu'une seule page suffit : une barre « Page 1 / 1 » n'apprend rien. */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            {(start + 1).toLocaleString('fr-FR')}–{Math.min(start + STOCK_GENERAL_PAGE_SIZE, filtered.length).toLocaleString('fr-FR')} sur {filtered.length.toLocaleString('fr-FR')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Précédent
            </button>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">
              Page {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Suivi detail screen ───────────────────────────────────────────────────────
function SuiviDetailScreen({ pays, city, section, cityStockCounts, framesByCity, onNavigate }: { pays: string; city: string; section: SuiviSection; cityStockCounts: Record<string, CityStats>; framesByCity: Record<string, FrameRecord[]>; onNavigate: (screen: NavScreen) => void }) {
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

      {section === 'presentoire' && frames.length > 0 && (
        <PresentoirParBloc frames={frames} onNavigate={onNavigate} city={city} />
      )}

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
                <button
                  key={f.ref + f.date}
                  type="button"
                  onClick={() => onNavigate({ type: 'frame', ref: f.ref, city })}
                  className="w-full items-center text-left hover:bg-purple-50/50 dark:hover:bg-purple-900/10 transition-colors"
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
                </button>
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

// ── Présentoir par bloc ─────────────────────────────────────────────────────────
// Regroupe les montures d'une ville par bloc (meuble) de présentoir, cf. blocKeyOf().
// Complète la table à plat ci-dessous, qui reste la vue de recherche/filtre globale.
function PresentoirParBloc({ frames, city, onNavigate }: { frames: FrameRecord[]; city: string; onNavigate: (screen: NavScreen) => void }) {
  const [activeBlocKey, setActiveBlocKey] = useState('')
  const [preview, setPreview] = useState<FrameRecord | null>(null)

  const blocs = useMemo(() => {
    const groupes = new Map<string, FrameRecord[]>()
    for (const frame of frames) {
      const cle = blocKeyOf(frame)
      const liste = groupes.get(cle)
      if (liste) liste.push(frame)
      else groupes.set(cle, [frame])
    }
    return Array.from(groupes.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'fr'))
      .map(([cle, montures]) => ({
        cle,
        montures,
        total: sumPrice(montures),
        moyenne: montures.length > 0 ? Math.round(sumPrice(montures) / montures.length) : 0,
        formes: groupByAttr(montures, f => f.forme),
        couleurs: groupByAttr(montures, f => f.couleur),
      }))
  }, [frames])

  if (blocs.length === 0) return null
  const blocCourant = blocs.find(b => b.cle === activeBlocKey) || blocs[0]

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-3 overflow-x-auto">
        {blocs.map(bloc => (
          <button
            key={bloc.cle}
            type="button"
            onClick={() => setActiveBlocKey(bloc.cle)}
            className={`flex-shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all ${
              bloc.cle === blocCourant.cle
                ? 'bg-green-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-green-200 dark:border-green-700'
            }`}
          >
            {bloc.cle === 'Non affecté' ? 'Bloc non affecté' : `Bloc ${bloc.cle}`}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{blocCourant.cle === 'Non affecté' ? 'Bloc non affecté' : `Bloc ${blocCourant.cle}`}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{businessBlocLabel(blocCourant.cle)}</p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-green-50 dark:bg-green-500/15 px-3 py-1 text-xs font-semibold text-green-700 dark:text-green-300">
            {blocCourant.montures.length} monture{blocCourant.montures.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3 text-center">
            <p className="text-xs text-slate-400">Prix total du bloc</p>
            <p className="mt-1 text-lg font-black tabular-nums text-green-600 dark:text-green-400">{fmtFCFA(blocCourant.total)}</p>
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
                <div key={f.label} className="rounded-xl border border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-2xl font-black tabular-nums text-green-600 dark:text-green-400">{percent}%</p>
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
                <div key={c.label} className="rounded-xl border border-green-200 dark:border-green-800 p-3 text-center">
                  <p className="text-2xl font-black tabular-nums text-purple-600 dark:text-purple-400">{percent}%</p>
                  <p className="mt-1 text-xs text-slate-400 truncate">{c.label}</p>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4">
          <p className="mb-2 text-xs font-bold text-slate-900 dark:text-white">Montures du bloc</p>
          <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Référence</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Forme</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Couleur</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Emplacement</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-slate-400">Prix</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/60">
                {blocCourant.montures.map(frame => (
                  <tr key={frame.ref + frame.date}>
                    <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-white">{frame.ref}</td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{frame.forme || '—'}</td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-slate-400">{frame.couleur || '—'}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-slate-500 dark:text-slate-400">{frame.emplacement || '—'}</td>
                    <td className="py-2.5 px-3 text-right font-bold tabular-nums text-green-600 dark:text-green-400">{fmtFCFA(priceOf(frame))}</td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => setPreview(frame)}
                        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700"
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
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setPreview(null)}>
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3.5 bg-white/95 dark:bg-slate-800/95 backdrop-blur-sm border-b border-slate-200 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{preview.ref}</p>
                <p className="text-xs text-slate-400 truncate">{blocKeyOf(preview) === 'Non affecté' ? 'Bloc non affecté' : `Bloc ${blocKeyOf(preview)}`} · {city}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="flex-shrink-0 p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all"
                aria-label="Fermer"
              >
                {ic.x('w-5 h-5')}
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="h-40 w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900 flex items-center justify-center">
                {preview.photo
                  ? <FramePhoto src={preview.photo} alt={preview.ref} className="h-full w-full object-cover" />
                  : <span className="text-xs text-slate-400">Pas de photo de monture</span>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Forme</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{preview.forme || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Couleur</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{preview.couleur || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Emplacement</p>
                  <p className="mt-1 text-sm font-mono text-slate-900 dark:text-white">{preview.emplacement || '—'}</p>
                </div>
                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 p-3">
                  <p className="text-xs text-slate-400">Prix</p>
                  <p className="mt-1 text-sm font-bold tabular-nums text-green-600 dark:text-green-400">{fmtFCFA(priceOf(preview))}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onNavigate({ type: 'frame', ref: preview.ref, city })}
                className="w-full rounded-xl bg-slate-100 dark:bg-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Voir la fiche complète
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── City detail screen ────────────────────────────────────────────────────────
function CityDetailScreen({ block, pays, city, onNavigate, cityStockCounts, framesByCity, revenueByCity }: {
  block: 'total' | 'ca'; pays: string; city: string; onNavigate: (s: NavScreen) => void; cityStockCounts: Record<string, CityStats>; framesByCity: Record<string, FrameRecord[]>; revenueByCity: Record<string, RevenueRow[]>
}) {
  const [calYear, setCalYear] = useState(2026)
  const [calMonth, setCalMonth] = useState(7)
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const [calOpen, setCalOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const [selectedRevenuePreview, setSelectedRevenuePreview] = useState<RevenueRow | null>(null)
  const [revenuePreviewDetail, setRevenuePreviewDetail] = useState<any | null>(null)
  const [isLoadingRevenuePreview, setIsLoadingRevenuePreview] = useState(false)
  const [revenuePreviewPhotos, setRevenuePreviewPhotos] = useState<Record<string, string>>({})

  // La ligne ne porte que ref/client/montant : ni les montures, ni le téléphone du client.
  // On les va chercher sur la fiche complète, comme fait déjà ProformaDetail côté Caisse.
  function openRevenuePreview(row: RevenueRow) {
    setSelectedRevenuePreview(row)
    setRevenuePreviewDetail(null)
    setRevenuePreviewPhotos({})
    if (!row.id) return
    setIsLoadingRevenuePreview(true)
    const token = window.localStorage.getItem('token')
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    fetch(`${API_URL}/inventory/proformas/${row.id}`, { headers })
      .then(response => (response.ok ? response.json() : Promise.reject()))
      .then(async payload => {
        const proforma = payload?.data?.proforma || null
        setRevenuePreviewDetail(proforma)

        // ProformaItem ne porte pas de photo (recopié pour rester lisible même si la
        // monture est supprimée) : on va la chercher sur la fiche monture, par code-barres.
        // Sans station_id dans l'URL : avec, ce même endpoint pose la monture en présentoir
        // (GetGlassByBarcode) — un simple aperçu ne doit rien déplacer.
        const barcodes = Array.from(new Set(
          (proforma?.items || []).map((item: any) => String(item.barcode || '').trim()).filter(Boolean),
        )) as string[]
        const entries = await Promise.all(barcodes.map(async barcode => {
          try {
            const response = await fetch(`${API_URL}/inventory/glasses/${encodeURIComponent(barcode)}`, { headers })
            if (!response.ok) return null
            const glassPayload = await response.json().catch(() => ({}))
            const url = glassPayload?.data?.glass?.photo_monture_url
            return url ? [barcode, url] as const : null
          } catch {
            return null
          }
        }))
        setRevenuePreviewPhotos(Object.fromEntries(entries.filter(Boolean) as [string, string][]))
      })
      .catch(() => setRevenuePreviewDetail(null))
      .finally(() => setIsLoadingRevenuePreview(false))
  }

  function closeRevenuePreview() {
    setSelectedRevenuePreview(null)
    setRevenuePreviewDetail(null)
    setRevenuePreviewPhotos({})
  }

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
    const rows = (revenueByCity[city] || []).filter(r =>
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
              <button key={r.ref} onClick={() => openRevenuePreview(r)}
                className="w-full grid grid-cols-4 items-center hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-colors text-left">
                <div className="px-3 py-3 text-xs font-bold text-slate-900 dark:text-white">{r.ref}</div>
                <div className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 truncate">{r.client}</div>
                <div className="px-3 py-3 text-xs font-black tabular-nums" style={{ color: accent }}>{fmtFCFA(r.montant)}</div>
                <div className="px-3 py-3"><Badge status={r.status} /></div>
              </button>
            ))}
          </div>
        </div>

        {selectedRevenuePreview && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" onClick={closeRevenuePreview}>
            <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Aperçu proforma</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{revenuePreviewDetail?.code || selectedRevenuePreview.ref}</p>
                </div>
                <button onClick={closeRevenuePreview} className="text-slate-400 hover:text-slate-600">{ic.x()}</button>
              </div>

              {isLoadingRevenuePreview ? (
                <div className="mt-4 py-8 text-center text-sm text-slate-400">Chargement...</div>
              ) : (
                <>
                  <div className="mt-4 grid gap-2 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60 sm:col-span-2">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Client</span>
                      <span className="mt-1 block font-semibold">{revenuePreviewDetail?.client_name || selectedRevenuePreview.client}</span>
                      {revenuePreviewDetail?.client_phone && <span className="block text-xs text-slate-500 dark:text-slate-400">{revenuePreviewDetail.client_phone}</span>}
                    </div>
                    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Montant</span><span className="mt-1 block font-semibold" style={{ color: accent }}>{fmtFCFA(Number(revenuePreviewDetail?.total_amount ?? selectedRevenuePreview.montant))}</span></div>
                    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Statut</span><span className="mt-1 block"><Badge status={selectedRevenuePreview.status} /></span></div>
                    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Émise le</span><span className="mt-1 block font-semibold">{String(revenuePreviewDetail?.created_at || '').slice(0, 10) || '—'}</span></div>
                    <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Réglée le</span><span className="mt-1 block font-semibold">{String(revenuePreviewDetail?.settled_at || selectedRevenuePreview.date || '').slice(0, 10) || '—'}</span></div>
                    {revenuePreviewDetail?.created_by_name && (
                      <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60 sm:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Enregistrée par</span><span className="mt-1 block font-semibold">{revenuePreviewDetail.created_by_name}</span></div>
                    )}
                  </div>

                  <div className="mt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Monture{(revenuePreviewDetail?.items?.length ?? 0) > 1 ? 's' : ''} ({revenuePreviewDetail?.items?.length ?? 0})
                    </p>
                    {!revenuePreviewDetail?.items || revenuePreviewDetail.items.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-400">Aucune ligne trouvée pour cette proforma.</p>
                    ) : (
                      <div className="mt-2 space-y-2">
                        {revenuePreviewDetail.items.map((item: any) => (
                          <div key={item.id} className="flex gap-2.5 rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                            <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                              {revenuePreviewPhotos[String(item.barcode || '').trim()] ? (
                                <img src={revenuePreviewPhotos[String(item.barcode || '').trim()]} alt={item.reference || item.barcode || 'Monture'} className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-[9px] text-slate-400">Pas de photo</div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900 dark:text-white">{item.reference || item.barcode || 'Monture'}</span>
                                <span className="flex-shrink-0 font-bold tabular-nums" style={{ color: accent }}>{item.offerte ? 'Offerte' : fmtFCFA(Number(item.unit_price) || 0)}</span>
                              </div>
                              <div className="mt-1 text-slate-500 dark:text-slate-400">
                                {[item.brand, item.shape, item.color].filter(Boolean).join(' · ') || '—'}
                              </div>
                              <div className="mt-1 text-slate-400">
                                {item.barcode && <span className="font-mono">{item.barcode}</span>}
                                {item.outcome && <span className="ml-2">{item.outcome === 'VENDUE' ? 'Vendue' : item.outcome === 'RETOUR_PRESENTOIR' ? 'Retournée au présentoir' : item.outcome}</span>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {revenuePreviewDetail?.note && (
                    <div className="mt-4 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Note</span>
                      <p className="mt-1 whitespace-pre-line">{revenuePreviewDetail.note}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {calOpen && <CalendarModal year={calYear} month={calMonth} selectedDay={selectedDay} onSelectDay={setSelectedDay} onClose={() => setCalOpen(false)} onPrevMonth={prevMonth} onNextMonth={nextMonth} />}
      </div>
    )
  }

}

// ── Frame detail ──────────────────────────────────────────────────────────────
function FrameDetailScreen({ frameRef, city, framesByCity }: { frameRef: string; city?: string; framesByCity: Record<string, FrameRecord[]> }) {
  const frameFromCity = city ? framesByCity[city]?.find(f => f.ref === frameRef) : undefined
  const frame = frameFromCity || Object.values(framesByCity).flat().find(f => f.ref === frameRef)
  const resolvedCity = city && framesByCity[city] ? city : Object.keys(framesByCity).find(key => framesByCity[key]?.some(f => f.ref === frameRef)) || city || '—'

  return (
    <div className="space-y-4 max-w-sm mx-auto">
      <div className="bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-3xl overflow-hidden aspect-video flex items-center justify-center">
        <FramePhoto src={frame?.photo} alt={frame?.ref || 'monture'} className="w-full h-full object-cover" />
      </div>
      {frame && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
          {[
            ['Référence', frame.ref],
            ['Marque', frame.marque],
            ['Enregistré par', frame.enregistrePar],
            ['Date', frame.date],
            ['Ville', resolvedCity],
            ['Emplacement', frame.emplacement || '—'],
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
  const [selectedStage, setSelectedStage] = useState<MvtStage>('shipped')
  // Second niveau, comme historique.html : période dans l'étape, et — pour « Réceptionné »
  // seulement, l'équivalent du « Stock local » — la station avant la période.
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodKey | null>(null)
  const [selectedLocalStation, setSelectedLocalStation] = useState<string | null>(null)
  const [liveItems, setLiveItems] = useState<Movement[]>(MOVEMENTS_DATA)
  const [knownStations, setKnownStations] = useState<any[]>([])
  const [quickSearch, setQuickSearch] = useState('')

  // Panneau « Suivi en direct » d'une monture.
  const [trackedBarcode, setTrackedBarcode] = useState<string | null>(null)
  const [trackMovements, setTrackMovements] = useState<any[]>([])
  const [isTrackLoading, setIsTrackLoading] = useState(false)
  const [trackError, setTrackError] = useState(false)
  const [, setNowTick] = useState(0)

  // Visionneuse photo plein écran.
  const [lightbox, setLightbox] = useState<{ url: string; caption: string } | null>(null)

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setLiveItems([])
      return
    }

    const headers = { Authorization: `Bearer ${token}` }

    const loadMovements = () => {
      fetch(`${API_URL}/inventory/movements?limit=300&offset=0`, { headers })
        .then(async response => {
          if (!response.ok) throw new Error('movements unavailable')
          const payload = await response.json().catch(() => ({}))
          const items = Array.isArray(payload?.data?.movements) ? payload.data.movements : []

          const mapped: Movement[] = items
            // Hors pipeline, et écartées ici plutôt que dans normalizeMovementStage, dont le
            // repli les ferait toutes retomber dans « Réceptionné » :
            //   RECEPTION_FOURNISSEUR — sans station d'origine, marque l'entrée de la monture
            //     dans le parc et non un déplacement ;
            //   RANGEMENT — changement de casier à l'intérieur d'une même station, la monture
            //     n'a franchi aucune frontière.
            .filter((entry: any) => !OUT_OF_PIPELINE_ACTIONS.has(String(entry.action || '').trim().toUpperCase()))
            .map((entry: any): Movement => {
              const stage = normalizeMovementStage(entry.action, entry.to_station_name)
              const from = stationDisplayLabel(entry.from_station_name) || 'Inconnu'
              const to = stationDisplayLabel(entry.to_station_name) || 'Inconnu'
              const operator = [entry.user_first_name, entry.user_last_name].filter(Boolean).join(' ') || 'Système'
              const { date, time } = formatMovementDate(entry.created_at)
              const ref = String(entry.reference || entry.barcode || `MVT-${entry.id ?? 'n/a'}`)

              return {
                id: String(entry.id ?? `${stage}-${ref}-${date}-${time}`),
                numericId: Number(entry.id) || 0,
                stage,
                frames: Number(entry.quantity || 1),
                from,
                to,
                toRaw: String(entry.to_station_name || ''),
                date,
                time,
                createdAtIso: String(entry.created_at || ''),
                operator,
                notes: entry.notes || undefined,
                barcode: String(entry.barcode || ''),
                reference: entry.reference || undefined,
                brand: entry.brand || undefined,
                photoUrl: movementPhotoUrl(entry),
              }
            })
            .filter((item: Movement) => item.from && item.to && item.barcode)
            .sort((a: Movement, b: Movement) => b.createdAtIso.localeCompare(a.createdAtIso))

          setLiveItems(mapped)
        })
        .catch(() => setLiveItems([]))
    }

    loadMovements()

    // Pas de push serveur : on republie le journal toutes les 15s pour un rendu quasi
    // temps réel, en sautant les cycles où l'onglet est en arrière-plan (et en resynchronisant
    // dès qu'il redevient visible) pour ne pas taper l'API pour rien.
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadMovements()
    }, 15000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadMovements()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // Le journal récent ne couvre pas forcément toutes les villes : sans ce référentiel, une
  // ville sans mouvement récent disparaîtrait du bloc « Réceptionné » (comme
  // loadKnownStations dans historique.js).
  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return
    fetch(`${API_URL}/auth/stations`, { headers: { Authorization: `Bearer ${token}` } })
      .then(response => (response.ok ? response.json() : Promise.reject()))
      .then(payload => setKnownStations(Array.isArray(payload?.data?.stations) ? payload.data.stations : []))
      .catch(() => setKnownStations([]))
  }, [])

  // Suivi en direct : chargement puis polling toutes les 12s tant que le panneau est ouvert.
  useEffect(() => {
    if (!trackedBarcode) return
    const token = window.localStorage.getItem('token')
    if (!token) return
    let cancelled = false
    const headers = { Authorization: `Bearer ${token}` }

    const fetchTrack = () => {
      const params = new URLSearchParams({ barcode: trackedBarcode, limit: '50', offset: '0' })
      fetch(`${API_URL}/inventory/movements?${params.toString()}`, { headers })
        .then(response => (response.ok ? response.json() : Promise.reject()))
        .then(payload => {
          if (cancelled) return
          setTrackMovements(Array.isArray(payload?.data?.movements) ? payload.data.movements : [])
          setTrackError(false)
        })
        .catch(() => { if (!cancelled) setTrackError(true) })
        .finally(() => { if (!cancelled) setIsTrackLoading(false) })
    }

    setIsTrackLoading(true)
    setTrackMovements([])
    setTrackError(false)
    fetchTrack()
    const poll = window.setInterval(fetchTrack, 12000)
    return () => { cancelled = true; window.clearInterval(poll) }
  }, [trackedBarcode])

  // Horloge des temps relatifs (« il y a 3 min ») dans le panneau de suivi, comme
  // tickRelativeTimes dans historique.js.
  useEffect(() => {
    if (!trackedBarcode) return
    const tick = window.setInterval(() => setNowTick(n => n + 1), 1000)
    return () => window.clearInterval(tick)
  }, [trackedBarcode])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      if (lightbox) { setLightbox(null); return }
      if (trackedBarcode) setTrackedBarcode(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [lightbox, trackedBarcode])

  function openTrack(barcode: string) {
    setTrackedBarcode(barcode.trim())
  }

  function handleQuickSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && quickSearch.trim()) {
      openTrack(quickSearch.trim())
      setQuickSearch('')
    }
  }

  function selectStage(stage: MvtStage) {
    setSelectedStage(stage)
    setSelectedPeriod(null)
    setSelectedLocalStation(null)
  }

  const pipeline: MvtStage[] = ['shipped', 'received', 'display', 'caisse', 'labo', 'sold']

  // Une ligne par monture (sa position la plus récente), pas le journal brut : mêmes
  // compteurs de cartes que historique.html (dedupeByMonture), pour que « 3 montures au
  // présentoir » compte des montures et non des allers-retours.
  const dedupedAll = useMemo(() => dedupeMovementsByBarcode(liveItems), [liveItems])
  const activeMeta = STAGE_META[selectedStage]
  const stageMovements = useMemo(() => dedupedAll.filter(m => m.stage === selectedStage), [dedupedAll, selectedStage])

  const isLocalDrilldown = selectedStage === 'received'
  const scopedMovements = isLocalDrilldown && selectedLocalStation
    ? stageMovements.filter(m => m.toRaw === selectedLocalStation)
    : stageMovements

  const periodCounts = useMemo(() => {
    const counts: Record<PeriodKey, number> = { today: 0, week: 0, month: 0, older: 0 }
    scopedMovements.forEach(m => { counts[periodOf(m.createdAtIso)] += 1 })
    return counts
  }, [scopedMovements])

  const filteredMovements = selectedPeriod
    ? scopedMovements.filter(m => periodOf(m.createdAtIso) === selectedPeriod)
    : scopedMovements

  // Villes du « Stock local » : celles vues dans les mouvements récents, complétées par les
  // stations magasin connues (même si rien n'y est arrivé récemment) — comme
  // renderLocalStationBlocks dans historique.js.
  const localStationNames = useMemo(() => {
    if (!isLocalDrilldown) return [] as [string, number][]
    const counts = new Map<string, number>()
    stageMovements.forEach(m => counts.set(m.toRaw, (counts.get(m.toRaw) || 0) + 1))
    knownStations.forEach((station: any) => {
      if (isStoreStation(station) && station.name && !counts.has(station.name)) counts.set(station.name, 0)
    })
    return Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0], 'fr'))
  }, [isLocalDrilldown, stageMovements, knownStations])

  const trackSorted = [...trackMovements].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  const trackPhotoUrl = trackSorted.map(movementPhotoUrl).find(Boolean) || null
  const trackLabel = trackSorted.length ? [trackSorted[0].brand, trackSorted[0].reference].filter(Boolean).join(' ') : ''

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
            Traçabilité complète des montures : transits, réceptions, présentoir, caisse, laboratoire, ventes.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search('w-4 h-4')}</span>
            <input
              value={quickSearch}
              onChange={e => setQuickSearch(e.target.value)}
              onKeyDown={handleQuickSearchKeyDown}
              placeholder="Suivre un code-barres..."
              className="w-48 rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
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
            const items = dedupedAll.filter(m => m.stage === stage)
            const meta = STAGE_META[stage]
            const isActive = stage === selectedStage
            return (
              <button
                key={stage}
                type="button"
                onClick={() => selectStage(stage)}
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
                <span className="text-xs text-slate-500 dark:text-slate-400">{items.length > 1 ? 'montures' : 'monture'}</span>
              </button>
            )
          })}
        </div>

        {isLocalDrilldown && !selectedLocalStation ? (
          /* Sous-niveau « Stock local » : choix de la ville avant la période, comme
             renderLocalStationBlocks dans historique.js. */
          <div className={`overflow-hidden ${BLOCK_CLASS}`}>
            <h3 className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 text-[15px] font-bold text-slate-900 dark:border-slate-700 dark:text-white">
              <span style={{ color: activeMeta.color }}>{ic.hist('w-[17px] h-[17px]')}</span>
              {activeMeta.label}
            </h3>
            {localStationNames.length === 0 ? (
              <div className="px-5 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
                Aucune monture en stock local pour le moment.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
                {localStationNames.map(([name, count]) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setSelectedLocalStation(name)}
                    className="flex flex-col items-start gap-1.5 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900"
                  >
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{stationDisplayLabel(name)}</span>
                    <span className="text-xl font-extrabold tabular-nums text-slate-900 dark:text-white">{count}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">{count > 1 ? 'montures' : 'monture'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Sous-niveau « période », comme PERIODS dans historique.js — un clic de plus
                désélectionne, pour revenir à toute l'étape. */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {PERIODS.map(p => {
                const isActive = selectedPeriod === p.key
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setSelectedPeriod(prev => (prev === p.key ? null : p.key))}
                    aria-pressed={isActive}
                    className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm transition-colors ${isActive
                      ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-500 dark:bg-blue-900/20 dark:text-blue-300'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}
                  >
                    <span className="font-semibold">{p.label}</span>
                    <span className="tabular-nums">{periodCounts[p.key]}</span>
                  </button>
                )
              })}
            </div>

            {/* .stage-activity — le détail de l'étape (et éventuellement de la ville/période)
                sélectionnée, directement sous les cartes. */}
            <div className={`overflow-hidden ${BLOCK_CLASS}`}>
              <h3 className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-5 py-4 text-[15px] font-bold text-slate-900 dark:border-slate-700 dark:text-white">
                {isLocalDrilldown && selectedLocalStation && (
                  <button
                    type="button"
                    onClick={() => setSelectedLocalStation(null)}
                    className="flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                  >
                    {ic.back('w-4 h-4')} Villes
                  </button>
                )}
                <span style={{ color: activeMeta.color }}>{ic.hist('w-[17px] h-[17px]')}</span>
                {activeMeta.label}
                {selectedLocalStation && <span className="text-slate-400 dark:text-slate-500"> · {stationDisplayLabel(selectedLocalStation)}</span>}
                <span className="ml-1 text-sm font-medium text-slate-500 dark:text-slate-400">· {filteredMovements.length} monture{filteredMovements.length > 1 ? 's' : ''}</span>
              </h3>

              {filteredMovements.length === 0 ? (
                <div className="px-5 py-14 text-center text-sm text-slate-500 dark:text-slate-400">
                  Aucune monture pour cette sélection.
                </div>
              ) : (
                <div className="flex flex-col">
                  {filteredMovements.map((mvt, idx) => {
                    const meta = STAGE_META[mvt.stage]
                    const label = [mvt.brand, mvt.reference].filter(Boolean).join(' ')
                    return (
                      <div key={mvt.id} className="flex items-center gap-3.5 border-b border-slate-100 px-5 py-3.5 transition-colors last:border-b-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                        {/* .glass-photo — vignette réelle si connue, icône sinon. */}
                        <button
                          type="button"
                          onClick={() => mvt.photoUrl && setLightbox({ url: mvt.photoUrl, caption: `${mvt.barcode}${label ? ' — ' + label : ''}` })}
                          disabled={!mvt.photoUrl}
                          title={mvt.photoUrl ? 'Voir la photo' : 'Aucune photo disponible'}
                          className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-slate-400 disabled:cursor-default dark:border-slate-700 dark:bg-slate-800"
                        >
                          {mvt.photoUrl ? (
                            <img src={mvt.photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                          ) : (
                            ic.glasses('w-[18px] h-[18px]')
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900 dark:text-white">{mvt.barcode}</span>
                            {label && <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>}
                            {idx === 0 && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Nouveau</span>
                            )}
                          </div>
                          {mvt.notes && <p className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">{mvt.notes}</p>}
                          <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-xs">
                            <span className="inline-block rounded-full px-[9px] py-0.5 text-xs font-bold" style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}>
                              {meta.label}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300">
                              {mvt.from} <span className="text-slate-400">→</span> {mvt.to}
                            </span>
                            <span className="text-slate-400">{mvt.date} à {mvt.time} · Par {mvt.operator}</span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => openTrack(mvt.barcode)}
                          className="flex flex-shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                        >
                          <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-white" aria-hidden="true" />
                          Suivi en direct
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </>
      )}

      {/* Panneau « Suivi en direct » d'une monture, comme #trackPanel dans historique.js. */}
      {trackedBarcode && (
        <div className="fixed inset-0 z-[70] flex items-stretch justify-end bg-black/50 sm:items-center sm:justify-center sm:p-4" onClick={() => setTrackedBarcode(null)}>
          <aside
            role="dialog"
            aria-modal="true"
            onClick={e => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-2xl dark:bg-slate-900 sm:h-auto sm:max-h-[85vh] sm:rounded-2xl sm:border sm:border-slate-200 sm:dark:border-slate-700"
          >
            <header className="flex items-start gap-3 border-b border-slate-200 p-4 dark:border-slate-700">
              <button
                type="button"
                onClick={() => trackPhotoUrl && setLightbox({ url: trackPhotoUrl, caption: `${trackedBarcode}${trackLabel ? ' — ' + trackLabel : ''}` })}
                disabled={!trackPhotoUrl}
                title={trackPhotoUrl ? 'Voir la photo en grand' : 'Aucune photo disponible'}
                className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-slate-400 disabled:cursor-default dark:border-slate-700 dark:bg-slate-800"
              >
                {trackPhotoUrl ? <img src={trackPhotoUrl} alt="" className="h-full w-full object-cover" /> : ic.glasses('w-6 h-6')}
              </button>
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-blue-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-600" aria-hidden="true" /> Suivi en direct
                </span>
                <h2 className="truncate text-lg font-bold text-slate-900 dark:text-white">{trackedBarcode}</h2>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">{trackLabel || 'Trajectoire de la monture'}</p>
              </div>
              <button type="button" onClick={() => setTrackedBarcode(null)} className="flex-shrink-0 text-slate-400 hover:text-slate-600" aria-label="Fermer le suivi">{ic.x('w-5 h-5')}</button>
            </header>

            <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold ${trackError ? 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${trackError ? 'bg-red-500' : 'animate-pulse bg-blue-500'}`} aria-hidden="true" />
              {trackError ? 'Suivi interrompu — nouvel essai sous peu…' : isTrackLoading ? 'Connexion au suivi…' : 'Suivi en direct · actualisé automatiquement'}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {isTrackLoading ? (
                <div className="py-10 text-center text-sm text-slate-400">Chargement de la trajectoire…</div>
              ) : trackSorted.length === 0 ? (
                <div className="py-10 text-center text-sm text-slate-400">Aucun mouvement enregistré pour cette monture.</div>
              ) : (
                <div className="space-y-4">
                  {trackSorted.map((m, index) => {
                    const color = movementActionColor(m.action)
                    const icon = movementActionIcon(m.action)
                    const fromCell = [stationDisplayLabel(m.from_station_name), m.from_location_code].filter(Boolean).join(' · ')
                    const toCell = [stationDisplayLabel(m.to_station_name), m.to_location_code].filter(Boolean).join(' · ')
                    const userName = [m.user_first_name, m.user_last_name].filter(Boolean).join(' ')
                    return (
                      <div key={m.id ?? index} className="flex gap-3">
                        <div className="flex flex-shrink-0 flex-col items-center">
                          <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: `${color}1f`, color }}>
                            {icon('w-4 h-4')}
                          </span>
                          {index < trackSorted.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200 dark:bg-slate-700" />}
                        </div>
                        <div className="min-w-0 flex-1 pb-2">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <span className="text-sm font-semibold text-slate-900 dark:text-white">
                              {movementActionLabel(m.action)}
                              {index === 0 && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">Position actuelle</span>}
                            </span>
                            <span className="text-xs text-slate-400">{relativeTimeFr(m.created_at)}</span>
                          </div>
                          {(fromCell || toCell) && (
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {fromCell || '—'} {toCell && <><span className="text-slate-400">→</span> {toCell}</>}
                            </p>
                          )}
                          {userName && <p className="mt-0.5 text-xs text-slate-400">Par {userName}</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Visionneuse photo plein écran, comme #lightboxBackdrop dans historique.js. */}
      {lightbox && (
        <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center gap-3 bg-black/90 p-4" onClick={() => setLightbox(null)}>
          <button type="button" onClick={() => setLightbox(null)} className="absolute right-4 top-4 text-white/80 hover:text-white" aria-label="Fermer la photo">{ic.x('w-6 h-6')}</button>
          <img src={lightbox.url} alt="" className="max-h-[80vh] max-w-full rounded-lg object-contain" onClick={e => e.stopPropagation()} />
          {lightbox.caption && <p className="text-sm text-white/80">{lightbox.caption}</p>}
        </div>
      )}
    </div>
  )
}

// ── Reception view ────────────────────────────────────────────────────────────
function ReceptionView() {
  const [sessions, setSessions] = useState(RECEPTION_SESSIONS)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailSession, setDetailSession] = useState<(typeof RECEPTION_SESSIONS)[number] | null>(null)
  const [detailRowPreview, setDetailRowPreview] = useState<any | null>(null)
  const [detailSearch, setDetailSearch] = useState('')
  const [detailStatusFilter, setDetailStatusFilter] = useState<'all' | 'Reçu' | 'En attente'>('all')
  const [detailFormeFilter, setDetailFormeFilter] = useState<ShapeFilterValue>('all')
  const [detailGenreFilter, setDetailGenreFilter] = useState<GenreFilterValue>('all')
  const [detailGammeFilter, setDetailGammeFilter] = useState<GammeFilterValue>('all')
  const [isLoadingSessions, setIsLoadingSessions] = useState(false)
  const [showSupplierModal, setShowSupplierModal] = useState(false)
  const [isSavingSupplier, setIsSavingSupplier] = useState(false)
  const [receptionSession, setReceptionSession] = useState<ReceptionSessionResult | null>(null)
  const [isLabelSentToStock, setIsLabelSentToStock] = useState(false)
  const [receptionCommands, setReceptionCommands] = useState<ReceptionSessionResult[]>([])
  const [detailSessionGlasses, setDetailSessionGlasses] = useState<any[]>([])
  const [isLoadingDetailSessionGlasses, setIsLoadingDetailSessionGlasses] = useState(false)
  const [showReceptionSessionCard, setShowReceptionSessionCard] = useState(true)
  const [isCreatingReceptionSession, setIsCreatingReceptionSession] = useState(false)
  const [isDeletingSessionId, setIsDeletingSessionId] = useState<number | null>(null)
  const [showStockPage, setShowStockPage] = useState(false)
  // Les sessions passées occupent leur propre page, comme le stock : l'écran Expédition
  // servait à la fois à créer et à consulter, et la liste s'allongeant, la création
  // finissait poussée hors de vue.
  const [showHistoryPage, setShowHistoryPage] = useState(false)
  const [stockGlasses, setStockGlasses] = useState<any[]>([])
  const [stockSummary, setStockSummary] = useState<any[]>([])
  const [isLoadingStock, setIsLoadingStock] = useState(false)
  const [isLoadingStockSummary, setIsLoadingStockSummary] = useState(false)
  // 'GENERAL' = liste du stock général ; sinon le nom du magasin dont on regarde les manquants.
  const [stockScope, setStockScope] = useState<string>('GENERAL')
  const [stockAction, setStockAction] = useState<StockAction>('')
  const [stockRayonFilter, setStockRayonFilter] = useState<string>('all')
  const [stockEtagereFilter, setStockEtagereFilter] = useState<string>('all')
  const [stockBacFilter, setStockBacFilter] = useState<string>('all')
  const [stockPage, setStockPage] = useState(1)
  // Sélection pour composer une liste depuis le stock existant. On garde les codes-barres et
  // non les indices de ligne : la sélection doit survivre au changement de page et de filtre.
  const [stockListSelection, setStockListSelection] = useState<string[]>([])
  const [stockListCity, setStockListCity] = useState('')
  const [selectedStockPreview, setSelectedStockPreview] = useState<any | null>(null)
  const [isSendingStockList, setIsSendingStockList] = useState(false)
  const [excludedPreparationKeys, setExcludedPreparationKeys] = useState<string[]>([])
  const [basketCounts, setBasketCounts] = useState<Record<string, number>>({})
  const [restockByCity, setRestockByCity] = useState<Record<string, RestockSuggestion>>({})
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
  const [sentListSessions, setSentListSessions] = useState<Record<string, Array<{ city: string; dispatched: boolean }>>>({})
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
    void loadStockGlasses()
    void loadStockSummary()

    // silent : les rafraîchissements automatiques (minuteur, retour de focus) ne doivent
    // pas réafficher les squelettes de chargement — seul le montage initial le fait. Sans
    // ça, la liste des sessions et le tableau de stock clignotaient sur « Chargement... »
    // toutes les 5 secondes pendant que la Direction regardait l'écran.
    const handleWindowFocus = () => {
      void loadSessions(true)
      void loadReceptionCommands()
      void loadSentLists()
      void loadStockGlasses(true)
      void loadStockSummary(true)
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleWindowFocus()
    }
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') handleWindowFocus()
    }, 5000)
    window.addEventListener('focus', handleWindowFocus)
    document.addEventListener('visibilitychange', handleVisibility)

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
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', handleWindowFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
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
      const bySession: Record<string, Array<{ city: string; dispatched: boolean }>> = {}
      for (const list of payload?.data?.lists || []) {
        const code = String(list.session_code || '').trim()
        const city = String(list.city || '').trim()
        if (!code || !city) continue
        // « Envoyée » (créée par la Direction) et « en transit » (réellement expédiée par
        // le magasinier, cf. listDispatched dans scan.tsx) sont deux états distincts : le
        // statut du serveur — pas une déduction côté client — tranche entre les deux.
        const dispatched = String(list.status || '').toUpperCase() === 'TRAITEE' || Number(list.sent_count || 0) > 0
        if (!bySession[code]) bySession[code] = []
        const existing = bySession[code].find(entry => entry.city === city)
        if (existing) {
          existing.dispatched = existing.dispatched || dispatched
        } else {
          bySession[code].push({ city, dispatched })
        }
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
        if (cities.some(entry => entry.city === sendListMagasin)) return prev
        return { ...prev, [sendListSession.id]: [...cities, { city: sendListMagasin, dispatched: false }] }
      })
    } catch {
      window.alert("Impossible d'envoyer la liste pour le moment.")
    } finally {
      setIsSubmittingSendList(false)
    }
  }

  async function loadSessions(silent = false) {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setSessions([])
      return
    }

    if (!silent) setIsLoadingSessions(true)
    try {
      const response = await fetch(`${API_URL}/inventory/expeditions`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('expeditions unavailable')
      const payload = await response.json().catch(() => ({}))
      const list = payload?.data?.orders || []
      const nextSessions = list.map((order: any) => {
        const timestampSource = order.created_at || order.updated_at || order.order_date || new Date().toISOString()
        const parsedDate = new Date(timestampSource)
        const safeDate = Number.isNaN(parsedDate.getTime()) && order.order_date
          ? new Date(`${String(order.order_date).trim()}T12:00:00`)
          : parsedDate
        const dateLabel = safeDate.toLocaleDateString('fr-FR')
        const timeLabel = safeDate.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
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
        activatedAt: command.activated_at || null,
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

  // Besoins de réapprovisionnement, indexés par ville normalisée : c'est la même clé que
  // partout ailleurs, sinon « Pointe-Noire » et « pointe-noire » ne se retrouveraient pas.
  async function loadRestockSuggestions() {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setRestockByCity({})
      return
    }

    try {
      const response = await fetch(`${API_URL}/inventory/send-boxes/restock`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('restock unavailable')
      const payload = await response.json().catch(() => ({}))
      const byCity: Record<string, RestockSuggestion> = {}
      for (const row of payload?.data?.suggestions || []) {
        byCity[String(row.city || '').trim().toLowerCase()] = row as RestockSuggestion
      }
      setRestockByCity(byCity)
    } catch {
      setRestockByCity({})
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

  async function loadStockSummary(silent = false) {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setStockSummary([])
      return
    }

    if (!silent) setIsLoadingStockSummary(true)
    try {
      const response = await fetch(`${API_URL}/inventory/stock-summary`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('stock summary unavailable')
      const payload = await response.json().catch(() => ({}))
      setStockSummary(payload?.data?.items || [])
    } catch {
      setStockSummary([])
    } finally {
      setIsLoadingStockSummary(false)
    }
  }

  async function loadStockGlasses(silent = false) {
    const token = window.localStorage.getItem('token')
    if (!token) {
      setStockGlasses([])
      return
    }

    if (!silent) setIsLoadingStock(true)
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

  function matchesStockFilters(glass: any) {
    return matchesLocationFilters(glass, stockRayonFilter, stockEtagereFilter, stockBacFilter)
  }

  function openStockSummaryPreview(item: any) {
    const rawRef = String(item?.reference || item?.barcode || item?.code || '').trim()
    const refKey = rawRef || '—'
    const match = (stockGlasses || []).find((glass: any) => {
      const candidateRefs = [
        String(glass.reference || '').trim(),
        String(glass.barcode || '').trim(),
        String(glass.code || '').trim(),
        String(glass.reference || glass.barcode || glass.code || '').trim(),
      ].filter(Boolean)

      return candidateRefs.some(value => value && refKey !== '—' && normalizeReference(value) === normalizeReference(refKey))
    })

    const preview = match || {
      ...item,
      reference: refKey,
      barcode: item?.barcode || item?.code || refKey,
      brand: item?.brand || item?.marque || '—',
      shape: item?.shape || '—',
      gender: item?.gender || '—',
      status: item?.status || 'Stock général',
      location_code: item?.location_code || item?.emplacement || '—',
      photo_monture_url: item?.photo_monture_url || item?.photo || item?.photo_url || '',
      photo: item?.photo_monture_url || item?.photo || item?.photo_url || '',
    }

    setSelectedStockPreview(preview)
  }

  // L'aperçu du stock général vient de /inventory/stock-summary, agrégé par référence —
  // sans emplacement. On le retrouve en croisant avec stockGlasses (montures individuelles,
  // déjà chargées). Une référence dont le seul exemplaire est ailleurs (présentoir, labo,
  // réserve, transit...) n'a ni stock général ni stock local : elle a quand même une
  // position réelle, qu'on affiche plutôt qu'un tiret qui la ferait passer pour introuvable.
  function getStockLocationLabel(item: any) {
    const refKey = String(item?.reference || item?.barcode || item?.code || '').trim()
    if (!refKey) return '—'

    const matches = (stockGlasses || []).filter((glass: any) =>
      normalizeReference(String(glass.reference || '')) === normalizeReference(refKey)
    )

    const labels = Array.from(new Set(
      matches
        // Réservée par une liste d'envoi pas encore dispatchée : son emplacement en rayon
        // n'a plus de sens à afficher, la monture est en train de partir. Sinon, un code
        // d'emplacement quand il y en a un (stock général/local, présentoir) ; à défaut le
        // statut lisible (Laboratoire, Réservé, Vendu, ...), pour ne jamais laisser une
        // monture qui existe bel et bien passer pour absente.
        .map((glass: any) => String(glass.status || '').trim().toUpperCase() === 'RESERVEE_ENVOI'
          ? `En transit vers Stock magasin${glass.reserved_for_city ? ` (${magasinLabel(glass.reserved_for_city)})` : ''}`
          : String(glass.location_code || '').trim() || mapGlassStatusToUI(glass.status))
        .filter(Boolean),
    ))

    if (labels.length === 0) return '—'
    if (labels.length === 1) return labels[0]
    return `${labels[0]} +${labels.length - 1}`
  }

  function renderStockPage() {
    // RESERVEE_ENVOI reste affichée ici (grisée, non sélectionnable) plutôt que masquée : une
    // monture déjà prise par une liste pas encore dispatchée doit rester visible pour qu'on ne
    // la croie pas disparue, sans pouvoir la remettre dans une deuxième liste en parallèle.
    const generalGlasses = (stockGlasses || []).filter((g: any) =>
      isGeneralStockStatus(g.status) || String(g.status || '').trim().toUpperCase() === 'RESERVEE_ENVOI')
    const magasinGlasses = (stockGlasses || []).filter((g: any) => isLocalStockStatus(g.status))

    const configuredMagasins = magasinOptions.map(option => String(option.city || '').trim()).filter(Boolean)
    // Les paniers sont indexés par VILLE côté serveur, alors que les montures portent un nom
    // de STATION. Sans cette normalisation, « Station Pointe-Noire » se retrouvait à côté de
    // « Pointe-Noire » : deux chips pour le même magasin, dont une qui affichait toujours 0
    // et ouvrait un panier vide, puisque aucune ville ne porte ce nom.
    const discoveredMagasins = magasinGlasses
      .map((g: any) => normalizeStationCityName({ name: String(g.station_name || ''), city: String(g.station_city || '') }))
      .filter(Boolean)
    // Les villes viennent de la table `villes`, pas d'un hardcode à 2 villes : le magasin
    // doit afficher l'intégralité du parc même quand un panier ou un stock local est vide.
    const magasins = Array.from(new Set([
      ...configuredMagasins,
      ...discoveredMagasins,
      ...Object.keys(basketCounts),
      // Les clés de restockByCity sont mises en minuscules pour servir de clé de lookup
      // (voir loadRestockSuggestions) : les réutiliser telles quelles dupliquait le chip
      // avec sa casse d'origine. La casse d'affichage vient de row.city, pas de la clé.
      ...Object.values(restockByCity).map(r => String(r.city || '').trim()).filter(Boolean),
    ])).sort((a, b) => a.localeCompare(b, 'fr'))

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
          ? `Panier — ${magasinLabel(selectedMagasin)}`
          : stockAction === 'ENVOI'
            ? `Envoyer le stock — ${magasinLabel(selectedMagasin)}`
            : magasinLabel(selectedMagasin),
        // Au moment de préparer un colis, le besoin de réapprovisionnement et les demandes
        // clients se répondent : combien envoyer, et quoi choisir en priorité.
        subtitle: stockAction === 'PANIER'
          ? restockSubtitle(selectedMagasin)
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

        {!selectedMagasin && renderGeneralStockTable(filteredGeneralGlasses, magasins)}
        {selectedMagasin && !stockAction && renderStockActionChooser(selectedMagasin)}
        {selectedMagasin && stockAction === 'PANIER' && renderBasketAnalysis(selectedMagasin, filteredGeneralGlasses)}
        {selectedMagasin && stockAction === 'ENVOI' && renderStockPreparation(selectedMagasin, filteredGeneralGlasses)}
      </div>
    )
  }

  function toggleStockSelection(barcode: string) {
    setStockListSelection(prev => prev.includes(barcode) ? prev.filter(b => b !== barcode) : [...prev, barcode])
  }

  // Compose une liste depuis le stock existant et l'adresse au Stock Général. La Direction
  // commande, elle n'expédie pas : c'est le magasinier qui scannera chaque monture en rayon
  // avant l'envoi réel.
  async function submitStockList(rows: any[]) {
    const token = window.localStorage.getItem('token')
    if (!token || !stockListCity || stockListSelection.length === 0) return

    const byBarcode = new Map(rows.map((g: any) => [String(g.barcode || ''), g]))
    const items = stockListSelection
      .map(barcode => byBarcode.get(barcode))
      .filter(Boolean)
      .map((glass: any) => ({
        glass_id: glass.id ?? null,
        barcode: glass.barcode || '',
        reference: glass.reference || '',
        brand: glass.brand || '',
        location_code: glass.location_code || '',
      }))
    if (items.length === 0) return

    setIsSendingStockList(true)
    try {
      const response = await fetch(`${API_URL}/inventory/send-lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        // Pas de session_code : c'est ce qui dit au serveur que la source est le stock
        // existant, et déclenche la vérification de disponibilité.
        body: JSON.stringify({ city: stockListCity, items }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload?.success === false) {
        const rejected = payload?.data?.rejected || {}
        const detail = Object.entries(rejected).map(([code, reason]) => `· ${code} — ${reason}`).join('\n')
        throw new Error([payload?.error || "Impossible d'enregistrer la liste.", detail].filter(Boolean).join('\n'))
      }

      const list = payload?.data?.list || {}
      const sent = Number(payload?.data?.sent || items.length)
      const rejected: Record<string, string> = payload?.data?.rejected || {}
      let message = `Liste ${list.session_code || ''} enregistrée : ${sent} monture${sent > 1 ? 's' : ''} à préparer par le Stock Général pour ${stockListCity}.`
      // Le lot n'est pas atomique : sans ce détail, la Direction croirait avoir envoyé
      // toute sa sélection alors que des montures ont été écartées.
      const rejectedEntries = Object.entries(rejected)
      if (rejectedEntries.length) {
        message += `\n\nÉcartées (${rejectedEntries.length}) :\n` + rejectedEntries.map(([code, reason]) => `· ${code} — ${reason}`).join('\n')
      }

      window.alert(message)

      setStockListSelection([])
      await loadStockGlasses()
      await loadSentLists()
    } catch (error: any) {
      window.alert(error?.message || "Impossible d'enregistrer la liste.")
    } finally {
      setIsSendingStockList(false)
    }
  }

  // Le panneau ouvert par une puce montre les deux signaux d'un coup : ce qu'il faut
  // renvoyer, et ce que les clients ont cherché sans le trouver.
  function restockSubtitle(city: string) {
    const restock = restockByCity[city.trim().toLowerCase()]
    const demands = 'Recherches client enregistrées par le chatbot pour ce magasin.'
    if (!restock) return `Aucun carton encore livré à ce magasin. ${demands}`
    const need = restock.to_send > 0
      ? `${restock.to_send.toLocaleString('fr-FR')} monture${restock.to_send > 1 ? 's' : ''} à renvoyer`
      : 'Stock au niveau de la dernière livraison'
    return `${need} — ${restock.current_stock} en stock sur ${restock.last_box_qty} au dernier carton. ${demands}`
  }

  function renderBasketRow(magasins: string[], selectedMagasin: string) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Réapprovisionnement</span>
        {magasins.map(magasin => {
          // Le chiffre est une quantité à préparer, plafonnée au dernier carton reçu. Une
          // ville jamais livrée n'a pas de suggestion : rien à afficher, et surtout pas
          // d'alerte sur un magasin qui n'a encore rien reçu.
          const restock = restockByCity[magasin.trim().toLowerCase()]
          const toSend = restock?.to_send || 0
          const isAlert = Boolean(restock?.alert)
          const demands = basketCounts[magasin] || 0
          const isActive = magasin === selectedMagasin && stockAction === 'PANIER'
          const hint = restock
            ? `${restock.current_stock} en stock sur ${restock.last_box_qty} livrées au dernier carton${demands ? ` · ${demands} demande${demands > 1 ? 's' : ''} client` : ''}`
            : 'Aucun carton encore livré à ce magasin'
          return (
            <button
              key={`basket-${magasin}`}
              onClick={() => openBasket(magasin)}
              title={hint}
              className={`flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition-colors ${isActive
                ? 'border-blue-500 bg-blue-600 text-white'
                : isAlert
                  ? 'border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 dark:hover:bg-slate-800'}`}
            >
              {ic.cart('w-4 h-4')}
              {magasinLabel(magasin)}
              <span className={`min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-xs font-bold tabular-nums ${isAlert
                ? 'bg-amber-500 text-white'
                : isActive ? 'bg-blue-500 text-blue-100' : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'}`}>
                {toSend}
              </span>
            </button>
          )
        })}
      </div>
    )
  }

  function renderGeneralStockTable(generalGlasses: any[], magasins: string[]) {
    const totalPages = Math.max(1, Math.ceil(generalGlasses.length / STOCK_PAGE_SIZE))
    // Page bornée à l'affichage : si un filtre réduit la liste entre deux rendus, on retombe
    // sur la dernière page existante au lieu d'afficher une tranche vide.
    const currentPage = Math.min(stockPage, totalPages)
    const start = (currentPage - 1) * STOCK_PAGE_SIZE
    const pageRows = generalGlasses.slice(start, start + STOCK_PAGE_SIZE)

    // RESERVEE_ENVOI : déjà prise par une autre liste pas encore dispatchée, on ne la propose
    // plus à la sélection — la re-sélectionner créerait deux listes concurrentes sur la même
    // monture. « Tout sélectionner » ne porte donc que sur les montures encore libres.
    const isReservedForShipment = (g: any) => String(g.status || '').trim().toUpperCase() === 'RESERVEE_ENVOI'
    const selectableGlasses = generalGlasses.filter((g: any) => !isReservedForShipment(g))
    const allSelected = selectableGlasses.length > 0 && selectableGlasses.every((g: any) => stockListSelection.includes(String(g.barcode || '')))

    return (
      <div className="space-y-3">
        {selectedStockPreview && (
          <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelectedStockPreview(null)}>
            <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Aperçu</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{selectedStockPreview.reference || selectedStockPreview.barcode || 'Monture'}</p>
                </div>
                <button onClick={() => setSelectedStockPreview(null)} className="text-slate-400 hover:text-slate-600">{ic.x()}</button>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[140px_1fr]">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                  {selectedStockPreview.photo_monture_url ? (
                    <img src={selectedStockPreview.photo_monture_url} alt={selectedStockPreview.reference || selectedStockPreview.barcode || 'Monture'} className="h-32 w-full object-cover" />
                  ) : (
                    <div className="flex h-32 items-center justify-center text-xs text-slate-500 dark:text-slate-400">Pas de photo</div>
                  )}
                </div>

                <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Marque</span><span className="mt-1 block font-semibold">{selectedStockPreview.brand || selectedStockPreview.marque || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Forme</span><span className="mt-1 block font-semibold">{selectedStockPreview.shape || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Genre</span><span className="mt-1 block font-semibold">{selectedStockPreview.gender || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Statut</span><span className="mt-1 block font-semibold">{selectedStockPreview.status || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60 sm:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Emplacement</span><span className="mt-1 block font-mono text-xs">{selectedStockPreview.location_code || selectedStockPreview.station_name || '—'}</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* Composer une liste depuis le stock existant. La Direction commande, le Stock Général
          prépare et expédie — ce bouton n'envoie aucune monture, il crée l'ordre. */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/60">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
          {stockListSelection.length > 0
            ? `${stockListSelection.length} monture${stockListSelection.length > 1 ? 's' : ''} sélectionnée${stockListSelection.length > 1 ? 's' : ''}`
            : 'Cochez les montures à envoyer'}
        </span>
        <select
          value={stockListCity}
          onChange={e => setStockListCity(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          <option value="">Destination…</option>
          {magasins.map(city => <option key={`dest-${city}`} value={city}>{magasinLabel(city)}</option>)}
        </select>
        <button
          onClick={() => submitStockList(generalGlasses)}
          disabled={isSendingStockList || !stockListCity || stockListSelection.length === 0}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSendingStockList ? 'Enregistrement…' : 'Envoyer au Stock Général'}
        </button>
        {stockListSelection.length > 0 && (
          <button
            onClick={() => setStockListSelection([])}
            className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Tout décocher
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-green-200 dark:border-green-700">
        <div className="min-w-[760px]">
          <table className="w-full min-w-full divide-y divide-green-200 dark:divide-green-700 text-xs sm:text-sm">
            <thead className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-200">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">
                  {/* Porte sur tout le résultat filtré, pas seulement la page affichée :
                      cocher page par page pour un envoi de 40 montures serait absurde. */}
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setStockListSelection(allSelected ? [] : selectableGlasses.map((g: any) => String(g.barcode || '')).filter(Boolean))}
                    title="Tout sélectionner"
                    className="h-4 w-4 cursor-pointer accent-blue-600"
                  />
                </th>
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
                <tr><td colSpan={9} className="px-3 py-6 text-center text-green-700">Chargement...</td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-green-700">Aucune lunette trouvée.</td></tr>
              ) : (
                pageRows.map((g: any, idx: number) => {
                  const reserved = isReservedForShipment(g)
                  return (
                  <tr
                    key={`stock-${g.id || idx}`}
                    onClick={() => setSelectedStockPreview(g)}
                    title={reserved ? 'Déjà réservée par une liste d\'envoi pas encore expédiée' : undefined}
                    className={`cursor-pointer transition-colors ${reserved
                      ? 'opacity-50'
                      : stockListSelection.includes(String(g.barcode || ''))
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    <td className="px-2 py-2" onClick={event => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={stockListSelection.includes(String(g.barcode || ''))}
                        onChange={() => toggleStockSelection(String(g.barcode || ''))}
                        disabled={reserved}
                        className="h-4 w-4 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
                      />
                    </td>
                    <td className="px-2 py-2" onClick={event => event.stopPropagation()}>
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
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                      {reserved
                        ? `En transit vers Stock magasin${g.reserved_for_city ? ` (${magasinLabel(g.reserved_for_city)})` : ''}`
                        : (g.location_code || g.station_name || '—')}
                    </td>
                  </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Masquée tant qu'une seule page suffit : une barre « Page 1 / 1 » n'apprend rien. */}
      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
            {(start + 1).toLocaleString('fr-FR')}–{Math.min(start + STOCK_PAGE_SIZE, generalGlasses.length).toLocaleString('fr-FR')} sur {generalGlasses.length.toLocaleString('fr-FR')}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setStockPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Précédent
            </button>
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 tabular-nums">
              Page {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setStockPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Suivant
            </button>
          </div>
        </div>
      )}
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
        activatedAt: command.activated_at || null,
        compareText: `Commande ${supplier} · ${targetCount} monture(s)`,
      }
      setReceptionSession(newCommand)
      setIsLabelSentToStock(true)
      setReceptionCommands(prev => [...prev.filter(cmd => cmd.orderId !== orderId), newCommand])
      setShowReceptionSessionCard(true)
    } catch {
      window.alert('Impossible de générer la session de réception pour le moment.')
    } finally {
      setIsCreatingReceptionSession(false)
    }
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
    // Révocation différée : révoquer dans la foulée annule le téléchargement en cours.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  async function svgToPngDataUrl(svg: SVGSVGElement) {
    // On sérialise une copie : le xmlns et les dimensions doivent être portés par la balise
    // elle-même pour qu'une <img> sache la lire, et on ne va pas trafiquer le SVG affiché.
    const clone = svg.cloneNode(true) as SVGSVGElement
    const rect = svg.getBoundingClientRect()
    // JsBarcode pose width/height en attributs : c'est la taille intrinsèque du code-barres,
    // bien plus fiable que la taille écran, que Tailwind étire avec w-full.
    const width = Number(svg.getAttribute('width')) || Math.round(rect.width) || 320
    const height = Number(svg.getAttribute('height')) || Math.round(rect.height) || 120

    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(width))
    clone.setAttribute('height', String(height))
    // Les classes Tailwind ne veulent rien dire hors du document : sans feuille de style,
    // elles n'alourdissent que la chaîne sérialisée.
    clone.removeAttribute('class')

    const svgString = new XMLSerializer().serializeToString(clone)
    // data: plutôt que blob: — une <img> qui charge un blob: déclenche selon les navigateurs
    // un contrôle d'origine qui échoue, et l'image n'arrive jamais.
    const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("Le code-barres n'a pas pu être converti en image."))
      img.src = source
    })

    // Rendu à deux fois la taille : une étiquette part à l'imprimante, elle doit rester nette.
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas non supporté par ce navigateur.')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png')
  }

  async function downloadBarcodeImage() {
    if (!barcodeRef.current || !receptionSession) return
    const dataUrl = await svgToPngDataUrl(barcodeRef.current)
    await downloadDataUrl(dataUrl, `session-${receptionSession.code}.png`)
  }

  async function downloadAndPrintBarcode() {
    if (!barcodeRef.current || !receptionSession) return

    // La fenêtre s'ouvre avant tout await : passé un point d'attente, le navigateur ne
    // rattache plus l'ouverture au clic et la bloque comme une popup non sollicitée.
    const popup = window.open('', '_blank', 'width=600,height=700')

    try {
      const dataUrl = await svgToPngDataUrl(barcodeRef.current)
      await downloadDataUrl(dataUrl, `session-${receptionSession.code}.png`)

      if (!popup) {
        window.alert("Étiquette téléchargée. Autorisez les fenêtres surgissantes pour lancer l'impression.")
        return
      }
      popup.document.write(`<html><head><title>Imprimer session ${receptionSession.code}</title><style>body{margin:0;padding:20px;font-family:Arial,Helvetica,sans-serif;text-align:center;}img{max-width:100%;height:auto;}</style></head><body><h2>${receptionSession.code}</h2><img src="${dataUrl}" alt="Code-barres" /><script>window.onload=function(){window.print();};</script></body></html>`)
      popup.document.close()
      popup.focus()
    } catch (error: any) {
      // Sans ce message, un échec de conversion laissait le bouton parfaitement muet : la
      // fonction est async et posée telle quelle sur onClick, donc son rejet partait nulle part.
      popup?.close()
      console.error('Erreur préparation étiquette', error)
      window.alert(error?.message || "Impossible de préparer l'étiquette.")
    }
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
    void loadRestockSuggestions()

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

  // Changer un filtre ou de magasin remet en première page : rester en page 3 d'une liste
  // qui vient d'être réduite donnerait un tableau vide sans explication.
  useEffect(() => {
    setStockPage(1)
  }, [stockRayonFilter, stockEtagereFilter, stockBacFilter, stockScope])

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
        emplacement: String(glass.location_code || '—'),
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
      emplacement: '—',
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
              const csv = ['Référence;Photo;Gamme;Genre;Enregistré par;Heure;Forme;Emplacement;Quantité;Date;Statut', ...filteredRows.map(row => [row.reference, row.photo, row.gamme, row.genre, row.enregistréPar, row.heure, row.forme, row.emplacement, row.quantity, row.date, row.status].join(';'))].join('\r\n')
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
                    <th className="px-2 py-2 text-left font-semibold">Emplacement</th>
                    <th className="px-2 py-2 text-left font-semibold">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                  {filteredRows.map((row, idx) => (
                    <tr key={`${detailSession.id}-${idx}`} onClick={() => setDetailRowPreview(row)} role="button" className="hover:bg-green-50/50 dark:hover:bg-green-900/10 transition-colors cursor-pointer">
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
                      <td className="px-2 py-2 font-mono text-xs text-slate-700 dark:text-slate-200">{row.emplacement}</td>
                      <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{row.date}</td>
                    </tr>
                  ))}
                  {filteredRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">Aucune monture n&apos;est associée à cette session pour le moment.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          {detailRowPreview && (
            <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetailRowPreview(null)}>
              <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 p-4 shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between">
                  <h4 className="text-lg font-bold text-slate-900 dark:text-white">Aperçu — {detailRowPreview.reference}</h4>
                  <button onClick={() => setDetailRowPreview(null)} className="text-slate-400 hover:text-slate-600">{ic.x()}</button>
                </div>
                <div className="mt-4 flex gap-4">
                  <div className="w-1/3">
                    {detailRowPreview.photo && detailRowPreview.photo.startsWith('http') ? (
                      <img src={detailRowPreview.photo} alt={detailRowPreview.reference} className="w-full rounded-md object-cover" />
                    ) : (
                      <div className="h-36 w-full rounded-md bg-slate-100 flex items-center justify-center text-slate-500">No image</div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold">Gamme:</span> {detailRowPreview.gamme}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold">Genre:</span> {detailRowPreview.genre}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold">Forme:</span> {detailRowPreview.forme}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold">Emplacement:</span> {detailRowPreview.emplacement}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold">Enregistré par:</span> {detailRowPreview.enregistréPar}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200"><span className="font-semibold">Heure:</span> {detailRowPreview.heure}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-200 mt-2"><span className="font-semibold">Statut:</span> {detailRowPreview.status}</p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Le stock occupe toute la page : il remplace la liste des sessions au lieu de s'y superposer.
  if (showStockPage) return renderStockPage()

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-2 min-w-0">
          {showHistoryPage && (
            <button
              onClick={() => { setShowHistoryPage(false); setShowCountriesView(false) }}
              className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              {ic.back('w-4 h-4')} Retour
            </button>
          )}
          <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">
            {showHistoryPage ? 'Historique des sessions de réception' : 'Expédition'}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!showHistoryPage && (
            <button onClick={() => setShowHistoryPage(true)} className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors active:scale-95 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
              {ic.hist('w-4 h-4')} Historique
              {sessions.length > 0 && (
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  {sessions.length}
                </span>
              )}
            </button>
          )}
          <button onClick={() => { setShowStockPage(true); void loadStockGlasses() }} className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 text-slate-800 rounded-xl text-sm font-semibold hover:bg-slate-200 transition-colors active:scale-95 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700">
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
                <div className="mt-3 rounded-full bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                  {isLabelSentToStock ? 'En transit vers le stock général' : '● En attente'}
                </div>
                {receptionSession.compareText && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{receptionSession.compareText}</p>}
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { void downloadAndPrintBarcode(); setIsLabelSentToStock(true) }} className="rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                    Imprimer et télécharger
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}
      {/* Écran d'accueil de l'Expédition : ce qu'on vient y faire, pas ce qu'on y a fait.
          Sans ça la page serait vide tant qu'aucune session n'est en cours. */}
      {!showHistoryPage && !receptionSession && (
        <div className="space-y-4">
          {selectedStockPreview && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Aperçu</p>
                  <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{selectedStockPreview.reference || selectedStockPreview.barcode || 'Monture'}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStockPreview(null)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  Fermer
                </button>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-[140px_1fr]">
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                  {selectedStockPreview.photo_monture_url ? (
                    <img src={selectedStockPreview.photo_monture_url} alt={selectedStockPreview.reference || selectedStockPreview.barcode || 'Monture'} className="h-32 w-full object-cover" />
                  ) : (
                    <div className="flex h-32 items-center justify-center text-xs text-slate-500 dark:text-slate-400">Pas de photo</div>
                  )}
                </div>

                <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Marque</span><span className="mt-1 block font-semibold">{selectedStockPreview.brand || selectedStockPreview.marque || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Forme</span><span className="mt-1 block font-semibold">{selectedStockPreview.shape || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Genre</span><span className="mt-1 block font-semibold">{selectedStockPreview.gender || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Statut</span><span className="mt-1 block font-semibold">{selectedStockPreview.status || '—'}</span></div>
                  <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60 sm:col-span-2"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Emplacement</span><span className="mt-1 block font-mono text-xs">{selectedStockPreview.location_code || selectedStockPreview.station_name || '—'}</span></div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Aperçu du stock général</p>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Vue rapide des références encore présentes dans l’entrepôt central.
                </p>
              </div>
              <button
                onClick={() => { setShowStockPage(true); void loadStockGlasses() }}
                className="rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                Voir le stock
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="overflow-x-auto rounded-2xl border border-emerald-200 dark:border-emerald-700">
                <div className="min-w-[620px]">
                  <table className="w-full min-w-full divide-y divide-emerald-200 dark:divide-emerald-700 text-xs sm:text-sm">
                    <thead className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-200">
                      <tr>
                        <th className="px-3 py-2.5 text-left font-semibold">Référence</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Total</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Stock général</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Stock local</th>
                        <th className="px-3 py-2.5 text-left font-semibold">Emplacement</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-emerald-100 bg-white dark:divide-emerald-800 dark:bg-slate-900">
                      {isLoadingStockSummary ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-emerald-700 dark:text-emerald-300">Chargement…</td></tr>
                      ) : stockSummary.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-4 text-center text-emerald-700 dark:text-emerald-300">Aucune donnée disponible pour le moment.</td></tr>
                      ) : (
                        stockSummary.slice(0, 5).map((item: any, index: number) => (
                          <tr
                            key={`${item.reference || 'ref'}-${index}`}
                            onClick={() => openStockSummaryPreview(item)}
                            className="cursor-pointer transition-colors hover:bg-emerald-50/70 dark:hover:bg-emerald-900/10"
                          >
                            <td className="px-3 py-2.5 font-medium text-slate-900 dark:text-white">{item.reference || '—'}</td>
                            <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{Number(item.qty_total || 0).toLocaleString('fr-FR')}</td>
                            <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{Number(item.qty_general || 0).toLocaleString('fr-FR')}</td>
                            <td className="px-3 py-2.5 text-slate-700 dark:text-slate-300">{Number(item.qty_local || 0).toLocaleString('fr-FR')}</td>
                            <td className="px-3 py-2.5 font-mono text-xs text-slate-700 dark:text-slate-300">{getStockLocationLabel(item)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {Object.entries(restockByCity).length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-4 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400">
                    Aucune ville avec réapprovisionnement pour le moment.
                  </div>
                ) : (
                  Object.entries(restockByCity)
                    .map(([cityKey, suggestion]) => {
                      const cityName = suggestion.city || cityKey
                      const toSend = Number(suggestion.to_send || 0)
                      const createdAt = suggestion.last_box_at ? new Date(suggestion.last_box_at) : null
                      const createdLabel = createdAt && !Number.isNaN(createdAt.getTime())
                        ? createdAt.toLocaleDateString('fr-FR')
                        : '—'
                      return (
                        <div key={cityKey} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900 dark:text-white">{cityName}</p>
                              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Réapprovisionnement</p>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${toSend > 0 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'}`}>
                              {toSend > 0 ? `${toSend} à envoyer` : 'À jour'}
                            </span>
                          </div>
                          <div className="mt-4 grid gap-2 text-sm text-slate-600 dark:text-slate-300">
                            <div className="flex items-center justify-between">
                              <span>Dernier carton</span>
                              <span className="font-semibold">{Number(suggestion.last_box_qty || 0).toLocaleString('fr-FR')}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Stock actuel</span>
                              <span className="font-semibold">{Number(suggestion.current_stock || 0).toLocaleString('fr-FR')}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span>Création</span>
                              <span className="font-semibold">{createdLabel}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 p-6 text-center dark:border-slate-700 dark:bg-slate-800/70">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Aucune session en cours</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Créez une expédition avec « Nouvelle », ou consultez les sessions déjà enregistrées.
            </p>
            <button
              onClick={() => setShowHistoryPage(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-sm font-semibold text-slate-800 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {ic.hist('w-4 h-4')} Voir l&apos;historique
            </button>
          </div>
        </div>
      )}

      {showHistoryPage && (showCountriesView ? (
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
        // "Reçu" se coche au scan du code-barres de session par le magasinier.
        // Le repli sur receivedCount couvre les sessions entamées avant que le
        // serveur n'horodate l'activation.
        const isSessionActivated = isSessionReceived(linkedCommand, receivedCount)
        const totalCount = Number(s.frames || 0)
        const alreadySent = (sentListSessions[s.id] || []).length > 0
        // Villes dont la liste a été réellement expédiée par le magasinier (statut TRAITEE
        // côté serveur, cf. loadSentLists) — distinct d'une liste juste préparée par la
        // Direction et pas encore traitée côté « Listes reçues » (scan.tsx).
        const dispatchedCities = (sentListSessions[s.id] || []).filter(entry => entry.dispatched).map(entry => entry.city)
        const receptionState = getReceptionCardState(linkedCommand, receivedCount, totalCount)
        const cardBgClass = getReceptionCardClass(receptionState)
        // Abandonné : un signal « monture absente du stock général » basé sur
        // reception_command_id existait ici, mais un échec silencieux côté serveur (lien
        // jamais posé sur le glass, cf. resolveReceptionCommandID dans reception_workflow.go)
        // le déclenchait à tort sur des montures pourtant toujours en stock général. Plutôt
        // que d'afficher une supposition non fiable, on se contente du fait vérifié : la
        // session a atteint son quota d'enregistrement.
        return (
          <div key={s.id} className={`${cardBgClass} rounded-2xl border p-4 transition-all ${receptionState === 'idle' ? 'hover:border-slate-500 dark:hover:border-slate-600 hover:shadow-sm' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2"><span className="font-bold text-slate-900 dark:text-white text-sm">{s.id}</span><Badge status={s.status} /></div>
                <p className="text-xs text-slate-400 mt-1">{s.date} à {s.time}</p>
                <div className="mt-2 inline-flex max-w-full items-center rounded-lg border border-blue-100 bg-blue-50/80 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:border-blue-800/60 dark:bg-blue-900/20 dark:text-blue-300">
                  <span className="truncate">{formatReceptionNote(s.note, s.operator)}</span>
                </div>
                {(receptionState === 'complete' || (isSessionActivated && !alreadySent)) && (
                  <div className={`mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold ${receptionState === 'complete'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-300'}`}>
                    {receptionState === 'complete' ? ic.check('w-3.5 h-3.5') : ic.truck('w-3.5 h-3.5')}
                    <span>{receptionState === 'complete'
                      ? (dispatchedCities.length > 0 ? `En transit vers le stock magasin (${dispatchedCities.join(', ')})` : 'Enregistrement terminé')
                      : (receptionState === 'recording' ? 'En cours d\'enregistrement' : 'En transit vers le stock Général')}</span>
                  </div>
                )}
                {/* Destination(s) de la session, une fois sa liste envoyée. Plusieurs villes
                    possibles : la liste se compose par lots et peut partir en plusieurs fois.
                    Le camion marque celles réellement expédiées par le magasinier (statut
                    TRAITEE côté serveur, cf. loadSentLists) ; la boutique, celles juste
                    préparées et pas encore traitées côté « Listes reçues » (scan.tsx). */}
                {(sentListSessions[s.id] || []).length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Destination</span>
                    {sentListSessions[s.id].map(entry => (
                      <span key={entry.city} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300">
                        {entry.dispatched ? ic.truck('w-3.5 h-3.5') : ic.store('w-3.5 h-3.5')} {entry.city}
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
                      Seule une liste réellement déjà envoyée (alreadySent) grise le bouton. */}
                  {receptionState === 'complete' && (() => {
                    const isLocked = alreadySent
                    return (
                      <button
                        type="button"
                        onClick={() => void openSendList(s)}
                        disabled={isLocked}
                        title={alreadySent ? 'La liste de cette session a déjà été envoyée au stock général' : undefined}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${isLocked
                          ? 'cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                          : 'bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95'}`}
                      >
                        {isLocked ? ic.check('w-3.5 h-3.5') : ic.send('w-3.5 h-3.5')}
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
                    <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" checked={isSessionActivated} readOnly />
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
      }))}

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
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Enregistrez ici chaque commande envoyée au stock.</p>
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
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Note (optionnel)</label>
                  <input value={supplierForm.note} onChange={e => setSupplierForm(f => ({ ...f, note: e.target.value }))} placeholder="Référence, transporteur..." className="mt-1 w-full px-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="submit" disabled={isSavingSupplier} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-60">{isSavingSupplier ? 'Enregistrement...' : 'Envoyer la commande'}</button>
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

    const load = () => {
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
    }

    load()

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 15000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
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
// Les postes de terrain seulement. Direction et Administrateur ne se créent pas ici :
// ce formulaire sert à ouvrir un poste en magasin.
// ids 9 et 10 : fixés par les migrations 025_caisse et 028_sav (7 = DIRECTION,
// 8 = SUPER_DIRECTEUR).
const ROLE_OPTIONS = [
  { id: 9, label: 'Caissier', value: 'CAISSIER' },
  { id: 4, label: 'Vendeur(se)', value: 'VENDEUR' },
  { id: 5, label: 'Laboratoire', value: 'LABORATOIRE' },
  { id: 10, label: 'SAV', value: 'SAV' },
  { id: 6, label: 'Responsable Magasin', value: 'RESPONSABLE_STATION' },
  { id: 3, label: 'Magasinier', value: 'MAGASINIER' },
]

interface StationRow { id: number; name: string; type: string; city: string }

/** Le poste où travaille l'employé. Il n'est pas stocké tel quel : c'est la station
 *  correspondante qui part dans users.station_id, parce que c'est elle qui cadre les
 *  requêtes de chaque écran (`glasses?station_id=…`) et que labo.tsx l'envoie avec sa
 *  livraison. Un poste sans station laisse le champ vide. */
const POSTE_OPTIONS: Array<{
  id: string
  label: string
  /** Station reconnue par son nom. */
  stationName?: string
  /** Station reconnue par son type plutôt que par son nom. */
  stationType?: string
  /** Le magasin de la ville choisie dans le formulaire. */
  cityStore?: boolean
}> = [
  { id: 'caisse', label: 'Caisse', stationName: 'Caisse' },
  { id: 'vendeur', label: 'Vendeur', stationName: 'Présentoir' },
  { id: 'labo', label: 'Laboratoire', stationName: 'Laboratoire' },
  // Le SAV suit des clients, il ne détient aucune monture : pas de station.
  { id: 'sav', label: 'SAV' },
  { id: 'responsable', label: 'Responsable Magasin', cityStore: true },
  { id: 'magasinier', label: 'Magasinier', stationType: 'STOCK_GENERAL' },
]

function foldAccents(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
}

function resolveStationId(posteId: string, stations: StationRow[], city: string): number | null {
  const poste = POSTE_OPTIONS.find(p => p.id === posteId)
  if (!poste) return null

  if (poste.stationType) {
    // Aucune station de type STOCK_GENERAL n'est semée par les migrations : on retombe
    // sur son nom, celui que stationDisplayLabel() sait déjà reconnaître.
    return stations.find(s => s.type === poste.stationType)?.id
      ?? stations.find(s => /^stock\s+(principal|g[ée]n[ée]ral)$/i.test(s.name.trim()))?.id
      ?? null
  }
  if (poste.cityStore) {
    return stations.find(s => foldAccents(s.city) === foldAccents(city) && /^station\s/i.test(s.name))?.id ?? null
  }
  if (!poste.stationName) return null

  // Une station homonyme dans la ville choisie l'emporte : le jour où chaque ville aura
  // sa Caisse et son Laboratoire, on ne veut pas rattacher l'employé à celle d'à côté.
  const wanted = foldAccents(poste.stationName)
  return stations.find(s => foldAccents(s.name) === wanted && foldAccents(s.city) === foldAccents(city))?.id
    ?? stations.find(s => foldAccents(s.name) === wanted)?.id
    ?? null
}

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
  // type et city servent à retrouver la station d'un poste (cf. resolveStationId).
  const [stations, setStations] = useState<StationRow[]>([])
  const [cities, setCities] = useState<Array<{ id: number; name: string }>>([])
  const [showAddEmployee, setShowAddEmployee] = useState(false)
  const [employeeForm, setEmployeeForm] = useState({
    fullName: '',
    gender: '',
    phone: '',
    email: '',
    city: '',
    roleId: '',
    posteId: '',
  })
  const [isSavingEmployee, setIsSavingEmployee] = useState(false)
  const [employeeFormError, setEmployeeFormError] = useState('')
  const groups = ['Station Générale', 'Sous-stations', 'Laboratoire']
  // Même principe que les étapes : les cartes restent affichées, seule la liste change.
  const [selectedGroup, setSelectedGroup] = useState<string>(groups[0])

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return

    // silent : les rafraîchissements périodiques ne doivent pas réafficher le squelette de
    // chargement, seul le premier montage le fait.
    const load = (silent: boolean) => {
      if (!silent) setIsLoading(true)
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

          setStations(stations.map((station: any) => ({
            id: Number(station.id) || 0,
            name: String(station.name || 'Non assigné'),
            type: String(station.type || ''),
            city: String(station.city || ''),
          })))
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
    }

    load(false)

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true)
    }, 15000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') load(true)
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
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
          // Le poste choisi n'est pas stocké tel quel : c'est sa station qui compte,
          // parce que c'est elle que les écrans de poste relisent dans user.station_id.
          station_id: employeeForm.posteId ? resolveStationId(employeeForm.posteId, stations, employeeForm.city) : null,
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
      setEmployeeForm({ fullName: '', gender: '', phone: '', email: '', city: '', roleId: '', posteId: '' })
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
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">Poste</label>
                  <select value={employeeForm.posteId} onChange={e => setEmployeeForm(f => ({ ...f, posteId: e.target.value }))} className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    <option value="">Sélectionner</option>
                    {POSTE_OPTIONS.map(poste => (
                      <option key={poste.id} value={poste.id}>{poste.label}</option>
                    ))}
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
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{ROLE_LABEL[emp.role] || emp.role} · {stationDisplayLabel(emp.station)}</p>
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

// La réponse de l'IA arrive en markdown (gras, listes, titres...), pensé pour l'affichage.
// Lu tel quel par SpeechSynthesisUtterance, le synthétiseur prononce les délimiteurs
// ("astérisque astérisque") au lieu de les traiter comme une mise en forme muette.
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
      get('/inventory/glasses', 'glasses'),
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
      case 'stock-general': return 'stock-general'
      case 'critical-references': return 'critical-references'
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
        const u = new SpeechSynthesisUtterance(sanitizeForSpeech(reply))
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
          {ic.signOut('w-4 h-4')}
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
// Dérivée de SIDEBAR_MODULES plutôt qu'une liste à part : un module ajouté à la barre
// latérale l'était jusqu'ici invisible en mobile (c'est ce qui a manqué « Présentoir par
// bloc » — visible sur desktop, absent d'ici), une seule liste tenue à jour empêche l'écart
// de revenir au prochain module ajouté.
function MobileNav({ currentScreen, onNavigate }: { currentScreen: NavScreen; onNavigate: (s: NavScreen) => void }) {
  const isDash = ['dashboard', 'pays', 'city', 'frame'].includes(currentScreen.type)

  const tabs: { label: string; icon: (c?: string) => React.ReactElement; active: boolean; nav: NavScreen }[] = [
    { label: 'Tableau de bord', icon: ic.home, active: isDash, nav: { type: 'dashboard' } },
    ...SIDEBAR_MODULES.map(mod => ({
      label: mod.short,
      icon: mod.icon,
      active: currentScreen.type === 'module' && (currentScreen as any).id === mod.id,
      nav: { type: 'module', id: mod.id } as NavScreen,
    })),
  ]

  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40 overflow-x-auto">
      <div className="flex min-w-max">
        {tabs.map(tab => (
          <button key={tab.label} onClick={() => onNavigate(tab.nav)}
            className={`flex-1 min-w-[68px] flex flex-col items-center py-3 gap-1 transition-colors ${tab.active ? 'text-blue-600' : 'text-slate-400'}`}
          >
            {tab.icon('w-5 h-5')}
            <span className="text-[10px] font-semibold leading-none whitespace-nowrap">{tab.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

// ── TopBar ────────────────────────────────────────────────────────────────────
function TopBar({ navStack, onBack, dark, onToggleDark, onOpenChat, onLogout }: {
  navStack: NavScreen[]; onBack: () => void
  dark: boolean; onToggleDark: () => void; onOpenChat: () => void; onLogout: () => void
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
    if (s.type === 'stock-general') return 'Stock général'
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
        {/* Thème et déconnexion vivent dans la barre latérale ; sur mobile elle n'existe
            pas, ils remontent donc ici (même geste que scan.tsx). */}
        <button onClick={onToggleDark} className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors">
          {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
        </button>
        <button onClick={onLogout} className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors" aria-label="Se déconnecter">
          {ic.signOut('w-4 h-4')}
        </button>
      </div>
    </header>
  )
}

// ── Module router ─────────────────────────────────────────────────────────────
// ── Sociétés conventionnées ───────────────────────────────────────────────────
/** La liste que le champ « Société » d'une proforma vient lire. Elle est fermée côté
 *  magasin — la vendeuse choisit, elle ne saisit plus — donc elle se tient ici.
 *
 *  Une société ne se supprime pas, elle se désactive : elle sort de la liste proposée mais
 *  reste attachée aux proformas qu'elle a déjà portées. */
interface SocieteRow {
  id: number
  name: string
  contact?: string
  phone?: string
  active: boolean
}

function SocietesView() {
  const [societes, setSocietes] = useState<SocieteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')

  const headers = () => ({
    Authorization: `Bearer ${window.localStorage.getItem('token') || ''}`,
    'Content-Type': 'application/json',
  })

  // silent : les rafraîchissements périodiques ne doivent pas réafficher le squelette de
  // chargement, seul le premier montage (et les actions de l'utilisateur) le font.
  async function load(silent = false) {
    if (!silent) setLoading(true)
    try {
      // include_inactive : l'écran de gestion doit voir les conventions terminées, sans quoi
      // il serait impossible d'en réactiver une.
      const response = await fetch(`${API_URL}/inventory/societes?include_inactive=true`, { headers: headers() })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || payload?.message || `Erreur ${response.status}`)
      setSocietes(payload?.data?.societes || [])
      setError('')
    } catch (e: any) {
      setError(e?.message || 'Liste des sociétés indisponible.')
      setSocietes([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()

    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true)
    }, 15000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void load(true)
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setFlash('')
    try {
      const response = await fetch(`${API_URL}/inventory/societes`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ name: name.trim(), contact: contact.trim(), phone: phone.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      // Le serveur nomme le doublon d'orthographe (« une société porte déjà ce nom ») :
      // son message vaut mieux qu'un « erreur » générique, c'est le cas d'échec courant.
      if (!response.ok) throw new Error(payload?.error || payload?.message || `Erreur ${response.status}`)
      setName(''); setContact(''); setPhone('')
      setFlash(`${payload?.data?.societe?.name || name.trim()} ajoutée.`)
      setError('')
      await load()
    } catch (e: any) {
      setError(e?.message || "Impossible d'ajouter la société.")
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(societe: SocieteRow) {
    setBusy(true)
    setFlash('')
    try {
      const response = await fetch(`${API_URL}/inventory/societes/${societe.id}`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ active: !societe.active }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload?.error || payload?.message || `Erreur ${response.status}`)
      setFlash(`${societe.name} ${societe.active ? 'désactivée' : 'réactivée'}.`)
      setError('')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Modification impossible.')
    } finally {
      setBusy(false)
    }
  }

  const actives = societes.filter(s => s.active).length

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-400">
          {error}
        </div>
      )}
      {flash && (
        <div className="rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-2.5 text-xs text-green-800 dark:text-green-400">
          {flash}
        </div>
      )}

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Nouvelle société</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
          Elle apparaîtra aussitôt dans le champ « Société » du poste Vendeuse.
        </p>
        <form onSubmit={create} className="mt-3 grid grid-cols-1 sm:grid-cols-4 gap-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nom de la société *"
            className="sm:col-span-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
          />
          <input
            value={contact}
            onChange={e => setContact(e.target.value)}
            placeholder="Interlocuteur"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
          />
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="Téléphone"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="sm:col-span-4 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-all active:scale-95 disabled:opacity-60"
          >
            {busy ? 'Enregistrement…' : 'Ajouter la société'}
          </button>
        </form>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
          <p className="text-sm font-bold text-slate-900 dark:text-white">Sociétés</p>
          <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums">
            {actives} active{actives > 1 ? 's' : ''} sur {societes.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-700">
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Nom</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Interlocuteur</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">Téléphone</th>
                <th className="text-left py-2 px-3 text-xs font-semibold text-slate-400">État</th>
                <th className="text-right py-2 px-3 text-xs font-semibold text-slate-400">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">Chargement…</td></tr>
              ) : societes.length === 0 ? (
                <tr><td colSpan={5} className="py-10 text-center text-sm text-slate-400">Aucune société enregistrée.</td></tr>
              ) : societes.map(societe => (
                <tr key={societe.id} className="border-b border-slate-50 dark:border-slate-700/60 last:border-0">
                  <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white">{societe.name}</td>
                  <td className="py-3 px-3 text-slate-400">{societe.contact || '—'}</td>
                  <td className="py-3 px-3 text-slate-400 tabular-nums">{societe.phone || '—'}</td>
                  <td className="py-3 px-3">
                    <Badge status={societe.active ? 'Active' : 'Inactive'} />
                  </td>
                  <td className="py-3 px-3 text-right">
                    <button
                      onClick={() => void toggleActive(societe)}
                      disabled={busy}
                      className="rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
                    >
                      {societe.active ? 'Désactiver' : 'Réactiver'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Une société désactivée disparaît de la liste du poste Vendeuse, mais reste attachée
        aux proformas qu'elle a déjà portées.
      </p>
    </div>
  )
}

// ── Présentoir par bloc (module) ──────────────────────────────────────────────────
// Accès direct depuis le menu principal : plus besoin de passer par Suivi → ville →
// Présentoire pour voir le présentoir regroupé par meuble. On choisit la ville en haut,
// le reste réutilise PresentoirParBloc (déjà branché sur SuiviDetailScreen).
function PresentoirBlocModule({ framesByCity, stationCities, onNavigate }: {
  framesByCity: Record<string, FrameRecord[]>; stationCities: string[]; onNavigate: (screen: NavScreen) => void
}) {
  const cities = stationCities.length > 0 ? stationCities : Object.keys(framesByCity)
  // Tant que la Direction n'a pas choisi de ville elle-même, on ouvre sur la première qui a
  // réellement des montures au présentoir plutôt que la première par ordre alphabétique —
  // sinon la page s'ouvre presque toujours sur un écran vide.
  const cityWithData = cities.find(c => (framesByCity[c] || []).some(f => f.status === 'Présentoir'))
  const [city, setCity] = useState('')
  const activeCity = city && cities.includes(city) ? city : (cityWithData || cities[0] || '')
  const frames = (framesByCity[activeCity] || []).filter(f => f.status === 'Présentoir')

  if (cities.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        Aucune ville détectée.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {cities.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setCity(c)}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              c === activeCity
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {frames.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          Aucune monture au présentoir à {activeCity}.
        </div>
      ) : (
        <PresentoirParBloc frames={frames} city={activeCity} onNavigate={onNavigate} />
      )}
    </div>
  )
}

function renderModuleView(id: ModuleId) {
  switch (id) {
    case 'reception': return <ReceptionView />
    case 'history': return <HistoryView />
    case 'societes': return <SocietesView />
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
  const [revenueByCity, setRevenueByCity] = useState<Record<string, RevenueRow[]>>({})
  const [chatButtonPos, setChatButtonPos] = useState<{ x: number; y: number } | null>(null)
  const chatButtonDragRef = useRef({ active: false, startX: 0, startY: 0, originX: 0, originY: 0, moved: false })
  const preventChatButtonClickRef = useRef(false)

  const current = navStack[navStack.length - 1]

  useEffect(() => {
    const token = window.localStorage.getItem('token')
    if (!token) return

    const loadDashboardData = () => {
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

    // Les proformas portent le chiffre d'affaires — les montures, non : voir buildCityRevenue.
    // La liste suffit, ses en-têtes contiennent déjà `total_amount` et `station_id` ; charger
    // les lignes coûterait une requête par document.
    const proformasPromise = fetch(`${API_URL}/inventory/proformas`, { headers })
      .then(async response => {
        if (!response.ok) throw new Error('proformas unavailable')
        const payload = await response.json().catch(() => ({}))
        return payload?.data?.proformas || []
      })

    Promise.allSettled([stockSummaryPromise, stationsPromise, activeGlassesPromise, proformasPromise])
      .then(async ([stockResult, stationsResult, glassesResult, proformasResult]) => {
        const summary = stockResult.status === 'fulfilled' ? summarizeStockSummary(stockResult.value) : { totalUnits: 0, hasData: false }

        if (stockResult.status === 'fulfilled') {
          setStockSummary(stockResult.value)
        } else {
          setStockSummary([])
        }

        const fallbackCounts = summary.hasData ? buildFallbackCityCounts(summary.totalUnits) : {}

        let dbCities: string[] = []
        try {
          const countriesResponse = await fetch(`${API_URL}/inventory/countries`, { headers })
          if (countriesResponse.ok) {
            const countriesPayload = await countriesResponse.json().catch(() => ({}))
            const countries = (countriesPayload?.data?.countries || []) as any[]
            const cityLists = await Promise.all(countries.map(async country => {
              if (!country?.id) return []
              const citiesResponse = await fetch(`${API_URL}/inventory/cities?country_id=${country.id}`, { headers })
              if (!citiesResponse.ok) return []
              const citiesPayload = await citiesResponse.json().catch(() => ({}))
              return (citiesPayload?.data?.cities || []).map((city: any) => String(city?.name || '').trim()).filter(Boolean)
            }))
            dbCities = mergeCityNames(cityLists.flat())
          }
        } catch {
          dbCities = []
        }

        if (stationsResult.status === 'fulfilled') {
          const stationList = stationsResult.value as any[]
          const uniqueCities = Array.from(new Set(
            stationList
              .filter((station: any) => isStoreStation(station))
              .map((station: any) => normalizeStationCityName(station))
              .filter((value): value is string => Boolean(value))
          )) as string[]
          uniqueCities.sort((a, b) => a.localeCompare(b, 'fr'))
          setStationCities(mergeCityNames(dbCities, uniqueCities))
        } else {
          setStationCities(mergeCityNames(dbCities, Object.keys(fallbackCounts)))
        }

        // Le CA vient des proformas, le stock des montures : que l'une des deux listes
        // tombe ne doit pas emporter l'autre.
        const revenue = stationsResult.status === 'fulfilled' && proformasResult.status === 'fulfilled'
          ? buildCityRevenue(stationsResult.value, proformasResult.value)
          : { revenueByCity: {}, rowsByCity: {} }
        setRevenueByCity(revenue.rowsByCity)

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
          const counts = Object.keys(builtCounts).length > 0 ? builtCounts : fallbackCounts
          const mergedCounts = addMissingZeroCities(mergeRevenueIntoCityCounts(counts, revenue.revenueByCity), stationCities)
          const finalCounts = addMissingZeroCities(mergedCounts, dbCities)
          setCityStockCounts(finalCounts)
          setFramesByCity(buildFrameRowsFromGlasses(glassesResult.value, stationMap))
        } else {
          const mergedCounts = addMissingZeroCities(mergeRevenueIntoCityCounts(fallbackCounts, revenue.revenueByCity), stationCities)
          setCityStockCounts(addMissingZeroCities(mergedCounts, dbCities))
          setFramesByCity({})
        }
      })
      .catch(() => {
        setStockSummary([])
        setCityStockCounts({})
        setStationCities([])
        setRevenueByCity({})
      })
    }

    loadDashboardData()

    // Pas de push serveur : on republie les données du tableau de bord toutes les 15s pour
    // un rendu quasi temps réel (voir HistoryView plus haut pour le même principe), en
    // sautant les cycles où l'onglet est en arrière-plan.
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadDashboardData()
    }, 15000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') loadDashboardData()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
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
      case 'city': return <CityDetailScreen block={current.block} pays={current.pays} city={current.city} onNavigate={navigate} cityStockCounts={cityStockCounts} framesByCity={framesByCity} revenueByCity={revenueByCity} />
      case 'suivi-detail': return <SuiviDetailScreen pays={current.pays} city={current.city} section={current.section} cityStockCounts={cityStockCounts} framesByCity={framesByCity} onNavigate={navigate} />
      case 'stock-general': return <StockGeneralScreen onNavigate={navigate} />
      case 'critical-references': return <CriticalReferencesScreen onNavigate={navigate} />
      case 'frame': return <FrameDetailScreen frameRef={current.ref} city={current.city} framesByCity={framesByCity} />
      case 'module': return current.id === 'presentoir-bloc'
        ? <PresentoirBlocModule framesByCity={framesByCity} stationCities={stationCities} onNavigate={navigate} />
        : renderModuleView(current.id)
    }
  }

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
        <Sidebar currentScreen={current} onNavigate={navigateRoot} dark={dark} onToggleDark={() => setDark(d => !d)} onLogout={logoutAndRedirectToIndex} />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar navStack={navStack} onBack={goBack} dark={dark} onToggleDark={() => setDark(d => !d)} onOpenChat={() => setChatOpen(v => !v)} onLogout={logoutAndRedirectToIndex} />
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