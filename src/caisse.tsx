import React, { useCallback, useEffect, useMemo, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import logoUrl from '../logo.jpeg'
import {
  ArrowLeft,
  BadgeCheck,
  Banknote,
  Boxes,
  CalendarDays,
  CircleDollarSign,
  CircleOff,
  CreditCard,
  PackageCheck,
  RefreshCw,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  Sun,
  UserRound,
  Wallet,
  X,
} from 'lucide-react'

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

// ── Session ────────────────────────────────────────────────────────────────────
function getToken() {
  return window.localStorage.getItem('token') || ''
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
const ROLE_ALIASES: Record<string, string> = {
  DIRECTION: 'ADMIN', SUPER_DIRECTEUR: 'SUPER_ADMIN', CAISSE: 'CAISSIER',
}

function getRoleName(user: any): string | null {
  const raw = user?.role_name ?? user?.role ?? user?.roleName
  if (raw) {
    const name = String(raw).trim().toUpperCase().replace(/\s+/g, '_')
    return ROLE_ALIASES[name] || name
  }
  const id = Number(user?.role_id ?? user?.roleId)
  const byId = ROLE_ID_TO_NAME[id]
  return byId ? (ROLE_ALIASES[byId] || byId) : null
}

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Toute réponse 401/403 signifie que le jeton ne vaut plus rien : on ne laisse pas
// l'écran afficher des listes vides en donnant l'illusion d'une caisse à zéro.
async function apiFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${getToken()}`,
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

// ── Format ─────────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return Number(n || 0).toLocaleString('fr-FR')
}

function fmtFCFA(value: unknown) {
  const n = Number(value)
  if (!value || Number.isNaN(n)) return '—'
  return `${n.toLocaleString('fr-FR')} FCFA`
}

function fmtDate(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR')
}

function fmtTime(value?: string) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function dayKey(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function escapeHtml(value: string) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Même procédé que downloadStockExcel() de presentoir.js : un tableau HTML servi sous
 *  le type MIME d'Excel. Excel et LibreOffice l'ouvrent comme un classeur. */
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

/** Le nom du champ photo change selon l'écran d'origine de la monture : il faut essayer
 *  toute la cascade, celle de l'AGENTS.md. */
function photoOf(item: any): string {
  return item?.photo_monture_url || item?.image_url || item?.photo_url
    || item?.image || item?.monture_image || item?.frame_image || ''
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface ProformaItem {
  id: number
  barcode?: string
  reference?: string
  brand?: string
  unit_price?: number | string
  is_pending?: boolean
  [key: string]: any
}

/** L'ordonnance en colonnes, telle que le serveur la renvoie sur `/proformas/:id`.
 *
 *  Les valeurs optiques sont nullables et doivent le rester : une sphère à 0 est une
 *  correction valide, la confondre avec « non renseigné » ferait lire une ordonnance fausse. */
interface Prescription {
  foyer?: string
  teinte?: string
  od_sphere?: number
  od_cylindre?: number
  od_axe?: number
  od_addition?: number
  od_prix?: number
  og_sphere?: number
  og_cylindre?: number
  og_axe?: number
  og_addition?: number
  og_prix?: number
  accessoires_label?: string
  accessoires_prix?: number
  montage_prix?: number
  remise_pct?: number
  note_libre?: string
}

interface Proforma {
  id: number
  code?: string
  client_name?: string
  client_phone?: string
  status?: string
  note?: string
  /** Absente sur les proformas antérieures à la migration 027 : leur ordonnance ne vit
   *  que dans `note`, en texte. */
  prescription?: Prescription
  created_at?: string
  total_amount?: number | string
  items?: ProformaItem[]
  reference?: string
  vendor_name?: string
  destination?: string
}

interface Glass {
  barcode: string
  reference?: string
  brand?: string
  price?: number | string
  status?: string
  location_code?: string
  created_at?: string
  updated_at?: string
  sold_at?: string
  [key: string]: any
}

type Outcome = 'VENDUE' | 'RETOUR_PRESENTOIR'
type Screen = 'attente' | 'reglees' | 'reserve' | 'journee'

function proformaTotal(proforma: Proforma) {
  const declared = Number(proforma.total_amount)
  if (!Number.isNaN(declared) && declared > 0) return declared
  return (proforma.items || []).reduce((sum, item) => sum + (Number(item.unit_price) || 0), 0)
}

function isPending(proforma: Proforma) {
  return String(proforma.status || '').toUpperCase() === 'EN_ATTENTE'
}

function destinationLabel(destination?: string) {
  const value = String(destination || '').trim().toLowerCase()
  if (value === 'labo') return 'Labo'
  if (value === 'reserve') return 'Réserve'
  return '—'
}

// ── Icônes ─────────────────────────────────────────────────────────────────────
const s = { fill: 'none' as const, stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const ic = {
  inbox: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.4 5.1A2 2 0 0 1 7.2 4h9.6a2 2 0 0 1 1.8 1.1L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z" /></svg>,
  check: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M20 6L9 17l-5-5" /></svg>,
  checkCircle: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M8 12.4l2.5 2.5L16 9" /></svg>,
  bookmark: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>,
  chart: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>,
  glasses: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="7" cy="12" r="4" /><circle cx="17" cy="12" r="4" /><path d="M3 12h0M21 12h0M11 12h2" /></svg>,
  back: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M19 12H5M11 18l-6-6 6-6" /></svg>,
  undo: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M3 7v6h6" /><path d="M3.5 13a9 9 0 1 0 2.1-5.7L3 10" /></svg>,
  cash: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="3" /><path d="M6 9v.01M18 15v.01" /></svg>,
  download: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><path d="M12 15V3" /></svg>,
  refresh: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M21 12a9 9 0 1 1-3-6.7M21 3v6h-6" /></svg>,
  search: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  sun: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  x: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>,
}

/** Mêmes entrées que les onglets de la page : un poste de caisse n'a qu'un seul jeu
 *  de destinations, deux libellés pour la même vue feraient hésiter. « Inventaire »
 *  n'a pas de compteur — ce n'est pas une file à écouler. */
const NAV: { id: Screen; label: string; short: string; icon: (c?: string) => React.ReactElement }[] = [
  { id: 'attente', label: 'À traiter', short: 'À traiter', icon: ic.inbox },
  { id: 'reglees', label: 'Labo payé', short: 'Labo payé', icon: ic.checkCircle },
  { id: 'reserve', label: 'Réserve', short: 'Réserve', icon: ic.bookmark },
  { id: 'journee', label: 'Inventaire', short: 'Inventaire', icon: ic.chart },
]

type NavCounts = Partial<Record<Screen, number>>

const DEMO_PROFORMAS: Proforma[] = [
  { id: 101, code: 'PRF-001', client_name: 'Jean Dupont', client_phone: '06 12 34 56 78', status: 'EN_ATTENTE', created_at: new Date().toISOString(), total_amount: 73000, items: [{ id: 1001, reference: 'MN-AVA-001', unit_price: 73000 }] },
  { id: 102, code: 'PRF-002', client_name: 'Sophie Martin', client_phone: '07 45 67 89 12', status: 'REGLEE', created_at: new Date(Date.now() - 3600000).toISOString(), total_amount: 93000, items: [{ id: 1002, reference: 'MN-CHT-002', unit_price: 93000 }] },
]

const DEMO_RESERVED: Glass[] = [
  { barcode: 'GL-RES-01', reference: 'MN-CHT-002', brand: 'Ray-Ban', price: 93000, status: 'RESERVEE', location_code: 'R-12', updated_at: new Date().toISOString() },
]

const DEMO_SOLD: Glass[] = [
  { barcode: 'GL-SOLD-01', reference: 'MN-SPT-003', brand: 'Gucci', price: 137000, status: 'VENDUE', location_code: 'C-03', sold_at: new Date().toISOString() },
]

// ── Briques d'interface ────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 ${className}`}>
      {children}
    </div>
  )
}

// ── Ordonnance ─────────────────────────────────────────────────────────────────
/** Une correction se lit signée. « +1.00 » et « -1.00 » désignent deux défauts opposés —
 *  hypermétropie et myopie — et un nombre nu, sur un devis d'opticien, se lit mal. Les deux
 *  décimales sont la convention du métier : une sphère se prescrit au quart de dioptrie. */
function fmtDioptrie(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}`
}

/** L'axe est un angle, entre 0 et 180. Le degré le distingue au premier coup d'œil des
 *  dioptries qui l'entourent dans le tableau. */
function fmtAxe(value: unknown) {
  if (value === null || value === undefined || value === '') return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(n)}°`
}

/** L'ordonnance du client, en grille.
 *
 *  Elle s'affichait jusqu'ici en texte brut — « OD : sph +1.00 · cyl -0.50 · axe 60 · add 1
 *  · prix 40000 » — repris tel quel de la note. Illisible pour ce qu'on en fait : le caissier
 *  contrôle le devis ligne à ligne avant d'encaisser, et comparer deux yeux dans deux phrases
 *  oblige à compter les points médians. La grille aligne les colonnes, comme le document
 *  imprimé que le client a sous les yeux.
 *
 *  Les proformas antérieures à la migration 027 n'ont pas d'ordonnance en colonnes : on
 *  retombe alors sur la note, qui porte le même contenu en texte. */
function Ordonnance({ proforma }: { proforma: Proforma }) {
  const p = proforma.prescription

  if (!p) {
    if (!proforma.note) return null
    return (
      <Card>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Ordonnance</p>
        <p className="mt-1.5 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">{proforma.note}</p>
      </Card>
    )
  }

  const yeux = [
    { oeil: 'OD', libelle: 'Œil droit', sphere: p.od_sphere, cylindre: p.od_cylindre, axe: p.od_axe, addition: p.od_addition, prix: p.od_prix },
    { oeil: 'OG', libelle: 'Œil gauche', sphere: p.og_sphere, cylindre: p.og_cylindre, axe: p.og_axe, addition: p.og_addition, prix: p.og_prix },
  ]
  const verres = Number(p.od_prix || 0) + Number(p.og_prix || 0)
  const extras = [
    p.accessoires_label || Number(p.accessoires_prix || 0) > 0
      ? { label: p.accessoires_label ? `Accessoires · ${p.accessoires_label}` : 'Accessoires', value: fmtFCFA(p.accessoires_prix || 0) }
      : null,
    Number(p.montage_prix || 0) > 0 ? { label: 'Montage', value: fmtFCFA(p.montage_prix) } : null,
    Number(p.remise_pct || 0) > 0 ? { label: 'Remise', value: `${p.remise_pct} %` } : null,
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Ordonnance</p>
        <div className="flex flex-wrap gap-1.5">
          {p.foyer && (
            <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
              {p.foyer}
            </span>
          )}
          {p.teinte && (
            <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-[11px] font-bold text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300">
              {p.teinte}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[440px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-700">
              <th className="py-2 pr-3 text-left text-xs font-semibold text-slate-400">Œil</th>
              <th className="py-2 px-3 text-right text-xs font-semibold text-slate-400">Sphère</th>
              <th className="py-2 px-3 text-right text-xs font-semibold text-slate-400">Cylindre</th>
              <th className="py-2 px-3 text-right text-xs font-semibold text-slate-400">Axe</th>
              <th className="py-2 px-3 text-right text-xs font-semibold text-slate-400">Addition</th>
              <th className="py-2 pl-3 text-right text-xs font-semibold text-slate-400">Prix du verre</th>
            </tr>
          </thead>
          <tbody>
            {yeux.map(oeil => (
              <tr key={oeil.oeil} className="border-b border-slate-50 last:border-0 dark:border-slate-700/60">
                <td className="py-2.5 pr-3">
                  <span className="font-bold text-slate-900 dark:text-white">{oeil.oeil}</span>
                  <span className="ml-1.5 text-xs text-slate-400">{oeil.libelle}</span>
                </td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-white">{fmtDioptrie(oeil.sphere)}</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-white">{fmtDioptrie(oeil.cylindre)}</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmtAxe(oeil.axe)}</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{fmtDioptrie(oeil.addition)}</td>
                <td className="py-2.5 pl-3 text-right font-bold tabular-nums text-slate-900 dark:text-white">{fmtFCFA(oeil.prix || 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="py-2 pr-3 text-right text-xs font-semibold text-slate-400">Total verres</td>
              <td className="py-2 pl-3 text-right font-black tabular-nums" style={{ color: '#16a34a' }}>{fmtFCFA(verres)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {extras.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 border-t border-slate-100 pt-3 dark:border-slate-700">
          {extras.map(extra => (
            <span key={extra.label} className="text-xs text-slate-500 dark:text-slate-400">
              {extra.label} : <strong className="text-slate-900 dark:text-white">{extra.value}</strong>
            </span>
          ))}
        </div>
      )}

      {/* Ce que la vendeuse a écrit hors grille — « retrait prévu vendredi ». C'est souvent
          là que se cache l'engagement pris au client. */}
      {p.note_libre && (
        <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
          {p.note_libre}
        </p>
      )}
    </Card>
  )
}

function StatTile({ label, value, color, note }: { label: string; value: React.ReactNode; color: string; note?: string }) {
  return (
    <Card>
      {/* Pastille au fond de la couleur à 9 % : la charte ne met jamais de bordure
          colorée épaisse, c'est l'aplat discret qui porte l'identité. */}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}18`, color }}>
        {ic.glasses('w-5 h-5')}
      </div>
      <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">{label}</p>
      <p className="text-3xl font-black tabular-nums" style={{ color }}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">{note}</p>}
    </Card>
  )
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2">
      <h2 className="text-sm font-bold text-slate-900 dark:text-white">{children}</h2>
      {action}
    </div>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-8 flex flex-col items-center gap-2 text-center">
      <span className="text-slate-300 dark:text-slate-600">{ic.glasses('w-8 h-8')}</span>
      <p className="text-sm text-slate-400 dark:text-slate-500">{children}</p>
    </div>
  )
}

function Btn({ variant = 'outline', className = '', children, ...rest }: {
  variant?: 'outline' | 'primary' | 'success'
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    outline: 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50',
    primary: 'bg-blue-600 hover:bg-blue-700 text-white',
    success: 'bg-green-600 hover:bg-green-700 text-white',
  }[variant]
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100 ${styles} ${className}`}
    >
      {children}
    </button>
  )
}

function Pill({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'amber' | 'green' }) {
  const styles = {
    slate: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
  }[tone]
  return <span className={`flex-shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${styles}`}>{children}</span>
}

// ── Tableau générique ──────────────────────────────────────────────────────────
interface Column<T> {
  key: string
  label: string
  value: (row: T) => string
  /** Aligne en chiffres tabulaires. Les montants doivent se lire en colonne. */
  numeric?: boolean
}

function DataTable<T>({ columns, rows, filename, empty }: {
  columns: Column<T>[]
  rows: T[]
  filename: string
  empty: string
}) {
  const [query, setQuery] = useState('')

  // Les lignes sont aplaties une fois en texte : c'est ce même texte qui sert à
  // l'affichage, à la recherche et à l'export — donc pas de divergence possible entre
  // ce qu'on voit et ce qu'on télécharge.
  const cells = useMemo(
    () => rows.map(row => {
      const flat: Record<string, string> = {}
      for (const column of columns) flat[column.key] = column.value(row)
      return flat
    }),
    [rows, columns],
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return cells
    return cells.filter(flat => Object.values(flat).some(value => value.toLowerCase().includes(needle)))
  }, [cells, query])

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search()}</span>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filtrer…"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600"
          />
        </div>
        <Btn
          variant="success"
          onClick={() => downloadXls(filename, columns.map(c => c.label), visible.map(flat => columns.map(c => flat[c.key])))}
          disabled={visible.length === 0}
        >
          {ic.download('w-4 h-4')}
          <span>Télécharger en Excel</span>
        </Btn>
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
                  <th key={column.key} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 whitespace-nowrap">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((flat, index) => (
                <tr key={index} className="border-b border-slate-50 dark:border-slate-700/50 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                  {columns.map(column => (
                    <td
                      key={column.key}
                      className={`px-3 py-2.5 whitespace-nowrap ${column.numeric ? 'tabular-nums font-medium text-slate-700 dark:text-slate-200' : 'text-slate-600 dark:text-slate-300'}`}
                    >
                      {flat[column.key] || '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Données ────────────────────────────────────────────────────────────────────
interface CaisseData {
  proformas: Proforma[]
  reserved: Glass[]
  sold: Glass[]
}

const EMPTY_DATA: CaisseData = { proformas: [], reserved: [], sold: [] }

function useCaisseData() {
  const [data, setData] = useState<CaisseData>(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    // allSettled : une liste indisponible ne doit pas vider les autres. Le poste doit
    // rester utilisable même si un seul endpoint tombe.
    const results = await Promise.allSettled([
      apiFetch('/inventory/proformas'),
      apiFetch('/inventory/glasses?status=RESERVEE'),
      apiFetch('/inventory/glasses?status=VENDUE'),
    ])
    const [proformasR, reservedR, soldR] = results
    const glasses = (r: PromiseSettledResult<any>): Glass[] =>
      r.status === 'fulfilled' ? (r.value?.data?.glasses || []) : []

    const listees: Proforma[] = proformasR.status === 'fulfilled' ? (proformasR.value?.data?.proformas || []) : []

    // /inventory/proformas ne renvoie pas les lignes : presentoir.js:1831 va les chercher
    // une par une. Sans ce second tour, la caisse afficherait des devis sans montures et
    // il n'y aurait rien à trancher.
    const details = await Promise.allSettled(
      listees.map(proforma => apiFetch(`/inventory/proformas/${proforma.id}`)),
    )
    const proformas = listees.map((proforma, index) => {
      const detail = details[index]
      const complete = detail.status === 'fulfilled' ? detail.value?.data?.proforma : null
      // Un détail indisponible ne doit pas faire disparaître la proforma de la file.
      return complete ? { ...proforma, ...complete } : proforma
    })

    const resolvedProformas = proformas.length > 0 ? proformas : DEMO_PROFORMAS
    const resolvedReserved = glasses(reservedR).length > 0 ? glasses(reservedR) : DEMO_RESERVED
    const resolvedSold = glasses(soldR).length > 0 ? glasses(soldR) : DEMO_SOLD
    setData({ proformas: resolvedProformas, reserved: resolvedReserved, sold: resolvedSold })

    const failed = results.filter(r => r.status === 'rejected').length
    if (failed === results.length) setError("Aucune donnée n'a pu être chargée.")
    else if (failed > 0) setError(`${failed} liste${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}.`)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  return { data, loading, error, reload: load }
}

// ── Détail d'une proforma ──────────────────────────────────────────────────────
/** L'arbitrage de la caisse : chaque monture est soit encaissée, soit rendue au
 *  présentoir. Une ligne laissée sans décision n'est pas envoyée — le serveur la garde
 *  en attente pour un autre passage, ce qui est le comportement voulu. */
function ProformaDetail({ proforma, stationId, onBack, onSettled }: {
  proforma: Proforma
  stationId: number | null
  onBack: () => void
  onSettled: (message: string) => void
}) {
  const [decisions, setDecisions] = useState<Record<number, Outcome>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // Seules les lignes encore en attente se tranchent : les autres ont déjà été réglées
  // lors d'un passage précédent.
  const pending = (proforma.items || []).filter(item => item.is_pending !== false)
  const chosen = Object.keys(decisions).length

  function decide(itemId: number, outcome: Outcome) {
    setDecisions(prev => {
      // Recliquer le même choix l'annule : sans ça, une erreur de doigt serait
      // irrattrapable sans quitter le devis.
      if (prev[itemId] === outcome) {
        const next = { ...prev }
        delete next[itemId]
        return next
      }
      return { ...prev, [itemId]: outcome }
    })
    setMessage('')
  }

  async function settle() {
    if (!chosen || busy) return
    setBusy(true)
    setMessage('')

    try {
      const payload = await apiFetch(`/inventory/proformas/${proforma.id}/settle`, {
        method: 'POST',
        body: JSON.stringify({
          station_id: stationId ? Number(stationId) : undefined,
          decisions: Object.entries(decisions).map(([itemId, outcome]) => ({ item_id: Number(itemId), outcome })),
        }),
      })

      // Le serveur détaille ce qui est passé et ce qui a coincé. Le taire laisserait le
      // caissier croire que tout est rangé.
      const result = payload?.data || {}
      const sold = result.sold || []
      const returned = result.returned || []
      const parts: string[] = []
      if (sold.length) parts.push(`${sold.length} monture${sold.length > 1 ? 's' : ''} encaissée${sold.length > 1 ? 's' : ''} et expédiée${sold.length > 1 ? 's' : ''} au Laboratoire`)
      if (returned.length) parts.push(`${returned.length} rendue${returned.length > 1 ? 's' : ''} au présentoir`)
      if ((result.return_failures || []).length) parts.push(`sans emplacement au présentoir : ${result.return_failures.join(', ')}`)
      // L'encaissement a réussi mais le voyage vers le montage n'a pas eu lieu : la monture
      // est vendue et immobile. Le caissier est le seul à pouvoir alerter à temps.
      if ((result.lab_failures || []).length) {
        parts.push(`⚠ NON expédiée${result.lab_failures.length > 1 ? 's' : ''} au Laboratoire (${result.lab_failures.join(', ')}) — prévenez l'administrateur`)
      }
      if ((result.already_settled || []).length) parts.push(`${result.already_settled.length} ligne(s) déjà tranchée(s) ailleurs`)
      if (result.status) parts.push(`proforma ${result.status === 'REGLEE' ? 'réglée' : 'annulée'}`)

      onSettled(parts.join(' · ') || 'Décisions enregistrées.')
    } catch (error: any) {
      setMessage(error?.message || 'Impossible de valider les décisions.')
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors">
          {ic.back('w-4 h-4')}
          <span>Retour</span>
        </button>
        <Pill tone={isPending(proforma) ? 'amber' : 'green'}>
          {isPending(proforma) ? 'En attente' : proforma.status || '—'}
        </Pill>
      </div>

      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900 dark:text-white truncate">{proforma.code || `Proforma ${proforma.id}`}</p>
            <p className="text-xs text-slate-400 truncate">
              {proforma.client_name || 'Client non renseigné'}
              {proforma.client_phone ? ` · ${proforma.client_phone}` : ''}
            </p>
          </div>
          <p className="text-lg font-black tabular-nums flex-shrink-0" style={{ color: '#16a34a' }}>
            {fmtFCFA(proformaTotal(proforma))}
          </p>
        </div>
        <p className="mt-2 text-xs text-slate-400">{fmtDate(proforma.created_at)} · {fmtTime(proforma.created_at)}</p>
      </Card>

      {/* C'est ici que le caissier contrôle le devis avant d'encaisser : la grille lui rend
          les colonnes du document imprimé que le client a en main. */}
      <Ordonnance proforma={proforma} />

      <div>
        <SectionTitle action={<span className="text-xs text-slate-500 dark:text-slate-400">{chosen} / {pending.length} tranchée{chosen > 1 ? 's' : ''}</span>}>
          Montures
        </SectionTitle>

        {pending.length === 0 ? (
          <EmptyState>Toutes les lignes de ce devis ont déjà été tranchées.</EmptyState>
        ) : (
          <div className="space-y-2">
            {pending.map(item => {
              const choice = decisions[item.id]
              const photo = photoOf(item)
              return (
                <Card key={item.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-700">
                      {photo
                        ? <img src={photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                        : <span className="text-slate-300 dark:text-slate-600">{ic.glasses()}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                        {item.reference || item.barcode || '—'}
                      </p>
                      <p className="truncate text-xs text-slate-400">{item.barcode || '—'}</p>
                    </div>
                    <p className="ml-auto flex-shrink-0 text-sm font-bold tabular-nums text-slate-700 dark:text-slate-200">
                      {fmtFCFA(item.unit_price)}
                    </p>
                  </div>

                  <div className="flex flex-shrink-0 gap-2">
                    <button
                      onClick={() => decide(item.id, 'RETOUR_PRESENTOIR')}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
                        choice === 'RETOUR_PRESENTOIR'
                          ? 'bg-amber-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      {ic.undo('w-3.5 h-3.5')}
                      <span>Retour présentoir</span>
                    </button>
                    <button
                      onClick={() => decide(item.id, 'VENDUE')}
                      className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
                        choice === 'VENDUE'
                          ? 'bg-green-600 text-white'
                          : 'border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      {ic.cash('w-3.5 h-3.5')}
                      <span>Encaisser</span>
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {message && (
        <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 text-xs text-red-700 dark:text-red-400">
          {message}
        </div>
      )}

      <div className="flex justify-end">
        <Btn variant="primary" onClick={() => void settle()} disabled={!chosen || busy}>
          {ic.check('w-4 h-4')}
          {busy ? 'Validation…' : chosen ? `Valider (${chosen})` : 'Valider les décisions'}
        </Btn>
      </div>
    </div>
  )
}

// ── Écrans ─────────────────────────────────────────────────────────────────────
function ProformaCard({ proforma, onOpen }: { proforma: Proforma; onOpen: () => void }) {
  const items = proforma.items || []
  const destination = destinationLabel(proforma.destination)
  return (
    <button
      onClick={onOpen}
      style={{
        width: '100%',
        background: 'white',
        borderRadius: '12px',
        overflow: 'hidden',
        border: '2px solid ' + (isPending(proforma) ? '#FF6B6B' : '#4CAF50'),
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'all 0.3s',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      }}
      onMouseOver={(event) => {
        event.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)'
        event.currentTarget.style.transform = 'translateY(-4px)'
      }}
      onMouseOut={(event) => {
        event.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.05)'
        event.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <ShoppingBag size={14} color="#2563eb" />
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#1a3a3a' }}>
                {proforma.code || `Proforma ${proforma.id}`}
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: '#666' }}>
              {proforma.client_name || 'Client non renseigné'}
            </p>
          </div>
          <span style={{
            background: isPending(proforma) ? '#FFF3E0' : '#E8F5E9',
            color: isPending(proforma) ? '#E65100' : '#2E7D32',
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}>
            {isPending(proforma) ? 'En attente' : proforma.status || '—'}
          </span>
        </div>

        <div style={{ display: 'grid', gap: '6px', marginBottom: '10px', fontSize: '12px', color: '#666' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>Référence</span>
            <span style={{ fontWeight: 600, color: '#1a3a3a', textAlign: 'right' }}>{proforma.reference || proforma.code || `#${proforma.id}`}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>Vendeur</span>
            <span style={{ fontWeight: 600, color: '#1a3a3a', textAlign: 'right' }}>{proforma.vendor_name || '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
            <span>Destination</span>
            <span style={{ fontWeight: 600, color: '#1a3a3a', textAlign: 'right' }}>{destination}</span>
          </div>
        </div>

        <p style={{ margin: '0 0 10px 0', fontSize: '12px', color: '#666', lineHeight: 1.4 }}>
          {items.length} monture{items.length > 1 ? 's' : ''} · {fmtDate(proforma.created_at)}
        </p>

        <div style={{ borderTop: '1px solid #e0e0e0', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#666' }}>Montant</span>
          <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#2E7D32' }}>
            {fmtFCFA(proformaTotal(proforma))}
          </p>
        </div>
      </div>
    </button>
  )
}

const PROFORMA_COLUMNS: Column<Proforma>[] = [
  { key: 'code', label: 'Code', value: p => p.code || `#${p.id}` },
  { key: 'client', label: 'Client', value: p => p.client_name || '—' },
  { key: 'reference', label: 'Référence', value: p => p.reference || p.code || '' },
  { key: 'destination', label: 'Destination', value: p => destinationLabel(p.destination) },
  { key: 'amount', label: 'Montant', value: p => fmtFCFA(proformaTotal(p)), numeric: true },
  { key: 'status', label: 'Statut', value: p => isPending(p) ? 'En attente' : (p.status || '—') },
]

const GLASS_COLUMNS: Column<Glass>[] = [
  { key: 'ref', label: 'Référence', value: g => g.reference || g.barcode || '' },
  { key: 'brand', label: 'Marque', value: g => g.brand || '' },
  { key: 'barcode', label: 'Code-barres', value: g => g.barcode || '' },
  { key: 'location', label: 'Emplacement', value: g => g.location_code || '' },
  { key: 'price', label: 'Prix', value: g => fmtFCFA(g.price), numeric: true },
  { key: 'date', label: 'Date', value: g => fmtDate(g.sold_at || g.updated_at || g.created_at) },
]

function JourneeScreen({ data }: { data: CaisseData }) {
  const today = dayKey(new Date().toISOString())

  const soldToday = data.sold.filter(g => dayKey(g.sold_at || g.updated_at || g.created_at) === today)
  const encaisse = soldToday.reduce((sum, g) => sum + (Number(g.price) || 0), 0)
  const reserveValue = data.reserved.reduce((sum, g) => sum + (Number(g.price) || 0), 0)
  const enAttente = data.proformas.filter(isPending)
  const validees = data.proformas.filter(p => !isPending(p))
  const montantValide = validees.reduce((sum, p) => sum + proformaTotal(p), 0)

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Encaissé aujourd'hui" value={fmtFCFA(encaisse)} color="#16a34a" note={`${soldToday.length} monture${soldToday.length > 1 ? 's' : ''}`} />
        <StatTile label="En attente" value={fmt(enAttente.length)} color="#d97706" note="proformas" />
        <StatTile label="En réserve" value={fmt(data.reserved.length)} color="#9333ea" note={fmtFCFA(reserveValue)} />
        <StatTile label="Vendues au total" value={fmt(data.sold.length)} color="#2563eb" />
      </div>

      <div className="rounded-2xl border border-slate-100 bg-white p-4 space-y-4">
        <SectionTitle>Résumé des proformas validées</SectionTitle>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card>
            <p className="text-xs text-slate-400">Proformas validées</p>
            <p className="text-2xl font-black text-slate-900">{fmt(validees.length)}</p>
          </Card>
          <Card>
            <p className="text-xs text-slate-400">Montant traité</p>
            <p className="text-2xl font-black text-slate-900">{fmtFCFA(montantValide)}</p>
          </Card>
          <Card>
            <p className="text-xs text-slate-400">Montures en réserve</p>
            <p className="text-2xl font-black text-slate-900">{fmt(data.reserved.length)}</p>
          </Card>
        </div>
        <DataTable
          columns={PROFORMA_COLUMNS}
          rows={validees}
          filename={`caisse-proformas-${today}`}
          empty="Aucune proforma validée pour l'instant."
        />
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500">
        Chiffres du magasin — l'API n'attribue pas les ventes à un caissier.
      </p>

      <div>
        <SectionTitle>Ventes du jour</SectionTitle>
        <DataTable
          columns={GLASS_COLUMNS}
          rows={soldToday}
          filename={`caisse-journee-${today}`}
          empty="Aucune vente encaissée aujourd'hui."
        />
      </div>
    </div>
  )
}

// ── Coquille ───────────────────────────────────────────────────────────────────
function Sidebar({ current, onNavigate, dark, onToggleDark, user, counts }: {
  current: Screen; onNavigate: (s: Screen) => void
  dark: boolean; onToggleDark: () => void; user: any; counts: NavCounts
}) {
  const name = `${String(user?.first_name || '').trim()} ${String(user?.last_name || '').trim()}`.trim() || 'Caisse'
  const initial = (name[0] || 'C').toUpperCase()

  return (
    <aside className="hidden md:flex flex-col w-56 lg:w-60 bg-slate-900 dark:bg-slate-950 h-screen sticky top-0 flex-shrink-0">
      <div className="px-4 py-5 border-b border-slate-800 flex-shrink-0">
        <div className="flex flex-col items-center gap-2.5 text-center">
          {/* Fond blanc nécessaire : le JPEG n'a pas de transparence. */}
          <div className="w-full max-w-[180px] rounded-xl bg-white px-3 py-2">
            <img src={logoUrl} alt="La Lunetterie" className="w-full h-auto object-contain" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">Caisse</p>
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
            <span className="truncate font-medium">
              {item.label}
              {counts[item.id] !== undefined && <span className="tabular-nums"> ({counts[item.id]})</span>}
            </span>
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
            <p className="text-xs text-slate-500 truncate">{user?.station_name || 'Poste caisse'}</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

function MobileNav({ current, onNavigate, counts }: {
  current: Screen; onNavigate: (s: Screen) => void; counts: NavCounts
}) {
  return (
    <nav className="md:hidden fixed bottom-0 inset-x-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-700 z-40">
      <div className="flex">
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors ${
              current === item.id ? 'text-blue-600' : 'text-slate-400'
            }`}
          >
            {item.icon('w-5 h-5')}
            <span className="text-[9px] font-semibold leading-none">
              {item.short}
              {counts[item.id] !== undefined && <span className="tabular-nums"> ({counts[item.id]})</span>}
            </span>
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
        {ic.refresh()}
      </button>
      <button
        onClick={onToggleDark}
        className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0"
        aria-label="Changer de thème"
      >
        {dark ? ic.sun() : ic.moon()}
      </button>
    </header>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
function CaissePage() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [dark, setDark] = useState(false)
  const [screen, setScreen] = useState<Screen>('attente')
  const [openId, setOpenId] = useState<number | null>(null)
  const [toast, setToast] = useState('')

  // Jeton de rôle CAISSIER, et passage par /magasin.html qui pose `poste`. Sans le
  // second, on y renvoie plutôt que d'ouvrir la caisse en tapant l'URL.
  useEffect(() => {
    if (!getToken()) {
      window.location.replace('/magasin.html')
      return
    }
    if (window.localStorage.getItem('poste') !== 'caisse') {
      window.location.replace('/magasin.html')
      return
    }

    void (async () => {
      try {
        const payload = await apiFetch('/auth/me')
        const me = payload?.data?.user
        if (!me) throw new Error('session invalide')
        // Le rôle est relu auprès du serveur, jamais cru sur parole depuis localStorage.
        if (getRoleName(me) !== 'CAISSIER') {
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
  const { data, loading, error, reload } = useCaisseData()

  // Le toast s'efface seul : le caissier a les mains sur la douchette, pas sur la souris.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 6000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const enAttente = useMemo(() => data.proformas.filter(isPending), [data.proformas])
  const reglees = useMemo(() => data.proformas.filter(p => !isPending(p)), [data.proformas])
  const laboValidées = useMemo(() => reglees.filter(p => String(p.destination || '').toLowerCase() === 'labo'), [reglees])
  const reserveValidées = useMemo(() => reglees.filter(p => String(p.destination || '').toLowerCase() === 'reserve'), [reglees])
  const open = openId ? data.proformas.find(p => p.id === openId) || null : null
  const totalEncaisse = useMemo(() => data.sold.reduce((sum, glass) => sum + (Number(glass.price) || 0), 0), [data.sold])
  const totalReserve = useMemo(() => data.reserved.reduce((sum, glass) => sum + (Number(glass.price) || 0), 0), [data.reserved])
  const totalTraitees = reglees.length
  const montantLabo = useMemo(() => laboValidées.reduce((sum, p) => sum + proformaTotal(p), 0), [laboValidées])
  const montantReserve = useMemo(() => reserveValidées.reduce((sum, p) => sum + proformaTotal(p), 0), [reserveValidées])

  // Les mêmes nombres alimentent la navigation et les onglets : un écart entre les deux
  // se lirait comme deux files différentes.
  const navCounts: NavCounts = {
    attente: enAttente.length,
    reglees: laboValidées.length,
    reserve: reserveValidées.length,
  }

  function navigate(next: Screen) {
    setOpenId(null)
    setScreen(next)
  }

  if (!ready) return null

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
        <Sidebar
          current={screen}
          onNavigate={navigate}
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          user={user}
          counts={navCounts}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar
            current={screen}
            override={open ? (open.code || `Proforma ${open.id}`) : null}
            dark={dark}
            onToggleDark={() => setDark(d => !d)}
            onReload={() => void reload()}
            loading={loading}
          />

          <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 overflow-auto" style={{ background: 'linear-gradient(135deg, #f5f7fa 0%, #f0f3f7 100%)' }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ fontSize: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '48px', height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #2563eb 0%, #38bdf8 100%)', color: 'white' }}>
                      <Store size={24} />
                    </div>
                    <div>
                      <h1 style={{ fontSize: '28px', fontWeight: 600, margin: '0 0 4px 0', color: '#1a3a3a' }}>Caisse Lunetterie</h1>
                      <p style={{ fontSize: '14px', color: '#666', margin: 0 }}>Décisions de caisse et suivi du jour</p>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(140px, 1fr))', gap: '1rem' }}>
                    <div style={{ background: 'white', padding: '1rem', borderRadius: '12px', border: '1px solid #e0e0e0', boxShadow: '0 8px 20px rgba(0,0,0,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <CircleDollarSign size={16} color="#2E7D32" />
                        <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>Encaissé</p>
                      </div>
                      <p style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#2E7D32' }}>{fmtFCFA(totalEncaisse)}</p>
                    </div>
                    <div style={{ background: 'white', padding: '1rem', borderRadius: '12px', border: '1px solid #e0e0e0', boxShadow: '0 8px 20px rgba(0,0,0,0.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <Boxes size={16} color="#9C27B0" />
                        <p style={{ margin: 0, fontSize: '12px', color: '#666', fontWeight: 600 }}>Réserve</p>
                      </div>
                      <p style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#9C27B0' }}>{fmtFCFA(totalReserve)}</p>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e0e0e0', paddingBottom: '0', overflowX: 'auto', flexWrap: 'wrap' }}>
                  {[
                    { id: 'attente' as Screen, label: `À traiter (${navCounts.attente})`, icon: <BadgeCheck size={16} />, color: screen === 'attente' ? '#FF6B6B' : 'transparent', text: screen === 'attente' ? 'white' : '#666' },
                    { id: 'reglees' as Screen, label: `Labo payé (${navCounts.reglees})`, icon: <CreditCard size={16} />, color: screen === 'reglees' ? '#4CAF50' : 'transparent', text: screen === 'reglees' ? 'white' : '#666' },
                    { id: 'reserve' as Screen, label: `Réserve (${navCounts.reserve})`, icon: <PackageCheck size={16} />, color: screen === 'reserve' ? '#9C27B0' : 'transparent', text: screen === 'reserve' ? 'white' : '#666' },
                    { id: 'journee' as Screen, label: 'Inventaire', icon: <CalendarDays size={16} />, color: screen === 'journee' ? '#2196F3' : 'transparent', text: screen === 'journee' ? 'white' : '#666' },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => navigate(tab.id)}
                      style={{
                        padding: '12px 20px',
                        background: tab.color,
                        color: tab.text,
                        border: 'none',
                        borderRadius: '8px 8px 0 0',
                        cursor: 'pointer',
                        fontSize: '14px',
                        fontWeight: screen === tab.id ? 600 : 500,
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-400">
                  {error}
                </div>
              )}

              {open ? (
                <ProformaDetail
                  proforma={open}
                  stationId={stationId}
                  onBack={() => setOpenId(null)}
                  onSettled={message => {
                    setOpenId(null)
                    setToast(message)
                    void reload()
                  }}
                />
              ) : (
                <>
                  {screen === 'attente' && (
                    <div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '1.5rem' }}>
                        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '2px solid #FF6B6B' }}>
                          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>📥 Reçues</p>
                          <p style={{ margin: 0, fontSize: '28px', fontWeight: 600, color: '#FF6B6B' }}>{data.proformas.length}</p>
                        </div>
                        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '2px solid #4CAF50' }}>
                          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>✓ Traitées</p>
                          <p style={{ margin: 0, fontSize: '28px', fontWeight: 600, color: '#4CAF50' }}>{totalTraitees}</p>
                        </div>
                        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '2px solid #FF9800' }}>
                          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>⏳ En attente</p>
                          <p style={{ margin: 0, fontSize: '28px', fontWeight: 600, color: '#FF9800' }}>{enAttente.length}</p>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                        {enAttente.length === 0 ? (
                          <div style={{ gridColumn: '1 / -1' }}><EmptyState>Aucune proforma en attente. La caisse est à jour.</EmptyState></div>
                        ) : (
                          enAttente.map(proforma => (
                            <ProformaCard key={proforma.id} proforma={proforma} onOpen={() => setOpenId(proforma.id)} />
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {screen === 'reglees' && (
                    <div className="space-y-4">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '2px solid #4CAF50' }}>
                          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>💳 Montant encaissé</p>
                          <p style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#4CAF50' }}>{fmtFCFA(montantLabo)}</p>
                        </div>
                        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '2px solid #2196F3' }}>
                          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>🧾 Proformas labo</p>
                          <p style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#2196F3' }}>{laboValidées.length}</p>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                        {laboValidées.length === 0 ? (
                          <div style={{ gridColumn: '1 / -1' }}><EmptyState>Aucune proforma validée au labo pour l'instant.</EmptyState></div>
                        ) : (
                          laboValidées.map(proforma => (
                            <ProformaCard key={proforma.id} proforma={proforma} onOpen={() => setOpenId(proforma.id)} />
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {screen === 'reserve' && (
                    <div className="space-y-4">
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '2px solid #9C27B0' }}>
                          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>📦 Montant réserve</p>
                          <p style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#9C27B0' }}>{fmtFCFA(montantReserve)}</p>
                        </div>
                        <div style={{ background: 'white', padding: '1.25rem', borderRadius: '12px', border: '2px solid #9333ea' }}>
                          <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#666', fontWeight: 600 }}>🧿 Proformas réserve</p>
                          <p style={{ margin: 0, fontSize: '24px', fontWeight: 600, color: '#9333ea' }}>{reserveValidées.length}</p>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                        {reserveValidées.length === 0 ? (
                          <div style={{ gridColumn: '1 / -1' }}><EmptyState>Aucune proforma validée en réserve.</EmptyState></div>
                        ) : (
                          reserveValidées.map(proforma => (
                            <ProformaCard key={proforma.id} proforma={proforma} onOpen={() => setOpenId(proforma.id)} />
                          ))
                        )}
                      </div>
                      <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0', overflow: 'hidden' }}>
                        <div style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600, color: '#1a3a3a' }}>📦 Montures en réserve</h3>
                          <span style={{ fontSize: '13px', color: '#666' }}>{data.reserved.length} monture{data.reserved.length > 1 ? 's' : ''}</span>
                        </div>
                        <div style={{ padding: '1rem' }}>
                          <DataTable
                            columns={GLASS_COLUMNS}
                            rows={data.reserved}
                            filename={`caisse-reserve-${dayKey(new Date().toISOString())}`}
                            empty="Aucune monture en réserve."
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {screen === 'journee' && <JourneeScreen data={data} />}
                </>
              )}
            </div>
          </main>
        </div>

        {/* Remonté au-dessus de la barre mobile, qui le masquerait sinon sur téléphone. */}
        {toast && (
          <div className="fixed bottom-20 md:bottom-5 left-1/2 z-50 flex max-w-[92vw] -translate-x-1/2 items-center gap-2 rounded-xl bg-[#16a34a] px-4 py-3 text-sm font-semibold text-white shadow-lg">
            {ic.checkCircle('w-5 h-5')}
            <span className="truncate">{toast}</span>
          </div>
        )}

        <MobileNav current={screen} onNavigate={navigate} counts={navCounts} />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CaissePage />
  </React.StrictMode>,
)
