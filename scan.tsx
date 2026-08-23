import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
// Importé plutôt que référencé par URL : sans dossier public/, un chemin littéral ne
// serait pas copié dans dist/ au build.
import logoUrl from '../logo.jpeg'
import { cameraUnavailableReason, createScanner, humanCameraError, openCamera, type Scanner } from './barcodeScanner'
import { GlassTable, fmtPrix } from './GlassTable'
import { isFeatureEnabled, isPosteEnabled, FEATURE_FLAGS_EVENT } from './featureFlags'

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'
// Aucun sélecteur de station sur cet écran : on réceptionne là où le magasinier est
// rattaché. Ce repli ne sert que si son compte n'a pas de station — l'identifiant 1 est
// celui du Stock Général sur une base neuve, mais rien ne le garantit après une remise à
// zéro : c'est `users.station_id` qui fait foi.
const DEFAULT_STATION_ID = '1'

/** La station du compte connecté, celle où atterrissent les montures qu'il réceptionne. */
function stationIdOf(user: any) {
  const id = Number(user?.station_id)
  return Number.isFinite(id) && id > 0 ? String(id) : DEFAULT_STATION_ID
}

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

/** Les seuls rôles admis ici, comme protectPage(['MAGASINIER','SUPER_ADMIN']) de scan.html. */
const ALLOWED_ROLES = ['MAGASINIER', 'SUPER_ADMIN']

/** Le statut voyage avec l'erreur : un code de session inconnu (404) doit dire
 *  « ce code est invalide », pas « le serveur est injoignable ». */
class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Toute réponse 401/403 signifie que le jeton ne vaut plus rien : on ne laisse pas
// l'écran afficher des listes vides en donnant l'illusion d'un stock à zéro.
async function apiFetch(path: string, init?: RequestInit) {
  const token = getToken()
  const isForm = init?.body instanceof FormData
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      // Surtout pas de Content-Type sur un FormData : le navigateur doit poser
      // lui-même la frontière multipart, sinon le serveur ne trouve aucun fichier.
      ...(init?.body && !isForm ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
    },
  })
  if (response.status === 401 || response.status === 403) {
    logoutToLogin()
    throw new Error('Session expirée')
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.error || payload?.message || `Erreur ${response.status}`, response.status)
  }
  return payload
}

/** Comme apiFetch, mais rend `null` au lieu de déconnecter sur 401/403.
 *
 *  Réservé aux appels d'agrément. Le journal des expéditions et la liste des commandes
 *  appartiennent à la Direction : rien ne garantit que le magasinier y ait droit, et un
 *  refus doit vider une section, jamais éjecter quelqu'un au milieu d'une réception.
 *  Une vraie expiration de jeton reste attrapée par les appels obligatoires de l'écran. */
async function apiFetchOptional(path: string) {
  try {
    const response = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!response.ok) return null
    const payload = await response.json().catch(() => null)
    return payload?.success === false ? null : payload
  } catch {
    return null
  }
}

// ── Format ─────────────────────────────────────────────────────────────────────
function fmtFCFA(value: unknown) {
  const n = Number(value)
  if (!value || Number.isNaN(n)) return '—'
  return `${n.toLocaleString('fr-FR')} FCFA`
}

function dayKey(value?: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

function formatDayLabel(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

/** `dayKey` rend null sur une date absente ou illisible. Sans ce garde-fou, la date
 *  partirait telle quelle dans `new Date('nullT12:00:00')` et sortirait « Invalid Date ». */
function dayLabel(value?: string) {
  const key = dayKey(value)
  return key ? formatDayLabel(key) : 'Date inconnue'
}

function formatRecordTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function dataURLtoBlob(dataUrl: string) {
  const [header, base64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(header)?.[1] || 'image/jpeg'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

// ── Référentiels ───────────────────────────────────────────────────────────────
const GENRES = ['Homme', 'Femme', 'Enfant', 'Unisexe']
const MATIERES = ['Acétate', 'Métal', 'Plastique', 'Titane', 'Bois', 'Composite', 'Inox']

const FORMES = [
  'Aviateur', 'Rond', 'Ovale', 'Carré', 'Rectangulaire',
  'Papillon', 'Oeil de chat', 'Sport', 'Wayfarer',
] as const

const COULEURS: { value: string; swatch: string }[] = [
  { value: 'Noir', swatch: '#1c1c1c' },
  { value: 'Marron', swatch: '#6b4226' },
  { value: 'Bleu', swatch: '#2563eb' },
  { value: 'Rouge', swatch: '#dc2626' },
  { value: 'Vert', swatch: '#16a34a' },
  { value: 'Gris', swatch: '#6b7280' },
  { value: 'Blanc', swatch: '#f8fafc' },
  { value: 'Doré', swatch: '#d4af37' },
  { value: 'Argenté', swatch: '#c0c0c0' },
  { value: 'Violet', swatch: '#7c3aed' },
  { value: 'Jaune', swatch: '#eab308' },
  { value: 'Orange', swatch: '#f97316' },
  { value: 'Rose', swatch: '#ec4899' },
  { value: 'Beige', swatch: '#d6c0a8' },
  { value: 'Transparent', swatch: 'rgba(255,255,255,0.65)' },
  { value: 'Écaille', swatch: '#a77445' },
  { value: 'Multicolore', swatch: 'linear-gradient(135deg, #f97316, #2563eb, #16a34a)' },
  { value: 'Bronze', swatch: '#a16207' },
  { value: 'Cuivré', swatch: '#c2410c' },
]

/** L'IA répond tantôt en anglais, tantôt sans accent : sans ce repli, la couleur
 *  détectée ne correspondrait à aucune pastille et le champ resterait vide. */
const COLOR_ALIASES: Record<string, string> = {
  noir: 'Noir', black: 'Noir',
  marron: 'Marron', brown: 'Marron', brun: 'Marron',
  bleu: 'Bleu', blue: 'Bleu',
  rouge: 'Rouge', red: 'Rouge',
  vert: 'Vert', green: 'Vert',
  gris: 'Gris', gray: 'Gris', grey: 'Gris',
  blanc: 'Blanc', white: 'Blanc',
  'doré': 'Doré', dore: 'Doré', gold: 'Doré', or: 'Doré',
  'argenté': 'Argenté', argente: 'Argenté', silver: 'Argenté', argent: 'Argenté',
  violet: 'Violet', purple: 'Violet',
  jaune: 'Jaune', yellow: 'Jaune',
  orange: 'Orange',
  rose: 'Rose', pink: 'Rose',
  beige: 'Beige', cream: 'Beige',
  transparent: 'Transparent',
  'écaille': 'Écaille', ecaille: 'Écaille', tortoise: 'Écaille',
  multicolore: 'Multicolore', multicolor: 'Multicolore', multicolored: 'Multicolore',
  bronze: 'Bronze',
  'cuivré': 'Cuivré', cuivre: 'Cuivré',
}

function normalizeColorValue(value: unknown) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  return COLOR_ALIASES[raw.toLowerCase()] || raw
}

/** Barème repris tel quel de scan.js. ⚠️ Il ne colle pas à getGamme() des autres écrans
 *  (≤ 50 000 = Classique) : une monture saisie « Classique » repart à 70 000 et sera
 *  relue « Moyenne gamme » ailleurs. Écart de la production, à trancher côté métier —
 *  le changer ici modifierait le prix réellement enregistré en base. */
const GAMME_PRICES: Record<string, number> = {
  classique: 70000,
  'moyenne gamme': 90000,
}

function normalizePriceValue(value: unknown) {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const trimmed = String(value).trim()
  if (!trimmed) return 0
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return numeric
  const normalized = trimmed.toLowerCase()
  // 'luxe' vaut 0 : son prix est saisi à la main dans le champ dédié.
  return GAMME_PRICES[normalized] ?? 0
}

// ── Icônes ─────────────────────────────────────────────────────────────────────
const s = { fill: 'none' as const, stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const ic = {
  glasses: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="6.5" cy="12.5" r="4" /><circle cx="17.5" cy="12.5" r="4" /><path d="M10.5 12.5h3M2.4 10.8l2.1-1M21.6 10.8l-2.1-1" /></svg>,
  arrowLeft: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>,
  refresh: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>,
  camera: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" /><circle cx="12" cy="13" r="3.4" /></svg>,
  play: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7-11-7z" /></svg>,
  stop: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>,
  check: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M5 13l4 4L19 7" /></svg>,
  check2: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M2 13l4 4L15 7" /><path d="M9.5 17l1.4 1.4L21 8" /></svg>,
  checkCircle: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M8 12.4l2.5 2.5L16 9" /></svg>,
  image: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9.5" r="1.4" fill="currentColor" stroke="none" /><path d="M21 16.5l-5.6-5.6a1 1 0 0 0-1.4 0L6 19" /></svg>,
  pencil: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M4 20l4.4-1L19.4 8a2.1 2.1 0 0 0-3-3L5.4 15.5 4 20z" /></svg>,
  send: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>,
  search: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  tag: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M12.4 3H5a1 1 0 0 0-1 1v7.4a1 1 0 0 0 .3.7l9 9a1 1 0 0 0 1.4 0l7.4-7.4a1 1 0 0 0 0-1.4l-9-9a1 1 0 0 0-.7-.3z" /><circle cx="8.1" cy="8.1" r="1.2" fill="currentColor" stroke="none" /></svg>,
  building: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><rect x="4" y="3" width="10" height="18" /><path d="M14 8h6v13h-6" /><path d="M7.5 7h1M10.5 7h1M7.5 11h1M10.5 11h1M7.5 15h1M10.5 15h1" /></svg>,
  gender: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="9" cy="14.2" r="4" /><path d="M9 10.2V3.5M6.7 5.8h4.6" /><circle cx="15.2" cy="8.8" r="4" /><path d="M18 6l3-3M17.8 2.3H21v3.2" /></svg>,
  shapes: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="8" cy="8" r="4.2" /><rect x="12.5" y="12.5" width="8" height="8" rx="1.5" /></svg>,
  palette: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.9 2-2 0-.5-.2-.9-.5-1.3-.3-.3-.5-.7-.5-1.2 0-.9.7-1.5 1.5-1.5H16a5 5 0 0 0 5-5c0-4.4-4-7-9-7z" /><circle cx="7.6" cy="10.6" r="1" fill="currentColor" stroke="none" /><circle cx="9.6" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="14.4" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="16.4" cy="10.6" r="1" fill="currentColor" stroke="none" /></svg>,
  cube: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5L12 12l8-4.5M12 12v9" /></svg>,
  banknote: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 9v.01M18 15v.01" /></svg>,
  save: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M5 3h11l3 3v15H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M8 3v6h8V3M8 21v-7h8v7" /></svg>,
  printer: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="1" /><path d="M6 17h12v5H6z" /></svg>,
  plus: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M12 5v14M5 12h14" /></svg>,
  sun: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>,
  moon: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" /></svg>,
  calendar: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>,
  signOut: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>,
  alert: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
}

// ── Dessins des formes de monture ──────────────────────────────────────────────
// Aident à choisir la forme réelle plutôt qu'un mot dans une liste ; la correction
// sert aussi de donnée d'entraînement au modèle de reconnaissance (detected_shape).
const SHAPE_PATHS: Record<string, React.ReactNode> = {
  Aviateur: <>
    <path d="M2 7.5C2 4.5 5 2.5 9 2.5s7 2 7 5c0 5-3 10.5-7 10.5S2 12.5 2 7.5z" />
    <g transform="translate(40,0) scale(-1,1)"><path d="M2 7.5C2 4.5 5 2.5 9 2.5s7 2 7 5c0 5-3 10.5-7 10.5S2 12.5 2 7.5z" /></g>
    <path d="M17 8h6M1 8L.2 6.8M39 8l.8-1.2" />
  </>,
  Rond: <><circle cx="9" cy="10" r="7" /><circle cx="31" cy="10" r="7" /><path d="M16 10h8M2 7.6.5 6.5M38 7.6l1.5-1.1" /></>,
  Ovale: <><ellipse cx="9" cy="10" rx="7.5" ry="6" /><ellipse cx="31" cy="10" rx="7.5" ry="6" /><path d="M16.5 10h7M1.5 8 0 6.8M38.5 8l1.5-1.2" /></>,
  'Carré': <><rect x="2" y="3" width="14" height="14" rx="2" /><rect x="24" y="3" width="14" height="14" rx="2" /><path d="M16 10h8M2 6 .5 4.8M38 6l1.5-1.2" /></>,
  Rectangulaire: <><rect x="1" y="5" width="16" height="10" rx="2" /><rect x="23" y="5" width="16" height="10" rx="2" /><path d="M17 10h6M1 7.5-.5 6.3M39 7.5l1.5-1.2" /></>,
  Papillon: <>
    <path d="M2.5 11c-.5-3 .5-6.5 3-7.5 1.8-.7 3-.2 3.5.7.5-.9 1.7-1.4 3.5-.7 2.5 1 3.5 4.5 3 7.5-.5 3-3 4.5-6.5 4.5S3 14 2.5 11z" />
    <g transform="translate(40,0) scale(-1,1)"><path d="M2.5 11c-.5-3 .5-6.5 3-7.5 1.8-.7 3-.2 3.5.7.5-.9 1.7-1.4 3.5-.7 2.5 1 3.5 4.5 3 7.5-.5 3-3 4.5-6.5 4.5S3 14 2.5 11z" /></g>
    <path d="M15.5 9h9M1 6.5-.5 5.5M39 6.5l1.5-1" />
  </>,
  'Oeil de chat': <>
    <path d="M2.5 10.5C2 7.3 3.5 4 7 3c1.3-.4 2 .1 2 1 0-.9.7-1.4 2-1 3.5 1 5 4.3 4.5 7.5-.5 3.2-3 5-6.5 5s-6-1.8-6.5-5z" />
    <g transform="translate(40,0) scale(-1,1)"><path d="M2.5 10.5C2 7.3 3.5 4 7 3c1.3-.4 2 .1 2 1 0-.9.7-1.4 2-1 3.5 1 5 4.3 4.5 7.5-.5 3.2-3 5-6.5 5s-6-1.8-6.5-5z" /></g>
    <path d="M15.5 8.5h9M1 6-.5 5M39 6l1.5-1" />
  </>,
  Sport: <>
    <path d="M2 6.5C2 4 4 2.5 7 2.5h3c3.5 0 6 2.5 6 7.5s-2.5 7-6 7H7C4 17 2 15.5 2 13z" />
    <g transform="translate(40,0) scale(-1,1)"><path d="M2 6.5C2 4 4 2.5 7 2.5h3c3.5 0 6 2.5 6 7.5s-2.5 7-6 7H7C4 17 2 15.5 2 13z" /></g>
    <path d="M16 10h8M2 7 .5 5.8M38 7l1.5-1.2" />
  </>,
  Wayfarer: <>
    <path d="M3 4.5h11l2.5 4.5-2 6.5H4.5l-2-6.5z" />
    <path d="M26 4.5h11l2 4.5-2 6.5H23.5l-2-6.5z" />
    <path d="M17.5 9.5h5M2 6 .5 4.8M38.5 6l1.5-1.2" />
  </>,
}

function ShapeIcon({ name, className = 'w-10 h-5' }: { name: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 20" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
      {SHAPE_PATHS[name]}
    </svg>
  )
}

// ── Styles maison ──────────────────────────────────────────────────────────────
// Deux besoins que Tailwind ne couvre pas : l'animation du viseur caméra, et
// l'étiquette d'impression — celle-ci part dans une fenêtre séparée qui n'a pas
// la feuille de style de l'app, donc classes maison obligatoires (même raison que
// PROFORMA_CSS dans vendeuse.tsx).
const SCAN_CSS = `
@keyframes scanline { 0%,100% { top: 8%; opacity: .25 } 50% { top: 92%; opacity: 1 } }
.scan-line { animation: scanline 2.6s ease-in-out infinite; }
@keyframes scanpulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }
.scan-pulse { animation: scanpulse 1.4s ease-in-out infinite; }
`

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

/** Le gabarit de LABEL_CSS converti en pixels CSS à 96 dpi : l'étiquette réelle ne fait
 *  que 57 × 30 mm (rouleau de l'imprimante) — 56 × ~28,5 mm ici pour garder une marge de
 *  sécurité. Tout est compressé en conséquence : peu de marge intérieure (1,6 mm), peu
 *  d'écart entre les blocs (2 px), polices réduites. `width` compte pour la largeur
 *  totale (padding compris), comme le `box-sizing: border-box` côté CSS : sans ça le
 *  padding s'ajoutait à la largeur déclarée et le rendu papier débordait le rouleau. */
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

// ── Code-barres ────────────────────────────────────────────────────────────────
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
    // La largeur rendue est de toute façon retaillée à la largeur de l'étiquette (56mm),
    // et la hauteur est contrainte par une étiquette physique de seulement 30mm de haut,
    // texte compris : height/margin ci-dessous sont calés pour tenir sous ce plafond
    // (~28,5mm de haut au total avec tout le reste), pas pour maximiser la taille du
    // code-barres dans l'absolu.
    width: 1.15,
    height: 24,
    fontSize: 20,
    margin: 2,
    displayValue: showValue,
  })

  // JsBarcode fixe parfois seulement les attributs du SVG sans les dimensions de
  // la vue, ou bien il les laisse à 0 sur certains navigateurs quand l'élément est
  // temporaire. Sans un viewBox exploitable, la barre n'a ni largeur ni hauteur à
  // l'impression / export d'image.
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
  // Révocation différée : révoquer dans la foulée annule le téléchargement en cours.
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
 *  de marque long doit descendre d'une ligne, pas déborder de l'image.
 *
 *  Coupe aussi après chaque tiret, pas seulement sur les espaces : un code d'emplacement
 *  comme « RAYON-A-ETA-01-BAC-A-POS-06 » est un seul « mot » sans espace, et un navigateur
 *  le renverrait déjà à la ligne à ces tirets (point de coupure standard). Sans quoi il ne
 *  se découpait jamais et débordait du canvas. */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const raw = String(text || '').trim()
  if (!raw) return ['—']

  const words = raw.split(/\s+/)
  const tokens: { text: string; spaceBefore: boolean }[] = []
  words.forEach((word, wordIndex) => {
    // Lookbehind : coupe juste après chaque tiret, en le laissant collé au fragment
    // précédent plutôt que de l'isoler sur sa propre ligne.
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

/** Le contenu d'une étiquette, détaché de ce qu'elle décrit.
 *
 *  Deux étiquettes sortent de cet écran — celle d'une monture et celle d'un carton
 *  d'envoi — et elles partagent tout : 56 mm de large, les mêmes polices, le même
 *  code-barres CODE128, la même ligne de pied. Seuls les textes changent. Dupliquer le
 *  tracé pour la seconde condamnerait les deux gabarits à diverger à la première retouche. */
interface PrintableLabel {
  /** Ligne principale, en gras : la marque de la monture, ou « Carton d'envoi ». */
  title: string
  /** Sous-titre en chasse fixe : la référence de la monture, ou celle du colis. */
  reference: string
  /** La valeur encodée dans le code-barres — et le nom du fichier téléchargé. */
  barcodeValue: string
  /** Ligne d'en-tête, centrée et en gras : l'emplacement, ou la ville de destination. */
  metaLeft: string
  /** Prix affiché sous la référence, avant le code-barres. */
  metaRight: string
  /** Préfixe du PNG déposé sur le disque : `etiquette-…` ou `carton-…`. */
  filePrefix: string
}

/** Redessine l'étiquette sur un canvas au lieu de photographier le HTML : sans
 *  bibliothèque tierce, aucun navigateur ne convertit du HTML en image de façon
 *  fiable — le détour par <foreignObject> rend de travers sur Safari.
 *
 *  Le tracé rejoue donc LABEL_CSS à la main : **toute retouche du gabarit imprimé
 *  doit être reportée ici**, sinon l'image téléchargée et le papier divergent. */
async function labelToPngDataUrl(data: PrintableLabel, barcode: { svg: string; width: number; height: number }) {
  const contentWidth = LABEL_PX.width - LABEL_PX.pad * 2

  // Mesurer avant de dimensionner le canvas : la hauteur dépend du nombre de lignes,
  // qui dépend de la police. Un contexte jetable sert de règle.
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
    // data: plutôt que blob: — une <img> qui charge un blob: SVG déclenche selon les
    // navigateurs un contrôle d'origine qui échoue, et l'image n'arrive jamais.
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
  // letterSpacing manque au contexte 2D des navigateurs anciens : l'affectation passe
  // par un cast pour qu'ils rendent sans interlettrage plutôt que de casser le tracé.
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

/** Une copie image part sur le disque en même temps que l'impression : la fenêtre
 *  d'impression ne laisse rien derrière elle, et le magasinier doit pouvoir retrouver
 *  l'étiquette d'une monture sans la réimprimer.
 *
 *  L'échec reste silencieux — une alerte surgirait par-dessus la boîte d'impression
 *  déjà ouverte, et le papier, lui, est parti. */
async function downloadLabel(data: PrintableLabel, barcode: { svg: string; width: number; height: number }) {
  try {
    const dataUrl = await labelToPngDataUrl(data, barcode)
    await downloadDataUrl(dataUrl, `${data.filePrefix}-${data.barcodeValue || 'etiquette'}.png`)
  } catch (error) {
    console.error("Échec du téléchargement de l'étiquette", error)
  }
}

/** L'étiquette part dans une fenêtre séparée plutôt qu'en masquant le reste de la
 *  page : le vanilla s'appuyait sur `body > *:not(.print-label)`, impossible ici où
 *  toute l'application vit sous un unique #root. */
async function printLabel(data: PrintableLabel) {
  // Le SVG est dessiné attaché au document — JsBarcode mesure le rendu, un nœud
  // détaché ressort sans dimensions — puis retiré aussitôt.
  const holder = document.createElement('div')
  holder.style.cssText = 'position:absolute;left:-9999px;top:0'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  holder.appendChild(svg)
  document.body.appendChild(holder)

  let markup = ''
  // Sérialisé pendant que le SVG est encore attaché, mais converti en image plus tard :
  // la sérialisation est synchrone et ne retarde pas l'ouverture de la fenêtre, alors
  // qu'un chargement d'image, lui, ferait passer le clic pour une popup non sollicitée.
  const barcode = { svg: '', width: 0, height: 0 }
  try {
    await drawBarcode(svg, data.barcodeValue, false)
    markup = svg.outerHTML

    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    barcode.svg = new XMLSerializer().serializeToString(clone)
    barcode.width = Number(svg.getAttribute('width')) || Number(svg.viewBox?.baseVal.width) || 180
    barcode.height = Number(svg.getAttribute('height')) || Number(svg.viewBox?.baseVal.height) || 48
  } finally {
    holder.remove()
  }

  const popup = window.open('', '_blank', 'width=420,height=560')

  // Téléchargée dans tous les cas, impression bloquée comprise : c'est justement quand
  // rien ne sort de l'imprimante que la copie image sert le plus.
  void downloadLabel(data, barcode)

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
    + markup
    + `</div>`
    + `<script>window.onload=function(){window.print();}<\/script></body></html>`,
  )
  popup.document.close()
}

/** L'étiquette d'une monture : celle qui part sur la branche.
 *  Le code-barres doit exister avant l'impression : si l'enregistrement vient d'un
 *  flux qui n'a pas réservé de numéro, on le demande au serveur pour éviter une
 *  étiquette vide. */
async function printMontureLabel(data: FinalMonture) {
  let barcodeValue = String(data.id || '').trim()
  if (!barcodeValue) {
    try {
      const payload = await apiFetch('/inventory/barcodes/next')
      barcodeValue = String(payload?.data?.barcode || '').trim()
    } catch (error) {
      console.warn('Aucun code-barres disponible pour l\'étiquette', error)
    }
  }

  if (!barcodeValue) {
    window.alert('Le code-barres de la monture est introuvable : réessayez l\'enregistrement.')
    return
  }

  return printLabel({
    title: data.marque,
    reference: data.reference,
    barcodeValue,
    metaLeft: data.emplacement || 'Emplacement non attribué',
    metaRight: fmtFCFA(data.prix),
    filePrefix: 'etiquette',
  })
}

/** L'étiquette du carton d'envoi : celle qu'on colle sur le colis.
 *
 *  Le code-barres porte `box_code` — c'est lui que la station destinataire scannera à la
 *  réception — et `box_reference` reste lisible en clair dessous. Le pied rappelle où va
 *  le colis et ce qu'il contient, les deux informations qu'on cherche sur un carton
 *  empilé parmi d'autres. */
function printBoxLabel(dispatch: Dispatch) {
  const count = Number(dispatch.sent_count || 0)
  return printLabel({
    title: "Carton d'envoi",
    reference: dispatch.box_reference || dispatch.reference || '—',
    barcodeValue: dispatch.box_code || dispatch.box_reference || dispatch.code || '',
    metaLeft: dispatch.station_name || dispatch.city || '—',
    metaRight: `${count} monture${count > 1 ? 's' : ''}`,
    filePrefix: 'carton',
  })
}

/** Trois notes montantes après un enregistrement : le magasinier a les mains
 *  occupées, il valide à l'oreille sans quitter la monture des yeux. */
function playSuccessChime() {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctor) return
    const audioCtx = new Ctor()
    ;[523, 659, 784].forEach((freq, i) => {
      window.setTimeout(() => {
        const osc = audioCtx.createOscillator()
        const gain = audioCtx.createGain()
        osc.connect(gain)
        gain.connect(audioCtx.destination)
        osc.frequency.value = freq
        osc.type = 'sine'
        gain.gain.value = 0.08
        osc.start()
        window.setTimeout(() => osc.stop(), 150)
      }, i * 150)
    })
  } catch {
    // Audio indisponible : l'enregistrement reste confirmé à l'écran.
  }
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface ReceptionSession {
  code: string
  registered: number
  target: number
  status: string
}

/** Une ligne de « Commandes à réceptionner ».
 *
 *  Le corps vient de l'expédition (`/inventory/expeditions`, ouvert à tout compte) : numéro,
 *  date, pays, quantité commandée. C'est ce qui s'affiche dès que la Direction a envoyé la
 *  commande, grisé, avant tout scan.
 *
 *  Les champs de session — code, quota, avancement — n'arrivent qu'une fois l'étiquette
 *  scannée sur ce poste. Tant qu'ils manquent, la ligne n'est pas reprenable. */
interface ReceptionEntry {
  key: string
  orderId: number
  orderDate?: string
  supplier?: string
  note?: string
  quantity: number
  code?: string
  targetCount?: number
  registeredCount?: number
  status?: string
  /** Horodatage du scan de l'étiquette, quand le serveur sait le poser. Toutes les
   *  versions déployées ne le renvoient pas : `scanned` et `registeredCount` prennent le
   *  relais, jamais l'inverse. */
  activatedAt?: string | null
  /** Cette session a été scannée par ce compte. Connaître son code ne suffit pas : c'est
   *  le scan de l'étiquette qui ouvre une réception, et lui seul débloque la reprise. */
  scanned?: boolean
}

/** Les codes de session scannés sur ce poste.
 *
 *  `GET /inventory/reception-commands` est réservé à la direction
 *  (backend/cmd/api/main.go:454) : impossible de demander au serveur « lesquelles ai-je
 *  ouvertes ». On retient donc les codes ici, et chacun se relit ensuite un par un sur
 *  `/reception-commands/:code`, qui lui est ouvert à tout compte authentifié.
 *
 *  C'est ce qui permet de quitter la page et d'y revenir sans rescanner. La contrepartie :
 *  la mémoire est celle du navigateur, pas celle du compte — changer de poste ou vider le
 *  cache oblige à rescanner l'étiquette, ce qui reste le geste normal. */
/** Au-delà, ce sont de vieilles réceptions : autant de requêtes inutiles au chargement. */
const SCANNED_CODES_MAX = 20

/** La clé est celle du compte, pas du poste : deux magasiniers se relaient souvent sur la
 *  même tablette, et chacun ne doit retrouver que les sessions qu'il a lui-même scannées.
 *
 *  L'identité se relit dans localStorage plutôt que dans l'état React : la garde y écrit le
 *  compte avant tout, et les fonctions ci-dessous sont appelées depuis des callbacks
 *  mémoïsés qui, eux, garderaient l'utilisateur du premier rendu — c'est-à-dire aucun. */
function scannedCodesKey() {
  try {
    const raw = window.localStorage.getItem('user')
    const id = raw ? JSON.parse(raw)?.id : null
    return id ? `scan.sessions.${id}` : 'scan.sessions.anon'
  } catch {
    return 'scan.sessions.anon'
  }
}

function loadScannedCodes(): string[] {
  try {
    const raw = window.localStorage.getItem(scannedCodesKey())
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((code): code is string => typeof code === 'string') : []
  } catch {
    return []
  }
}

function saveScannedCodes(codes: string[]) {
  try {
    window.localStorage.setItem(scannedCodesKey(), JSON.stringify(codes.slice(0, SCANNED_CODES_MAX)))
  } catch {
    // Stockage indisponible (navigation privée) : on perd la reprise, pas la réception.
  }
}

function rememberScannedCode(code: string) {
  const clean = String(code || '').trim().toUpperCase()
  if (!clean) return
  saveScannedCodes([clean, ...loadScannedCodes().filter(item => item !== clean)])
}

/** Le serveur ne renvoie pas de façon fiable, sur un mouvement relu (GET /inventory/movements),
 *  le code de la session qui l'a créé — le nom du champ varie selon la version déployée, sans
 *  qu'on puisse le deviner depuis le front (cf. SessionsGate, qui essaie plusieurs noms en
 *  repli). On le retient donc nous-mêmes, ici, au moment où on le connaît avec certitude :
 *  juste après l'enregistrement (saveRecord). Même portée que scannedCodesKey (par compte, ce
 *  navigateur) — les enregistrements faits ailleurs ne bénéficient pas de ce raccourci, mais
 *  retombent sur le même repli que avant. */
const BARCODE_SESSIONS_MAX = 500

function barcodeSessionsKey() {
  try {
    const raw = window.localStorage.getItem('user')
    const id = raw ? JSON.parse(raw)?.id : null
    return id ? `scan.barcodeSessions.${id}` : 'scan.barcodeSessions.anon'
  } catch {
    return 'scan.barcodeSessions.anon'
  }
}

function loadBarcodeSessions(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(barcodeSessionsKey())
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function rememberBarcodeSession(barcode: string, sessionCode: string) {
  const cleanBarcode = String(barcode || '').trim()
  const cleanCode = String(sessionCode || '').trim().toUpperCase()
  if (!cleanBarcode || !cleanCode) return
  try {
    const map = loadBarcodeSessions()
    map[cleanBarcode] = cleanCode
    const entries = Object.entries(map)
    // Garde les plus récents si le plafond est dépassé, plutôt que de grossir indéfiniment.
    const trimmed = entries.length > BARCODE_SESSIONS_MAX ? entries.slice(entries.length - BARCODE_SESSIONS_MAX) : entries
    window.localStorage.setItem(barcodeSessionsKey(), JSON.stringify(Object.fromEntries(trimmed)))
  } catch {
    // Stockage indisponible : le regroupement par session sera juste moins complet.
  }
}

interface Movement {
  id?: string | number
  created_at?: string
  brand?: string
  reference?: string
  barcode?: string
  from_location_code?: string
  to_location_code?: string
  [key: string]: any
}

type FieldKey = 'reference' | 'marque' | 'genre' | 'forme' | 'couleur' | 'matiere'
type FieldSource = 'manual' | 'detected' | 'corrected'

interface VerifyForm {
  reference: string
  marque: string
  genre: string
  forme: string
  couleur: string
  matiere: string
  gamme: string
  prixCustom: string
}

const EMPTY_FORM: VerifyForm = {
  reference: '', marque: '', genre: '', forme: '', couleur: '', matiere: '', gamme: '', prixCustom: '',
}

const EMPTY_SOURCES: Record<FieldKey, FieldSource> = {
  reference: 'manual', marque: 'manual', genre: 'manual', forme: 'manual', couleur: 'manual', matiere: 'manual',
}

interface FinalMonture {
  id: string
  glassId?: string
  reference: string
  marque: string
  genre: string
  forme: string
  couleur: string
  matiere: string
  prix: number
  quantite: number
  emplacement: string
  photoMonture: string
  photoBranche: string
}

// ── Briques d'interface ────────────────────────────────────────────────────────
const CARD = 'bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700'

function Btn({ variant = 'outline', className = '', children, ...rest }: {
  variant?: 'primary' | 'outline' | 'success' | 'danger'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none'
  const variants = {
    primary: 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]',
    success: 'bg-[#16a34a] text-white hover:bg-[#15803d]',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    outline: 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50',
  }
  return <button type="button" className={`${base} ${variants[variant]} ${className}`} {...rest}>{children}</button>
}

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'blue' | 'green' | 'red' }) {
  const tones = {
    slate: 'bg-slate-100 dark:bg-slate-700/50 text-slate-500 dark:text-slate-300',
    blue: 'bg-[#2563eb]/10 text-[#2563eb]',
    green: 'bg-[#16a34a]/10 text-[#16a34a]',
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  }
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${tones[tone]}`}>{children}</span>
}

function CardHead({ icon, title, pill }: { icon: React.ReactNode; title: React.ReactNode; pill?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-700 px-4 py-3">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <span className="text-[#2563eb]">{icon}</span>
        {title}
      </h3>
      {pill}
    </div>
  )
}

// ── Étape 1 : photos ───────────────────────────────────────────────────────────
// Le <video> ne peut pas être démonté entre les deux photos (le flux serait perdu) :
// la vue de capture est donc rendue d'un bloc, avec la balise vidéo toujours présente.
function CaptureCard({ target, photo, cameraOn, videoRef, onStart, onStop, onCapture, onRetake, onNext, analyzing }: {
  target: 'monture' | 'branche'
  photo: string | null
  cameraOn: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  onStart: () => void
  onStop: () => void
  onCapture: () => void
  onRetake: () => void
  onNext: () => void
  analyzing: boolean
}) {
  const isMonture = target === 'monture'
  return (
    <div className={CARD}>
      <CardHead
        icon={ic.camera('w-4 h-4')}
        title={<>Étape 1 · {isMonture ? 'Photo de la monture' : 'Photo de la branche'}</>}
        pill={<Pill tone="blue">{isMonture ? 'Photo 1/2 · Monture' : 'Photo 2/2 · Branche'}</Pill>}
      />

      <div className="relative m-4 aspect-video min-h-[220px] overflow-hidden rounded-xl bg-slate-900">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover ${cameraOn && !photo ? '' : 'invisible'}`}
        />

        {photo && <img src={photo} alt="Photo capturée" className="absolute inset-0 h-full w-full object-cover" />}

        {!cameraOn && !photo && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800">{ic.camera('w-6 h-6')}</div>
            <p className="text-sm font-bold text-slate-300">Caméra en attente</p>
            <p className="text-xs">Appuyez sur « Démarrer »</p>
          </div>
        )}

        {/* Viseur : purement décoratif, il cadre le geste. La détection est faite par le serveur. */}
        {cameraOn && !photo && (
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute inset-[12%] rounded-lg">
              {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map(pos => (
                <span key={pos} className={`absolute h-6 w-6 rounded-sm border-[#2563eb] ${pos}`} />
              ))}
              <span className="scan-line absolute left-[6%] right-[6%] h-0.5 rounded-full bg-[#2563eb]" />
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm">
              <span className="scan-pulse h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
              Caméra prête
            </div>
          </div>
        )}

        {analyzing && (
          <div className="absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-center text-[11px] font-semibold text-white">
            Analyse IA en cours…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        {!cameraOn
          ? <Btn variant="primary" onClick={onStart}>{ic.play()} Démarrer</Btn>
          : <Btn variant="danger" onClick={onStop}>{ic.stop()} Arrêter</Btn>}

        {!photo
          ? <Btn variant="success" onClick={onCapture} disabled={!cameraOn}>{ic.camera()} Capturer</Btn>
          : <Btn onClick={onRetake}>{ic.refresh()} Reprendre</Btn>}

        <Btn variant="primary" className="ml-auto" onClick={onNext} disabled={!photo}>
          {ic.check()} {isMonture ? 'Photo suivante →' : 'Valider →'}
        </Btn>
      </div>
    </div>
  )
}

// ── Étape 2 : vérification ─────────────────────────────────────────────────────
function SrcTag({ source }: { source: FieldSource }) {
  if (source === 'detected') return <Pill tone="green">{ic.check('w-3 h-3')} Détecté</Pill>
  return <Pill tone="slate">{source === 'corrected' ? 'Corrigé' : 'À saisir'}</Pill>
}

/** Un champ que l'IA a rempli se replie en résumé : le magasinier ne relit que ce
 *  qui manque. Le crayon le rouvre pour corriger. */
function Field({ icon, label, source, collapsed, summary, invalid, onExpand, children }: {
  icon: React.ReactNode
  label: string
  source?: FieldSource
  collapsed?: boolean
  summary?: string
  invalid?: boolean
  onExpand?: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className={`rounded-xl border p-3 transition-colors ${invalid ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'} ${collapsed ? 'bg-slate-50 dark:bg-slate-800/60' : 'bg-white dark:bg-slate-800'}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">{icon}</span>
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
        {collapsed && <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{summary || '—'}</span>}
        <span className="ml-auto flex items-center gap-2 flex-shrink-0">
          {source && <SrcTag source={source} />}
          {collapsed && (
            <button
              type="button"
              onClick={onExpand}
              title="Modifier"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              {ic.pencil('w-3.5 h-3.5')}
            </button>
          )}
        </span>
      </div>
      {!collapsed && <div className="mt-2">{children}</div>}
    </div>
  )
}

const INPUT = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-[#2563eb]'

function PhotoBox({ url, label }: { url: string | null; label: string }) {
  return (
    <div className={`relative flex min-h-[120px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 ${url ? '' : 'bg-slate-50 dark:bg-slate-900/50'}`}>
      {url
        ? <img src={url} alt={label} className="h-full w-full object-cover" />
        : <div className="flex flex-col items-center gap-1 text-slate-300 dark:text-slate-600">{ic.image('w-6 h-6')}<p className="text-xs">Photo {label.toLowerCase()}</p></div>}
      <span className="absolute left-2 top-2 rounded-lg bg-black/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{label}</span>
    </div>
  )
}

// ── Écran d'activation de session ──────────────────────────────────────────────
// Caméra + saisie manuelle du code de session — partagé par l'écran d'activation (atteint
// sur erreur de reprise, cf. activateOrResume) et « Mes sessions », qui l'affiche directement
// en tête plutôt qu'une liste de cartes : scanner ou taper n'importe quel code, nouveau ou
// déjà entamé, rouvre la bonne session (onActivate fait foi dans les deux cas).
function SessionScanCard({ status, isError, onActivate }: {
  status: string
  isError: boolean
  onActivate: (code: string) => Promise<boolean>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const scannerRef = useRef<Scanner | null>(null)
  const [scanning, setScanning] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanStatus, setScanStatus] = useState('')

  // Le lecteur détient une caméra : quitter l'écran sans l'arrêter laisserait la
  // diode allumée et le flux ouvert pour tout le reste de la session.
  useEffect(() => () => { scannerRef.current?.stop() }, [])

  async function startScanner() {
    // Un clic sur la case déjà en train de filmer relancerait un flux caméra par-dessus
    // l'autre — plusieurs Android refusent le second (NotReadableError).
    if (scanning || !videoRef.current) return
    scannerRef.current?.stop()
    const scanner = createScanner({
      video: videoRef.current,
      formats: ['code_128'],
      onStatus: (message, error) => setScanStatus(error ? `⚠ ${message}` : message),
      // onActivate est asynchrone : on attend son vrai résultat avant de décider
      // d'arrêter la lecture. Renvoyer false garde la caméra active, sinon un code
      // voisin mal cadré figerait l'écran sur un refus sans nouvelle tentative.
      onDetect: code => onActivate(code),
    })
    scannerRef.current = scanner
    setScanning(true)
    const ok = await scanner.start()
    if (!ok) setScanning(false)
  }

  async function submitCode() {
    setBusy(true)
    try {
      await onActivate(code)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Le bouton « Activer la caméra » est explicite plutôt qu'un clic sur la case
            entière : tout le monde ne devine pas qu'une zone silencieuse est cliquable. */}
        <div className="relative flex min-h-[200px] flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-[#2563eb] bg-white p-6 text-center dark:bg-slate-800">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover ${scanning ? '' : 'hidden'}`}
          />
          {!scanning && (
            <>
              <span className="text-[#2563eb]">{ic.camera('w-7 h-7')}</span>
              <span className="text-base font-bold text-[#2563eb]">Scanner le code-barres de session</span>
              <Btn variant="primary" onClick={() => void startScanner()}>
                {ic.camera('w-4 h-4')} Activer la caméra
              </Btn>
            </>
          )}
        </div>

        <div className="flex flex-col justify-center text-left">
          <label htmlFor="sessionCode" className="mb-1 block text-xs font-semibold text-slate-500 dark:text-slate-400">
            Code de session
          </label>
          <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); void submitCode() }}>
            <input
              id="sessionCode"
              type="text"
              autoComplete="off"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="SESSION-…"
              className={INPUT}
            />
            <Btn type="submit" variant="primary" disabled={busy || !code.trim()}>
              {busy ? 'Vérification…' : 'Activer'}
            </Btn>
          </form>
        </div>
      </div>

      <p className={`mt-3 text-center text-sm ${isError && status ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
        {status || scanStatus || 'La caméra peut détecter automatiquement le code. Vous pouvez aussi le saisir manuellement.'}
      </p>
    </div>
  )
}

function ActivationGate({ status, isError, onActivate, onReturn }: {
  status: string
  isError: boolean
  onActivate: (code: string) => Promise<boolean>
  onReturn?: () => void
}) {
  return (
    <div className="mx-auto max-w-xl">
      {onReturn && (
        <div className="mb-4 flex justify-start">
          <Btn variant="outline" onClick={onReturn}>{ic.arrowLeft()} Retour</Btn>
        </div>
      )}
      <div className="mb-5 text-center">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Activer une session d'enregistrement</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Scannez l'étiquette générée par l'administrateur avant d'enregistrer des montures.
        </p>
      </div>

      <SessionScanCard status={status} isError={isError} onActivate={onActivate} />
    </div>
  )
}

/** Une ligne de monture enregistrée — réutilisée par la liste plate (repli sans
 *  regroupement fiable) et par le détail d'une session ouverte depuis ses blocs. */
function MovementRow({ row }: { row: Movement }) {
  return (
    <div className="flex items-center gap-3 p-3">
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#2563eb]/10 text-[#2563eb]">
        {ic.glasses('w-4 h-4')}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
          {row.brand || row.marque || 'Monture'} {row.reference ? `· ${row.reference}` : ''}
        </p>
        <p className="truncate text-xs text-slate-400">{row.barcode || '—'} · {row.to_location_code || row.from_location_code || '—'}</p>
      </div>
      <span className="flex-shrink-0 text-xs tabular-nums text-slate-400">{formatRecordTime(row.created_at)}</span>
    </div>
  )
}

// ── Écran des sessions ─────────────────────────────────────────────────────────
/** Le scan ou la saisie du code de session (SessionScanCard) est la porte d'entrée, en
 *  tête d'écran : nouvelle session ou déjà entamée, le même geste rouvre la bonne — onActivate
 *  fait foi dans les deux cas. En dessous, les journées passées restent consultables au
 *  détail (l'avancement d'aujourd'hui, lui, vient du serveur via `session`). */
function SessionsGate({ movements, commands, status, isError, onActivate, onPrint }: {
  movements: Movement[]
  commands: ReceptionEntry[]
  status: string
  isError: boolean
  onActivate: (code: string) => Promise<boolean>
  onPrint: (record: Movement) => void
}) {
  const [detailDate, setDetailDate] = useState<string | null>(null)
  // Session ouverte au sein du détail d'un jour passé : un second niveau, pas un état à
  // part — remis à zéro à chaque changement de jour (cf. openDay/closeDay ci-dessous).
  const [openSessionCode, setOpenSessionCode] = useState<string | null>(null)

  function openDay(key: string) {
    setOpenSessionCode(null)
    setDetailDate(key)
  }
  function closeDay() {
    setOpenSessionCode(null)
    setDetailDate(null)
  }

  const today = todayKey()
  const counts = new Map<string, number>()
  movements.forEach(m => {
    const key = dayKey(m.created_at)
    if (key) counts.set(key, (counts.get(key) || 0) + 1)
  })
  if (!counts.has(today)) counts.set(today, 0)
  const keys = Array.from(counts.keys()).sort((a, b) => b.localeCompare(a))

  // Le bug corrigé ici : `commands` liste TOUTES les commandes encore actives côté serveur,
  // pas seulement celles d'aujourd'hui — une commande ouverte hier et jamais terminée y
  // reste. Sans le filtre sur activatedAt, la pastille comptait ces vieilles commandes en
  // plus de celles du jour (d'où un « 4 sessions en cours » alors que 2 montures
  // seulement avaient été enregistrées aujourd'hui).
  const todayOpenCommands = commands.filter(entry =>
    Boolean(entry.code) && entry.activatedAt && dayKey(entry.activatedAt) === today)
  const todayCommandsDone = todayOpenCommands.every(entry => {
    const target = Number(entry.targetCount || 0)
    const registered = Number(entry.registeredCount || 0)
    return target > 0 && registered >= target
  })

  if (detailDate) {
    const isToday = detailDate === today

    const dayRows = movements
      .filter(m => dayKey(m.created_at) === detailDate)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

    // D'abord notre propre mémoire (rememberBarcodeSession, posée à l'enregistrement même :
    // fiable, mais seulement pour ce qui a été enregistré sur ce compte depuis ce correctif).
    // À défaut, le mouvement porte peut-être lui-même le code de sa session — le serveur ne
    // le renvoie pas toujours (cf. le commentaire sur rememberBarcodeSession) : on essaie
    // plusieurs noms de champ possibles avant d'abandonner, plutôt que d'inventer un
    // regroupement faux.
    const barcodeSessions = loadBarcodeSessions()
    const groupedByCode = new Map<string, Movement[]>()
    dayRows.forEach(row => {
      const code = barcodeSessions[String(row.barcode || '').trim()]
        || recordField(row, 'reception_command_code') || recordField(row, 'session_code') || recordField(row, 'command_code')
      const key = code || 'Sans session'
      if (!groupedByCode.has(key)) groupedByCode.set(key, [])
      groupedByCode.get(key)!.push(row)
    })
    const canGroupDayRows = Array.from(groupedByCode.keys()).some(code => code !== 'Sans session')

    // Uniquement les commandes d'AUJOURD'HUI, pas toute commande encore active quel que
    // soit le jour où elle a été ouverte (l'ancien comportement, volontaire à l'origine —
    // cf. git blame — mais qui encombrait ce bloc de sessions d'autres jours). Un signal
    // réel du jour est exigé : activatedAt daté d'aujourd'hui, ou déjà une monture
    // enregistrée aujourd'hui pour ce code. Une commande active mais jamais touchée
    // aujourd'hui ne redescend donc plus ici — elle reste sur son propre jour.
    const openCommands = isToday
      ? commands
          .filter(entry => Boolean(entry.code))
          .filter(entry => (entry.activatedAt && dayKey(entry.activatedAt) === detailDate) || groupedByCode.has(entry.code as string))
          .sort((a, b) => Number(a.registeredCount || 0) / Math.max(1, Number(a.targetCount || 1))
            - Number(b.registeredCount || 0) / Math.max(1, Number(b.targetCount || 1)))
      : []

    // Une session déjà traitée aujourd'hui a quitté `commands` (le serveur n'y garde que les
    // sessions encore actives) : on la retrouve par ses mouvements plutôt que de la perdre.
    const activeCodesToday = new Set(openCommands.map(entry => entry.code))
    const closedSessionsToday = isToday
      ? Array.from(groupedByCode.entries()).filter(([code]) => code !== 'Sans session' && !activeCodesToday.has(code))
      : []
    const unresolvedRows = groupedByCode.get('Sans session') || []

    // Cliquer une session déjà traitée — aujourd'hui ou un jour passé — ouvre sa liste de
    // montures, jamais l'assistant : il n'y a plus rien à y reprendre.
    if (openSessionCode) {
      const sessionRows = groupedByCode.get(openSessionCode) || []
      return (
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex items-center gap-3">
            <Btn onClick={() => setOpenSessionCode(null)}>{ic.arrowLeft()} {isToday ? 'Sessions en cours' : 'Sessions'}</Btn>
            <span className="text-sm font-bold text-slate-900 dark:text-white">{openSessionCode === 'Sans session' ? 'Montures sans session' : openSessionCode}</span>
          </div>
          {/* Même tableau que « Stock total » (RecordsTable) — photo, forme, genre,
              emplacement, aperçu avec impression — plutôt que la ligne compacte d'avant. */}
          {sessionRows.length === 0 ? (
            <div className={`${CARD} flex flex-col items-center gap-2 p-10 text-center text-slate-400`}>
              {ic.glasses('w-7 h-7')}
              <p className="text-sm">Aucune monture trouvée pour cette session.</p>
            </div>
          ) : (
            <RecordsTable records={sessionRows} onPrint={onPrint} />
          )}
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center gap-3">
          <Btn onClick={closeDay}>{ic.arrowLeft()} Sessions</Btn>
          <span className="text-sm font-bold text-slate-900 dark:text-white">{formatDayLabel(detailDate)}</span>
        </div>

        {isToday ? (
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Sessions en cours</h3>
            {openCommands.length === 0 && closedSessionsToday.length === 0 && unresolvedRows.length === 0 ? (
              <div className={`${CARD} flex flex-col items-center gap-2 p-8 text-center`}>
                <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-8 h-8')}</span>
                <p className="text-sm text-slate-400">Aucune session ouverte pour le moment — scannez une étiquette pour en démarrer une.</p>
              </div>
            ) : (
              // Même grille de blocs que « Listes reçues » (ListesScreen). En cours : un clic
              // rouvre directement la session (activateOrResume la retrouve par son code, sans
              // repasser par le scan de l'étiquette). Traitée : un clic ouvre sa liste de
              // montures, elle n'a plus rien à reprendre.
              <div className="grid gap-3 sm:grid-cols-2">
                {openCommands.map(entry => {
                  const target = Number(entry.targetCount || 0)
                  const registered = Number(entry.registeredCount || 0)
                  const done = target > 0 && registered >= target
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      onClick={() => void onActivate(entry.code as string)}
                      className={`bg-white dark:bg-slate-800 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 border-2 ${done ? 'border-[#16a34a]' : 'border-[#2563eb]'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{entry.code}</p>
                        <Pill tone={done ? 'green' : 'blue'}>{done ? 'Traitée' : 'En cours'}</Pill>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-400">
                        {entry.supplier ? `${entry.supplier} · ` : ''}{registered}/{target || '?'} monture{target > 1 ? 's' : ''} enregistrée{registered > 1 ? 's' : ''}
                      </p>
                    </button>
                  )
                })}
                {closedSessionsToday.map(([code, sessionRows]) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setOpenSessionCode(code)}
                    className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 border-2 border-[#16a34a]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{code}</p>
                      <Pill tone="green">Traitée</Pill>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {sessionRows.length} monture{sessionRows.length > 1 ? 's' : ''} enregistrée{sessionRows.length > 1 ? 's' : ''}
                    </p>
                  </button>
                ))}
                {/* Pas une session en cours : ces montures SONT déjà enregistrées, le
                    serveur n'a juste pas renvoyé de façon fiable le code qui les rattache
                    à une session précise (cf. le commentaire sur ReceptionEntry plus haut).
                    Un bloc gris à côté de blocs verts « Traitée » aurait laissé croire à un
                    reste à faire — il n'y en a pas, elles sont donc vertes comme les autres. */}
                {unresolvedRows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setOpenSessionCode('Sans session')}
                    className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 border-2 border-[#16a34a]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">Montures sans session</p>
                      <Pill tone="green">Traitée</Pill>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {unresolvedRows.length} monture{unresolvedRows.length > 1 ? 's' : ''} enregistrée{unresolvedRows.length > 1 ? 's' : ''}
                    </p>
                  </button>
                )}
              </div>
            )}
          </section>
        ) : canGroupDayRows ? (
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Sessions de ce jour</h3>
            {/* Un jour passé n'a plus de session « en cours » : une commande encore active
                reste sur le bloc Aujourd'hui (cf. ci-dessus) jusqu'à son quota atteint. */}
            <div className="grid gap-3 sm:grid-cols-2">
              {Array.from(groupedByCode.entries()).map(([code, sessionRows]) => {
                const unresolved = code === 'Sans session'
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setOpenSessionCode(code)}
                    className="bg-white dark:bg-slate-800 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 border-2 border-[#16a34a]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{unresolved ? 'Montures sans session' : code}</p>
                      <Pill tone="green">Traitée</Pill>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-400">
                      {sessionRows.length} monture{sessionRows.length > 1 ? 's' : ''} enregistrée{sessionRows.length > 1 ? 's' : ''}
                    </p>
                  </button>
                )
              })}
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Montures enregistrées</h3>
            <div className={`${CARD} divide-y divide-slate-100 dark:divide-slate-700`}>
              {dayRows.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-slate-400">
                  {ic.glasses('w-7 h-7')}
                  <p className="text-sm">Aucun enregistrement pour cette date.</p>
                </div>
              ) : dayRows.map((row, index) => <MovementRow key={row.id ?? index} row={row} />)}
            </div>
          </section>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SessionScanCard status={status} isError={isError} onActivate={onActivate} />

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">Journées d'enregistrement</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {keys.map(key => {
            const isToday = key === today
            const count = counts.get(key) || 0
            // Traitée : verte, comme une session ou une liste déjà traitée ailleurs dans
            // l'app. Un jour passé l'est toujours (sa commande a forcément atteint son
            // quota, sinon elle serait encore sur Aujourd'hui) ; aujourd'hui ne l'est que
            // si plus aucune commande scannée n'est en cours.
            const isTreated = !isToday || todayCommandsDone
            return (
              // Toujours le détail du jour, même aujourd'hui avec une session déjà ouverte :
              // c'est là qu'on choisit entre PLUSIEURS sessions scannées le même jour
              // (« Sessions de ce jour » ci-dessous), pas seulement celle en cours. Reprendre
              // la session déjà ouverte reste un simple clic sur son bloc, sans confirmation
              // (activateOrResume la reconnaît). Un raccourci direct vers l'assistant la
              // masquait entièrement dès qu'une session tournait.
              <button
                key={key}
                type="button"
                onClick={() => openDay(key)}
                className={`bg-white dark:bg-slate-800 rounded-2xl border-2 flex flex-col items-center gap-1 p-4 text-center transition-all hover:-translate-y-0.5 ${
                  isTreated ? 'border-[#16a34a]' : isToday ? 'border-[#2563eb] ring-2 ring-[#2563eb]' : 'border-slate-100 dark:border-slate-700'
                }`}
              >
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${isTreated ? 'bg-[#16a34a]/10 text-[#16a34a]' : isToday ? 'bg-[#2563eb]/10 text-[#2563eb]' : 'bg-slate-100 text-slate-400 dark:bg-slate-700/50'}`}>
                  {ic.calendar('w-5 h-5')}
                </span>
                <span className="text-3xl font-black tabular-nums text-slate-900 dark:text-white">{count}</span>
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                  {isToday ? `Aujourd'hui · ${formatDayLabel(key)}` : formatDayLabel(key)}
                </span>
                <span className="text-[11px] font-semibold text-slate-400">
                  {isToday && !todayCommandsDone
                    ? `${todayOpenCommands.length} session${todayOpenCommands.length > 1 ? 's' : ''} en cours`
                    : count > 1 ? 'montures' : 'monture'}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
// ── Historique ─────────────────────────────────────────────────────────────────
/** Une monture en stock porte ses champs à plat ; un mouvement en garde parfois une
 *  copie dans un sous-objet `monture`. Même prudence que `recordField()` de scan.js. */
function recordField(record: any, key: string): string {
  if (!record) return ''
  const direct = record[key]
  if (direct != null && direct !== '') return String(direct)
  const nested = record.monture?.[key]
  if (nested != null && nested !== '') return String(nested)
  return ''
}

/** Le nom du champ photo change selon l'écran qui a créé la monture : il faut essayer
 *  toute la cascade. C'est celle de scan.js, reprise dans l'AGENTS.md. */
function recordPhoto(record: any): string {
  return recordField(record, 'photo_monture_url') || recordField(record, 'image_url')
    || recordField(record, 'photo_url') || recordField(record, 'image')
    || recordField(record, 'monture_image') || recordField(record, 'frame_image')
}

/** Récupère la photo de la branche avec les variantes de noms de champs. */
function recordPhotoBranche(record: any): string {
  return recordField(record, 'photo_branche_url') || recordField(record, 'PhotoBrancheURL')
    || recordField(record, 'branche_image') || recordField(record, 'branch_image')
    || recordField(record, 'branche_url')
}

const HISTORIQUE_PAGE_SIZE = 10

const SELECT = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:border-[#2563eb]'

/** Tableau vert (même gabarit que Stock général côté Direction) directement — plus de
 *  blocs par jour à ouvrir : Forme/Genre/recherche filtrent tout le parc d'un coup, comme
 *  Stock général. Un clic sur une ligne ouvre l'aperçu (photos, détail, impression). */
// Recherche + Forme/Genre + compteur vivent désormais dans TopBar (sur la même ligne que
// le titre), pas ici : query/forme/genre/page sont donc reçus en props, portés par ScanPage,
// plutôt qu'un état local que TopBar n'aurait pas pu atteindre.
function HistoriqueScreen({ movements, onPrint, query, forme, genre, page, onPageChange }: {
  movements: Movement[]
  onPrint: (record: Movement) => void
  query: string
  forme: string
  genre: string
  page: number
  onPageChange: (page: number) => void
}) {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return movements.filter(record => {
      if (forme && recordField(record, 'shape') !== forme) return false
      if (genre && recordField(record, 'gender') !== genre) return false
      if (!needle) return true
      return ['reference', 'brand', 'barcode', 'color']
        .some(key => recordField(record, key).toLowerCase().includes(needle))
    })
  }, [movements, query, forme, genre])

  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORIQUE_PAGE_SIZE))
  // Un filtre qui raccourcit la liste laisserait sinon la page courante dans le vide.
  const current = Math.min(page, totalPages)
  const rows = filtered.slice((current - 1) * HISTORIQUE_PAGE_SIZE, current * HISTORIQUE_PAGE_SIZE)

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {rows.length === 0 ? (
        <div className={`${CARD} flex flex-col items-center gap-2 p-8 text-center`}>
          <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-8 h-8')}</span>
          <p className="text-sm text-slate-400">
            {movements.length === 0 ? 'Aucun enregistrement pour l’instant.' : 'Aucun enregistrement ne correspond à ces filtres.'}
          </p>
        </div>
      ) : (
        <RecordsTable records={rows} onPrint={onPrint} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Btn onClick={() => onPageChange(current - 1)} disabled={current <= 1}>{ic.arrowLeft()} Précédent</Btn>
          <span className="text-xs tabular-nums text-slate-400">Page {current} / {totalPages}</span>
          <Btn onClick={() => onPageChange(current + 1)} disabled={current >= totalPages}>Suivant</Btn>
        </div>
      )}
    </div>
  )
}

/** Tableau + aperçu (photos, détail, impression) de « Stock total », réutilisé partout
 *  où une liste de montures mérite plus qu'une ligne compacte — notamment une session déjà
 *  traitée, dans « Mes sessions ». Ne gère ni recherche ni pagination : l'appelant décide
 *  quels enregistrements passer. */
function RecordsTable({ records, onPrint }: { records: Movement[]; onPrint: (record: Movement) => void }) {
  const [selectedRecord, setSelectedRecord] = useState<Movement | null>(null)

  return (
    <>
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
                <th className="px-2 py-2 text-left font-semibold">Date</th>
                <th className="px-2 py-2 text-left font-semibold">Emplacement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-green-200 dark:divide-green-700 bg-white dark:bg-slate-900">
              {records.map((record, index) => {
                const photo = recordPhoto(record)
                return (
                  <tr
                    key={recordField(record, 'barcode') || index}
                    onClick={() => setSelectedRecord(record)}
                    className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <td className="px-2 py-2">
                      {photo ? (
                        <img src={photo} alt="" loading="lazy" className="h-12 w-12 rounded-md object-cover" />
                      ) : (
                        <span className="inline-block rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-800">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-slate-900 dark:text-white">
                      {recordField(record, 'reference') || recordField(record, 'barcode') || '—'}
                    </td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{recordField(record, 'brand') || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{recordField(record, 'shape') || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{recordField(record, 'gender') || '—'}</td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                      {dayLabel(recordField(record, 'created_at'))} · {formatRecordTime(recordField(record, 'created_at'))}
                    </td>
                    <td className="px-2 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">
                      {recordField(record, 'to_location_code') || recordField(record, 'from_location_code') || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={() => setSelectedRecord(null)}>
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3.5 dark:border-slate-700">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Aperçu</p>
                <p className="mt-1 truncate text-lg font-bold text-slate-900 dark:text-white">
                  {recordField(selectedRecord, 'reference') || recordField(selectedRecord, 'brand') || 'Monture'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Fermer
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="h-44 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                  {recordPhoto(selectedRecord)
                    ? <img src={recordPhoto(selectedRecord)} alt={recordField(selectedRecord, 'reference') || 'Monture'} className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">Pas de photo de monture</div>}
                </div>
                <div className="h-44 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
                  {recordPhotoBranche(selectedRecord)
                    ? <img src={recordPhotoBranche(selectedRecord)} alt={recordField(selectedRecord, 'reference') || 'Branche'} className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">Pas de photo de branche</div>}
                </div>
              </div>

              <div className="grid gap-2 text-sm text-slate-700 dark:text-slate-200 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Marque</span><span className="mt-1 block font-semibold">{recordField(selectedRecord, 'brand') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Référence</span><span className="mt-1 block font-semibold">{recordField(selectedRecord, 'reference') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Forme</span><span className="mt-1 block font-semibold">{recordField(selectedRecord, 'shape') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Genre</span><span className="mt-1 block font-semibold">{recordField(selectedRecord, 'gender') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Couleur</span><span className="mt-1 block font-semibold">{recordField(selectedRecord, 'color') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/60"><span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Emplacement</span><span className="mt-1 block font-semibold">{recordField(selectedRecord, 'to_location_code') || recordField(selectedRecord, 'from_location_code') || '—'}</span></div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRecord(null)
                    onPrint(selectedRecord)
                  }}
                  className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Imprimer l&apos;étiquette
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function distinctValues(records: Movement[], key: string) {
  return Array.from(new Set(records.map(record => recordField(record, key)).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'fr'))
}

/** L'étiquette attend une FinalMonture ; un enregistrement d'historique n'en est pas
 *  une. On ne remplit que ce que l'étiquette imprime — le reste ne serait jamais lu. */
function recordToLabel(record: Movement): FinalMonture {
  return {
    id: recordField(record, 'barcode') || recordField(record, 'id') || '',
    reference: recordField(record, 'reference'),
    marque: recordField(record, 'brand'),
    genre: '',
    forme: '',
    couleur: '',
    matiere: '',
    prix: Number(recordField(record, 'price')) || 0,
    quantite: 1,
    emplacement: recordField(record, 'location_code'),
    photoMonture: '',
    photoBranche: '',
  }
}

// ── Listes reçues ──────────────────────────────────────────────────────────────
interface SendList {
  id: number
  created_at?: string
  session_code?: string
  status?: string
  city?: string
  destination_station_name?: string
  item_count?: number
  sent_count?: number
}

interface SendListItem {
  id: number
  barcode?: string
  reference?: string
  brand?: string
  status?: string
  /** Où la monture est rangée dans ce stock : la case à ouvrir pour la sortir. Vient de la
   *  fiche que `openListe` vient chercher, pas de la ligne de liste. */
  location_code?: string
  [key: string]: any
}

interface Dispatch {
  box_code?: string
  box_reference?: string
  code?: string
  reference?: string
  city?: string
  station_name?: string
  sent_count?: number
  skipped?: { reference?: string; reason?: string }[]
}

function listDispatched(list: SendList) {
  return String(list.status || '').toUpperCase() === 'TRAITEE' || Number(list.sent_count || 0) > 0
}

/** La vérification survit au rechargement : le magasinier scanne un carton de trente
 *  montures, il ne doit pas tout reprendre parce que la page a bougé. */
function verifiedStorageKey(listId: number | string) {
  return `lunetterie.sendlist.verified.${listId}`
}

function loadVerifiedIds(listId: number | string): Set<number> {
  try {
    const raw = window.localStorage.getItem(verifiedStorageKey(listId))
    const parsed = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch {
    return new Set()
  }
}

function saveVerifiedIds(listId: number | string, ids: Set<number>) {
  try {
    window.localStorage.setItem(verifiedStorageKey(listId), JSON.stringify(Array.from(ids)))
  } catch {
    // Stockage indisponible : la vérification reste valable pour la session en cours.
  }
}

function dispatchMessage(dispatch: Dispatch) {
  const count = Number(dispatch.sent_count || 0)
  const plural = count > 1 ? 's' : ''
  let message = `${count} monture${plural} envoyée${plural} vers ${dispatch.station_name || 'la station locale'}.`
  const skipped = dispatch.skipped || []
  if (skipped.length) {
    message += ` Non parties : ${skipped.map(item => `${item.reference} (${item.reason})`).join(', ')}.`
  }
  return message
}

const LISTE_PAGE_SIZE = 10

/** Les listes que la Direction adresse à ce magasin : le magasinier les ouvre, pointe
 *  chaque monture au code-barres, puis déclenche l'envoi du colis. Rien à voir avec les
 *  commandes fournisseur, qui vivent sur l'écran Réceptions. */
function ListesScreen({
  lists, loading, hidden, stationId, onReload, onReturn, hasSession,
}: {
  lists: SendList[]
  loading: boolean
  /** Nombre de listes écartées parce qu'elles visent un autre magasin. */
  hidden: number
  /** La station du compte, d'où part le colis. */
  stationId: string
  onReload: () => void
  onReturn: () => void
  hasSession: boolean
}) {
  const [open, setOpen] = useState<SendList | null>(null)
  const [items, setItems] = useState<SendListItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [verified, setVerified] = useState<Set<number>>(new Set())
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [tone, setTone] = useState<'ok' | 'warn' | 'error' | ''>('')
  const [sending, setSending] = useState(false)
  const [dispatch, setDispatch] = useState<Dispatch | null>(null)
  const [page, setPage] = useState(1)
  const codeRef = useRef<HTMLInputElement>(null)
  /** Verrou de la recherche directe : la vérification passe par le réseau, et sans lui un
   *  second déclenchement sur le même code pointerait la monture deux fois. */
  const verifyingRef = useRef(false)

  async function openListe(list: SendList) {
    setOpen(list)
    setItems([])
    setPage(1)
    setMessage('')
    setTone('')
    setVerified(loadVerifiedIds(list.id))
    setLoadingItems(true)

    try {
      const payload = await apiFetch(`/inventory/send-lists/${list.id}/items`)
      const raw: SendListItem[] = Array.isArray(payload.data?.items) ? payload.data.items : []

      // Chaque ligne est complétée par la fiche de sa monture : photo, forme, couleur.
      // Sans station_id — le passer déclencherait PlaceOnDisplay côté serveur, qui
      // réceptionne les montures EN_TRANSIT. Ouvrir une liste doit rester une lecture.
      const detailed = await Promise.all(raw.map(async item => {
        if (!item.barcode) return item
        try {
          const glassPayload = await apiFetch(`/inventory/glasses/${encodeURIComponent(item.barcode)}`)
          const glass = glassPayload?.data?.glass
          // `glass` porte son propre `id` : sans le rétablir il écraserait celui de la
          // ligne, or c'est sur ce dernier que porte la vérification.
          const merged = glass ? { ...item, ...glass, id: item.id, glass_id: glass.id } : item
          if (item.barcode === 'HA14-00759') {
            console.log('Debug item HA14-00759:', merged)
            console.log('Photo fields:', {
              photo_monture_url: merged.photo_monture_url,
              photo_branche_url: merged.photo_branche_url,
              image_url: merged.image_url,
              branche_image: merged.branche_image,
              all_keys: Object.keys(merged).filter(k => k.includes('photo') || k.includes('image') || k.includes('branche'))
            })
          }
          return merged
        } catch {
          return item
        }
      }))

      setItems(detailed.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))))
    } catch (error) {
      console.error('Erreur chargement des éléments de la liste', error)
      setMessage('Impossible de charger le contenu de cette liste.')
      setTone('error')
    } finally {
      setLoadingItems(false)
    }
  }

  /** `raw` laisse la recherche directe passer la valeur qu'elle vient de reconnaître :
   *  entre le déclenchement de l'effet et l'exécution, le champ a pu être vidé. */
  async function verify(raw?: string) {
    const value = String(raw ?? code).trim()
    if (!value || !open || verifyingRef.current) return
    const needle = value.toLowerCase()

    const match = items.find(item =>
      String(item.barcode || '').toLowerCase() === needle
      || String(item.reference || '').toLowerCase() === needle)

    if (!match) {
      setMessage(`« ${value} » ne figure pas dans cette liste.`)
      setTone('error')
      codeRef.current?.select()
      return
    }
    if (verified.has(match.id)) {
      setMessage(`« ${value} » a déjà été vérifiée.`)
      setTone('warn')
      setCode('')
      return
    }

    // Verrou posé avant l'aller-retour réseau seulement : les refus ci-dessus sont
    // synchrones et n'ont rien à protéger.
    verifyingRef.current = true
    try {
      // Sans station_id, pour ne rien déplacer : on confirme seulement l'existence.
      await apiFetch(`/inventory/glasses/${encodeURIComponent(match.barcode || value)}`)
    } catch {
      setMessage(`« ${value} » est introuvable en base de données.`)
      setTone('error')
      codeRef.current?.select()
      return
    } finally {
      verifyingRef.current = false
    }

    const next = new Set(verified)
    next.add(match.id)
    setVerified(next)
    saveVerifiedIds(open.id, next)

    // La validée remonte en tête et la pagination revient au début : elle doit rester
    // sous les yeux du magasinier.
    setItems(list => [match, ...list.filter(item => item.id !== match.id)])
    setPage(1)

    const remaining = items.length - next.size
    setMessage(remaining === 0
      ? 'Liste complète : toutes les montures sont vérifiées.'
      : `« ${match.reference || match.barcode} » validée.`)
    setTone('ok')
    setCode('')
    codeRef.current?.focus()
  }

  /** Recherche directe : la saisie se vérifie d'elle-même, sans bouton.
   *
   *  Un lecteur de code-barres se comporte comme un clavier — il écrit la trame d'un coup.
   *  Dès qu'elle désigne exactement une monture de la liste, la vérification part : le
   *  magasinier a une monture dans une main et le lecteur dans l'autre, lui réclamer un
   *  appui de plus à chaque pièce n'apporte rien.
   *
   *  L'égalité est stricte, jamais un « commence par » : `LUN-CNG-0002` ne doit pas être
   *  validée en passant devant `LUN-CNG-00021`. Une saisie partielle ne déclenche donc
   *  rien tant qu'elle est incomplète.
   *
   *  Le code inconnu, lui, attend la fin de la frappe avant d'être signalé — annoncer
   *  l'échec à chaque caractère ferait clignoter une erreur sous chaque lettre tapée. */
  useEffect(() => {
    const value = code.trim()
    if (!value || !open || loadingItems || listDispatched(open)) return

    const needle = value.toLowerCase()
    const found = items.some(item =>
      String(item.barcode || '').toLowerCase() === needle
      || String(item.reference || '').toLowerCase() === needle)

    if (found) {
      void verify(value)
      return
    }

    const timer = window.setTimeout(() => {
      setMessage(`« ${value} » ne figure pas dans cette liste.`)
      setTone('error')
    }, 800)
    return () => window.clearTimeout(timer)
    // `verify` est recréée à chaque rendu : la lister relancerait l'effet en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, items, open, loadingItems])

  /** Envoie le colis. Le serveur déduit la station de destination de la ville de la
   *  liste — aucun choix manuel ici — déplace les montures et clôt la liste. */
  async function send() {
    if (!open || sending) return
    setSending(true)
    setMessage('Envoi en cours…')
    setTone('')

    try {
      const payload = await apiFetch('/inventory/send-lists/dispatch', {
        method: 'POST',
        body: JSON.stringify({ id: Number(open.id), from_station_id: Number(stationId) }),
      })
      const result: Dispatch = payload?.data?.dispatch || {}
      setDispatch(result)
      // La vérification a rempli son office : on libère le stockage local de cette liste.
      try { window.localStorage.removeItem(verifiedStorageKey(open.id)) } catch { /* sans conséquence */ }
      setMessage(dispatchMessage(result))
      setTone('ok')
      onReload()
    } catch (error) {
      // Le serveur refuse l'envoi entier quand il ne sait pas où livrer (aucune station
      // pour la ville, ou plusieurs). Son message dit quoi corriger : on le remonte tel
      // quel plutôt qu'un « erreur réseau » qui n'aiderait personne.
      setMessage(error instanceof Error ? error.message : "Impossible d'envoyer la liste.")
      setTone('error')
    } finally {
      setSending(false)
    }
  }

  const toneClass = tone === 'error'
    ? 'text-red-600 dark:text-red-400'
    : tone === 'warn' ? 'text-amber-600 dark:text-amber-400'
    : tone === 'ok' ? 'text-green-700 dark:text-green-400'
    : 'text-slate-400'

  // ── Une liste ouverte ────────────────────────────────────────────────────────
  if (open) {
    const dispatched = listDispatched(open)
    const done = items.filter(item => verified.has(item.id)).length
    const complete = items.length > 0 && done === items.length
    const totalPages = Math.max(1, Math.ceil(items.length / LISTE_PAGE_SIZE))
    const current = Math.min(page, totalPages)
    const rows = items.slice((current - 1) * LISTE_PAGE_SIZE, current * LISTE_PAGE_SIZE)

    // Une liste déjà partie n'a plus rien à vérifier ni à envoyer : la carte de scan et le
    // bouton d'envoi n'ont plus d'objet. Le tableau, lui, garde exactement les colonnes
    // d'origine (Photo/Réf/Marque/Genre/Forme/Emplacement/Entrée/Statut/Prix) — même
    // GlassTable qu'avant, juste sans la carte de scan ni le bouton d'envoi autour.
    if (dispatched) {
      return (
        <div className="mx-auto max-w-4xl space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Btn onClick={() => { setOpen(null); setDispatch(null) }}>{ic.arrowLeft()} Listes</Btn>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{dayLabel(open.created_at)}</p>
              <p className="truncate text-xs text-slate-400">{open.session_code || '—'}</p>
            </div>
          </div>

          {loadingItems ? (
            <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>Chargement du contenu…</div>
          ) : items.length === 0 ? (
            <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>Cette liste est vide.</div>
          ) : (
            // Même habillage que Stock total (en-tête vert, photos 48px) — mêmes colonnes
            // que GlassTable ci-dessous (Photo/Réf/Marque/Genre/Forme/Emplacement/Entrée/
            // Statut/Prix, dans le même ordre), juste pas le même composant partagé.
            <div className="overflow-x-auto rounded-2xl border border-green-200 dark:border-green-700">
              <div className="min-w-[880px]">
                <table className="w-full min-w-full divide-y divide-green-200 dark:divide-green-700 text-xs sm:text-sm">
                  <thead className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-200">
                    <tr>
                      <th className="px-2 py-2 text-left font-semibold">Photo</th>
                      <th className="px-2 py-2 text-left font-semibold">Réf</th>
                      <th className="px-2 py-2 text-left font-semibold">Marque</th>
                      <th className="px-2 py-2 text-left font-semibold">Genre</th>
                      <th className="px-2 py-2 text-left font-semibold">Forme</th>
                      <th className="px-2 py-2 text-left font-semibold">Emplacement</th>
                      <th className="px-2 py-2 text-left font-semibold">Entrée</th>
                      <th className="px-2 py-2 text-left font-semibold">Statut</th>
                      <th className="px-2 py-2 text-right font-semibold">Prix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-green-200 dark:divide-green-700 bg-white dark:bg-slate-900">
                    {rows.map(item => {
                      const photo = recordPhoto(item)
                      return (
                        <tr key={item.id}>
                          <td className="px-2 py-2">
                            {photo ? (
                              <img src={photo} alt="" className="h-12 w-12 rounded-md object-cover" />
                            ) : (
                              <span className="inline-block rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-500 dark:bg-slate-800">—</span>
                            )}
                          </td>
                          <td className="px-2 py-2 font-mono text-slate-900 dark:text-white">{item.reference || item.barcode || '—'}</td>
                          <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{item.brand || '—'}</td>
                          <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{item.gender || '—'}</td>
                          <td className="px-2 py-2 text-slate-700 dark:text-slate-200">{item.shape || '—'}</td>
                          <td className="px-2 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">{item.location_code || '—'}</td>
                          <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                            {dayLabel(item.created_at)} · {formatRecordTime(item.created_at)}
                          </td>
                          <td className="px-2 py-2">
                            <span className="inline-block rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
                              En transit
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right text-slate-700 dark:text-slate-200">{fmtPrix(item.price)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3">
              <Btn onClick={() => setPage(current - 1)} disabled={current <= 1}>{ic.arrowLeft()} Précédent</Btn>
              <span className="text-xs tabular-nums text-slate-400">Page {current} / {totalPages}</span>
              <Btn onClick={() => setPage(current + 1)} disabled={current >= totalPages}>Suivant</Btn>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Btn onClick={() => { setOpen(null); setDispatch(null) }}>{ic.arrowLeft()} Listes</Btn>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
              {dayLabel(open.created_at)}
            </p>
            <p className="truncate text-xs text-slate-400">{open.session_code || '—'}</p>
          </div>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-baseline justify-between gap-3">
            <strong className="text-sm font-bold text-slate-900 dark:text-white">Confirmation des montures</strong>
            <span className="flex-shrink-0 text-xs tabular-nums text-slate-400">{done} / {items.length} vérifiée{done > 1 ? 's' : ''}</span>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Scannez le code-barres de chaque monture : la validation est automatique.
          </p>

          {/* Plus de bouton : la vérification part dès que la saisie désigne une monture.
              Le <form> ne sert plus qu'à absorber l'Entrée que la plupart des lecteurs
              envoient en fin de trame — sans lui, elle rechargerait la page. */}
          <form onSubmit={e => { e.preventDefault(); void verify() }} className="mt-3">
            <input
              ref={codeRef}
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              disabled={dispatched || loadingItems}
              autoComplete="off"
              placeholder="Scannez ou saisissez le code-barres"
              className={`${INPUT} disabled:opacity-50`}
            />
          </form>

          {message && <p className={`mt-2 text-xs ${toneClass}`}>{message}</p>}
        </div>

        {loadingItems ? (
          <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>Chargement du contenu…</div>
        ) : items.length === 0 ? (
          <div className={`${CARD} p-8 text-center text-sm text-slate-400`}>Cette liste est vide.</div>
        ) : (
          // Tableau plutôt qu'une pile de cartes : le magasinier pointe une liste, il compare
          // des lignes entre elles. Même gabarit que le contenu d'un carton côté Responsable
          // et que le présentoir côté Vendeuse — un seul tableau à apprendre pour tout le monde.
          <div className={`${CARD} p-0`}>
            <GlassTable
              title={`liste-${open.session_code || open.id}`}
              after={[{ header: 'Prix', align: 'right' }]}
              rows={rows.map(item => {
                const ok = verified.has(item.id)
                return {
                  key: item.id,
                  photo: recordPhoto(item),
                  branchPhoto: recordPhotoBranche(item),
                  reference: item.reference || item.barcode,
                  brand: item.brand,
                  gender: item.gender,
                  shape: item.shape,
                  // Ici, l'emplacement est celui d'où il faut SORTIR la monture.
                  location: item.location_code,
                  entry: item.created_at,
                  after: [fmtPrix(item.price)],
                  done: dispatched || ok,
                  // Une fois la liste partie, « à vérifier » n'a plus de sens — la coche
                  // vérifiée est locale au navigateur (cf. loadVerifiedIds) et peut avoir
                  // été perdue sans que l'envoi lui-même ait échoué. En transit reflète ce
                  // qui est vraiment vrai : la monture a bien quitté ce magasin.
                  status: dispatched
                    ? { label: 'En transit', tone: 'blue' as const }
                    : ok
                      ? { label: '✓ vérifiée', tone: 'green' as const }
                      : { label: 'à vérifier', tone: 'slate' as const },
                }
              })}
            />
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3">
            <Btn onClick={() => setPage(current - 1)} disabled={current <= 1}>{ic.arrowLeft()} Précédent</Btn>
            <span className="text-xs tabular-nums text-slate-400">Page {current} / {totalPages}</span>
            <Btn onClick={() => setPage(current + 1)} disabled={current >= totalPages}>Suivant</Btn>
          </div>
        )}

        <div className="flex justify-end">
          {/* Une liste déjà partie ne se renvoie pas : le serveur la refuserait, autant
              ne pas réarmer le bouton en la rouvrant. */}
          <Btn variant="primary" onClick={() => void send()} disabled={dispatched || !complete || sending}>
            {ic.send()}
            {dispatched
              ? `En transit vers le stock magasin${(open.destination_station_name || open.city) ? ` (${open.destination_station_name || open.city})` : ''}`
              : sending ? 'Envoi en cours…'
              : complete ? `Envoyer (${items.length})`
              : `Envoyer — ${items.length - done} à vérifier`}
          </Btn>
        </div>

        {dispatch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className={`${CARD} w-full max-w-sm p-5 text-center`}>
              <p className="text-sm font-bold text-slate-900 dark:text-white">Carton d'envoi</p>
              <p className="mt-1 text-xs text-slate-400">
                {dispatch.city || ''} · {dispatch.sent_count || 0} monture{Number(dispatch.sent_count || 0) > 1 ? 's' : ''}
              </p>

              <div className="mt-4 flex flex-col items-center rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700">
                <BarcodePreview value={dispatch.box_code || dispatch.box_reference || dispatch.code || ''} />
                <div className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900">
                  {dispatch.box_code || dispatch.box_reference || dispatch.code || '—'}
                </div>
                <span className="mt-1 text-[11px] text-slate-400">{dispatch.box_reference || dispatch.reference || 'Colis d’expédition'}</span>
              </div>

              {/* Imprimer d'abord, fermer ensuite : la boîte disparaît avec la liste, et
                  le code du carton n'est réaffiché nulle part. L'impression dépose aussi
                  le PNG dans les téléchargements — même filet que l'étiquette de monture,
                  pour le cas où l'imprimante est absente ou la fenêtre bloquée. */}
              <div className="mt-4 flex flex-col gap-2">
                <Btn variant="primary" className="w-full justify-center" onClick={() => void printBoxLabel(dispatch)}>
                  {ic.printer()} Imprimer l'étiquette du carton
                </Btn>
                <Btn className="w-full justify-center" onClick={() => { setDispatch(null); setOpen(null) }}>
                  Fermer
                </Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Choix de la liste ────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {!hasSession && (
        <div className="flex justify-start">
          <Btn variant="outline" onClick={onReturn}>{ic.arrowLeft()} Retour</Btn>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-400">
            {loading ? 'Chargement…' : `${lists.length} liste${lists.length > 1 ? 's' : ''} reçue${lists.length > 1 ? 's' : ''}`}
          </p>
          {/* Rien ne disparaît en silence : si le tri par magasin a écarté des lignes, on
              le dit, sinon un colis manquant resterait inexplicable. */}
          {hidden > 0 && (
            <p className="text-xs text-slate-400">
              {hidden} liste{hidden > 1 ? 's' : ''} destinée{hidden > 1 ? 's' : ''} à un autre magasin, masquée{hidden > 1 ? 's' : ''}.
            </p>
          )}
        </div>
        <Btn onClick={onReload} disabled={loading}>{ic.refresh()} Actualiser</Btn>
      </div>

      {lists.length === 0 && !loading ? (
        <div className={`${CARD} flex flex-col items-center gap-2 p-8 text-center`}>
          <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-8 h-8')}</span>
          <p className="text-sm text-slate-400">Aucune liste reçue.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {[...lists]
            .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
            .map(list => {
              const sent = listDispatched(list)
              const total = Number(list.item_count || 0)
              const count = Number(list.sent_count || 0) || total
              const destination = list.destination_station_name || list.city || ''
              const isToday = dayKey(list.created_at) === todayKey()

              return (
                <button
                  key={list.id}
                  onClick={() => void openListe(list)}
                  className={`bg-white dark:bg-slate-800 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 border-2 ${sent ? 'border-[#16a34a]' : 'border-[#2563eb]'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">
                      {isToday ? 'Aujourd’hui · ' : ''}{dayLabel(list.created_at)}
                    </p>
                    <Pill tone={sent ? 'green' : 'blue'}>{sent ? 'Envoyée' : 'À traiter'}</Pill>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-400">
                    {list.session_code || '—'} · {sent
                      ? `${count} lunettes envoyées${destination ? ` vers ${destination}` : ''}`
                      : `${total} lunettes`}
                  </p>
                </button>
              )
            })}
        </div>
      )}
    </div>
  )
}

/** Le délai avant que la fin d'une réception ramène seule à « Mes sessions ». Assez long
 *  pour lire le code-barres et prendre l'étiquette, assez court pour ne pas faire attendre
 *  devant un écran qui n'attend plus rien. */
const SESSION_DONE_SECONDS = 3

type Screen = 'loading' | 'activation' | 'sessions' | 'wizard' | 'historique' | 'listes'

// ── Coquille Direction ─────────────────────────────────────────────────────────
/** Barre latérale, barre haute et navigation mobile reprises de la Direction
 *  (`src/App.tsx`, déjà rejouées dans `vendeuse.tsx`) : mêmes largeurs, mêmes rayons,
 *  mêmes couleurs. Le magasinier n'a que deux destinations, mais il les porte dans le
 *  même cadre que le reste de l'application. */
const NAV: {
  id: Screen; label: string; short: string
  icon: (c?: string) => React.ReactElement
  /** Seul l'assistant exige une session ouverte : on ne photographie pas une monture
   *  sans réception pour l'accueillir. « Mes sessions » est au contraire l'écran par
   *  lequel on en ouvre ou en reprend une — le verrouiller fermerait la seule porte. */
  needsSession?: boolean
}[] = [
  { id: 'wizard', label: 'Enregistrement', short: 'Scan', icon: ic.camera, needsSession: true },
  { id: 'listes', label: 'Commande à envoyer', short: 'Commandes', icon: ic.send },
  { id: 'historique', label: 'Stock total', short: 'Stock', icon: ic.checkCircle },
  { id: 'sessions', label: 'Mes sessions', short: 'Sessions', icon: ic.calendar },
]

function Sidebar({ current, onNavigate, dark, onToggleDark, user, hasSession, newLists }: {
  current: Screen; onNavigate: (s: Screen) => void
  dark: boolean; onToggleDark: () => void; user: any
  hasSession: boolean; newLists: number
}) {
  const name = `${String(user?.first_name || '').trim()} ${String(user?.last_name || '').trim()}`.trim() || 'Magasinier'
  const initial = (name[0] || 'M').toUpperCase()

  return (
    <aside className="hidden md:flex flex-col w-56 lg:w-60 bg-slate-900 dark:bg-slate-950 h-screen sticky top-0 flex-shrink-0">
      <div className="px-4 py-5 border-b border-slate-800 flex-shrink-0">
        <div className="flex flex-col items-center gap-2.5 text-center">
          {/* Fond blanc nécessaire : le JPEG n'a pas de transparence. */}
          <div className="w-full max-w-[180px] rounded-xl bg-white px-3 py-2">
            <img src={logoUrl} alt="La Lunetterie" className="w-full h-auto object-contain" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Magasinier</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {NAV.filter(item => isFeatureEnabled('magasinier', item.id)).map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            disabled={Boolean(item.needsSession) && !hasSession}
            // Les entrées qui exigent une session restent visibles mais inertes : les
            // faire disparaître ferait sauter la barre entière à l'activation.
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              current === item.id
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-800 disabled:hover:bg-transparent disabled:hover:text-slate-400'
            }`}
          >
            <span className="flex-shrink-0">{item.icon('w-4 h-4')}</span>
            <span className="truncate font-medium">{item.label}</span>
            {item.id === 'listes' && newLists > 0 && (
              <span className="ml-auto flex-shrink-0 rounded-lg bg-[#dc2626] px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white">
                {newLists}
              </span>
            )}
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
            <p className="text-xs text-slate-500 truncate">{user?.station_name || 'Stock général'}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function MobileNav({ current, onNavigate, hasSession, newLists }: {
  current: Screen; onNavigate: (s: Screen) => void
  hasSession: boolean; newLists: number
}) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40">
      <div className="flex">
        {NAV.filter(item => isFeatureEnabled('magasinier', item.id)).map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            disabled={Boolean(item.needsSession) && !hasSession}
            className={`relative flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors disabled:opacity-40 ${
              current === item.id ? 'text-blue-600' : 'text-slate-400'
            }`}
          >
            {item.icon('w-5 h-5')}
            <span className="text-[9px] font-semibold leading-none">{item.short}</span>
            {item.id === 'listes' && newLists > 0 && (
              <span className="absolute right-1/4 top-1 rounded-lg bg-[#dc2626] px-1.5 text-[9px] font-black tabular-nums text-white">
                {newLists}
              </span>
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}

function TopBar({ current, session, dark, onToggleDark, onReset, onBack, historique }: {
  current: Screen
  session: ReceptionSession | null
  dark: boolean
  onToggleDark: () => void
  onReset: (() => void) | null
  onBack: (() => void) | null
  /** Recherche + filtres de l'Historique, sur la même ligne que le titre plutôt que dans
   *  leur propre carte plus bas — la Direction a le même genre de bandeau sur Stock général. */
  historique?: {
    query: string; onQuery: (v: string) => void
    forme: string; onForme: (v: string) => void; formes: string[]
    genre: string; onGenre: (v: string) => void; genres: string[]
    count: number; total: number
  }
}) {
  const label = current === 'activation'
    ? 'Activer une session'
    : NAV.find(item => item.id === current)?.label || 'Enregistrement monture'

  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 min-h-14 py-2 flex flex-wrap items-center gap-3 flex-shrink-0">
      {/* Le retour est en tête, avant le titre : c'est la place qu'il occupe partout
          ailleurs, et sur mobile la barre latérale n'existe pas — sans lui, quitter
          l'assistant demandait de passer par la navigation du bas. */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex-shrink-0 -ml-1 flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Retour à mes sessions"
        >
          {ic.arrowLeft('w-4 h-4')}
          <span className="hidden sm:inline">Retour</span>
        </button>
      )}

      <div className={historique ? 'flex-shrink-0' : 'flex-1 min-w-0'}>
        <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">{label}</h1>
      </div>

      {historique && (
        <div className="flex flex-1 min-w-[220px] flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[160px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search()}</span>
            <input
              type="search"
              value={historique.query}
              onChange={e => historique.onQuery(e.target.value)}
              placeholder="Référence, marque, code-barres, couleur…"
              className={`${INPUT} py-1.5 pl-9 text-xs`}
            />
          </div>
          <select value={historique.forme} onChange={e => historique.onForme(e.target.value)} className={`${SELECT} py-1.5 text-xs`}>
            <option value="">Toutes les formes</option>
            {historique.formes.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={historique.genre} onChange={e => historique.onGenre(e.target.value)} className={`${SELECT} py-1.5 text-xs`}>
            <option value="">Tous les genres</option>
            {historique.genres.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <span className="whitespace-nowrap text-xs text-slate-400">
            {historique.count} monture{historique.count > 1 ? 's' : ''} enregistrée{historique.count > 1 ? 's' : ''}
            {historique.count !== historique.total ? ` sur ${historique.total}` : ''}
          </span>
        </div>
      )}

      {/* Le quota suit le magasinier d'un écran à l'autre : c'est lui qui dit s'il peut
          encore enregistrer, il n'a donc pas sa place dans le seul assistant.

          L'avancement est le chiffre clé de l'écran : il passe en gras, au format des
          chiffres clés du reste de l'application, et reste affiché sur téléphone — il
          disparaissait entièrement sous `sm`, là où la barre latérale n'existe pas et où
          rien d'autre ne le rappelait. Seul le code de session cède la place, c'est la
          partie qu'on relit le moins. */}
      {session && (
        <span className="inline-flex items-center gap-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2 flex-shrink-0">
          <span className="text-blue-600 dark:text-blue-400 flex-shrink-0">{ic.tag('w-5 h-5')}</span>
          <span className="hidden sm:inline text-sm font-semibold text-slate-500 dark:text-slate-400">{session.code}</span>
          <span className="text-xl font-black tabular-nums text-slate-900 dark:text-white leading-none">
            {session.registered}/{session.target}
          </span>
        </span>
      )}

      {onReset && (
        <Btn variant="primary" onClick={onReset} className="flex-shrink-0 px-2.5 md:px-3.5">
          {ic.refresh()} <span className="hidden sm:inline">Nouveau</span>
        </Btn>
      )}

      {/* Thème et déconnexion vivent dans la barre latérale ; sur mobile elle n'existe
          pas, ils remontent donc ici. */}
      <button
        onClick={onToggleDark}
        className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0"
        aria-label="Changer de thème"
      >
        {dark ? ic.sun('w-4 h-4') : ic.moon('w-4 h-4')}
      </button>
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

function ScanPage() {
  const [dark, setDark] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [screen, setScreen] = useState<Screen>('loading')

  // Recherche + filtres de l'écran Historique : portés ici (pas dans HistoriqueScreen) pour
  // que TopBar puisse les afficher sur la même ligne que le titre.
  const [histQuery, setHistQuery] = useState('')
  const [histForme, setHistForme] = useState('')
  const [histGenre, setHistGenre] = useState('')
  const [histPage, setHistPage] = useState(1)

  // Secondes restantes avant le retour automatique à « Mes sessions ». Null tant que la
  // réception n'est pas terminée.
  const [autoRetour, setAutoRetour] = useState<number | null>(null)

  // Session de réception
  const [session, setSession] = useState<ReceptionSession | null>(null)
  const [activationStatus, setActivationStatus] = useState('')
  const [activationError, setActivationError] = useState(false)
  const [movements, setMovements] = useState<Movement[]>([])
  const [lists, setLists] = useState<SendList[]>([])
  const [loadingLists, setLoadingLists] = useState(false)
  const [commands, setCommands] = useState<ReceptionEntry[]>([])
  const [loadingCommands, setLoadingCommands] = useState(false)
  // Si les expéditions sont refusées, on le dit plutôt que d'afficher un « aucune
  // commande » qui ferait croire à un entrepôt vide.
  const [commandsDenied, setCommandsDenied] = useState(false)

  // Assistant
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [captureTarget, setCaptureTarget] = useState<'monture' | 'branche'>('monture')
  const [photoMonture, setPhotoMonture] = useState<string | null>(null)
  const [photoBranche, setPhotoBranche] = useState<string | null>(null)
  const [cameraOn, setCameraOn] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)

  const [form, setForm] = useState<VerifyForm>(EMPTY_FORM)
  const [sources, setSources] = useState<Record<FieldKey, FieldSource>>(EMPTY_SOURCES)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [invalid, setInvalid] = useState<Record<string, boolean>>({})
  /** Forme détectée par l'IA, renvoyée telle quelle au serveur (detected_shape) :
   *  c'est l'écart avec la correction du magasinier qui fait progresser le modèle. */
  const [detectedShape, setDetectedShape] = useState('')
  const [aiMountType, setAiMountType] = useState('')

  const [finalData, setFinalData] = useState<FinalMonture | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // ── Caméra de capture ────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  const startCamera = useCallback(async () => {
    // Sans cette garde, un second appel (retour à l'étape 1, double clic) ouvrirait
    // un deuxième flux et laisserait le premier allumé jusqu'au rechargement.
    if (streamRef.current) return
    const blocked = cameraUnavailableReason()
    if (blocked) { window.alert(blocked); return }
    try {
      const stream = await openCamera()
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraOn(true)
    } catch (error) {
      console.error('Ouverture de la caméra impossible', error)
      window.alert(humanCameraError(error))
      setCameraOn(false)
    }
  }, [])

  // Le flux survit aux changements d'étape mais pas au démontage de la page.
  useEffect(() => () => stopCamera(), [stopCamera])

  /** Ouvre la caméra en arrivant sur la prise de vue.
   *
   *  Un effet plutôt qu'un appel direct dans `activateSession` : React démonte l'écran
   *  d'activation — et avec lui le lecteur de code-barres, qui relâche le capteur — avant
   *  d'exécuter les effets du nouvel écran. Réclamer la caméra plus tôt la demanderait
   *  pendant qu'elle est encore prise.
   *
   *  `cameraOn` est délibérément absent des dépendances : l'inclure relancerait le flux
   *  aussitôt que le magasinier appuie sur « Arrêter ». `startCamera` se garde lui-même
   *  des appels redondants. */
  useEffect(() => {
    if (screen === 'wizard' && step === 1) void startCamera()
  }, [screen, step, startCamera])

  function snapshot() {
    const video = videoRef.current
    if (!video) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  }

  // ── Analyse IA ───────────────────────────────────────────────────────────────
  // Un échec n'interrompt jamais l'enregistrement : les champs restent simplement
  // ouverts à la saisie manuelle.
  async function analyzeMonture(dataUrl: string) {
    setAnalyzing(true)
    try {
      const body = new FormData()
      body.append('image', dataURLtoBlob(dataUrl), 'monture.jpg')
      const payload = await apiFetch('/inventory/analyze', { method: 'POST', body })
      const a = payload.data || {}

      setDetectedShape(a.shape || '')
      setAiMountType(a.mount_type || '')

      const detected: Partial<Record<FieldKey, string>> = {}
      if (a.shape) detected.forme = a.shape
      if (a.color) detected.couleur = normalizeColorValue(a.color)
      if (a.material) detected.matiere = a.material
      if (a.brand) detected.marque = a.brand
      if (a.gender) detected.genre = a.gender

      applyDetection(detected)
    } catch (error) {
      console.warn('Analyse IA indisponible, saisie manuelle requise :', error)
    } finally {
      setAnalyzing(false)
    }
  }

  async function analyzeBranche(dataUrl: string) {
    setAnalyzing(true)
    try {
      const body = new FormData()
      body.append('image', dataURLtoBlob(dataUrl), 'branche.jpg')
      const payload = await apiFetch('/inventory/analyze-branche', { method: 'POST', body })
      const b = payload.data || {}

      const detected: Partial<Record<FieldKey, string>> = {}
      if (b.reference) detected.reference = b.reference
      if (b.brand) detected.marque = b.brand

      applyDetection(detected)
    } catch (error) {
      console.warn('OCR branche indisponible, saisie manuelle requise :', error)
    } finally {
      setAnalyzing(false)
    }
  }

  function applyDetection(detected: Partial<Record<FieldKey, string>>) {
    const keys = Object.keys(detected) as FieldKey[]
    if (keys.length === 0) return
    setForm(previous => ({ ...previous, ...detected }))
    setSources(previous => {
      const next = { ...previous }
      keys.forEach(key => { next[key] = 'detected' })
      return next
    })
    setCollapsed(previous => {
      const next = { ...previous }
      keys.forEach(key => { next[key] = true })
      return next
    })
  }

  function setField(key: keyof VerifyForm, value: string) {
    setForm(previous => ({ ...previous, [key]: value }))
    setInvalid(previous => ({ ...previous, [key]: false }))
    // Un champ détecté que l'on modifie devient « Corrigé » : c'est cette
    // correction qui vaut vérité face à la prédiction du modèle.
    if (key in EMPTY_SOURCES) {
      setSources(previous => (previous[key as FieldKey] === 'detected'
        ? { ...previous, [key]: 'corrected' }
        : previous))
    }
  }

  // ── Capture ──────────────────────────────────────────────────────────────────
  const photo = captureTarget === 'monture' ? photoMonture : photoBranche

  function capture() {
    const dataUrl = snapshot()
    if (!dataUrl) return
    if (captureTarget === 'monture') {
      setPhotoMonture(dataUrl)
      void analyzeMonture(dataUrl)
    } else {
      setPhotoBranche(dataUrl)
      void analyzeBranche(dataUrl)
    }
  }

  function retake() {
    if (captureTarget === 'monture') setPhotoMonture(null)
    else setPhotoBranche(null)
  }

  function nextCapture() {
    if (captureTarget === 'monture') {
      if (!photoMonture) return
      setCaptureTarget('branche')
      // La caméra reste ouverte entre les deux photos : la relancer coûterait une
      // seconde de noir et, sur mobile, un nouveau geste utilisateur.
      return
    }
    if (!photoBranche) return
    stopCamera()
    setStep(2)
  }

  // ── Étape 2 → 3 ──────────────────────────────────────────────────────────────
  function gammePrice() {
    if (form.gamme === 'luxe' && form.prixCustom.trim()) {
      const numeric = Number(form.prixCustom.trim())
      return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
    }
    return normalizePriceValue(form.gamme)
  }

  async function confirmVerification() {
    const required: (keyof VerifyForm)[] = ['reference', 'marque', 'genre', 'forme', 'couleur', 'gamme']
    const nextInvalid: Record<string, boolean> = {}
    required.forEach(key => { if (!String(form[key]).trim()) nextInvalid[key] = true })

    if (form.gamme === 'luxe') {
      const numeric = Number(form.prixCustom.trim())
      if (!form.prixCustom.trim() || !Number.isFinite(numeric) || numeric <= 0) nextInvalid.prixCustom = true
    }

    if (Object.keys(nextInvalid).length > 0) {
      setInvalid(nextInvalid)
      // Un champ replié en erreur resterait invisible : on rouvre ce qui bloque.
      setCollapsed(previous => {
        const next = { ...previous }
        Object.keys(nextInvalid).forEach(key => { next[key] = false })
        return next
      })
      window.alert('Veuillez remplir tous les champs obligatoires.')
      return
    }

    setConfirming(true)
    let locationCode: string
    let barcode = ''
    try {
      // Aperçu seulement : l'emplacement n'est pas réservé, celui réellement attribué
      // peut différer si un autre poste le prend entre-temps. Le serveur tranche.
      const payload = await apiFetch(`/inventory/storage/next-free?station_id=${stationIdOf(user)}&zone=STOCK`)
      locationCode = payload.data?.code || '—'
    } catch (error: any) {
      window.alert(`Impossible de trouver un emplacement libre en stock : ${error?.message || 'erreur inconnue'}`)
      setConfirming(false)
      return
    }

    try {
      // Le vrai numéro, réservé pour cette monture. L'aperçu affichait auparavant un
      // `MNT-2026-…` tiré au hasard : il ressemblait à un identifiant sans en être un, et
      // ne correspondait jamais au code que la monture allait porter.
      const payload = await apiFetch('/inventory/barcodes/next')
      barcode = String(payload.data?.barcode || '')
    } catch (error) {
      // Sans blocage : le serveur en attribuera un à l'enregistrement, comme avant cette
      // réservation. Seul l'aperçu est en retrait, et il le dit plutôt que d'inventer.
      console.warn('Code-barres non réservé, il sera attribué à l\'enregistrement', error)
    } finally {
      setConfirming(false)
    }

    setFinalData({
      id: barcode,
      reference: form.reference.trim(),
      marque: form.marque.trim(),
      genre: form.genre,
      forme: form.forme,
      couleur: form.couleur,
      matiere: form.matiere,
      prix: gammePrice(),
      quantite: 1,
      emplacement: locationCode,
      photoMonture: photoMonture || '',
      photoBranche: photoBranche || '',
    })
    setStep(3)
  }

  // ── Étape 3 : enregistrement réel ────────────────────────────────────────────
  async function saveRecord() {
    if (!finalData) return
    if (!session || session.registered >= session.target) {
      window.alert('La session est absente ou son quota est atteint. Activez une nouvelle session avant de continuer.')
      return
    }

    setSaving(true)
    try {
      const body = new FormData()
      body.append('image', dataURLtoBlob(finalData.photoMonture), 'monture.jpg')
      body.append('branche_image', dataURLtoBlob(finalData.photoBranche), 'branche.jpg')
      body.append('station_id', stationIdOf(user))
      body.append('price', String(finalData.prix))
      body.append('reception_command_code', session.code)
      // Le numéro réservé pour l'aperçu, pour que l'étiquette imprimée porte bien celui que
      // le magasinier a vu. Absent si la réservation a échoué : le serveur en génère un.
      if (finalData.id) body.append('barcode', finalData.id)
      body.append('reference', finalData.reference)
      body.append('brand', finalData.marque)
      body.append('gender', finalData.genre)
      body.append('shape', finalData.forme)
      body.append('detected_shape', detectedShape)
      body.append('color', finalData.couleur)
      body.append('material', finalData.matiere)
      body.append('mount_type', aiMountType)

      const payload = await apiFetch('/inventory/reception', { method: 'POST', body })
      const data = payload.data || {}

      // Les valeurs prévisualisées étaient fictives : le code-barres, l'ID et
      // l'emplacement qui comptent sont ceux que le serveur vient d'attribuer.
      const recorded: FinalMonture = {
        ...finalData,
        id: data.barcode || finalData.id,
        glassId: data.glass_id,
        emplacement: data.location_code || data.location || finalData.emplacement,
      }
      setFinalData(recorded)
      // Pour que « Mes sessions » puisse regrouper cette monture par session plus tard,
      // même si le serveur ne le redit pas lui-même sur le mouvement (cf. SessionsGate).
      rememberBarcodeSession(recorded.id, session.code)

      await incrementSession()

      setSaved(true)
      playSuccessChime()
      showToast(`Monture enregistrée — ${recorded.id}`)
      // Pas de retour automatique à la caméra : la boîte d'impression est modale et
      // surgirait par-dessus un flux déjà relancé.
      void printMontureLabel(recorded)
    } catch (error: any) {
      console.error('Erreur enregistrement monture', error)
      window.alert(error?.message || "Échec de l'enregistrement de la monture")
    } finally {
      setSaving(false)
    }
  }

  function showToast(text: string) {
    setToast(text)
    window.setTimeout(() => setToast(''), 3200)
  }

  // ── Session de réception ─────────────────────────────────────────────────────
  const activateSession = useCallback(async (rawCode: string) => {
    const code = String(rawCode || '').trim().toUpperCase()
    if (!code) {
      setActivationStatus('Saisissez ou scannez le code de session.')
      setActivationError(true)
      return false
    }

    try {
      const payload = await apiFetch(`/inventory/reception-commands/${encodeURIComponent(code)}`)
      const command = payload.data?.command || payload.data
      if (!command || command.status !== 'active') {
        setActivationStatus('Ce code est invalide ou la session est fermée.')
        setActivationError(true)
        return false
      }
      if (Number(command.registered_count || 0) >= Number(command.target_count || 0)) {
        setActivationStatus('Cette session a déjà atteint son nombre de montures.')
        setActivationError(true)
        return false
      }

      // Le suivi des réceptions coche « Reçu » sur ce scan, pas sur la première
      // monture : on horodate donc l'activation dès la lecture du code. Un échec
      // ici ne doit pas bloquer le magasinier — seul l'affichage du suivi attendra.
      try {
        await apiFetch(`/inventory/reception-commands/${encodeURIComponent(code)}/activate`, { method: 'POST' })
      } catch (error) {
        console.warn('Activation de session non enregistrée côté serveur', error)
      }

      const active: ReceptionSession = {
        code: String(command.code),
        registered: Number(command.registered_count || 0),
        target: Number(command.target_count || 0),
        status: String(command.status),
      }
      // Ce scan est la seule trace qu'on gardera de la session : l'état React ne survit pas
      // au rechargement, et le serveur refuse de lister ses commandes au magasinier. Sans
      // cette ligne, revenir sur la page obligerait à rescanner l'étiquette.
      rememberScannedCode(active.code)
      setSession(active)
      setActivationError(false)
      setActivationStatus('')

      // Scanner l'étiquette EST le geste qui ouvre la réception : on enchaîne sur
      // l'assistant. Repasser par « Mes sessions » renverrait le magasinier sur la liste
      // qu'il vient de quitter, une monture déjà en main.
      //
      // La caméra n'est volontairement pas démarrée ici : le lecteur de code-barres tient
      // encore le capteur — `createScanner` n'appelle `stop()` qu'après le retour de
      // `onDetect`, donc après cette ligne — et plusieurs Android refusent le second flux
      // (NotReadableError). C'est l'effet d'entrée dans l'assistant qui s'en charge, une
      // fois l'écran d'activation démonté.
      const restant = Math.max(0, active.target - active.registered)
      showToast(`Session ${active.code} ouverte — ${restant} monture${restant > 1 ? 's' : ''} à enregistrer`)
      setStep(1)
      setScreen('wizard')
      return true
    } catch (error) {
      // 404 / 400 : c'est le code qui ne vaut rien, pas le serveur. Le magasinier
      // doit lire « ce code est invalide », sinon il attend un rétablissement réseau
      // qui n'arrivera jamais.
      const status = error instanceof ApiError ? error.status : 0
      if (status === 404 || status === 400) {
        setActivationStatus('Ce code est invalide ou la session est fermée.')
      } else {
        console.error('Erreur activation session', error)
        setActivationStatus('Impossible de valider la session sur le serveur. Réessayez.')
      }
      setActivationError(true)
      return false
    }
  }, [])

  async function incrementSession() {
    if (!session) return
    try {
      const payload = await apiFetch(
        `/inventory/reception-commands/${encodeURIComponent(session.code)}/increment`,
        { method: 'POST' },
      )
      const command = payload.data?.command || payload.data || {}

      // Défensif : si /increment ne renvoie pas registered_count / target_count sous
      // la forme attendue, `target` ne doit surtout pas tomber à 0 — la vérification
      // « registered >= target » croirait la session terminée après une seule monture
      // et fermerait le flux d'enregistrement à tort.
      const parsedRegistered = Number(command.registered_count)
      const parsedTarget = Number(command.target_count)
      const nextRegistered = Number.isFinite(parsedRegistered) ? parsedRegistered : session.registered + 1
      const nextTarget = Number.isFinite(parsedTarget) && parsedTarget > 0 ? parsedTarget : session.target
      if (!Number.isFinite(parsedRegistered) || !Number.isFinite(parsedTarget) || parsedTarget <= 0) {
        console.warn('Réponse inattendue de /increment, valeurs de secours utilisées :', command)
      }

      setSession({ ...session, registered: nextRegistered, target: nextTarget, status: command.status || session.status })
    } catch (error) {
      console.error('Erreur incrémentation commande', error)
    }
  }

  const loadMovements = useCallback(async (userId?: string) => {
    try {
      const query = userId
        ? `?user_id=${encodeURIComponent(userId)}&action=RECEPTION_FOURNISSEUR&limit=300`
        : '?action=RECEPTION_FOURNISSEUR&limit=300'
      const payload = await apiFetch(`/inventory/movements${query}`)
      setMovements(Array.isArray(payload.data?.movements) ? payload.data.movements : [])
    } catch (error) {
      console.error('Erreur chargement des sessions précédentes', error)
      setMovements([])
    }
  }, [])

  const loadLists = useCallback(async (silent = false) => {
    if (!silent) setLoadingLists(true)
    try {
      const payload = await apiFetch('/inventory/send-lists')
      setLists(Array.isArray(payload.data?.lists) ? payload.data.lists : [])
    } catch (error) {
      // Une liste indisponible ne doit pas empêcher d'enregistrer : c'est un écran de
      // consultation, le poste reste utilisable sans lui.
      console.error('Erreur chargement des listes reçues', error)
      setLists([])
    } finally {
      setLoadingLists(false)
    }
  }, [])

  /** Les commandes que la Direction a préparées, et l'avancement de celles déjà scannées.
   *
   *  Deux sources, parce que le magasinier n'a pas les mêmes droits sur les deux :
   *  `/inventory/expeditions` est ouvert à tout compte et donne la commande telle que la
   *  Direction l'a envoyée ; la session, elle, ne se relit que code par code, ceux qu'on a
   *  retenus au scan. Croiser les deux sur `supplier_order_id` rattache l'avancement à sa
   *  commande. */
  const loadCommands = useCallback(async (silent = false) => {
    if (!silent) setLoadingCommands(true)
    try {
      const codes = loadScannedCodes()
      const scannedSet = new Set(codes)

      const [ordersPayload, listPayload] = await Promise.all([
        apiFetchOptional('/inventory/expeditions'),
        apiFetchOptional('/inventory/reception-commands'),
      ])

      // Les sessions ouvertes, indexées par la commande qu'elles servent. `actives` les
      // garde aussi à plat : c'est lui qui fait foi pour « Mes sessions », l'index par
      // commande ne sert qu'à rattacher une session à sa ligne d'expédition.
      const parCommande = new Map<number, any>()
      const actives: any[] = []
      const retenir = (command: any) => {
        if (!command?.code || command.status !== 'active') return
        actives.push(command)
        const orderId = Number(command.supplier_order_id || 0)
        if (orderId > 0) parCommande.set(orderId, command)
      }

      if (listPayload) {
        for (const command of listPayload.data?.commands || []) retenir(command)
        // Les codes retenus localement dont la session est close n'ont plus rien à dire.
        const vivants = codes.filter(code =>
          (listPayload.data?.commands || []).some((c: any) => c.code === code && c.status === 'active'))
        if (vivants.length !== codes.length) saveScannedCodes(vivants)
      } else {
        // Serveur pas encore redéployé, ou compte sans droit de lecture : on retombe sur le
        // seul chemin qui reste ouvert, code par code, pour ce que ce poste a scanné.
        const payloads = await Promise.all(
          codes.map(code => apiFetchOptional(`/inventory/reception-commands/${encodeURIComponent(code)}`)),
        )
        const vivants: string[] = []
        payloads.forEach((payload, index) => {
          const command = payload?.data?.command || payload?.data
          if (!command?.code || command.status !== 'active') return
          vivants.push(codes[index])
          retenir(command)
        })
        if (vivants.length !== codes.length) saveScannedCodes(vivants)
      }

      const orders = ordersPayload?.data?.orders || []
      // Les expéditions sont refusées : sans elles il reste les sessions scannées, mais on
      // ne peut plus annoncer les commandes que la Direction vient d'envoyer.
      setCommandsDenied(!ordersPayload)

      const entries: ReceptionEntry[] = orders.map((order: any): ReceptionEntry => {
        const orderId = Number(order.id || 0)
        const command = parCommande.get(orderId)
        return {
          key: `EXP-${orderId}`,
          orderId,
          orderDate: order.order_date || undefined,
          supplier: order.supplier || undefined,
          note: order.note || undefined,
          quantity: Number(order.quantity || 0),
          code: command?.code ? String(command.code) : undefined,
          targetCount: command ? Number(command.target_count || 0) : undefined,
          registeredCount: command ? Number(command.registered_count || 0) : undefined,
          status: command ? String(command.status || '') : undefined,
          activatedAt: command?.activated_at || null,
          scanned: Boolean(command?.code) && scannedSet.has(String(command.code)),
        }
      })

      // Toute session ouverte que le croisement n'a pas placée garde sa ligne : celles
      // sans expédition rattachée, mais aussi celles dont la commande manque au journal
      // des expéditions. Elles sont ouvertes, donc reprenables, et les perdre ici
      // bloquerait une réception en cours — c'est exactement ce que cet écran répare.
      const rattachees = new Set(entries.map(entry => entry.code).filter(Boolean))
      for (const command of actives) {
        const code = String(command.code)
        if (rattachees.has(code)) continue
        entries.push({
          key: code,
          orderId: Number(command.supplier_order_id || 0),
          orderDate: command.created_at || undefined,
          quantity: Number(command.target_count || 0),
          code,
          targetCount: Number(command.target_count || 0),
          registeredCount: Number(command.registered_count || 0),
          status: String(command.status || ''),
          activatedAt: command.activated_at || null,
          scanned: scannedSet.has(code),
        })
      }

      setCommands(entries)
    } finally {
      setLoadingCommands(false)
    }
  }, [])

  // ── Garde ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!getToken()) {
      window.location.replace('/magasin.html')
      return
    }
    void (async () => {
      try {
        const payload = await apiFetch('/auth/me')
        const account = payload?.data?.user
        if (!account) throw new Error('session invalide')
        // Le rôle est relu auprès du serveur, jamais cru sur parole depuis localStorage.
        const role = String(getRoleName(account))
        if (!ALLOWED_ROLES.includes(role)) {
          window.location.replace('/magasin.html')
          return
        }
        // Poste désactivé depuis la page Fonctionnalités : SUPER_ADMIN excepté, comme les
        // autres verrous de ce garde — il entre par la Direction, pas par le poste Magasinier.
        if (role !== 'SUPER_ADMIN' && !isPosteEnabled('magasinier')) {
          window.location.replace('/magasin.html')
          return
        }
        window.localStorage.setItem('user', JSON.stringify(account))
        setUser(account)
        // On atterrit sur « Mes sessions », pas sur l'activation : au rechargement comme
        // le lendemain, le magasinier doit voir ses réceptions en cours et choisir
        // laquelle reprendre. Rouvrir une session d'office serait pire que l'activation —
        // avec plusieurs réceptions ouvertes, ce serait la mauvaise une fois sur deux.
        setScreen('sessions')
        void loadMovements(account.id)
        void loadLists()
        void loadCommands()
      } catch {
        logoutToLogin()
      }
    })()
  }, [loadMovements, loadLists, loadCommands])

  // Rafraîchissement silencieux de « Mes sessions » / « Listes reçues » — seulement sur ces
  // deux écrans de consultation, jamais pendant l'assistant : un magasinier au milieu d'une
  // capture caméra ou d'une vérification ne doit pas voir ses données bouger sous lui.
  // Même cadence que la Direction (App.tsx) : 15 s, uniquement onglet visible.
  useEffect(() => {
    if (screen !== 'sessions' && screen !== 'listes') return

    const refresh = () => {
      void loadCommands(true)
      if (screen === 'listes') void loadLists(true)
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const refreshInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 15000)
    window.addEventListener('focus', handleVisibility)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.clearInterval(refreshInterval)
      window.removeEventListener('focus', handleVisibility)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [screen, loadCommands, loadLists])

  // ── Réinitialisation ─────────────────────────────────────────────────────────
  function resetAll(skipConfirm = false) {
    if (!skipConfirm && step > 1 && !window.confirm('Voulez-vous vraiment recommencer ?')) return

    stopCamera()
    setPhotoMonture(null)
    setPhotoBranche(null)
    setCaptureTarget('monture')
    setForm(EMPTY_FORM)
    setSources(EMPTY_SOURCES)
    setCollapsed({})
    setInvalid({})
    setDetectedShape('')
    setAiMountType('')
    setFinalData(null)
    setSaved(false)

    // Quota atteint : la session ne peut plus rien recevoir. On renvoie à « Mes sessions »
    // plutôt qu'à l'activation — c'est là que le magasinier voit la réception qu'il vient
    // de terminer et celles qui l'attendent encore, au lieu d'un écran qui ne sait que
    // réclamer une étiquette. `loadCommands` relit l'avancement au passage : la carte doit
    // montrer la monture tout juste enregistrée.
    if (!session || session.registered >= session.target) {
      if (session) showToast(`Réception ${session.code} terminée — ${session.registered}/${session.target}`)
      setSession(null)
      setActivationError(false)
      setActivationStatus('')
      setScreen('sessions')
      void loadCommands()
      return
    }

    setStep(1)
    setScreen('wizard')
    void startCamera()
  }

  /** Quitter l'assistant pour « Mes sessions » sans refermer la réception en cours.
   *
   *  La caméra s'arrête — la carte de capture est démontée, sa piste resterait ouverte —
   *  et l'avancement se relit, sinon la carte de la session afficherait un compteur
   *  d'avant la dernière monture. */
  function goToSessions() {
    stopCamera()
    setScreen('sessions')
    void loadCommands()
  }

  function enterSession() {
    setScreen('wizard')
    setStep(1)
    // Ce clic est le geste utilisateur qui autorise l'accès caméra sur mobile ; un
    // démarrage silencieux au chargement de la page serait souvent bloqué.
    if (!cameraOn) void startCamera()
  }

  /** Scanner ou taper un code de session, nouvelle ou déjà entamée : les deux passent par
   *  activateSession, qui la (ré)ouvre dans les deux cas (elle refait juste le point sur
   *  le serveur à chaque fois). Cette enveloppe n'ajoute que les deux garde-fous qui
   *  protégeaient autrefois « Continuer l'enregistrement » depuis la liste des commandes :
   *  rouvrir l'assistant sans rien relire si c'est déjà la session en cours sur ce poste, et
   *  confirmer avant d'en fermer une autre — personne ne doit perdre une réception entamée
   *  sur un scan mal cadré. */
  async function activateOrResume(rawCode: string) {
    const code = String(rawCode || '').trim().toUpperCase()
    if (session && code && session.code === code) {
      enterSession()
      return true
    }
    if (session && code) {
      const restant = Math.max(0, session.target - session.registered)
      const confirme = window.confirm(
        `La session ${session.code} est ouverte (${restant} monture(s) restante(s)).\n\n`
        + 'Ouvrir cette autre session la fermera sur ce poste. Continuer ?',
      )
      if (!confirme) return false
    }
    return activateSession(code)
  }

  /** Navigation de la barre latérale. Quitter l'assistant démonte la carte de capture,
   *  donc le <video> : sans arrêt explicite, la piste caméra resterait ouverte et la
   *  diode du téléphone allumée sur un écran qui ne filme plus. `enterSession` la
   *  rallume au retour. */
  function navigate(next: Screen) {
    if (next === screen) return
    if (screen === 'wizard') stopCamera()
    if (next === 'wizard') {
      enterSession()
      return
    }
    // Les compteurs de réception bougent à chaque monture enregistrée, ici comme sur les
    // autres postes : la liste se relit à l'ouverture plutôt qu'au seul chargement de la
    // page, sinon elle affiche l'avancement d'il y a une heure.
    if (next === 'listes' || next === 'sessions') void loadCommands()
    setScreen(next)
  }

  // Un écran désactivé depuis la page Fonctionnalités (Direction) ne doit pas rester
  // ouvert juste parce qu'on l'avait déjà sous les yeux — on retombe sur le premier
  // écran encore actif du menu. 'loading'/'activation' ne sont pas des écrans du menu,
  // ce garde-fou ne les concerne pas.
  const [, forceFlagsRerender] = useState(0)
  useEffect(() => {
    const handler = () => forceFlagsRerender(n => n + 1)
    window.addEventListener('storage', handler)
    window.addEventListener(FEATURE_FLAGS_EVENT, handler)
    return () => {
      window.removeEventListener('storage', handler)
      window.removeEventListener(FEATURE_FLAGS_EVENT, handler)
    }
  }, [])
  useEffect(() => {
    if (!NAV.some(item => item.id === screen)) return
    if (isFeatureEnabled('magasinier', screen)) return
    const fallback = NAV.find(item => isFeatureEnabled('magasinier', item.id))
    if (fallback) navigate(fallback.id)
  })

  // ── Rendu ────────────────────────────────────────────────────────────────────
  // Le compteur ne retient que ce qui reste à traiter : une liste déjà partie n'appelle
  // plus aucun geste.
  const newLists = lists.filter(list => !listDispatched(list)).length

  // Le quota est épuisé : plus rien ne peut être enregistré sur cette session, la sortie
  // n'est donc plus une option mais la seule suite possible.
  const sessionFull = !session || session.registered >= session.target

  // La dernière monture de la réception vient d'être enregistrée : on repart seul vers
  // « Mes sessions ». Le délai laisse le temps de lire le code-barres et de récupérer
  // l'étiquette qui sort de l'imprimante ; le bouton reste actif pour partir avant.
  //
  // Le décompte est affiché plutôt que silencieux : un écran qui change tout seul sans
  // prévenir se lit comme une perte de saisie.
  useEffect(() => {
    if (!saved || !sessionFull || screen !== 'wizard') {
      setAutoRetour(null)
      return
    }

    setAutoRetour(SESSION_DONE_SECONDS)
    const tic = window.setInterval(() => {
      setAutoRetour(reste => (reste === null ? null : Math.max(0, reste - 1)))
    }, 1000)
    const sortie = window.setTimeout(() => resetAll(true), SESSION_DONE_SECONDS * 1000)

    return () => {
      window.clearInterval(tic)
      window.clearTimeout(sortie)
    }
  }, [saved, sessionFull, screen])

  const histFormes = useMemo(() => distinctValues(movements, 'shape'), [movements])
  const histGenres = useMemo(() => distinctValues(movements, 'gender'), [movements])
  const histFilteredCount = useMemo(() => {
    const needle = histQuery.trim().toLowerCase()
    return movements.filter(record => {
      if (histForme && recordField(record, 'shape') !== histForme) return false
      if (histGenre && recordField(record, 'gender') !== histGenre) return false
      if (!needle) return true
      return ['reference', 'brand', 'barcode', 'color']
        .some(key => recordField(record, key).toLowerCase().includes(needle))
    }).length
  }, [movements, histQuery, histForme, histGenre])

  return (
    <div className={dark ? 'dark' : ''}>
      <style>{SCAN_CSS}</style>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
        <Sidebar
          current={screen}
          onNavigate={navigate}
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          user={user}
          hasSession={Boolean(session)}
          newLists={newLists}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            current={screen}
            session={session}
            dark={dark}
            onToggleDark={() => setDark(d => !d)}
            onReset={screen === 'wizard' ? () => resetAll() : null}
            // Seulement depuis l'assistant : « Mes sessions » est l'écran d'où l'on vient,
            // et les autres onglets sont à un clic dans la navigation.
            //
            // goToSessions et non setScreen : il arrête la caméra — la carte de capture est
            // démontée, sa piste resterait ouverte, diode allumée — et relit l'avancement,
            // sinon la carte de la session afficherait un compteur d'avant la dernière
            // monture enregistrée.
            onBack={screen === 'wizard' ? () => goToSessions() : null}
            historique={screen === 'historique' ? {
              query: histQuery,
              onQuery: v => { setHistQuery(v); setHistPage(1) },
              forme: histForme,
              onForme: v => { setHistForme(v); setHistPage(1) },
              formes: histFormes,
              genre: histGenre,
              onGenre: v => { setHistGenre(v); setHistPage(1) },
              genres: histGenres,
              count: histFilteredCount,
              total: movements.length,
            } : undefined}
          />

          <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 overflow-auto">
          {screen === 'loading' && null}

          {screen === 'activation' && (
            <ActivationGate
              status={activationStatus}
              isError={activationError}
              onActivate={activateOrResume}
              onReturn={goToSessions}
            />
          )}

          {screen === 'sessions' && (
            <SessionsGate
              movements={movements}
              commands={commands}
              status={activationStatus}
              isError={activationError}
              onActivate={activateOrResume}
              onPrint={record => void printMontureLabel(recordToLabel(record))}
            />
          )}

          {screen === 'historique' && (
            <HistoriqueScreen
              movements={movements}
              onPrint={record => void printMontureLabel(recordToLabel(record))}
              query={histQuery}
              forme={histForme}
              genre={histGenre}
              page={histPage}
              onPageChange={setHistPage}
            />
          )}

          {screen === 'listes' && (
            <ListesScreen
              lists={lists}
              loading={loadingLists}
              // Le serveur ne renvoie que les listes de ce magasin : rien n'est écarté
              // ici. La reprise des réceptions, elle, vit désormais dans « Mes sessions ».
              hidden={0}
              stationId={stationIdOf(user)}
              onReload={() => { void loadLists(); void loadCommands() }}
              onReturn={goToSessions}
              hasSession={Boolean(session)}
            />
          )}

          {screen === 'wizard' && (
            <div className="mx-auto max-w-4xl">
              {/* Le <video> vit dans cette carte : la démonter entre les deux photos
                  couperait le flux, d'où une seule vue de capture réutilisée. */}
              <div className={step === 1 ? '' : 'hidden'}>
                <CaptureCard
                  target={captureTarget}
                  photo={photo}
                  cameraOn={cameraOn}
                  videoRef={videoRef}
                  analyzing={analyzing}
                  onStart={() => void startCamera()}
                  onStop={stopCamera}
                  onCapture={capture}
                  onRetake={retake}
                  onNext={nextCapture}
                />
              </div>

              {step === 2 && (
                <div className={CARD}>
                  <CardHead
                    icon={ic.check2('w-4 h-4')}
                    title="Étape 2 · Vérification"
                    pill={<Pill tone={analyzing ? 'blue' : 'slate'}>{analyzing ? 'Analyse IA en cours…' : 'Vérifiez les champs signalés'}</Pill>}
                  />

                  <div className="grid gap-4 p-4 lg:grid-cols-[260px_1fr]">
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
                      <PhotoBox url={photoMonture} label="Monture" />
                      <PhotoBox url={photoBranche} label="Branche" />
                    </div>

                    <div className="space-y-2.5">
                      <Field
                        icon={ic.tag()} label="Référence" source={sources.reference}
                        collapsed={collapsed.reference} summary={form.reference} invalid={invalid.reference}
                        onExpand={() => setCollapsed(p => ({ ...p, reference: false }))}
                      >
                        <input
                          type="text" value={form.reference} placeholder="RB2180-001" className={INPUT}
                          onChange={e => setField('reference', e.target.value)}
                        />
                      </Field>

                      <Field
                        icon={ic.building()} label="Marque" source={sources.marque}
                        collapsed={collapsed.marque} summary={form.marque} invalid={invalid.marque}
                        onExpand={() => setCollapsed(p => ({ ...p, marque: false }))}
                      >
                        {/* Seule suggestion quand l'IA n'a rien lu ; le champ reste libre. */}
                        <input
                          type="text" list="marquesList" value={form.marque} placeholder="Ray-Ban" className={INPUT}
                          onChange={e => setField('marque', e.target.value)}
                        />
                        <datalist id="marquesList"><option value="OPAL" /></datalist>
                      </Field>

                      <Field
                        icon={ic.gender()} label="Genre" source={sources.genre}
                        collapsed={collapsed.genre} summary={form.genre} invalid={invalid.genre}
                        onExpand={() => setCollapsed(p => ({ ...p, genre: false }))}
                      >
                        <select value={form.genre} className={INPUT} onChange={e => setField('genre', e.target.value)}>
                          <option value="">Sélectionner un genre</option>
                          {GENRES.map(genre => <option key={genre} value={genre}>{genre}</option>)}
                        </select>
                      </Field>

                      <Field
                        icon={ic.shapes()} label="Forme" source={sources.forme}
                        collapsed={collapsed.forme} summary={form.forme} invalid={invalid.forme}
                        onExpand={() => setCollapsed(p => ({ ...p, forme: false }))}
                      >
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                          {FORMES.map(forme => {
                            const selected = form.forme === forme
                            return (
                              <button
                                key={forme}
                                type="button"
                                onClick={() => setField('forme', forme)}
                                className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[11px] font-semibold transition-all ${selected
                                  ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]'
                                  : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}
                              >
                                <ShapeIcon name={forme} />
                                <span className="text-center leading-tight">{forme === 'Oeil de chat' ? 'Œil de chat' : forme}</span>
                              </button>
                            )
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400">
                          Choisissez la forme réelle de la monture : ça aide l'IA à mieux la reconnaître.
                        </p>
                      </Field>

                      <Field
                        icon={ic.palette()} label="Couleur" source={sources.couleur}
                        collapsed={collapsed.couleur} summary={form.couleur} invalid={invalid.couleur}
                        onExpand={() => setCollapsed(p => ({ ...p, couleur: false }))}
                      >
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                          {COULEURS.map(({ value, swatch }) => {
                            const selected = form.couleur === value
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setField('couleur', value)}
                                className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition-all ${selected
                                  ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]'
                                  : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}
                              >
                                <span
                                  className="h-4 w-4 flex-shrink-0 rounded-full border border-slate-300 dark:border-slate-600"
                                  style={{ background: swatch }}
                                />
                                <span className="truncate">{value}</span>
                              </button>
                            )
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-slate-400">
                          Choisissez la couleur réelle de la monture : ça aide l'IA à mieux la reconnaître.
                        </p>
                      </Field>

                      <Field
                        icon={ic.cube()} label="Matière" source={sources.matiere}
                        collapsed={collapsed.matiere} summary={form.matiere}
                        onExpand={() => setCollapsed(p => ({ ...p, matiere: false }))}
                      >
                        <select value={form.matiere} className={INPUT} onChange={e => setField('matiere', e.target.value)}>
                          <option value="">Sélectionner une matière</option>
                          {MATIERES.map(matiere => <option key={matiere} value={matiere}>{matiere}</option>)}
                        </select>
                      </Field>

                      {/* La gamme n'est jamais détectée : toujours ouverte. */}
                      <Field icon={ic.banknote()} label="Gamme" invalid={invalid.gamme || invalid.prixCustom}>
                        <select value={form.gamme} className={INPUT} onChange={e => setField('gamme', e.target.value)}>
                          <option value="">Sélectionner une gamme</option>
                          <option value="classique">Classique</option>
                          <option value="moyenne gamme">Moyenne gamme</option>
                          <option value="luxe">Luxe</option>
                        </select>
                        {form.gamme === 'luxe' && (
                          <input
                            type="text" inputMode="numeric" placeholder="Prix en FCFA"
                            value={form.prixCustom} className={`${INPUT} mt-2`}
                            onChange={e => setField('prixCustom', e.target.value)}
                          />
                        )}
                      </Field>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
                    <Btn onClick={() => { setStep(1); void startCamera() }}>{ic.arrowLeft()} Retour</Btn>
                    <Btn variant="primary" className="ml-auto" onClick={() => void confirmVerification()} disabled={confirming}>
                      {ic.check()} {confirming ? "Recherche de l'emplacement…" : 'Confirmer →'}
                    </Btn>
                  </div>
                </div>
              )}

              {step === 3 && finalData && (
                <div className={CARD}>
                  <CardHead
                    icon={ic.save('w-4 h-4')}
                    title="Étape 3 · Enregistrement"
                    pill={<Pill tone={saved ? 'green' : 'slate'}>
                      {saved ? 'Monture enregistrée · étiquette imprimée' : 'Emplacement généré automatiquement'}
                    </Pill>}
                  />

                  <div className="p-4">
                    <div className="mx-auto flex max-w-sm flex-col items-center rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700">
                      {/* Rien à dessiner sans numéro : un code-barres vide se scannerait
                          quand même, et rendrait une chaîne vide. */}
                      {finalData.id
                        ? <>
                            <BarcodePreview value={finalData.id} />
                            <div className="mt-1 font-mono text-sm font-bold tabular-nums text-slate-900">{finalData.id}</div>
                          </>
                        : <div className="py-4 text-center text-xs text-slate-400">Numéro attribué à l'enregistrement</div>}
                      <span className="mt-1 text-[11px] text-slate-400">Aperçu de l'étiquette</span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                      {[
                        ['Marque', finalData.marque || '—'],
                        ['Référence', finalData.reference || '—'],
                        // « Code-barres » et non « ID » : c'est bien le numéro imprimé sur
                        // l'étiquette, celui que la douchette lira en rayon.
                        ['Code-barres', finalData.id || 'À l\'enregistrement'],
                        ['Emplacement', finalData.emplacement],
                        ['Quantité', String(finalData.quantite)],
                        ['Gamme', fmtFCFA(finalData.prix)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-900/50">
                          <div className="text-[11px] font-semibold text-slate-400">{label}</div>
                          <div className="mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-white">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700">
                    {!saved ? (
                      <>
                        <Btn onClick={() => setStep(2)}>{ic.arrowLeft()} Retour</Btn>
                        <Btn variant="success" className="ml-auto" onClick={() => void saveRecord()} disabled={saving}>
                          {ic.save()} {saving ? 'Enregistrement en cours…' : 'Enregistrer'}
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn onClick={() => void printMontureLabel(finalData)}>{ic.printer()} Réimprimer l'étiquette</Btn>

                        {/* Une réception se quitte en cours de route : le magasinier peut
                            reprendre plus tard, ou passer à une autre commande. */}
                        {!sessionFull && (
                          <Btn onClick={goToSessions}>{ic.calendar()} Mes sessions</Btn>
                        )}

                        {/* `resetAll` sait déjà distinguer les deux cas : relancer la
                            caméra tant qu'il reste du quota, sortir vers « Mes sessions »
                            quand il est épuisé. Seul le libellé change. */}
                        <Btn
                          variant={sessionFull ? 'success' : 'primary'}
                          className="ml-auto"
                          onClick={() => resetAll(true)}
                        >
                          {sessionFull
                            ? <>
                                {ic.check()} Réception terminée → Mes sessions
                                {autoRetour !== null && <span className="tabular-nums"> ({autoRetour} s)</span>}
                              </>
                            : <>{ic.plus()} Enregistrer une autre monture</>}
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          </main>
        </div>

        {/* Remonté au-dessus de la barre mobile, qui le masquerait sinon sur téléphone. */}
        {toast && (
          <div className="fixed bottom-20 md:bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[#16a34a] px-4 py-3 text-sm font-semibold text-white shadow-lg">
            {ic.checkCircle()} {toast}
          </div>
        )}

        <MobileNav
          current={screen}
          onNavigate={navigate}
          hasSession={Boolean(session)}
          newLists={newLists}
        />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ScanPage />
  </React.StrictMode>,
)