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
const DEFAULT_STATION_ID = '1'

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

const ALLOWED_ROLES = ['MAGASINIER', 'SUPER_ADMIN']

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function apiFetch(path: string, init?: RequestInit) {
  const token = getToken()
  const isForm = init?.body instanceof FormData
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
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

function localDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function dayKey(value?: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return localDayKey(date)
}

function todayKey() {
  return localDayKey(new Date())
}

function formatDayLabel(key: string) {
  return new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

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
  'Papillon', 'Oeil de chat', 'Sport', 'Wayfarer', 'Percée',
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
  return GAMME_PRICES[normalized] ?? 0
}

function normalizeSessionGenre(value: unknown) {
  const normalized = String(value || '').trim().toUpperCase()
  const labels: Record<string, string> = {
    HOMME: 'Homme', FEMME: 'Femme', ENFANT: 'Enfant', UNISEXE: 'Unisexe',
  }
  return labels[normalized] || ''
}

function normalizeSessionGamme(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'moyenne') return 'moyenne gamme'
  if (['classique', 'luxe', 'lecture', 'solaire', 'securite'].includes(normalized)) return normalized
  return ''
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

// ── Brouillon du lot en cours ─────────────────────────────────────────────────
function batchDraftKey(sessionCode: string) {
  try {
    const raw = window.localStorage.getItem('user')
    const id = raw ? JSON.parse(raw)?.id : null
    return `scan.batchDraft.${id || 'anon'}.${sessionCode}`
  } catch {
    return `scan.batchDraft.anon.${sessionCode}`
  }
}

function loadBatchDraft(sessionCode?: string): any[] {
  if (!sessionCode) return []
  try {
    const raw = window.localStorage.getItem(batchDraftKey(sessionCode))
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveBatchDraft(sessionCode: string | undefined, items: any[]) {
  if (!sessionCode) return
  try {
    if (items.length === 0) window.localStorage.removeItem(batchDraftKey(sessionCode))
    else window.localStorage.setItem(batchDraftKey(sessionCode), JSON.stringify(items))
  } catch {
    // Quota localStorage dépassé (lot chargé de photos) ou stockage indisponible
    // (navigation privée) : on perd la reprise, pas la capture en cours.
  }
}

// ── MonturesManager ───────────────────────────────────────────────────────────
function MonturesManager({ onClose, sessionRemaining, sessionCode, sessionGenre, sessionGamme, knownBrands, onRecorded }: { onClose: () => void; sessionRemaining?: number; sessionCode?: string; sessionGenre?: string; sessionGamme?: string; knownBrands?: string[]; onRecorded?: () => Promise<void> }) {
  const [montures, setMontures] = useState<any[]>(() => loadBatchDraft(sessionCode))
  const [resumedCount] = useState(() => loadBatchDraft(sessionCode).length)
  const [showResumedBanner, setShowResumedBanner] = useState(() => loadBatchDraft(sessionCode).length > 0)

  useEffect(() => {
    saveBatchDraft(sessionCode, montures)
  }, [montures, sessionCode])

  const [cameraOnLocal, setCameraOnLocal] = useState(false)
  const videoRefLocal = useRef<HTMLVideoElement | null>(null)
  const streamRefLocal = useRef<MediaStream | null>(null)
  const [captureTargetLocal, setCaptureTargetLocal] = useState<'face'|'branche'>('face')
  const [tempFace, setTempFace] = useState<string | null>(null)
  const [tempBranche, setTempBranche] = useState<string | null>(null)

  const [batchTarget, setBatchTarget] = useState<number | null>(null)

  const quotaCap = typeof sessionRemaining === 'number' ? Math.max(0, sessionRemaining) : Infinity
  const maxItems = (typeof batchTarget === 'number' && batchTarget > 0) ? Math.min(batchTarget, quotaCap) : quotaCap

  const emptyVForm = (): VerifyForm => ({ ...EMPTY_FORM, genre: sessionGenre || '', gamme: sessionGamme || '' })
  const [verifying, setVerifying] = useState(false)
  const [vForm, setVForm] = useState<VerifyForm>(emptyVForm)
  const [vSources, setVSources] = useState<Record<FieldKey, FieldSource>>(EMPTY_SOURCES)
  const [vCollapsed, setVCollapsed] = useState<Record<string, boolean>>({})
  const [vInvalid, setVInvalid] = useState<Record<string, boolean>>({})
  const [vAnalyzing, setVAnalyzing] = useState(false)

  const [uploading, setUploading] = useState(false)
  const uploadingRef = useRef(false)
  const [uploadItems, setUploadItems] = useState<any[]>([])
  const [uploadStatuses, setUploadStatuses] = useState<('pending' | 'uploading' | 'done' | 'error')[]>([])
  const [uploadResults, setUploadResults] = useState<Record<number, any>>({})
  const [uploadError, setUploadError] = useState('')
  const [uploadDone, setUploadDone] = useState(false)

  useEffect(() => {
    if (!sessionGenre && !sessionGamme) return
    setMontures(previous => previous.map(m => ({
      ...m,
      genre: m.genre || sessionGenre || '',
      gamme: m.gamme || sessionGamme || '',
    })))
  }, [sessionGenre, sessionGamme])

  const startCameraLocal = async () => {
    if (streamRefLocal.current) return
    const blocked = cameraUnavailableReason()
    if (blocked) { window.alert(blocked); return }
    try {
      const stream = await openCamera()
      streamRefLocal.current = stream
      if (videoRefLocal.current) {
        videoRefLocal.current.srcObject = stream
        await videoRefLocal.current.play()
      }
      setCameraOnLocal(true)
    } catch (err) {
      console.error('camera local open', err)
      window.alert(humanCameraError(err))
      setCameraOnLocal(false)
    }
  }

  const stopCameraStreamLocal = () => {
    streamRefLocal.current?.getTracks().forEach(t => t.stop())
    streamRefLocal.current = null
    if (videoRefLocal.current) videoRefLocal.current.srcObject = null
    setCameraOnLocal(false)
  }

  const cancelCaptureLocal = () => {
    stopCameraStreamLocal()
    setCaptureTargetLocal('face')
    setTempFace(null)
    setTempBranche(null)
    setVForm(emptyVForm())
    setVSources(EMPTY_SOURCES)
    setVCollapsed({})
    setVInvalid({})
  }

  useEffect(() => () => cancelCaptureLocal(), [])

  useEffect(() => {
    void startCameraLocal()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function snapshotLocal() {
    const v = videoRefLocal.current
    if (!v) return null
    const c = document.createElement('canvas')
    c.width = v.videoWidth || 640
    c.height = v.videoHeight || 480
    c.getContext('2d')?.drawImage(v,0,0)
    return c.toDataURL('image/jpeg', 0.92)
  }

  function vApplyDetection(detected: Partial<Record<FieldKey, string>>) {
    const keys = Object.keys(detected) as FieldKey[]
    if (keys.length === 0) return
    setVForm(previous => ({ ...previous, ...detected }))
    setVSources(previous => {
      const next = { ...previous }
      keys.forEach(key => { next[key] = 'detected' })
      return next
    })
    setVCollapsed(previous => {
      const next = { ...previous }
      keys.forEach(key => { next[key] = true })
      return next
    })
  }

  async function analyzeMontureLocal(dataUrl: string) {
    setVAnalyzing(true)
    try {
      const body = new FormData()
      body.append('image', dataURLtoBlob(dataUrl), 'monture.jpg')
      const payload = await apiFetch('/inventory/analyze', { method: 'POST', body })
      const a = payload.data || {}
      const detected: Partial<Record<FieldKey, string>> = {}
      if (a.reference) detected.reference = a.reference
      if (a.shape) detected.forme = a.shape
      if (a.color) detected.couleur = normalizeColorValue(a.color)
      if (a.material) detected.matiere = a.material
      if (a.brand) detected.marque = a.brand
      if (a.gender && !sessionGenre) detected.genre = normalizeSessionGenre(a.gender)
      vApplyDetection(detected)
    } catch (error) {
      console.warn('Analyse monture du lot indisponible', error)
    } finally {
      setVAnalyzing(false)
    }
  }

  async function analyzeBrancheLocal(dataUrl: string) {
    setVAnalyzing(true)
    try {
      const body = new FormData()
      body.append('image', dataURLtoBlob(dataUrl), 'branche.jpg')
      const payload = await apiFetch('/inventory/analyze-branche', { method: 'POST', body })
      const b = payload.data || {}
      const detected: Partial<Record<FieldKey, string>> = {}
      if (b.reference) detected.reference = b.reference
      if (b.brand) detected.marque = b.brand
      vApplyDetection(detected)
    } catch (error) {
      console.warn('OCR branche du lot indisponible', error)
    } finally {
      setVAnalyzing(false)
    }
  }

  function captureSnapshotLocal() {
    const data = snapshotLocal()
    if (!data) return
    if (captureTargetLocal === 'face') {
      setTempFace(data)
      void analyzeMontureLocal(data)
    } else {
      setTempBranche(data)
      void analyzeBrancheLocal(data)
    }
  }

  function retakeSnapshotLocal() {
    if (captureTargetLocal === 'branche') setTempBranche(null)
    else setTempFace(null)
  }

  function nextCaptureLocal() {
    if (captureTargetLocal === 'face') {
      if (!tempFace) return
      setCaptureTargetLocal('branche')
      return
    }
    if (!tempBranche) return
    stopCameraStreamLocal()
    setVerifying(true)
  }

  function backToCaptureLocal() {
    setVerifying(false)
    void startCameraLocal()
  }

  function setVField(key: keyof VerifyForm, value: string) {
    setVForm(previous => ({ ...previous, [key]: value }))
    setVInvalid(previous => ({ ...previous, [key]: false }))
    if (key in EMPTY_SOURCES) {
      setVSources(previous => (previous[key as FieldKey] === 'detected'
        ? { ...previous, [key]: 'corrected' }
        : previous))
    }
  }

  function confirmBatchMonture() {
    const required: (keyof VerifyForm)[] = ['reference', 'marque', 'genre', 'forme', 'couleur', 'gamme']
    const nextInvalid: Record<string, boolean> = {}
    required.forEach(key => { if (!String(vForm[key]).trim()) nextInvalid[key] = true })

    if (vForm.gamme === 'luxe') {
      const numeric = Number(vForm.prixCustom.trim())
      if (!vForm.prixCustom.trim() || !Number.isFinite(numeric) || numeric <= 0) nextInvalid.prixCustom = true
    }

    if (Object.keys(nextInvalid).length > 0) {
      setVInvalid(nextInvalid)
      setVCollapsed(previous => {
        const next = { ...previous }
        Object.keys(nextInvalid).forEach(key => { next[key] = false })
        return next
      })
      window.alert('Veuillez remplir tous les champs obligatoires.')
      return
    }

    if (montures.length >= maxItems) {
      window.alert(maxItems === quotaCap ? 'Le quota de la session est atteint.' : 'La taille de lot choisie est atteinte — augmentez-la ou terminez le lot.')
      return
    }

    const newM = {
      id: Date.now() + Math.random(),
      photoFace: tempFace || null,
      photoBranche: tempBranche || null,
      reference: vForm.reference.trim(),
      marque: vForm.marque.trim(),
      genre: vForm.genre,
      forme: vForm.forme,
      couleur: vForm.couleur,
      matiere: vForm.matiere,
      gamme: vForm.gamme,
      prixCustom: vForm.prixCustom,
    }
    let updated: typeof montures = []
    setMontures(previous => {
      updated = [...previous, newM]
      return updated
    })

    setTempFace(null)
    setTempBranche(null)
    setCaptureTargetLocal('face')
    setVerifying(false)
    setVForm(emptyVForm())
    setVSources(EMPTY_SOURCES)
    setVCollapsed({})
    setVInvalid({})

    if (Number.isFinite(maxItems) && updated.length >= maxItems) {
      void runBatchUpload(updated)
    } else {
      void startCameraLocal()
    }
  }

  const runBatchUpload = async (items: any[]) => {
    if (items.length === 0 || uploadingRef.current) return
    uploadingRef.current = true
    try {
      const stationId = stationIdOf(JSON.parse(localStorage.getItem('user') || '{}'))
      setUploadItems(items)
      setUploadStatuses(items.map(() => 'pending' as const))
      setUploadError('')
      setUploadDone(false)
      setUploading(true)

      for (let i = 0; i < items.length; i++) {
        const m = items[i]
        setUploadStatuses(previous => previous.map((s, idx) => idx === i ? 'uploading' : s))
        try {
          const body = new FormData()
          if (m.photoFace) body.append('image', dataURLtoBlob(m.photoFace), 'monture.jpg')
          if (m.photoBranche) body.append('branche_image', dataURLtoBlob(m.photoBranche), 'branche.jpg')
          body.append('station_id', stationId)
          let price = 0
          if (m.gamme === 'luxe') price = Number(m.prixCustom || 0)
          else if (m.prix && Number.isFinite(Number(m.prix))) price = Number(m.prix)
          else price = normalizePriceValue(m.gamme || 0)
          body.append('price', String(price))
          if (sessionCode) body.append('reception_command_code', sessionCode)
          body.append('reference', m.reference || '')
          body.append('brand', m.marque || '')
          body.append('gender', m.genre || sessionGenre || '')
          body.append('shape', m.forme || '')
          body.append('detected_shape', '')
          body.append('color', m.couleur || '')
          body.append('material', m.matiere || '')
          body.append('mount_type', '')
          const payload = await apiFetch('/inventory/reception', { method: 'POST', body })
          const data = payload.data || {}
          if (onRecorded) await onRecorded()
          if (data.barcode && sessionCode) rememberBarcodeSession(data.barcode, sessionCode)
          setUploadStatuses(previous => previous.map((s, idx) => idx === i ? 'done' : s))
          setUploadResults(previous => ({ ...previous, [m.id]: data }))
          setMontures(previous => previous.filter(x => x.id !== m.id))
        } catch (err: any) {
          console.error('upload error', err)
          setUploadStatuses(previous => previous.map((s, idx) => idx === i ? 'error' : s))
          setUploadError(`Échec sur la monture #${i + 1}${m.reference ? ` (${m.reference})` : ''} : ${err?.message || 'vérifiez votre connexion et réessayez'}`)
          return
        }
      }
      setUploadDone(true)
      saveBatchDraft(sessionCode, [])
    } finally {
      uploadingRef.current = false
    }
  }

  const willReachQuota = Number.isFinite(maxItems) && montures.length + 1 >= maxItems
  const hasUnconfirmedCapture = verifying || Boolean(tempFace) || Boolean(tempBranche)

  function closeAndReset() {
    if (hasUnconfirmedCapture && !window.confirm('La monture en cours de capture n\'a pas été confirmée et sera perdue. Fermer quand même ?')) return
    if (montures.length > 0 && !window.confirm(`${montures.length} monture(s) non envoyée(s) seront perdues. Fermer quand même ?`)) return
    setMontures([])
    saveBatchDraft(sessionCode, [])
    onClose()
  }

  function finishBatch() {
    if (hasUnconfirmedCapture && !window.confirm('La monture en cours de capture n\'a pas été confirmée et sera perdue. Terminer quand même ?')) return
    if (Number.isFinite(quotaCap) && montures.length > quotaCap) {
      window.alert(`Le lot contient ${montures.length} monture(s) mais il ne reste que ${quotaCap} place(s) sur la session — impossible d'envoyer. Le quota a dû changer pendant votre absence.`)
      return
    }
    stopCameraStreamLocal()
    void runBatchUpload(montures)
  }

  return (
    <div className="fixed inset-0 z-9999 overflow-y-auto bg-black/50 p-1 sm:p-6">
      <div className="mx-auto flex min-h-full w-full max-w-5xl items-start justify-center py-1 sm:py-6">
      <div className="w-full overflow-hidden rounded-xl sm:rounded-2xl bg-white shadow-xl dark:bg-slate-800">
        <div className="flex flex-col gap-2 border-b border-slate-100 px-3 py-3 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Réception</p>
              <h2 className="mt-1 text-sm font-bold text-slate-900 dark:text-white sm:text-lg">Capture en lot</h2>
            </div>
            {Number.isFinite(quotaCap) && (
              <span className="rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-900/60 dark:text-slate-400 sm:px-3 sm:py-1 sm:text-xs">
                Quota : {quotaCap}
              </span>
            )}
            <label className="flex items-center gap-1 rounded-lg bg-[#2563eb]/10 px-2 py-0.5 text-[10px] font-bold text-[#2563eb] sm:px-3 sm:py-1 sm:text-xs">
              Taille du lot
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={Number.isFinite(quotaCap) ? quotaCap : undefined}
                value={batchTarget ?? ''}
                onChange={e => {
                  const raw = e.target.value.trim()
                  if (!raw) { setBatchTarget(null); return }
                  const n = Number(raw)
                  if (Number.isFinite(n) && n > 0) setBatchTarget(Math.trunc(n))
                }}
                placeholder={Number.isFinite(quotaCap) ? String(quotaCap) : '∞'}
                className="w-10 rounded-md border border-[#2563eb]/30 bg-white px-1 py-0.5 text-[10px] font-bold text-[#2563eb] outline-none focus:border-[#2563eb] dark:bg-slate-900 sm:w-14 sm:text-xs"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-none">
            <Btn
              variant="success"
              disabled={montures.length === 0}
              onClick={finishBatch}
              className="w-full text-xs sm:w-auto sm:text-sm"
            >
              {ic.check()} Terminer{montures.length > 0 ? ` (${montures.length})` : ''}
            </Btn>
            <Btn onClick={closeAndReset} className="w-full text-xs sm:w-auto sm:text-sm">Fermer</Btn>
          </div>
        </div>

        <div className="flex items-center justify-end px-3 pt-2 sm:px-6 sm:pt-4">
          <span className="text-[10px] font-bold text-slate-400 sm:text-xs">{montures.length}/{Number.isFinite(maxItems) ? maxItems : '∞'}</span>
        </div>

        {showResumedBanner && (
          <div className="mx-3 mt-2 flex items-center justify-between gap-3 rounded-xl border border-[#2563eb]/30 bg-[#2563eb]/10 px-3 py-2 text-[10px] font-semibold text-[#2563eb] sm:mx-6 sm:mt-3 sm:px-3.5 sm:py-2.5 sm:text-xs">
            <span className="flex items-center gap-2">
              {ic.refresh('w-3 h-3 flex-shrink-0')}
              Lot précédent repris — {resumedCount} monture{resumedCount > 1 ? 's' : ''} en attente d'envoi.
            </span>
            <button onClick={() => setShowResumedBanner(false)} aria-label="Masquer" className="flex-shrink-0 text-[#2563eb]/70 hover:text-[#2563eb]">✕</button>
          </div>
        )}

        <div className="p-3 sm:p-6">
            <div className={verifying ? 'hidden' : ''}>
              <CaptureCard
                target={captureTargetLocal === 'face' ? 'monture' : 'branche'}
                photo={captureTargetLocal === 'face' ? tempFace : tempBranche}
                cameraOn={cameraOnLocal}
                videoRef={videoRefLocal}
                analyzing={vAnalyzing}
                onStart={() => void startCameraLocal()}
                onStop={cancelCaptureLocal}
                onCapture={captureSnapshotLocal}
                onRetake={retakeSnapshotLocal}
                onNext={nextCaptureLocal}
              />

              {captureTargetLocal === 'branche' && tempFace && (
                <div className="mt-3 flex items-center gap-2 sm:mt-4">
                  <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 sm:h-16 sm:w-16">
                    <img src={tempFace} className="h-full w-full object-cover" alt="Monture" />
                    <span className="absolute bottom-0.5 right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-[#16a34a] text-white sm:h-4 sm:w-4">{ic.check('w-2 h-2 sm:w-2.5 sm:h-2.5')}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 sm:text-xs">Photo de la monture déjà capturée · photographiez la branche</p>
                </div>
              )}
            </div>

            {verifying && (
              <div className={CARD}>
                <CardHead
                  icon={ic.check2('w-4 h-4')}
                  title="Étape 2 · Vérification"
                  pill={<Pill tone={vAnalyzing ? 'blue' : 'slate'}>{vAnalyzing ? 'Analyse IA en cours…' : 'Vérifiez les champs signalés'}</Pill>}
                />

                <div className="grid gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[220px_1fr]">
                  <div className="grid grid-cols-2 gap-2 lg:grid-cols-1 sm:gap-3">
                    <PhotoBox url={tempFace} label="Monture" />
                    <PhotoBox url={tempBranche} label="Branche" />
                  </div>

                  <div className="space-y-2">
                    <Field
                      icon={ic.tag()} label="Référence" source={vSources.reference}
                      collapsed={vCollapsed.reference} summary={vForm.reference} invalid={vInvalid.reference}
                      onExpand={() => setVCollapsed(p => ({ ...p, reference: false }))}
                    >
                      <input type="text" value={vForm.reference} placeholder="RB2180-001" className={INPUT} onChange={e => setVField('reference', e.target.value)} />
                    </Field>

                    <Field
                      icon={ic.building()} label="Marque" source={vSources.marque}
                      collapsed={vCollapsed.marque} summary={vForm.marque} invalid={vInvalid.marque}
                      onExpand={() => setVCollapsed(p => ({ ...p, marque: false }))}
                    >
                      <input type="text" list="vMarquesList" value={vForm.marque} placeholder="Ray-Ban" className={INPUT} onChange={e => setVField('marque', e.target.value)} />
                      <datalist id="vMarquesList">
                        <option value="OPAL" />
                        {(knownBrands || []).filter(brand => brand !== 'OPAL').map(brand => <option key={brand} value={brand} />)}
                      </datalist>
                    </Field>

                    <Field
                      icon={ic.gender()} label="Genre" source={vSources.genre}
                      collapsed={vCollapsed.genre} summary={vForm.genre} invalid={vInvalid.genre}
                      onExpand={() => setVCollapsed(p => ({ ...p, genre: false }))}
                    >
                      <select value={vForm.genre} className={INPUT} onChange={e => setVField('genre', e.target.value)}>
                        <option value="">Sélectionner un genre</option>
                        {GENRES.map(genre => <option key={genre} value={genre}>{genre}</option>)}
                      </select>
                    </Field>

                    <Field
                      icon={ic.shapes()} label="Forme" source={vSources.forme}
                      collapsed={vCollapsed.forme} summary={vForm.forme} invalid={vInvalid.forme}
                      onExpand={() => setVCollapsed(p => ({ ...p, forme: false }))}
                    >
                      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(80px,1fr))] sm:gap-2">
                        {FORMES.map(forme => {
                          const selected = vForm.forme === forme
                          return (
                            <button
                              key={forme}
                              type="button"
                              onClick={() => setVField('forme', forme)}
                              className={`flex flex-col items-center gap-0.5 rounded-xl border p-1.5 text-[10px] font-semibold transition-all sm:gap-1 sm:p-2 sm:text-[11px] ${selected
                                ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]'
                                : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}
                            >
                              <ShapeIcon name={forme} className="w-8 h-4 sm:w-10 sm:h-5" />
                              <span className="text-center leading-tight">{forme === 'Oeil de chat' ? 'Œil de chat' : forme}</span>
                            </button>
                          )
                        })}
                      </div>
                    </Field>

                    <Field
                      icon={ic.palette()} label="Couleur" source={vSources.couleur}
                      collapsed={vCollapsed.couleur} summary={vForm.couleur} invalid={vInvalid.couleur}
                      onExpand={() => setVCollapsed(p => ({ ...p, couleur: false }))}
                    >
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(100px,1fr))] sm:gap-2">
                        {COULEURS.map(({ value, swatch }) => {
                          const selected = vForm.couleur === value
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setVField('couleur', value)}
                              className={`flex items-center gap-1 rounded-xl border px-1.5 py-1 text-[10px] font-semibold transition-all sm:gap-1.5 sm:px-2 sm:py-1.5 sm:text-[11px] ${selected
                                ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]'
                                : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}
                            >
                              <span className="h-3 w-3 flex-shrink-0 rounded-full border border-slate-300 dark:border-slate-600 sm:h-4 sm:w-4" style={{ background: swatch }} />
                              <span className="truncate text-[9px] sm:text-[11px]">{value}</span>
                            </button>
                          )
                        })}
                      </div>
                    </Field>

                    <Field
                      icon={ic.cube()} label="Matière" source={vSources.matiere}
                      collapsed={vCollapsed.matiere} summary={vForm.matiere}
                      onExpand={() => setVCollapsed(p => ({ ...p, matiere: false }))}
                    >
                      <select value={vForm.matiere} className={INPUT} onChange={e => setVField('matiere', e.target.value)}>
                        <option value="">Sélectionner une matière</option>
                        {MATIERES.map(matiere => <option key={matiere} value={matiere}>{matiere}</option>)}
                      </select>
                    </Field>

                    <Field icon={ic.banknote()} label="Gamme" invalid={vInvalid.gamme || vInvalid.prixCustom}>
                      <select value={vForm.gamme} className={INPUT} onChange={e => setVField('gamme', e.target.value)}>
                        <option value="">Sélectionner une gamme</option>
                        <option value="classique">Classique</option>
                        <option value="moyenne gamme">Moyenne gamme</option>
                        <option value="luxe">Luxe</option>
                      </select>
                      {vForm.gamme === 'luxe' && (
                        <input
                          type="text" inputMode="numeric" placeholder="Prix en FCFA"
                          value={vForm.prixCustom} className={`${INPUT} mt-2`}
                          onChange={e => setVField('prixCustom', e.target.value)}
                        />
                      )}
                    </Field>
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-slate-100 px-3 py-2.5 dark:border-slate-700 sm:flex-row sm:flex-wrap sm:items-center sm:px-4 sm:py-3">
                  <Btn onClick={backToCaptureLocal} className="text-xs sm:text-sm">{ic.arrowLeft()} Reprendre les photos</Btn>
                  <Btn variant={willReachQuota ? 'success' : 'primary'} className="w-full text-xs sm:ml-auto sm:w-auto sm:text-sm" onClick={confirmBatchMonture}>
                    {ic.check()} {willReachQuota ? 'Confirmer et terminer le lot →' : 'Confirmer et ajouter au lot →'}
                  </Btn>
                </div>
              </div>
            )}
          </div>
      </div>
    </div>

    {uploading && (
      <div className="fixed inset-0 z-[10050] flex items-center justify-center bg-black/70 p-2 sm:p-4">
        <div className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-800 sm:rounded-2xl" style={{ maxHeight: '90vh' }}>
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700 sm:px-5 sm:py-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">
              {uploadDone ? 'Lot enregistré' : uploadError ? "Envoi interrompu" : 'Enregistrement du lot…'}
            </h3>
            <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">
              {uploadStatuses.filter(s => s === 'done').length} / {uploadStatuses.length} monture(s) envoyée(s)
            </p>
          </div>

          <ul className="divide-y divide-slate-100 overflow-y-auto dark:divide-slate-700">
            {uploadItems.map((m, i) => (
              <li key={m.id} className={`flex items-center gap-2 px-4 py-2.5 transition-colors sm:gap-3 sm:px-5 sm:py-3 ${uploadStatuses[i] === 'uploading' ? 'bg-[#2563eb]/5' : ''}`}>
                <UploadStatusIcon status={uploadStatuses[i] || 'pending'} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-slate-900 dark:text-white sm:text-sm">#{i + 1} {m.reference || 'Monture'}</p>
                  <p className="truncate text-[10px] text-slate-400 sm:text-xs">
                    {uploadStatuses[i] === 'uploading' ? 'Envoi en cours…'
                      : uploadStatuses[i] === 'done' ? (uploadResults[m.id]?.location_code || uploadResults[m.id]?.location || m.marque || 'Enregistrée')
                      : uploadStatuses[i] === 'error' ? 'Échec'
                      : 'En attente'}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {uploadError && (
            <div className="mx-4 mt-2 rounded-xl border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-semibold text-red-600 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-400 sm:mx-5 sm:mt-3 sm:px-3 sm:py-2 sm:text-xs">
              {uploadError}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-3 dark:border-slate-700 sm:px-5 sm:py-4">
            {uploadDone ? (
              <Btn variant="success" className="ml-auto text-xs sm:text-sm" onClick={closeAndReset}>{ic.check()} Terminé</Btn>
            ) : uploadError ? (
              <>
                <Btn onClick={() => setUploading(false)} className="text-xs sm:text-sm">Fermer</Btn>
                <Btn variant="primary" className="ml-auto text-xs sm:text-sm" onClick={() => void runBatchUpload(montures)}>{ic.refresh()} Réessayer</Btn>
              </>
            ) : (
              <span className="text-[10px] text-slate-400 sm:text-xs">Ne fermez pas cette fenêtre…</span>
            )}
          </div>
        </div>
      </div>
    )}
    </div>
  )
}

// ── Dessins des formes de monture ──────────────────────────────────────────────
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

const LABEL_PX = { width: 212, pad: 6, gap: 2, barcodeMargin: 2 }

const LABEL_FONT = {
  location: '800 10px Inter, system-ui, sans-serif',
  shop: '800 9px Inter, system-ui, sans-serif',
  marque: '700 12px Inter, system-ui, sans-serif',
  ref: '700 9px ui-monospace, monospace',
  meta: '8px Inter, system-ui, sans-serif',
}

const LABEL_LINE = { location: 11, shop: 10, marque: 14, ref: 10, meta: 9 }

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

interface PrintableLabel {
  title: string
  reference: string
  barcodeValue: string
  metaLeft: string
  metaRight: string
  filePrefix: string
}

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

async function downloadLabel(data: PrintableLabel, barcode: { svg: string; width: number; height: number }) {
  try {
    const dataUrl = await labelToPngDataUrl(data, barcode)
    await downloadDataUrl(dataUrl, `${data.filePrefix}-${data.barcodeValue || 'etiquette'}.png`)
  } catch (error) {
    console.error("Échec du téléchargement de l'étiquette", error)
  }
}

async function printLabel(data: PrintableLabel) {
  const holder = document.createElement('div')
  holder.style.cssText = 'position:absolute;left:-9999px;top:0'
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  holder.appendChild(svg)
  document.body.appendChild(holder)

  let markup = ''
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
  genre: string
  gamme: string
}

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
  activatedAt?: string | null
  scanned?: boolean
  genre?: string
  gamme?: string
}

const SCANNED_CODES_MAX = 20

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

function activatedAtKey() {
  try {
    const raw = window.localStorage.getItem('user')
    const id = raw ? JSON.parse(raw)?.id : null
    return id ? `scan.activatedAt.${id}` : 'scan.activatedAt.anon'
  } catch {
    return 'scan.activatedAt.anon'
  }
}

function loadActivatedAtMap(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(activatedAtKey())
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function rememberActivatedAt(code: string) {
  const clean = String(code || '').trim().toUpperCase()
  if (!clean) return
  try {
    const map = loadActivatedAtMap()
    map[clean] = new Date().toISOString()
    const entries = Object.entries(map)
    const trimmed = entries.length > SCANNED_CODES_MAX ? entries.slice(entries.length - SCANNED_CODES_MAX) : entries
    window.localStorage.setItem(activatedAtKey(), JSON.stringify(Object.fromEntries(trimmed)))
  } catch {
    // Stockage indisponible : le filet ne joue pas, mais l'activation elle-même a eu lieu.
  }
}

function loadActivatedAt(code: string): string | null {
  const clean = String(code || '').trim().toUpperCase()
  return clean ? loadActivatedAtMap()[clean] || null : null
}

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
const CARD = 'bg-white dark:bg-slate-800 rounded-xl sm:rounded-2xl border border-slate-100 dark:border-slate-700'

function Btn({ variant = 'outline', className = '', children, ...rest }: {
  variant?: 'primary' | 'outline' | 'success' | 'danger'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = 'inline-flex items-center justify-center gap-1.5 md:gap-2 rounded-xl px-3 md:px-3.5 py-2.5 text-xs md:text-sm font-semibold transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none min-h-[44px] min-w-[44px]'
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
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold sm:px-2.5 sm:py-1 sm:text-[11px] ${tones[tone]}`}>{children}</span>
}

function CardHead({ icon, title, pill }: { icon: React.ReactNode; title: React.ReactNode; pill?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-700 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white sm:gap-2 sm:text-sm">
        <span className="text-[#2563eb]">{icon}</span>
        {title}
      </h3>
      {pill}
    </div>
  )
}

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

      <div className="m-2 sm:m-4">
        <div className="relative w-full aspect-video min-h-[180px] sm:min-h-[220px] overflow-hidden rounded-xl bg-slate-900">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover ${cameraOn && !photo ? '' : 'invisible'}`}
          />

          {photo && <img src={photo} alt="Photo capturée" className="absolute inset-0 h-full w-full object-cover" />}

          {!cameraOn && !photo && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-400 sm:gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-800 sm:h-12 sm:w-12">{ic.camera('w-5 h-5 sm:w-6 sm:h-6')}</div>
              <p className="text-xs font-bold text-slate-300 sm:text-sm">Caméra en attente</p>
              <p className="text-[10px] sm:text-xs">Appuyez sur « Démarrer »</p>
            </div>
          )}

          {cameraOn && !photo && (
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute inset-[12%] rounded-lg">
                {['left-0 top-0 border-l-2 border-t-2', 'right-0 top-0 border-r-2 border-t-2', 'bottom-0 left-0 border-b-2 border-l-2', 'bottom-0 right-0 border-b-2 border-r-2'].map(pos => (
                  <span key={pos} className={`absolute h-4 w-4 rounded-sm border-[#2563eb] sm:h-6 sm:w-6 ${pos}`} />
                ))}
                <span className="scan-line absolute left-[6%] right-[6%] h-0.5 rounded-full bg-[#2563eb]" />
              </div>
              <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-[9px] font-semibold text-white backdrop-blur-sm sm:bottom-3 sm:gap-2 sm:px-3 sm:py-1.5 sm:text-[11px]">
                <span className="scan-pulse h-1 w-1 rounded-full bg-[#16a34a] sm:h-1.5 sm:w-1.5" />
                Caméra prête
              </div>
            </div>
          )}

          {analyzing && (
            <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1.5 text-center text-[9px] font-semibold text-white sm:px-3 sm:py-2 sm:text-[11px]">
              Analyse IA en cours…
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 px-2 pb-2 sm:gap-2 sm:px-4 sm:pb-4">
        {!cameraOn
          ? <Btn variant="primary" onClick={onStart} className="text-xs sm:text-sm">{ic.play()} Démarrer</Btn>
          : <Btn variant="danger" onClick={onStop} className="text-xs sm:text-sm">{ic.stop()} Arrêter</Btn>}

        {!photo
          ? <Btn variant="success" onClick={onCapture} disabled={!cameraOn} className="text-xs sm:text-sm">{ic.camera()} Capturer</Btn>
          : <Btn onClick={onRetake} className="text-xs sm:text-sm">{ic.refresh()} Reprendre</Btn>}

        <Btn variant="primary" className="ml-auto text-xs sm:text-sm" onClick={onNext} disabled={!photo}>
          {ic.check()} {isMonture ? 'Photo suivante →' : 'Valider →'}
        </Btn>
      </div>
    </div>
  )
}

function SrcTag({ source }: { source: FieldSource }) {
  if (source === 'detected') return <Pill tone="green">{ic.check('w-2.5 h-2.5')} Détecté</Pill>
  return <Pill tone="slate">{source === 'corrected' ? 'Corrigé' : 'À saisir'}</Pill>
}

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
      className={`rounded-xl border p-2 transition-colors sm:p-3 ${invalid ? 'border-red-500' : 'border-slate-200 dark:border-slate-700'} ${collapsed ? 'bg-slate-50 dark:bg-slate-800/60' : 'bg-white dark:bg-slate-800'}`}
    >
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">{icon}</span>
        <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 sm:text-xs">{label}</span>
        {collapsed && <span className="truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{summary || '—'}</span>}
        <span className="ml-auto flex items-center gap-1 flex-shrink-0 sm:gap-2">
          {source && <SrcTag source={source} />}
          {collapsed && (
            <button
              type="button"
              onClick={onExpand}
              title="Modifier"
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200 sm:p-1.5"
            >
              {ic.pencil('w-3 h-3 sm:w-3.5 sm:h-3.5')}
            </button>
          )}
        </span>
      </div>
      {!collapsed && <div className="mt-1.5 sm:mt-2">{children}</div>}
    </div>
  )
}

const INPUT = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-[#2563eb] sm:px-3 sm:py-2 sm:text-sm'

function PhotoBox({ url, label }: { url: string | null; label: string }) {
  return (
    <div className={`relative flex min-h-[80px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 sm:min-h-[120px] ${url ? '' : 'bg-slate-50 dark:bg-slate-900/50'}`}>
      {url
        ? <img src={url} alt={label} className="h-full w-full object-cover" />
        : <div className="flex flex-col items-center gap-0.5 text-slate-300 dark:text-slate-600 sm:gap-1">{ic.image('w-4 h-4 sm:w-6 sm:h-6')}<p className="text-[9px] sm:text-xs">Photo {label.toLowerCase()}</p></div>}
      <span className="absolute left-1.5 top-1.5 rounded-lg bg-black/60 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white sm:left-2 sm:top-2 sm:px-2 sm:py-0.5 sm:text-[10px]">{label}</span>
    </div>
  )
}

function UploadStatusIcon({ status }: { status: 'pending' | 'uploading' | 'done' | 'error' }) {
  if (status === 'done') {
    return <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#16a34a] text-white sm:h-8 sm:w-8">{ic.check('w-3.5 h-3.5 sm:w-4 sm:h-4')}</span>
  }
  if (status === 'error') {
    return <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400 sm:h-8 sm:w-8">{ic.alert('w-3.5 h-3.5 sm:w-4 sm:h-4')}</span>
  }
  if (status === 'uploading') {
    return (
      <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center sm:h-8 sm:w-8">
        <span className="absolute inset-0 rounded-full border-2 border-[#2563eb]/20" />
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[#2563eb]" />
      </span>
    )
  }
  return <span className="h-7 w-7 flex-shrink-0 rounded-full border-2 border-dashed border-slate-200 dark:border-slate-700 sm:h-8 sm:w-8" />
}

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

  useEffect(() => () => { scannerRef.current?.stop() }, [])

  async function startScanner() {
    if (scanning || !videoRef.current) return
    scannerRef.current?.stop()
    const scanner = createScanner({
      video: videoRef.current,
      formats: ['code_128'],
      onStatus: (message, error) => setScanStatus(error ? `⚠ ${message}` : message),
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
      <div className="grid gap-3 sm:gap-4 sm:grid-cols-2">
        <div className="relative flex min-h-[160px] flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-[#2563eb] bg-white p-4 text-center dark:bg-slate-800 sm:min-h-[200px] sm:p-6 sm:gap-3">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`absolute inset-0 h-full w-full object-cover ${scanning ? '' : 'hidden'}`}
          />
          {!scanning && (
            <>
              <span className="text-[#2563eb]">{ic.camera('w-6 h-6 sm:w-7 sm:h-7')}</span>
              <span className="text-sm font-bold text-[#2563eb] sm:text-base">Scanner le code-barres de session</span>
              <Btn variant="primary" onClick={() => void startScanner()} className="text-xs sm:text-sm">
                {ic.camera('w-3.5 h-3.5 sm:w-4 sm:h-4')} Activer la caméra
              </Btn>
            </>
          )}
        </div>

        <div className="flex flex-col justify-center text-left">
          <label htmlFor="sessionCode" className="mb-1 block text-[10px] font-semibold text-slate-500 dark:text-slate-400 sm:text-xs">
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
            <Btn type="submit" variant="primary" disabled={busy || !code.trim()} className="text-xs sm:text-sm">
              {busy ? 'Vérification…' : 'Activer'}
            </Btn>
          </form>
        </div>
      </div>

      <p className={`mt-2 text-center text-[11px] sm:mt-3 sm:text-sm ${isError && status ? 'text-red-600 dark:text-red-400' : 'text-slate-500 dark:text-slate-400'}`}>
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
    <div className="mx-auto max-w-xl px-1 sm:px-0">
      {onReturn && (
        <div className="mb-3 flex justify-start sm:mb-4">
          <Btn variant="outline" onClick={onReturn} className="text-xs sm:text-sm">{ic.arrowLeft()} Retour</Btn>
        </div>
      )}
      <div className="mb-4 text-center sm:mb-5">
        <h2 className="text-lg font-bold text-slate-900 dark:text-white sm:text-xl">Activer une session d'enregistrement</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 sm:mt-1 sm:text-sm">
          Scannez l'étiquette générée par l'administrateur avant d'enregistrer des montures.
        </p>
      </div>

      <SessionScanCard status={status} isError={isError} onActivate={onActivate} />
    </div>
  )
}

function SessionsGate({ movements, commands, status, isError, onActivate, onPrint }: {
  movements: Movement[]
  commands: ReceptionEntry[]
  status: string
  isError: boolean
  onActivate: (code: string) => Promise<boolean>
  onPrint: (record: Movement) => void
}) {
  const [detailDate, setDetailDate] = useState<string | null>(null)
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

  const openCommandsByDay = new Map<string, ReceptionEntry[]>()
  commands.forEach(entry => {
    if (!entry.code || !entry.activatedAt) return
    const key = dayKey(entry.activatedAt)
    if (!key) return
    if (!counts.has(key)) counts.set(key, 0)
    if (!openCommandsByDay.has(key)) openCommandsByDay.set(key, [])
    openCommandsByDay.get(key)!.push(entry)
  })

  const keys = Array.from(counts.keys()).sort((a, b) => b.localeCompare(a))

  if (detailDate) {
    const isToday = detailDate === today

    const dayRows = movements
      .filter(m => dayKey(m.created_at) === detailDate)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())

    const barcodeSessions = loadBarcodeSessions()
    const groupedByCode = new Map<string, Movement[]>()
    dayRows.forEach(row => {
      const code = barcodeSessions[String(row.barcode || '').trim()]
        || recordField(row, 'reception_command_code') || recordField(row, 'session_code') || recordField(row, 'command_code')
      const key = code || 'Sans session'
      if (!groupedByCode.has(key)) groupedByCode.set(key, [])
      groupedByCode.get(key)!.push(row)
    })

    const openCommands = commands
      .filter(entry => Boolean(entry.code))
      .filter(entry => {
        if (entry.activatedAt) return dayKey(entry.activatedAt) === detailDate
        return groupedByCode.has(entry.code as string)
      })
      .sort((a, b) => Number(a.registeredCount || 0) / Math.max(1, Number(a.targetCount || 1))
        - Number(b.registeredCount || 0) / Math.max(1, Number(b.targetCount || 1)))

    const activeCodesForDay = new Set(openCommands.map(entry => entry.code))
    const closedSessionsForDay = Array.from(groupedByCode.entries()).filter(([code]) => code !== 'Sans session' && !activeCodesForDay.has(code))
    const unresolvedRows = groupedByCode.get('Sans session') || []

    if (openSessionCode) {
      const sessionRows = groupedByCode.get(openSessionCode) || []
      return (
        <div className="mx-auto max-w-4xl space-y-4 sm:space-y-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <Btn onClick={() => setOpenSessionCode(null)} className="text-xs sm:text-sm">{ic.arrowLeft()} {isToday ? 'Sessions en cours' : 'Sessions'}</Btn>
            <span className="text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{openSessionCode === 'Sans session' ? 'Montures sans session' : openSessionCode}</span>
          </div>
          {sessionRows.length === 0 ? (
            <div className={`${CARD} flex flex-col items-center gap-1.5 p-6 text-center text-slate-400 sm:gap-2 sm:p-10`}>
              {ic.glasses('w-6 h-6 sm:w-7 sm:h-7')}
              <p className="text-[11px] sm:text-sm">Aucune monture trouvée pour cette session.</p>
            </div>
          ) : (
            <RecordsTable records={sessionRows} onPrint={onPrint} />
          )}
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">
        <div className="flex items-center gap-2 sm:gap-3">
          <Btn onClick={closeDay} className="text-xs sm:text-sm">{ic.arrowLeft()} Sessions</Btn>
          <span className="text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{formatDayLabel(detailDate)}</span>
        </div>

        <section className="space-y-2.5 sm:space-y-3">
          <h3 className="text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{isToday ? 'Sessions en cours' : 'Sessions de ce jour'}</h3>
          {openCommands.length === 0 && closedSessionsForDay.length === 0 && unresolvedRows.length === 0 ? (
            <div className={`${CARD} flex flex-col items-center gap-1.5 p-6 text-center sm:gap-2 sm:p-8`}>
              <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-6 h-6 sm:w-8 sm:h-8')}</span>
              <p className="text-[11px] text-slate-400 sm:text-sm">
                {isToday ? 'Aucune session ouverte pour le moment — scannez une étiquette pour en démarrer une.' : 'Aucun enregistrement pour cette date.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-2.5 sm:gap-3 grid-cols-1 sm:grid-cols-2">
              {openCommands.map(entry => {
                const target = Number(entry.targetCount || 0)
                const registered = Number(entry.registeredCount || 0)
                const done = target > 0 && registered >= target
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => void onActivate(entry.code as string)}
                    className={`bg-white dark:bg-slate-800 rounded-2xl p-3 text-left transition-all hover:-translate-y-0.5 border-2 sm:p-4 ${done ? 'border-[#16a34a]' : 'border-[#2563eb]'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{entry.code}</p>
                      <Pill tone={done ? 'green' : 'blue'}>{done ? 'Traitée' : 'En cours'}</Pill>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-slate-400 sm:mt-1 sm:text-xs">
                      {entry.supplier ? `${entry.supplier} · ` : ''}{registered}/{target || '?'} monture{target > 1 ? 's' : ''} enregistrée{registered > 1 ? 's' : ''}
                    </p>
                  </button>
                )
              })}
              {closedSessionsForDay.map(([code, sessionRows]) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setOpenSessionCode(code)}
                  className="bg-white dark:bg-slate-800 rounded-2xl p-3 text-left transition-all hover:-translate-y-0.5 border-2 border-[#16a34a] sm:p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{code}</p>
                    <Pill tone="green">Traitée</Pill>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-slate-400 sm:mt-1 sm:text-xs">
                    {sessionRows.length} monture{sessionRows.length > 1 ? 's' : ''} enregistrée{sessionRows.length > 1 ? 's' : ''}
                  </p>
                </button>
              ))}
              {unresolvedRows.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpenSessionCode('Sans session')}
                  className="bg-white dark:bg-slate-800 rounded-2xl p-3 text-left transition-all hover:-translate-y-0.5 border-2 border-[#16a34a] sm:p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">Montures sans session</p>
                    <Pill tone="green">Traitée</Pill>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-slate-400 sm:mt-1 sm:text-xs">
                    {unresolvedRows.length} monture{unresolvedRows.length > 1 ? 's' : ''} enregistrée{unresolvedRows.length > 1 ? 's' : ''}
                  </p>
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 sm:space-y-6">
      <SessionScanCard status={status} isError={isError} onActivate={onActivate} />

      <section className="space-y-2.5 sm:space-y-3">
        <h3 className="text-xs font-bold text-slate-900 dark:text-white sm:text-sm">Journées d'enregistrement</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(130px,1fr))] sm:gap-3">
          {keys.map(key => {
            const isToday = key === today
            const count = counts.get(key) || 0
            const dayOpenCommands = openCommandsByDay.get(key) || []
            const isTreated = dayOpenCommands.length === 0
            return (
              <button
                key={key}
                type="button"
                onClick={() => openDay(key)}
                className={`bg-white dark:bg-slate-800 rounded-2xl border-2 flex flex-col items-center gap-0.5 p-2.5 text-center transition-all hover:-translate-y-0.5 sm:gap-1 sm:p-4 ${
                  isTreated ? 'border-[#16a34a]' : 'border-[#2563eb] ring-2 ring-[#2563eb]'
                }`}
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${isTreated ? 'bg-[#16a34a]/10 text-[#16a34a]' : 'bg-[#2563eb]/10 text-[#2563eb]'}`}>
                  {ic.calendar('w-4 h-4 sm:w-5 sm:h-5')}
                </span>
                <span className="text-2xl font-black tabular-nums text-slate-900 dark:text-white sm:text-3xl">{count}</span>
                <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 sm:text-xs">
                  {isToday ? `Aujourd'hui · ${formatDayLabel(key)}` : formatDayLabel(key)}
                </span>
                <span className="text-[9px] font-semibold text-slate-400 sm:text-[11px]">
                  {dayOpenCommands.length > 0
                    ? `${dayOpenCommands.length} session${dayOpenCommands.length > 1 ? 's' : ''} en cours`
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

function recordField(record: any, key: string): string {
  if (!record) return ''
  const direct = record[key]
  if (direct != null && direct !== '') return String(direct)
  const nested = record.monture?.[key]
  if (nested != null && nested !== '') return String(nested)
  return ''
}

function recordLocationCode(record: any): string {
  return (
    recordField(record, 'location_code')
    || recordField(record, 'emplacement')
    || recordField(record, 'to_location_code')
    || recordField(record, 'from_location_code')
    || ''
  )
}

function recordPhoto(record: any): string {
  return recordField(record, 'photo_monture_url') || recordField(record, 'image_url')
    || recordField(record, 'photo_url') || recordField(record, 'image')
    || recordField(record, 'monture_image') || recordField(record, 'frame_image')
}

function recordPhotoBranche(record: any): string {
  return recordField(record, 'photo_branche_url') || recordField(record, 'PhotoBrancheURL')
    || recordField(record, 'branche_image') || recordField(record, 'branch_image')
    || recordField(record, 'branche_url')
}

const HISTORIQUE_PAGE_SIZE = 10
const UNDETERMINED_SHAPE = '__forme_non_determinee__'

function isUndeterminedShape(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || normalized === '—' || normalized === 'unknown'
    || normalized === 'inconnu' || normalized === 'non déterminé' || normalized === 'non determinee'
    || normalized === 'non déterminée' || normalized === 'non determine'
}

const SELECT = 'rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-white outline-none focus:border-[#2563eb] sm:px-3 sm:py-2 sm:text-sm'

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
      if (forme === UNDETERMINED_SHAPE ? !isUndeterminedShape(recordField(record, 'shape')) : forme && recordField(record, 'shape') !== forme) return false
      if (genre && recordField(record, 'gender') !== genre) return false
      if (!needle) return true
      return ['reference', 'brand', 'barcode', 'color']
        .some(key => recordField(record, key).toLowerCase().includes(needle))
    })
  }, [movements, query, forme, genre])

  const totalPages = Math.max(1, Math.ceil(filtered.length / HISTORIQUE_PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const rows = filtered.slice((current - 1) * HISTORIQUE_PAGE_SIZE, current * HISTORIQUE_PAGE_SIZE)

  return (
    <div className="mx-auto max-w-4xl space-y-3 sm:space-y-4">
      {rows.length === 0 ? (
        <div className={`${CARD} flex flex-col items-center gap-1.5 p-6 text-center sm:gap-2 sm:p-8`}>
          <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-6 h-6 sm:w-8 sm:h-8')}</span>
          <p className="text-[11px] text-slate-400 sm:text-sm">
            {movements.length === 0 ? 'Aucun enregistrement pour l’instant.' : 'Aucun enregistrement ne correspond à ces filtres.'}
          </p>
        </div>
      ) : (
        <RecordsTable records={rows} onPrint={onPrint} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 sm:gap-3">
          <Btn onClick={() => onPageChange(current - 1)} disabled={current <= 1} className="text-xs sm:text-sm">{ic.arrowLeft()} Précédent</Btn>
          <span className="text-[10px] tabular-nums text-slate-400 sm:text-xs">Page {current} / {totalPages}</span>
          <Btn onClick={() => onPageChange(current + 1)} disabled={current >= totalPages} className="text-xs sm:text-sm">Suivant</Btn>
        </div>
      )}
    </div>
  )
}

function RecordsTable({ records, onPrint }: { records: Movement[]; onPrint: (record: Movement) => void }) {
  const [selectedRecord, setSelectedRecord] = useState<Movement | null>(null)

  return (
    <>
      <div className="overflow-x-auto -mx-2 sm:mx-0 rounded-xl sm:rounded-2xl border border-green-200 dark:border-green-700">
        <div className="min-w-[600px] sm:min-w-[720px]">
          <table className="w-full min-w-full divide-y divide-green-200 dark:divide-green-700 text-[10px] sm:text-xs">
            <thead className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-200">
              <tr>
                <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Photo</th>
                <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Réf</th>
                <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Marque</th>
                <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Forme</th>
                <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Genre</th>
                <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Date</th>
                <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Emplacement</th>
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
                    <td className="px-1.5 py-1.5 sm:px-2 sm:py-2">
                      {photo ? (
                        <img src={photo} alt="" loading="lazy" className="h-8 w-8 rounded-md object-cover sm:h-12 sm:w-12" />
                      ) : (
                        <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-slate-800 sm:px-2 sm:py-1 sm:text-xs">—</span>
                      )}
                    </td>
                    <td className="px-1.5 py-1.5 font-mono text-[10px] text-slate-900 dark:text-white sm:px-2 sm:py-2 sm:text-xs">
                      {recordField(record, 'reference') || recordField(record, 'barcode') || '—'}
                    </td>
                    <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">{recordField(record, 'brand') || '—'}</td>
                    <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">{recordField(record, 'shape') || '—'}</td>
                    <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">{recordField(record, 'gender') || '—'}</td>
                    <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">
                      {dayLabel(recordField(record, 'created_at'))} · {formatRecordTime(recordField(record, 'created_at'))}
                    </td>
                    <td className="px-1.5 py-1.5 font-mono text-[9px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-[11px]">
                      {recordLocationCode(record) || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-2 sm:p-4" onClick={() => setSelectedRecord(null)}>
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800 sm:rounded-2xl"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-700 sm:gap-3 sm:px-4 sm:py-3.5">
              <div className="min-w-0">
                <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Aperçu</p>
                <p className="mt-0.5 truncate text-sm font-bold text-slate-900 dark:text-white sm:mt-1 sm:text-lg">
                  {recordField(selectedRecord, 'reference') || recordField(selectedRecord, 'brand') || 'Monture'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedRecord(null)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-700 sm:px-2.5 sm:py-1.5 sm:text-xs"
              >
                Fermer
              </button>
            </div>

            <div className="p-3 space-y-3 sm:p-4 sm:space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="h-32 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900 sm:h-44">
                  {recordPhoto(selectedRecord)
                    ? <img src={recordPhoto(selectedRecord)} alt={recordField(selectedRecord, 'reference') || 'Monture'} className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">Pas de photo de monture</div>}
                </div>
                <div className="h-32 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900 sm:h-44">
                  {recordPhotoBranche(selectedRecord)
                    ? <img src={recordPhotoBranche(selectedRecord)} alt={recordField(selectedRecord, 'reference') || 'Branche'} className="h-full w-full object-cover" />
                    : <div className="flex h-full items-center justify-center text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">Pas de photo de branche</div>}
                </div>
              </div>

              <div className="grid gap-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:grid-cols-2 sm:gap-2 sm:text-sm">
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/60 sm:p-2.5"><span className="block text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Marque</span><span className="mt-0.5 block font-semibold sm:mt-1">{recordField(selectedRecord, 'brand') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/60 sm:p-2.5"><span className="block text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Référence</span><span className="mt-0.5 block font-semibold sm:mt-1">{recordField(selectedRecord, 'reference') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/60 sm:p-2.5"><span className="block text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Forme</span><span className="mt-0.5 block font-semibold sm:mt-1">{recordField(selectedRecord, 'shape') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/60 sm:p-2.5"><span className="block text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Genre</span><span className="mt-0.5 block font-semibold sm:mt-1">{recordField(selectedRecord, 'gender') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/60 sm:p-2.5"><span className="block text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Couleur</span><span className="mt-0.5 block font-semibold sm:mt-1">{recordField(selectedRecord, 'color') || '—'}</span></div>
                <div className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/60 sm:p-2.5"><span className="block text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400 sm:text-[10px]">Emplacement</span><span className="mt-0.5 block font-semibold sm:mt-1">{recordLocationCode(selectedRecord) || '—'}</span></div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRecord(null)
                    onPrint(selectedRecord)
                  }}
                  className="flex-1 rounded-xl bg-blue-600 px-3 py-2 text-[10px] font-semibold text-white hover:bg-blue-700 sm:px-4 sm:py-2.5 sm:text-sm"
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

function listCancelled(list: SendList) {
  return String(list.status || '').toUpperCase() === 'ANNULEE'
}

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

function ListesScreen({
  lists, loading, hidden, stationId, onReload, onReturn, hasSession,
}: {
  lists: SendList[]
  loading: boolean
  hidden: number
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
  const [cancelledWarning, setCancelledWarning] = useState(false)
  const [page, setPage] = useState(1)
  const codeRef = useRef<HTMLInputElement>(null)
  const verifyingRef = useRef(false)

  async function openListe(list: SendList) {
    setOpen(list)
    setItems([])
    setPage(1)
    setMessage('')
    setTone('')
    setCancelledWarning(false)
    setVerified(loadVerifiedIds(list.id))
    setLoadingItems(true)

    try {
      const payload = await apiFetch(`/inventory/send-lists/${list.id}/items`)
      const raw: SendListItem[] = Array.isArray(payload.data?.items) ? payload.data.items : []

      const detailed = await Promise.all(raw.map(async item => {
        if (!item.barcode) return item
        try {
          const glassPayload = await apiFetch(`/inventory/glasses/${encodeURIComponent(item.barcode)}`)
          const glass = glassPayload?.data?.glass
          const merged = glass ? { ...item, ...glass, id: item.id, glass_id: glass.id } : item
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

  async function verify(raw?: string) {
    const value = String(raw ?? code).trim()
    if (!value || !open || verifyingRef.current) return
    if (listCancelled(open)) {
      setCancelledWarning(true)
      setCode('')
      return
    }
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

    verifyingRef.current = true
    try {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, items, open, loadingItems])

  async function send() {
    if (!open || sending) return
    if (listCancelled(open)) {
      setCancelledWarning(true)
      return
    }
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
      try { window.localStorage.removeItem(verifiedStorageKey(open.id)) } catch { /* sans conséquence */ }
      setMessage(dispatchMessage(result))
      setTone('ok')
      onReload()
    } catch (error) {
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

  if (open) {
    const dispatched = listDispatched(open)
    const cancelled = listCancelled(open)
    const done = items.filter(item => verified.has(item.id)).length
    const complete = items.length > 0 && done === items.length
    const totalPages = Math.max(1, Math.ceil(items.length / LISTE_PAGE_SIZE))
    const current = Math.min(page, totalPages)
    const rows = items.slice((current - 1) * LISTE_PAGE_SIZE, current * LISTE_PAGE_SIZE)

    if (dispatched) {
      return (
        <div className="mx-auto max-w-4xl space-y-3 sm:space-y-4">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <Btn onClick={() => { setOpen(null); setDispatch(null) }} className="text-xs sm:text-sm">{ic.arrowLeft()} Listes</Btn>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">{dayLabel(open.created_at)}</p>
              <p className="truncate text-[10px] text-slate-400 sm:text-xs">{open.session_code || '—'}</p>
            </div>
          </div>

          {loadingItems ? (
            <div className={`${CARD} p-6 text-center text-[11px] text-slate-400 sm:p-8 sm:text-sm`}>Chargement du contenu…</div>
          ) : items.length === 0 ? (
            <div className={`${CARD} p-6 text-center text-[11px] text-slate-400 sm:p-8 sm:text-sm`}>Cette liste est vide.</div>
          ) : (
            <div className="overflow-x-auto -mx-2 sm:mx-0 rounded-xl sm:rounded-2xl border border-green-200 dark:border-green-700">
              <div className="min-w-[680px] sm:min-w-[880px]">
                <table className="w-full min-w-full divide-y divide-green-200 dark:divide-green-700 text-[10px] sm:text-xs">
                  <thead className="bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-200">
                    <tr>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Photo</th>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Réf</th>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Marque</th>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Genre</th>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Forme</th>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Emplacement</th>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Entrée</th>
                      <th className="px-1.5 py-1.5 text-left font-semibold sm:px-2 sm:py-2">Statut</th>
                      <th className="px-1.5 py-1.5 text-right font-semibold sm:px-2 sm:py-2">Prix</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-green-200 dark:divide-green-700 bg-white dark:bg-slate-900">
                    {rows.map(item => {
                      const photo = recordPhoto(item)
                      return (
                        <tr key={item.id}>
                          <td className="px-1.5 py-1.5 sm:px-2 sm:py-2">
                            {photo ? (
                              <img src={photo} alt="" className="h-8 w-8 rounded-md object-cover sm:h-12 sm:w-12" />
                            ) : (
                              <span className="inline-block rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-slate-800 sm:px-2 sm:py-1 sm:text-xs">—</span>
                            )}
                          </td>
                          <td className="px-1.5 py-1.5 font-mono text-[10px] text-slate-900 dark:text-white sm:px-2 sm:py-2 sm:text-xs">{item.reference || item.barcode || '—'}</td>
                          <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">{item.brand || '—'}</td>
                          <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">{item.gender || '—'}</td>
                          <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">{item.shape || '—'}</td>
                          <td className="px-1.5 py-1.5 font-mono text-[9px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-[11px]">{item.location_code || '—'}</td>
                          <td className="px-1.5 py-1.5 text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">
                            {dayLabel(item.created_at)} · {formatRecordTime(item.created_at)}
                          </td>
                          <td className="px-1.5 py-1.5 sm:px-2 sm:py-2">
                            <span className="inline-block rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 sm:px-2 sm:py-0.5 sm:text-[11px]">
                              En transit
                            </span>
                          </td>
                          <td className="px-1.5 py-1.5 text-right text-[10px] text-slate-700 dark:text-slate-200 sm:px-2 sm:py-2 sm:text-xs">{fmtPrix(item.price)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 sm:gap-3">
              <Btn onClick={() => setPage(current - 1)} disabled={current <= 1} className="text-xs sm:text-sm">{ic.arrowLeft()} Précédent</Btn>
              <span className="text-[10px] tabular-nums text-slate-400 sm:text-xs">Page {current} / {totalPages}</span>
              <Btn onClick={() => setPage(current + 1)} disabled={current >= totalPages} className="text-xs sm:text-sm">Suivant</Btn>
            </div>
          )}
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-4xl space-y-3 sm:space-y-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Btn onClick={() => { setOpen(null); setDispatch(null) }} className="text-xs sm:text-sm">{ic.arrowLeft()} Listes</Btn>
          <div className="min-w-0">
            <p className="truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">
              {dayLabel(open.created_at)}
            </p>
            <p className="truncate text-[10px] text-slate-400 sm:text-xs">{open.session_code || '—'}</p>
          </div>
        </div>

        <div className={`${CARD} p-3 sm:p-4`}>
          <div className="flex items-baseline justify-between gap-2 sm:gap-3">
            <strong className="text-xs font-bold text-slate-900 dark:text-white sm:text-sm">Confirmation des montures</strong>
            <span className="flex-shrink-0 text-[10px] tabular-nums text-slate-400 sm:text-xs">{done} / {items.length} vérifiée{done > 1 ? 's' : ''}</span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400 sm:mt-1 sm:text-xs">
            Scannez le code-barres de chaque monture : la validation est automatique.
          </p>

          <form onSubmit={e => { e.preventDefault(); void verify() }} className="mt-2 sm:mt-3">
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

          {message && <p className={`mt-1.5 text-[10px] sm:mt-2 sm:text-xs ${toneClass}`}>{message}</p>}
        </div>

        {loadingItems ? (
          <div className={`${CARD} p-6 text-center text-[11px] text-slate-400 sm:p-8 sm:text-sm`}>Chargement du contenu…</div>
        ) : items.length === 0 ? (
          <div className={`${CARD} p-6 text-center text-[11px] text-slate-400 sm:p-8 sm:text-sm`}>Cette liste est vide.</div>
        ) : (
          <div className={`${CARD} p-0 overflow-hidden`}>
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
                  location: item.location_code,
                  entry: item.created_at,
                  after: [fmtPrix(item.price)],
                  done: dispatched || ok,
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
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            <Btn onClick={() => setPage(current - 1)} disabled={current <= 1} className="text-xs sm:text-sm">{ic.arrowLeft()} Précédent</Btn>
            <span className="text-[10px] tabular-nums text-slate-400 sm:text-xs">Page {current} / {totalPages}</span>
            <Btn onClick={() => setPage(current + 1)} disabled={current >= totalPages} className="text-xs sm:text-sm">Suivant</Btn>
          </div>
        )}

        <div className="flex justify-end">
          <Btn variant="primary" onClick={() => void send()} disabled={dispatched || cancelled || !complete || sending} className="text-xs sm:text-sm">
            {ic.send()}
            {dispatched
              ? `En transit vers le stock magasin${(open.destination_station_name || open.city) ? ` (${open.destination_station_name || open.city})` : ''}`
              : sending ? 'Envoi en cours…'
              : complete ? `Envoyer (${items.length})`
              : `Envoyer — ${items.length - done} à vérifier`}
          </Btn>
        </div>

        {cancelledWarning && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="cancelled-list-title">
            <div className={`${CARD} w-full max-w-md p-5 text-center sm:p-6`}>
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 sm:h-12 sm:w-12">
                {ic.alert('w-5 h-5 sm:w-6 sm:h-6')}
              </div>
              <h3 id="cancelled-list-title" className="mt-3 text-sm font-bold text-slate-900 dark:text-white sm:mt-4 sm:text-base">Liste annulée</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 sm:mt-2 sm:text-sm">
                Cette liste a été annulée par la Direction et attend une nouvelle destination. La vérification et l'envoi sont temporairement bloqués.
              </p>
              <Btn className="mt-4 w-full justify-center sm:mt-5" onClick={() => setCancelledWarning(false)}>Compris</Btn>
            </div>
          </div>
        )}

        {dispatch && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-3 sm:p-4">
            <div className={`${CARD} w-full max-w-sm p-4 text-center sm:p-5`}>
              <p className="text-xs font-bold text-slate-900 dark:text-white sm:text-sm">Carton d'envoi</p>
              <p className="mt-0.5 text-[10px] text-slate-400 sm:mt-1 sm:text-xs">
                {dispatch.city || ''} · {dispatch.sent_count || 0} monture{Number(dispatch.sent_count || 0) > 1 ? 's' : ''}
              </p>

              <div className="mt-3 flex flex-col items-center rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 sm:mt-4 sm:p-4">
                <BarcodePreview value={dispatch.box_code || dispatch.box_reference || dispatch.code || ''} />
                <div className="mt-0.5 font-mono text-xs font-bold tabular-nums text-slate-900 sm:mt-1 sm:text-sm">
                  {dispatch.box_code || dispatch.box_reference || dispatch.code || '—'}
                </div>
                <span className="mt-0.5 text-[9px] text-slate-400 sm:mt-1 sm:text-[11px]">{dispatch.box_reference || dispatch.reference || 'Colis d’expédition'}</span>
              </div>

              <div className="mt-3 flex flex-col gap-1.5 sm:mt-4 sm:gap-2">
                <Btn variant="primary" className="w-full justify-center text-xs sm:text-sm" onClick={() => void printBoxLabel(dispatch)}>
                  {ic.printer()} Imprimer l'étiquette du carton
                </Btn>
                <Btn className="w-full justify-center text-xs sm:text-sm" onClick={() => { setDispatch(null); setOpen(null) }}>
                  Fermer
                </Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-3 sm:space-y-4">
      {!hasSession && (
        <div className="flex justify-start">
          <Btn variant="outline" onClick={onReturn} className="text-xs sm:text-sm">{ic.arrowLeft()} Retour</Btn>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 sm:gap-3">
        <div>
          <p className="text-[11px] text-slate-400 sm:text-sm">
            {loading ? 'Chargement…' : `${lists.length} liste${lists.length > 1 ? 's' : ''} reçue${lists.length > 1 ? 's' : ''}`}
          </p>
          {hidden > 0 && (
            <p className="text-[10px] text-slate-400 sm:text-xs">
              {hidden} liste{hidden > 1 ? 's' : ''} destinée{hidden > 1 ? 's' : ''} à un autre magasin, masquée{hidden > 1 ? 's' : ''}.
            </p>
          )}
        </div>
        <Btn onClick={onReload} disabled={loading} className="text-xs sm:text-sm">{ic.refresh()} Actualiser</Btn>
      </div>

      {lists.length === 0 && !loading ? (
        <div className={`${CARD} flex flex-col items-center gap-1.5 p-6 text-center sm:gap-2 sm:p-8`}>
          <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-6 h-6 sm:w-8 sm:h-8')}</span>
          <p className="text-[11px] text-slate-400 sm:text-sm">Aucune liste reçue.</p>
        </div>
      ) : (
        <div className="grid gap-2.5 sm:gap-3 grid-cols-1 sm:grid-cols-2">
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
                  className={`bg-white dark:bg-slate-800 rounded-2xl p-3 text-left transition-all hover:-translate-y-0.5 border-2 sm:p-4 ${sent ? 'border-[#16a34a]' : 'border-[#2563eb]'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-xs font-bold text-slate-900 dark:text-white sm:text-sm">
                      {isToday ? 'Aujourd’hui · ' : ''}{dayLabel(list.created_at)}
                    </p>
                    <Pill tone={sent ? 'green' : 'blue'}>{sent ? 'Envoyée' : 'À traiter'}</Pill>
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-slate-400 sm:mt-1 sm:text-xs">
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

const SESSION_DONE_SECONDS = 3

type Screen = 'loading' | 'activation' | 'sessions' | 'wizard' | 'historique' | 'listes'

const NAV: {
  id: Screen; label: string; short: string
  icon: (c?: string) => React.ReactElement
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
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40 pb-safe">
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

function TopBar({ current, session, dark, onToggleDark, onReset, onBack, historique, onOpenBatch }: {
  current: Screen
  session: ReceptionSession | null
  dark: boolean
  onToggleDark: () => void
  onReset: (() => void) | null
  onBack: (() => void) | null
  onOpenBatch?: () => void
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
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-2 md:px-6 min-h-12 sm:min-h-14 py-1.5 sm:py-2 flex flex-wrap items-center gap-1.5 sm:gap-3 flex-shrink-0">
      {onBack && (
        <button
          onClick={onBack}
          className="flex-shrink-0 -ml-0.5 flex items-center gap-1 rounded-xl px-1.5 py-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors sm:-ml-1 sm:px-2 sm:py-1.5 sm:text-xs"
          aria-label="Retour à mes sessions"
        >
          {ic.arrowLeft('w-3.5 h-3.5 sm:w-4 sm:h-4')}
          <span className="hidden sm:inline">Retour</span>
        </button>
      )}

      <div className={historique ? 'flex-shrink-0' : 'flex-1 min-w-0'}>
        <h1 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm md:text-base truncate leading-tight">{label}</h1>
      </div>

      {historique && (
        <div className="flex flex-1 min-w-[180px] flex-wrap items-center gap-1.5 sm:gap-2">
          <div className="relative flex-1 min-w-[120px] sm:min-w-[160px]">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400">{ic.search('w-3 h-3 sm:w-3.5 sm:h-3.5')}</span>
            <input
              type="search"
              value={historique.query}
              onChange={e => historique.onQuery(e.target.value)}
              placeholder="Réf, marque, code…"
              className={`${INPUT} py-1 pl-7 text-[10px] sm:pl-9 sm:text-xs`}
            />
          </div>
          <select value={historique.forme} onChange={e => historique.onForme(e.target.value)} className={`${SELECT} py-1 text-[10px] sm:py-1.5 sm:text-xs`}>
            <option value="">Formes</option>
            {historique.formes.slice(0, 5).map(value => <option key={value} value={value}>{value === UNDETERMINED_SHAPE ? 'Non déf.' : value}</option>)}
            {historique.formes.length > 5 && <option value="">+</option>}
          </select>
          <select value={historique.genre} onChange={e => historique.onGenre(e.target.value)} className={`${SELECT} py-1 text-[10px] sm:py-1.5 sm:text-xs`}>
            <option value="">Genres</option>
            {historique.genres.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
          <span className="whitespace-nowrap text-[9px] text-slate-400 sm:text-xs">
            {historique.count}
          </span>
        </div>
      )}

      {session && (
        <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 flex-shrink-0 sm:gap-2.5 sm:px-4 sm:py-2">
          <span className="text-blue-600 dark:text-blue-400 flex-shrink-0">{ic.tag('w-4 h-4 sm:w-5 sm:h-5')}</span>
          <span className="hidden sm:inline text-xs font-semibold text-slate-500 dark:text-slate-400 sm:text-sm">{session.code}</span>
          <span className="text-base font-black tabular-nums text-slate-900 dark:text-white leading-none sm:text-xl">
            {session.registered}/{session.target}
          </span>
        </span>
      )}

      {onReset && (
        <Btn variant="primary" onClick={onReset} className="flex-shrink-0 px-2 py-1.5 text-[10px] sm:px-2.5 md:px-3.5 sm:text-xs md:text-sm min-h-[36px] sm:min-h-[44px]">
          {ic.refresh('w-3 h-3 sm:w-4 sm:h-4')} <span className="hidden sm:inline">Nouveau</span>
        </Btn>
      )}
      <Btn onClick={() => { if (onOpenBatch) onOpenBatch() }} className="flex-shrink-0 px-2 py-1.5 text-[10px] sm:px-2.5 md:px-3.5 sm:text-xs md:text-sm min-h-[36px] sm:min-h-[44px]">
        {ic.camera('w-3 h-3 sm:w-4 sm:h-4')} <span className="hidden sm:inline">Capturer lot</span>
      </Btn>

      <button
        onClick={onToggleDark}
        className="md:hidden p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0 sm:p-2"
        aria-label="Changer de thème"
      >
        {dark ? ic.sun('w-3.5 h-3.5 sm:w-4 sm:h-4') : ic.moon('w-3.5 h-3.5 sm:w-4 sm:h-4')}
      </button>
      <button
        onClick={logoutToLogin}
        className="md:hidden p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0 sm:p-2"
        aria-label="Se déconnecter"
      >
        {ic.signOut('w-3.5 h-3.5 sm:w-4 sm:h-4')}
      </button>
    </header>
  )
}

function ScanPage() {
  const [dark, setDark] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [screen, setScreen] = useState<Screen>('loading')
  const [showMonturesManager, setShowMonturesManager] = useState(false)

  const [histQuery, setHistQuery] = useState('')
  const [histForme, setHistForme] = useState('')
  const [histGenre, setHistGenre] = useState('')
  const [histPage, setHistPage] = useState(1)

  const [autoRetour, setAutoRetour] = useState<number | null>(null)

  const [session, setSession] = useState<ReceptionSession | null>(null)
  const [activationStatus, setActivationStatus] = useState('')
  const [activationError, setActivationError] = useState(false)
  const [movements, setMovements] = useState<Movement[]>([])
  const [lists, setLists] = useState<SendList[]>([])
  const [loadingLists, setLoadingLists] = useState(false)
  const [commands, setCommands] = useState<ReceptionEntry[]>([])
  const [loadingCommands, setLoadingCommands] = useState(false)
  const [commandsDenied, setCommandsDenied] = useState(false)

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
  const [detectedShape, setDetectedShape] = useState('')
  const [aiMountType, setAiMountType] = useState('')

  const [finalData, setFinalData] = useState<FinalMonture | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [toast, setToast] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCameraOn(false)
  }, [])

  const startCamera = useCallback(async () => {
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

  useEffect(() => () => stopCamera(), [stopCamera])

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
      if (a.reference) detected.reference = a.reference
      if (a.shape) detected.forme = a.shape
      if (a.color) detected.couleur = normalizeColorValue(a.color)
      if (a.material) detected.matiere = a.material
      if (a.brand) detected.marque = a.brand
      if (a.gender && !session?.genre) detected.genre = a.gender

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
    if (key in EMPTY_SOURCES) {
      setSources(previous => (previous[key as FieldKey] === 'detected'
        ? { ...previous, [key]: 'corrected' }
        : previous))
    }
  }

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
      return
    }
    if (!photoBranche) return
    stopCamera()
    setStep(2)
  }

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
      const payload = await apiFetch(`/inventory/storage/next-free?station_id=${stationIdOf(user)}&zone=STOCK`)
      locationCode = payload.data?.code || '—'
    } catch (error: any) {
      window.alert(`Impossible de trouver un emplacement libre en stock : ${error?.message || 'erreur inconnue'}`)
      setConfirming(false)
      return
    }

    try {
      const payload = await apiFetch('/inventory/barcodes/next')
      barcode = String(payload.data?.barcode || '')
    } catch (error) {
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

  async function saveRecord() {
    if (!finalData) return
    if (!session || (session.target > 0 && session.registered >= session.target)) {
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

      const recorded: FinalMonture = {
        ...finalData,
        id: data.barcode || finalData.id,
        glassId: data.glass_id,
        emplacement: data.location_code || data.location || finalData.emplacement,
      }
      setFinalData(recorded)
      rememberBarcodeSession(recorded.id, session.code)

      await incrementSession()

      setSaved(true)
      playSuccessChime()
      showToast(`Monture enregistrée — ${recorded.id}`)
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
        genre: normalizeSessionGenre(command.gender),
        gamme: normalizeSessionGamme(command.gamme),
      }
      rememberScannedCode(active.code)
      rememberActivatedAt(active.code)
      setSession(active)
      setForm(previous => ({
        ...previous,
        genre: active.genre || previous.genre,
        gamme: active.gamme || previous.gamme,
      }))
      setSources(previous => ({
        ...previous,
        ...(active.genre ? { genre: 'manual' as FieldSource } : {}),
        ...(active.gamme ? { gamme: 'manual' as FieldSource } : {}),
      }))
      setActivationError(false)
      setActivationStatus('')

      const restant = Math.max(0, active.target - active.registered)
      showToast(`Session ${active.code} ouverte — ${restant} monture${restant > 1 ? 's' : ''} à enregistrer`)
      setStep(1)
      setScreen('wizard')
      return true
    } catch (error) {
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
      console.error('Erreur chargement des listes reçues', error)
      setLists([])
    } finally {
      setLoadingLists(false)
    }
  }, [])

  const loadCommands = useCallback(async (silent = false) => {
    if (!silent) setLoadingCommands(true)
    try {
      const codes = loadScannedCodes()
      const scannedSet = new Set(codes)

      const [ordersPayload, listPayload] = await Promise.all([
        apiFetchOptional('/inventory/expeditions'),
        apiFetchOptional('/inventory/reception-commands'),
      ])

      const parCommande = new Map<number, any>()
      const actives: any[] = []
      const retenir = (command: any) => {
        if (!command?.code || command.status !== 'active') return
        actives.push(command)
        const orderId = Number(command.supplier_order_id || 0)
        if (orderId > 0) parCommande.set(orderId, command)
      }

      if (listPayload) {
        const listCommands: any[] = listPayload.data?.commands || []
        for (const command of listCommands) retenir(command)
        const vivants = codes.filter(code => {
          const found = listCommands.find((c: any) => c.code === code)
          return !found || found.status === 'active'
        })
        if (vivants.length !== codes.length) saveScannedCodes(vivants)
      } else {
        const payloads = await Promise.all(
          codes.map(code => apiFetchOptional(`/inventory/reception-commands/${encodeURIComponent(code)}`)),
        )
        const vivants: string[] = []
        payloads.forEach((payload, index) => {
          const command = payload?.data?.command || payload?.data
          const status = command?.status ? String(command.status) : null
          if (status === null) { vivants.push(codes[index]); return }
          if (status === 'active') { vivants.push(codes[index]); retenir(command) }
        })
        if (vivants.length !== codes.length) saveScannedCodes(vivants)
      }

      const orders = ordersPayload?.data?.orders || []
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
          activatedAt: command?.activated_at || (command?.code ? loadActivatedAt(String(command.code)) : null),
          scanned: Boolean(command?.code) && scannedSet.has(String(command.code)),
          genre: normalizeSessionGenre(order.gender || command?.gender),
          gamme: normalizeSessionGamme(order.gamme || command?.gamme),
        }
      })

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
          activatedAt: command.activated_at || loadActivatedAt(code),
          scanned: scannedSet.has(code),
          genre: normalizeSessionGenre(command.gender),
          gamme: normalizeSessionGamme(command.gamme),
        })
      }

      setCommands(entries)
    } finally {
      setLoadingCommands(false)
    }
  }, [])

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
        const role = String(getRoleName(account))
        if (!ALLOWED_ROLES.includes(role)) {
          window.location.replace('/magasin.html')
          return
        }
        if (role !== 'SUPER_ADMIN' && !isPosteEnabled('magasinier')) {
          window.location.replace('/magasin.html')
          return
        }
        window.localStorage.setItem('user', JSON.stringify(account))
        setUser(account)
        setScreen('sessions')
        void loadMovements(account.id)
        void loadLists()
        void loadCommands()
      } catch {
        logoutToLogin()
      }
    })()
  }, [loadMovements, loadLists, loadCommands])

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

  function resetAll(skipConfirm = false) {
    if (!skipConfirm && step > 1 && !window.confirm('Voulez-vous vraiment recommencer ?')) return

    stopCamera()
    setPhotoMonture(null)
    setPhotoBranche(null)
    setCaptureTarget('monture')
    setForm({
      ...EMPTY_FORM,
      genre: session?.genre || '',
      gamme: session?.gamme || '',
    })
    setSources(EMPTY_SOURCES)
    setCollapsed({})
    setInvalid({})
    setDetectedShape('')
    setAiMountType('')
    setFinalData(null)
    setSaved(false)

    if (!session || (session.target > 0 && session.registered >= session.target)) {
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

  function goToSessions() {
    stopCamera()
    setScreen('sessions')
    void loadCommands()
  }

  function enterSession() {
    setScreen('wizard')
    setStep(1)
    if (!cameraOn) void startCamera()
  }

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

  function navigate(next: Screen) {
    if (next === screen) return
    if (screen === 'wizard') stopCamera()
    if (next === 'wizard') {
      enterSession()
      return
    }
    if (next === 'listes' || next === 'sessions') void loadCommands()
    setScreen(next)
  }

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

  const newLists = lists.filter(list => !listDispatched(list)).length

  const sessionFull = !session || (session.target > 0 && session.registered >= session.target)

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

  const histFormes = useMemo(() => {
    const values = distinctValues(movements, 'shape')
    return movements.some(record => isUndeterminedShape(recordField(record, 'shape')))
      ? [UNDETERMINED_SHAPE, ...values]
      : values
  }, [movements])
  const histGenres = useMemo(() => distinctValues(movements, 'gender'), [movements])
  const knownBrands = useMemo(() => distinctValues(movements, 'brand'), [movements])
  const histFilteredCount = useMemo(() => {
    const needle = histQuery.trim().toLowerCase()
    return movements.filter(record => {
      if (histForme === UNDETERMINED_SHAPE ? !isUndeterminedShape(recordField(record, 'shape')) : histForme && recordField(record, 'shape') !== histForme) return false
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
            onOpenBatch={() => {
              if (!session) {
                window.alert("Aucune session active — ouvrez une session d'enregistrement d'abord.")
                return
              }
              if (session.target > 0 && session.registered >= session.target) {
                window.alert('La session est pleine — ouvrez une autre session.')
                return
              }
              stopCamera()
              setShowMonturesManager(true)
            }}
          />

          <main className="flex-1 px-2 sm:px-4 md:px-6 py-2 sm:py-4 md:py-6 pb-20 sm:pb-24 md:pb-8 overflow-auto">
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
              hidden={0}
              stationId={stationIdOf(user)}
              onReload={() => { void loadLists(); void loadCommands() }}
              onReturn={goToSessions}
              hasSession={Boolean(session)}
            />
          )}

          {screen === 'wizard' && (
            <div className="mx-auto max-w-4xl">
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

                  <div className="grid gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[260px_1fr]">
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-1">
                      <PhotoBox url={photoMonture} label="Monture" />
                      <PhotoBox url={photoBranche} label="Branche" />
                    </div>

                    <div className="space-y-2 sm:space-y-2.5">
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
                        <input
                          type="text" list="marquesList" value={form.marque} placeholder="Ray-Ban" className={INPUT}
                          onChange={e => setField('marque', e.target.value)}
                        />
                        <datalist id="marquesList">
                          <option value="OPAL" />
                          {knownBrands.filter(brand => brand !== 'OPAL').map(brand => <option key={brand} value={brand} />)}
                        </datalist>
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
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(80px,1fr))] sm:gap-2">
                          {FORMES.map(forme => {
                            const selected = form.forme === forme
                            return (
                              <button
                                key={forme}
                                type="button"
                                onClick={() => setField('forme', forme)}
                                className={`flex flex-col items-center gap-0.5 rounded-xl border p-1.5 text-[10px] font-semibold transition-all sm:gap-1 sm:p-2 sm:text-[11px] ${selected
                                  ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]'
                                  : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}
                              >
                                <ShapeIcon name={forme} className="w-8 h-4 sm:w-10 sm:h-5" />
                                <span className="text-center leading-tight">{forme === 'Oeil de chat' ? 'Œil de chat' : forme}</span>
                              </button>
                            )
                          })}
                        </div>
                        <p className="mt-1 text-[9px] text-slate-400 sm:mt-2 sm:text-[11px]">
                          Choisissez la forme réelle de la monture : ça aide l'IA à mieux la reconnaître.
                        </p>
                      </Field>

                      <Field
                        icon={ic.palette()} label="Couleur" source={sources.couleur}
                        collapsed={collapsed.couleur} summary={form.couleur} invalid={invalid.couleur}
                        onExpand={() => setCollapsed(p => ({ ...p, couleur: false }))}
                      >
                        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-[repeat(auto-fit,minmax(100px,1fr))] sm:gap-2">
                          {COULEURS.map(({ value, swatch }) => {
                            const selected = form.couleur === value
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setField('couleur', value)}
                                className={`flex items-center gap-1 rounded-xl border px-1.5 py-1 text-[10px] font-semibold transition-all sm:gap-1.5 sm:px-2 sm:py-1.5 sm:text-[11px] ${selected
                                  ? 'border-[#2563eb] bg-[#2563eb]/10 text-[#2563eb]'
                                  : 'border-slate-200 text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:text-slate-400'}`}
                              >
                                <span
                                  className="h-3 w-3 flex-shrink-0 rounded-full border border-slate-300 dark:border-slate-600 sm:h-4 sm:w-4"
                                  style={{ background: swatch }}
                                />
                                <span className="truncate text-[9px] sm:text-[11px]">{value}</span>
                              </button>
                            )
                          })}
                        </div>
                        <p className="mt-1 text-[9px] text-slate-400 sm:mt-2 sm:text-[11px]">
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

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-2.5 dark:border-slate-700 sm:gap-2 sm:px-4 sm:py-3">
                    <Btn onClick={() => { setStep(1); void startCamera() }} className="text-xs sm:text-sm">{ic.arrowLeft()} Retour</Btn>
                    <Btn variant="primary" className="ml-auto text-xs sm:text-sm" onClick={() => void confirmVerification()} disabled={confirming}>
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

                  <div className="p-3 sm:p-4">
                    <div className="mx-auto flex max-w-sm flex-col items-center rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 sm:p-4">
                      {finalData.id
                        ? <>
                            <BarcodePreview value={finalData.id} />
                            <div className="mt-0.5 font-mono text-xs font-bold tabular-nums text-slate-900 sm:mt-1 sm:text-sm">{finalData.id}</div>
                          </>
                        : <div className="py-3 text-center text-[10px] text-slate-400 sm:py-4 sm:text-xs">Numéro attribué à l'enregistrement</div>}
                      <span className="mt-0.5 text-[9px] text-slate-400 sm:mt-1 sm:text-[11px]">Aperçu de l'étiquette</span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(110px,1fr))] sm:gap-3 sm:mt-4">
                      {[
                        ['Marque', finalData.marque || '—'],
                        ['Référence', finalData.reference || '—'],
                        ['Code-barres', finalData.id || 'À l\'enregistrement'],
                        ['Emplacement', finalData.emplacement],
                        ['Quantité', String(finalData.quantite)],
                        ['Gamme', fmtFCFA(finalData.prix)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl bg-slate-50 p-2 dark:bg-slate-900/50 sm:p-3">
                          <div className="text-[9px] font-semibold text-slate-400 sm:text-[11px]">{label}</div>
                          <div className="mt-0.5 truncate text-xs font-bold text-slate-900 dark:text-white sm:mt-0.5 sm:text-sm">{value}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 px-3 py-2.5 dark:border-slate-700 sm:gap-2 sm:px-4 sm:py-3">
                    {!saved ? (
                      <>
                        <Btn onClick={() => setStep(2)} className="text-xs sm:text-sm">{ic.arrowLeft()} Retour</Btn>
                        <Btn variant="success" className="ml-auto text-xs sm:text-sm" onClick={() => void saveRecord()} disabled={saving}>
                          {ic.save()} {saving ? 'Enregistrement en cours…' : 'Enregistrer'}
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn onClick={() => void printMontureLabel(finalData)} className="text-xs sm:text-sm">{ic.printer()} Réimprimer</Btn>

                        {!sessionFull && (
                          <Btn onClick={goToSessions} className="text-xs sm:text-sm">{ic.calendar()} Mes sessions</Btn>
                        )}

                        <div className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto sm:gap-2">
                          <Btn
                            className="w-full text-xs sm:w-auto sm:text-sm"
                            variant={sessionFull ? 'success' : 'primary'}
                            onClick={() => {
                              if (sessionFull) {
                                window.alert('Impossible : aucune session active ou session pleine.')
                                return
                              }
                              stopCamera()
                              setShowMonturesManager(true)
                            }}
                          >
                            {sessionFull
                              ? <>
                                  {ic.check()} Terminée → Sessions
                                  {autoRetour !== null && <span className="tabular-nums"> ({autoRetour} s)</span>}
                                </>
                              : <>{ic.plus()} Autre monture</>}
                          </Btn>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          </main>
        </div>

        {toast && (
          <div className="fixed bottom-16 sm:bottom-20 md:bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-xl bg-[#16a34a] px-3 py-2 text-[10px] font-semibold text-white shadow-lg sm:gap-2 sm:px-4 sm:py-3 sm:text-sm">
            {ic.checkCircle()} {toast}
          </div>
        )}

        <MobileNav
          current={screen}
          onNavigate={navigate}
          hasSession={Boolean(session)}
          newLists={newLists}
        />
        {showMonturesManager && <MonturesManager
          sessionRemaining={session ? Math.max(0, (session.target || 0) - (session.registered || 0)) : undefined}
          sessionCode={session?.code}
          sessionGenre={session?.genre}
          sessionGamme={session?.gamme}
          knownBrands={knownBrands}
          onRecorded={incrementSession}
          onClose={() => { setShowMonturesManager(false); void loadCommands(); }}
        />}
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ScanPage />
  </React.StrictMode>,
)