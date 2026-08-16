import React, { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import logoUrl from '../logo.jpeg'

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'

// ── Session ────────────────────────────────────────────────────────────────────
function getToken() {
  return window.localStorage.getItem('token') || ''
}

function logoutToLogin() {
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('user')
  window.localStorage.removeItem('poste')
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
  const raw = user?.role_name ?? user?.role ?? user?.roleName
  if (raw) {
    const name = String(raw).trim().toUpperCase().replace(/\s+/g, '_')
    return ROLE_ALIASES[name] || name
  }
  const id = Number(user?.role_id ?? user?.roleId)
  const byId = ROLE_ID_TO_NAME[id]
  return byId ? (ROLE_ALIASES[byId] || byId) : null
}

/** Rôle SAV posé en base par la migration 028_sav (id 10). SUPER_ADMIN reste accepté
 *  pour que la direction puisse consulter l'écran, même précaution que les autres
 *  postes sensibles. */
const ALLOWED_ROLES = ['SAV', 'SUPER_ADMIN']

// ── Format ─────────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return Number(n || 0).toLocaleString('fr-FR')
}

function fmtDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('fr-FR')
}

/** Le serveur horodate l'appel en ISO : affiché tel quel, ça donnerait
 *  « 2026-08-09T14:30:00Z » sur la fiche. */
function fmtDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}

function dayKey(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'
}

function daysBetween(from?: string | null, to?: string | null) {
  if (!from || !to) return null
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.floor((b - a) / 86_400_000)
}

// ── Données ────────────────────────────────────────────────────────────────────
type ClientType = 'ancien' | 'proformat'
type LabStatus = 'en stock' | 'prêt' | 'enlevée' | ''

interface Client {
  id: number
  name: string
  type: ClientType
  phone: string
  purchaseDate?: string
  status?: string
  labStatus?: LabStatus
  retrievedDate?: string | null
  called?: boolean
  calledDate?: string | null
  noAnswer?: boolean
  observations?: string
  message?: string
  relanceDate?: string | null
  paymentDate?: string | null
}

// ── API ───────────────────────────────────────────────────────────────────────

/** Toute réponse 401/403 signifie que le jeton ne vaut plus rien : on ne laisse pas
 *  l'écran afficher un fichier client vide en donnant l'illusion qu'il n'y a personne
 *  à rappeler. */
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
  if (!response.ok) {
    throw new Error(payload?.error || payload?.message || `Erreur ${response.status}`)
  }
  return payload
}

interface ApiProformaItem { barcode?: string; reference?: string }

interface ApiProforma {
  id: number
  client_name?: string
  client_phone?: string
  status?: string
  created_at?: string
  settled_at?: string | null
  items?: ApiProformaItem[]
}

interface ApiGlass { barcode: string; reference?: string; status?: string; sold_at?: string; updated_at?: string }

interface ApiFollowup {
  proforma_id: number
  called?: boolean
  called_at?: string | null
  no_answer?: boolean
  relance_at?: string | null
  observations?: string | null
  message?: string | null
}

/** Le client du SAV n'est pas une table : c'est une proforma vue sous l'angle du suivi.
 *  Le nom, le téléphone et le paiement viennent de proformas ; l'état de la monture des
 *  statuts de glasses ; les appels et observations de sav_followups. Les recouper ici
 *  évite de dupliquer un fichier client qui divergerait du reste de l'application. */
function buildClients(
  proformas: ApiProforma[],
  pretes: ApiGlass[],
  vendues: ApiGlass[],
  followups: ApiFollowup[],
): Client[] {
  const suiviParProforma = new Map<number, ApiFollowup>()
  for (const followup of followups) suiviParProforma.set(Number(followup.proforma_id), followup)

  const codesPretes = new Set(pretes.map(g => String(g.barcode || '').toUpperCase()))
  const venduesParCode = new Map<string, ApiGlass>()
  for (const glass of vendues) venduesParCode.set(String(glass.barcode || '').toUpperCase(), glass)

  return proformas.map(proforma => {
    const codes = (proforma.items || [])
      .map(item => String(item.barcode || item.reference || '').toUpperCase())
      .filter(Boolean)

    const aUnePrete = codes.some(code => codesPretes.has(code))
    const venduesDeLaFiche = codes.map(code => venduesParCode.get(code)).filter(Boolean) as ApiGlass[]

    let labStatus: LabStatus = ''
    if (aUnePrete) labStatus = 'prêt'
    else if (venduesDeLaFiche.length > 0) labStatus = 'enlevée'
    else if (codes.length > 0) labStatus = 'en stock'

    // La plus récente des remises : la fiche parle d'un client, pas d'une monture.
    const retrievedDate = venduesDeLaFiche
      .map(glass => glass.sold_at || glass.updated_at || '')
      .filter(Boolean)
      .sort()
      .pop() || null

    const status = String(proforma.status || '').toUpperCase()
    const suivi = suiviParProforma.get(Number(proforma.id))

    return {
      id: Number(proforma.id),
      name: proforma.client_name || 'Client sans nom',
      // Une proforma encore en attente est une relance à faire ; une fois réglée ou
      // annulée, le client rejoint le fichier des anciens.
      type: status === 'EN_ATTENTE' ? 'proformat' : 'ancien',
      phone: proforma.client_phone || '',
      purchaseDate: proforma.created_at,
      status: status === 'REGLEE' ? 'payé' : status === 'ANNULEE' ? 'annulé' : 'en attente',
      labStatus,
      retrievedDate,
      called: Boolean(suivi?.called),
      calledDate: suivi?.called_at || null,
      noAnswer: Boolean(suivi?.no_answer),
      observations: suivi?.observations || '',
      message: suivi?.message || '',
      relanceDate: suivi?.relance_at || null,
      paymentDate: proforma.settled_at || null,
    }
  })
}

async function loadClients(): Promise<{ clients: Client[]; error: string }> {
  // allSettled : une liste indisponible ne doit pas vider les trois autres. Le poste
  // doit rester utilisable même si un seul endpoint tombe.
  const results = await Promise.allSettled([
    apiFetch('/inventory/proformas'),
    apiFetch('/inventory/glasses?status=PRETE_A_LIVRER'),
    apiFetch('/inventory/glasses?status=VENDUE'),
    apiFetch('/inventory/sav/followups'),
  ])
  const [proformasR, pretesR, venduesR, followupsR] = results

  const listees: ApiProforma[] = proformasR.status === 'fulfilled'
    ? (proformasR.value?.data?.proformas || [])
    : []

  // /inventory/proformas ne renvoie pas les lignes : sans ce second tour, aucune fiche
  // ne sait quelles montures elle porte, donc où elles en sont au laboratoire.
  const details = await Promise.allSettled(
    listees.map(proforma => apiFetch(`/inventory/proformas/${proforma.id}`)),
  )
  const proformas = listees.map((proforma, index) => {
    const detail = details[index]
    const complete = detail.status === 'fulfilled' ? detail.value?.data?.proforma : null
    return complete ? { ...proforma, ...complete } : proforma
  })

  const glasses = (r: PromiseSettledResult<any>): ApiGlass[] =>
    r.status === 'fulfilled' ? (r.value?.data?.glasses || []) : []
  const followups: ApiFollowup[] = followupsR.status === 'fulfilled'
    ? (followupsR.value?.data?.followups || [])
    : []

  const failed = results.filter(r => r.status === 'rejected').length
  const error = failed === results.length
    ? "Aucune donnée n'a pu être chargée."
    : failed > 0
      ? `${failed} liste${failed > 1 ? 's' : ''} indisponible${failed > 1 ? 's' : ''}.`
      : ''

  return {
    clients: buildClients(proformas, glasses(pretesR), glasses(venduesR), followups),
    error,
  }
}

/** Enregistre le suivi d'une fiche. Les champs absents ne sont pas touchés côté serveur. */
function saveFollowup(proformaId: number, body: Record<string, unknown>) {
  return apiFetch(`/inventory/sav/followups/${proformaId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

// ── Icônes ─────────────────────────────────────────────────────────────────────
const s = { fill: 'none' as const, stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

const ic = {
  users: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>,
  doc: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h8M8 17h5" /></svg>,
  flask: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M9 3h6M10 3v6.5L4.6 18a2 2 0 0 0 1.7 3h11.4a2 2 0 0 0 1.7-3L14 9.5V3" /><path d="M7.5 15h9" /></svg>,
  bag: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M6 2l-2 5v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7l-2-5z" /><path d="M4 7h16M16 11a4 4 0 0 1-8 0" /></svg>,
  chart: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></svg>,
  calendar: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>,
  phone: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" /></svg>,
  check: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M20 6L9 17l-5-5" /></svg>,
  checkCircle: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M8 12.4l2.5 2.5L16 9" /></svg>,
  muted: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M2 2l20 20" /><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-4.3-3.8" /><path d="M9.1 4.5A2 2 0 0 0 7.1 3h-3a2 2 0 0 0-2 2.2c.2 1.7.6 3.3 1.2 4.8" /></svg>,
  search: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  chevLeft: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>,
  chevRight: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M9 18l6-6-6-6" /></svg>,
  sun: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>,
  moon: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
  x: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s} strokeWidth={2}><path d="M18 6L6 18M6 6l12 12" /></svg>,
  signOut: (c = 'w-4 h-4') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>,
  alert: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>,
  clock: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 1.9" /></svg>,
  target: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /></svg>,
  info: (c = 'w-5 h-5') => <svg className={c} viewBox="0 0 24 24" {...s}><circle cx="12" cy="12" r="9" /><path d="M12 11.5v4.5M12 8h.01" /></svg>,
}

type Screen = 'clients' | 'proformas' | 'labo' | 'retraits' | 'suivi' | 'calendrier'

const NAV: { id: Screen; label: string; short: string; icon: (c?: string) => React.ReactElement }[] = [
  { id: 'clients', label: 'Anciens clients', short: 'Clients', icon: ic.users },
  { id: 'proformas', label: 'Proformas à relancer', short: 'Proformas', icon: ic.doc },
  { id: 'labo', label: 'Prêtes au labo', short: 'Labo', icon: ic.flask },
  { id: 'retraits', label: 'Récupérées', short: 'Retraits', icon: ic.bag },
  { id: 'suivi', label: 'KPI', short: 'KPI', icon: ic.chart },
  { id: 'calendrier', label: 'Calendrier', short: 'Agenda', icon: ic.calendar },
]

// ── Briques d'interface ────────────────────────────────────────────────────────
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 p-4 ${className}`}>
      {children}
    </div>
  )
}

function StatTile({ label, value, color, note, icon }: {
  label: string; value: React.ReactNode; color: string; note?: string
  icon: (c?: string) => React.ReactElement
}) {
  return (
    <Card>
      {/* Pastille au fond de la couleur à 9 % : la charte ne met jamais de bordure
          colorée épaisse, c'est l'aplat discret qui porte l'identité. */}
      <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${color}18`, color }}>
        {icon('w-5 h-5')}
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
      <span className="text-slate-300 dark:text-slate-600">{ic.users('w-8 h-8')}</span>
      <p className="text-sm text-slate-400 dark:text-slate-500">{children}</p>
    </div>
  )
}

const INPUT = 'w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:border-slate-300 dark:focus:border-slate-600'

function Pill({ children, tone }: { children: React.ReactNode; tone: 'slate' | 'amber' | 'green' | 'cyan' }) {
  const styles = {
    slate: 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400',
    cyan: 'bg-cyan-50 text-cyan-700 dark:bg-cyan-900/20 dark:text-cyan-400',
  }[tone]
  return <span className={`flex-shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${styles}`}>{children}</span>
}

/** Initiales plutôt qu'une photo : la maquette pointait vers Unsplash, qui ne répondra
 *  pas dans une boutique hors ligne et n'a rien à faire dans un fichier client. */
function Avatar({ name, color }: { name: string; color: string }) {
  return (
    <div
      className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-black flex-shrink-0"
      style={{ backgroundColor: `${color}18`, color }}
    >
      {initials(name)}
    </div>
  )
}

function statusTone(status?: string): 'slate' | 'amber' | 'green' {
  const value = String(status || '').toLowerCase()
  if (value === 'payé') return 'green'
  if (value === 'relancé' || value === 'en attente') return 'amber'
  return 'slate'
}

// ── Fiche client ───────────────────────────────────────────────────────────────
function ClientCard({ client, color, onToggleCalled, onToggleNoAnswer, onObservations, onMessage, onRetrieved }: {
  client: Client
  color: string
  onToggleCalled: () => void
  onToggleNoAnswer: () => void
  onObservations: (value: string) => void
  onMessage?: (value: string) => void
  onRetrieved?: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <Card className="space-y-3">
      <div className="flex items-start gap-3">
        <Avatar name={client.name} color={color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{client.name}</p>
            {client.status && <Pill tone={statusTone(client.status)}>{client.status}</Pill>}
          </div>
          <p className="truncate text-xs text-slate-400">
            {client.phone} · achat {fmtDate(client.purchaseDate)}
          </p>
          {client.called && client.calledDate && (
            <p className="mt-0.5 text-[11px] text-green-700 dark:text-green-400">Appelé le {fmtDateTime(client.calledDate)}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {/* tel: ouvre le combiné du téléphone — c'est un poste tenu au portable. */}
        <a
          href={`tel:${client.phone.replace(/\s/g, '')}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
        >
          {ic.phone('w-3.5 h-3.5')}
          <span>Appeler</span>
        </a>

        <button
          onClick={onToggleCalled}
          className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
            client.called
              ? 'bg-green-600 text-white'
              : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
          }`}
        >
          {ic.check('w-3.5 h-3.5')}
          <span>{client.called ? 'Appelé' : 'Marquer appelé'}</span>
        </button>

        {client.type === 'proformat' && (
          <button
            onClick={onToggleNoAnswer}
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all active:scale-95 ${
              client.noAnswer
                ? 'bg-amber-600 text-white'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
            }`}
          >
            {ic.muted('w-3.5 h-3.5')}
            <span>Sans réponse</span>
          </button>
        )}

        {onRetrieved && client.labStatus !== 'enlevée' && (
          <button
            onClick={onRetrieved}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-all hover:bg-blue-700 active:scale-95"
          >
            {ic.bag('w-3.5 h-3.5')}
            <span>Marquer récupérée</span>
          </button>
        )}

        <button
          onClick={() => setOpen(v => !v)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-400 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
        >
          {open ? 'Masquer' : 'Observations'}
        </button>
      </div>

      {client.type === 'proformat' && client.noAnswer && onMessage && (
        <textarea
          value={client.message || ''}
          onChange={e => onMessage(e.target.value)}
          rows={2}
          placeholder="Message à laisser…"
          className={`${INPUT} resize-none`}
        />
      )}

      {open && (
        <textarea
          value={client.observations || ''}
          onChange={e => onObservations(e.target.value)}
          rows={3}
          placeholder="Ce qui s'est dit au téléphone, ce qu'il faut retenir…"
          className={`${INPUT} resize-none`}
        />
      )}
    </Card>
  )
}

// ── Calendrier ─────────────────────────────────────────────────────────────────
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function CalendrierScreen({ clients }: { clients: Client[] }) {
  const [month, setMonth] = useState(() => new Date())
  const [selected, setSelected] = useState<string | null>(null)

  // Une relance par jour, indexée : le calendrier n'a qu'à lire.
  const byDay = useMemo(() => {
    const map = new Map<string, Client[]>()
    for (const client of clients) {
      const key = dayKey(client.relanceDate || client.calledDate || null)
      if (!key) continue
      map.set(key, [...(map.get(key) || []), client])
    }
    return map
  }, [clients])

  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  // getDay() rend 0 pour dimanche ; la semaine française commence le lundi.
  const firstDay = (new Date(year, monthIndex, 1).getDay() + 6) % 7

  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  const todayKey = dayKey(new Date().toISOString())
  const selectedClients = selected ? byDay.get(selected) || [] : []

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}
            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Mois précédent"
          >
            {ic.chevLeft()}
          </button>
          <p className="text-sm font-bold text-slate-900 dark:text-white">{MONTHS[monthIndex]} {year}</p>
          <button
            onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}
            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            aria-label="Mois suivant"
          >
            {ic.chevRight()}
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1">
          {DAYS.map(day => (
            <div key={day} className="pb-1 text-center text-[11px] font-semibold text-slate-400">{day}</div>
          ))}
          {cells.map((day, index) => {
            if (day === null) return <div key={`vide-${index}`} />
            const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const count = (byDay.get(key) || []).length
            const isToday = key === todayKey
            return (
              <button
                key={key}
                onClick={() => setSelected(selected === key ? null : key)}
                className={`aspect-square rounded-xl text-sm tabular-nums transition-all ${
                  selected === key
                    ? 'bg-blue-600 text-white'
                    : isToday
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                <span className="block leading-none pt-2">{day}</span>
                {/* Une pastille, pas un chiffre : c'est la présence d'un appel qui compte
                    à l'échelle du mois, le détail est sous le calendrier. */}
                {count > 0 && (
                  <span className={`mx-auto mt-1 block h-1.5 w-1.5 rounded-full ${selected === key ? 'bg-white' : 'bg-[#d97706]'}`} />
                )}
              </button>
            )
          })}
        </div>
      </Card>

      {selected && (
        <div>
          <SectionTitle>{fmtDate(selected)}</SectionTitle>
          {selectedClients.length === 0 ? (
            <EmptyState>Aucune relance ce jour-là.</EmptyState>
          ) : (
            <div className="space-y-2">
              {selectedClients.map(client => (
                <Card key={client.id} className="flex items-center gap-3">
                  <Avatar name={client.name} color="#d97706" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{client.name}</p>
                    <p className="truncate text-xs text-slate-400">{client.phone}</p>
                  </div>
                  {client.status && <Pill tone={statusTone(client.status)}>{client.status}</Pill>}
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Suivi (KPI) ─────────────────────────────────────────────────────────────────
const GAUGE_R = 66
const GAUGE_C = 2 * Math.PI * GAUGE_R
/** 2 px de fond entre la part et la piste, comme les anneaux du poste Vendeuse : c'est
 *  le vide qui sépare, pas un contour. */
const GAUGE_GAP = 2

/** Jauge de conversion, même géométrie que le `Donut` de vendeuse.tsx : départ à midi,
 *  bouts francs (un `strokeLinecap` rond déborderait de 10 px sur un trait de 20 et
 *  gonflerait les petits pourcentages), piste `slate-100/700` qui suit le thème.
 *
 *  Le chiffre du centre reste en encre neutre : un vert de 26 px sur fond blanc se lit
 *  mal, l'identité de la part est portée par la légende à côté. */
function Gauge({ percent, caption }: { percent: number; caption: string }) {
  const value = Math.max(0, Math.min(100, percent))
  const drawn = Math.max((value / 100) * GAUGE_C - GAUGE_GAP, 0)

  return (
    <svg
      viewBox="0 0 168 168"
      className="w-40 h-40 flex-shrink-0"
      role="img"
      aria-label={`${caption} : ${value} %`}
    >
      <circle cx="84" cy="84" r={GAUGE_R} fill="none" strokeWidth={20} className="stroke-slate-100 dark:stroke-slate-700" />
      {drawn > 0 && (
        <circle
          cx="84"
          cy="84"
          r={GAUGE_R}
          fill="none"
          strokeWidth={20}
          strokeDasharray={`${drawn} ${GAUGE_C}`}
          transform="rotate(-90 84 84)"
          className="stroke-[#16a34a] transition-all duration-700"
        />
      )}
      <text x="84" y="82" textAnchor="middle" className="fill-slate-900 dark:fill-white text-[26px] font-black tabular-nums">
        {value} %
      </text>
      <text x="84" y="100" textAnchor="middle" className="fill-slate-400 text-[11px]">{caption}</text>
    </svg>
  )
}

/** Titre de carte : l'icône en couleur d'accent, sans pastille. La pastille `w-10` de la
 *  charte appartient au chiffre clé ; la reprendre ici mettrait deux aplats de couleur
 *  dans la même carte. */
function CardTitle({ icon, color, children }: {
  icon: (c?: string) => React.ReactElement; color: string; children: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="flex-shrink-0" style={{ color }}>{icon('w-4 h-4')}</span>
      <h2 className="text-sm font-bold text-slate-900 dark:text-white">{children}</h2>
    </div>
  )
}

type Tone = 'good' | 'warn' | 'bad' | 'idle'

const TONES: Record<Tone, { color: string; icon: (c?: string) => React.ReactElement }> = {
  good: { color: '#16a34a', icon: ic.checkCircle },
  warn: { color: '#d97706', icon: ic.alert },
  bad: { color: '#dc2626', icon: ic.alert },
  idle: { color: '#94a3b8', icon: ic.info },
}

/** L'analyse porte une icône **et** une phrase : la couleur seule ne dit rien à qui ne
 *  la distingue pas, et ce poste se consulte au téléphone, souvent en plein soleil.
 *  Remplace les émojis ✅/⚠️/❌, qui rendaient différemment d'un appareil à l'autre. */
function Insight({ tone, title, children }: { tone: Tone; title: string; children: React.ReactNode }) {
  const { color, icon } = TONES[tone]
  return (
    <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-900/40">
      <span className="mt-0.5 flex-shrink-0" style={{ color }}>{icon('w-5 h-5')}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</p>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{children}</p>
      </div>
    </div>
  )
}

/** Trois parts d'un même dénominateur, en longueurs : l'œil compare des barres, pas des
 *  fractions écrites. Les classes sont écrites en toutes lettres — le scanner de
 *  Tailwind v4 lit le source, une classe assemblée à l'exécution ne serait pas générée —
 *  et portent leur variante sombre quand le 600 ne tient pas 3:1 sur `slate-800`. */
function Meter({ label, value, total, bar }: {
  label: string; value: number; total: number; bar: string
}) {
  const percent = total === 0 ? 0 : Math.round((value / total) * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-slate-700 dark:text-slate-200">{label}</span>
        <span className="flex-shrink-0 text-sm font-bold tabular-nums text-slate-900 dark:text-white">
          {fmt(value)}
          <span className="font-medium text-slate-400"> / {fmt(total)}</span>
          <span className="ml-2 inline-block w-9 text-right text-xs font-medium text-slate-400">{percent} %</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
        <div className={`h-full rounded-full transition-all duration-700 ${bar}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

/** Étendue des délais observés, avec la moyenne posée dessus. Trois chiffres côte à côte
 *  ne disent pas si la moyenne penche vers le bas ou vers le haut de la fourchette —
 *  c'est pourtant ça qui indique si un client typique paie vite ou traîne. */
function RangeStrip({ min, mean, max }: { min: number; mean: number; max: number }) {
  const span = max - min
  const at = span <= 0 ? 50 : ((mean - min) / span) * 100

  return (
    <div className="mt-4" role="img" aria-label={`Délais de ${fmt(min)} à ${fmt(max)} jours, moyenne ${fmt(mean)} jours`}>
      <div className="relative h-2 rounded-full bg-slate-100 dark:bg-slate-700">
        <span
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#2563eb] dark:bg-[#3b82f6]"
          style={{ left: `${at}%` }}
        />
      </div>
      {/* Seules les bornes sont écrites. Une mention « moyenne » centrée en dur
          mentirait dès que le repère penche d'un côté ; sa valeur est déjà dans la
          tuile au-dessus, ici c'est sa position qui informe. */}
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-slate-400">
        <span>{fmt(min)} j</span>
        <span>{fmt(max)} j</span>
      </div>
    </div>
  )
}

/** Mêmes seuils que l'analyse de timing : ce qui est dit en toutes lettres sous le
 *  graphique doit se retrouver dans la couleur des fiches, sinon les deux se contredisent. */
function delaiColor(days: number | null) {
  if (days === null) return '#94a3b8'
  if (days <= 7) return '#16a34a'
  if (days <= 14) return '#d97706'
  return '#dc2626'
}

function SuiviScreen({ clients }: { clients: Client[] }) {
  const totalProformats = clients.filter(c => c.type === 'proformat')
  const relances = clients.filter(c => c.type === 'proformat' && c.relanceDate)
  const payees = relances.filter(c => c.paymentDate)

  const delais = payees
    .map(c => daysBetween(c.relanceDate, c.paymentDate))
    .filter((n): n is number => n !== null)

  const moyenne = delais.length ? Math.round(delais.reduce((a, b) => a + b, 0) / delais.length) : 0
  const minDelai = delais.length ? Math.min(...delais) : 0
  const maxDelai = delais.length ? Math.max(...delais) : 0
  const conversion = relances.length ? Math.round((payees.length / relances.length) * 100) : 0
  const appeles = relances.filter(c => c.called).length
  const sansReponse = relances.filter(c => c.noAnswer).length

  const aRelancer = relances.length - appeles

  // Le cas « aucune relance » se teste sur le nombre de relances, pas sur un taux à 0 :
  // zéro paiement sur trente relances donnait « Commencez les relances ! » alors que
  // c'est exactement le contraire qu'il fallait lire.
  const conversionInsight: { tone: Tone; text: string } = relances.length === 0
    ? { tone: 'idle', text: "Aucune relance lancée : le taux se calculera dès la première." }
    : conversion >= 70
      ? { tone: 'good', text: 'Excellent taux : les relances aboutissent, gardez ce rythme.' }
      : conversion >= 50
        ? { tone: 'warn', text: "Bon taux, avec de la marge — reprenez plus tôt les fiches restées sans réponse." }
        : { tone: 'bad', text: "Taux faible : intensifiez les relances et variez l'heure des appels." }

  const timingInsight: { tone: Tone; text: string } = delais.length === 0
    ? { tone: 'idle', text: "Aucun paiement après relance : pas encore de délai à mesurer." }
    : moyenne <= 7
      ? { tone: 'good', text: 'Les clients décident vite. Le rythme de relance actuel fonctionne.' }
      : moyenne <= 14
        ? { tone: 'warn', text: 'Délai normal. Une relance à J+3 puis J+7 accélère la décision.' }
        : { tone: 'bad', text: "Délai long : les clients hésitent. Proposez un paiement échelonné ou un essai." }

  const appelInsight: { tone: Tone; text: string } = relances.length === 0
    ? { tone: 'idle', text: 'Aucune fiche en attente de relance.' }
    : aRelancer === 0
      ? { tone: 'good', text: 'Toutes les fiches en attente ont été appelées.' }
      : { tone: 'warn', text: `${fmt(aRelancer)} fiche${aRelancer > 1 ? 's' : ''} reste${aRelancer > 1 ? 'nt' : ''} à appeler.` }

  // Les plus récents d'abord : un journal de relances se lit par le haut.
  const payeesRecentes = [...payees].sort((a, b) =>
    String(b.paymentDate || '').localeCompare(String(a.paymentDate || '')),
  )

  return (
    <div className="space-y-4">
      {/* L'entonnoir dans l'ordre où il se parcourt : le fichier, ce qu'on a relancé, ce
          qui a payé, et le taux qui en sort.

          Bleu → ambre → vert → cyan : ordre vérifié au validateur de palette sur les deux
          fonds de carte. La pire paire adjacente est vert/ambre à ΔE 6,2 en protanopie —
          dans la bande basse, donc légale seulement parce que chaque tuile porte en clair
          son libellé, son icône et sa note. Le rouge a été écarté : collé au vert il
          tombait à ΔE 5,0 en deutéranopie, sous le plancher. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Proformas en attente"
          value={fmt(totalProformats.length)}
          color="#2563eb"
          icon={ic.doc}
          note="le fichier à suivre"
        />
        <StatTile
          label="Relancées"
          value={fmt(relances.length)}
          color="#d97706"
          icon={ic.phone}
          note={totalProformats.length ? `${Math.round((relances.length / totalProformats.length) * 100)} % du fichier` : '—'}
        />
        <StatTile
          label="Payées après relance"
          value={fmt(payees.length)}
          color="#16a34a"
          icon={ic.checkCircle}
          note={`sur ${fmt(relances.length)} relancée${relances.length > 1 ? 's' : ''}`}
        />
        <StatTile
          label="Taux de conversion"
          value={`${conversion} %`}
          color="#0891b2"
          icon={ic.chart}
          note="des relances aboutissent"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardTitle icon={ic.chart} color="#16a34a">Conversion des relances</CardTitle>
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <Gauge percent={conversion} caption="converties" />

            {/* La légende est le canal d'identité fiable : la couleur seule ne suffit
                jamais, et la pastille grise dit « reliquat », pas « catégorie ». */}
            <ul className="w-full min-w-0 space-y-1 sm:flex-1">
              <li className="flex items-center gap-2.5 px-2 py-1.5">
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-[#16a34a]" />
                <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">Payées</span>
                <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{fmt(payees.length)}</span>
              </li>
              <li className="flex items-center gap-2.5 px-2 py-1.5">
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full bg-[#94a3b8]" />
                <span className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">Toujours en attente</span>
                <span className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">{fmt(relances.length - payees.length)}</span>
              </li>
            </ul>
          </div>

          <Insight tone={conversionInsight.tone} title="Analyse">{conversionInsight.text}</Insight>
        </Card>

        <Card>
          <CardTitle icon={ic.target} color="#2563eb">Efficacité des relances</CardTitle>
          {/* Trois parts du même dénominateur : elles se comparent en longueur, là où
              les quatre lignes de chiffres d'avant obligeaient à diviser de tête. */}
          <div className="space-y-3">
            <Meter label="Clients appelés" value={appeles} total={relances.length} bar="bg-[#2563eb] dark:bg-[#3b82f6]" />
            <Meter label="Paiements reçus" value={payees.length} total={relances.length} bar="bg-[#16a34a]" />
            <Meter label="Restés sans réponse" value={sansReponse} total={relances.length} bar="bg-[#d97706]" />
          </div>

          <Insight tone={appelInsight.tone} title="À faire">{appelInsight.text}</Insight>
        </Card>
      </div>

      <Card>
        <CardTitle icon={ic.clock} color="#9333ea">Délai entre la relance et le paiement</CardTitle>
        {/* Ordonnés du plus court au plus long : la ligne se lit comme l'échelle que la
            barre reprend en dessous. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Plus rapide', value: minDelai, color: '#16a34a' },
            { label: 'Moyenne', value: moyenne, color: '#2563eb' },
            { label: 'Plus long', value: maxDelai, color: '#d97706' },
          ].map(item => (
            <div key={item.label} className="rounded-xl bg-slate-50 p-4 dark:bg-slate-900/40">
              <p className="text-xs text-slate-400 dark:text-slate-500">{item.label}</p>
              <p className="text-3xl font-black tabular-nums" style={{ color: delais.length ? item.color : '#94a3b8' }}>
                {delais.length ? fmt(item.value) : '—'}
                {delais.length > 0 && <span className="text-base font-bold text-slate-400"> j</span>}
              </p>
            </div>
          ))}
        </div>

        {delais.length > 0 && <RangeStrip min={minDelai} mean={moyenne} max={maxDelai} />}

        <Insight tone={timingInsight.tone} title="Timing">{timingInsight.text}</Insight>
      </Card>

      {/* Section "Relances payées" */}
      <div>
        <SectionTitle action={<span className="text-xs text-slate-500 dark:text-slate-400">{fmt(payees.length)} fiche{payees.length > 1 ? 's' : ''}</span>}>
          Relances payées
        </SectionTitle>
        {payeesRecentes.length === 0 ? (
          <EmptyState>Aucune relance n'a encore abouti.</EmptyState>
        ) : (
          <div className="space-y-2">
            {payeesRecentes.map(client => {
              const delai = daysBetween(client.relanceDate, client.paymentDate)
              return (
                <Card key={client.id} className="flex items-center gap-3">
                  <Avatar name={client.name} color="#16a34a" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{client.name}</p>
                    <p className="truncate text-xs text-slate-400">
                      relancé le {fmtDate(client.relanceDate)} · payé le {fmtDate(client.paymentDate)}
                    </p>
                  </div>
                  {/* Le délai porte la couleur de son seuil : la fiche qui a traîné se
                      repère sans relire les dates. Le nombre reste écrit, la couleur
                      n'est qu'un renfort. */}
                  <span
                    className="flex-shrink-0 text-sm font-bold tabular-nums"
                    style={{ color: delaiColor(delai) }}
                  >
                    {delai !== null ? `${fmt(delai)} j` : '—'}
                  </span>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Coquille ───────────────────────────────────────────────────────────────────
function Sidebar({ current, onNavigate, dark, onToggleDark, user, todo }: {
  current: Screen; onNavigate: (s: Screen) => void
  dark: boolean; onToggleDark: () => void; user: any; todo: number
}) {
  const name = `${String(user?.first_name || '').trim()} ${String(user?.last_name || '').trim()}`.trim() || 'SAV'
  const initial = (name[0] || 'S').toUpperCase()

  return (
    <aside className="hidden md:flex flex-col w-56 lg:w-60 bg-slate-900 dark:bg-slate-950 h-screen sticky top-0 flex-shrink-0">
      <div className="px-4 py-5 border-b border-slate-800 flex-shrink-0">
        <div className="flex flex-col items-center gap-2.5 text-center">
          {/* Fond blanc nécessaire : le JPEG n'a pas de transparence. */}
          <div className="w-full max-w-[180px] rounded-xl bg-white px-3 py-2">
            <img src={logoUrl} alt="La Lunetterie" className="w-full h-auto object-contain" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-slate-500">SAV</p>
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
            {item.id === 'proformas' && todo > 0 && (
              <span className="ml-auto flex-shrink-0 rounded-lg bg-[#d97706] px-1.5 py-0.5 text-[10px] font-black tabular-nums text-white">
                {todo}
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
            <p className="text-xs text-slate-500 truncate">{user?.station_name || 'Poste SAV'}</p>
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
            className={`flex-1 flex flex-col items-center py-2.5 gap-1 transition-colors ${
              current === item.id ? 'text-blue-600' : 'text-slate-400'
            }`}
          >
            {item.icon('w-5 h-5')}
            <span className="text-[9px] font-semibold leading-none">{item.short}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

function TopBar({ current, dark, onToggleDark }: { current: Screen; dark: boolean; onToggleDark: () => void }) {
  const label = NAV.find(item => item.id === current)?.label || ''
  return (
    <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100 dark:border-slate-800 px-4 md:px-6 h-14 flex items-center gap-3 flex-shrink-0">
      <div className="flex-1 min-w-0">
        <h1 className="font-bold text-slate-900 dark:text-white text-sm md:text-base truncate leading-tight">{label}</h1>
      </div>
      <button
        onClick={onToggleDark}
        className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0"
        aria-label="Changer de thème"
      >
        {dark ? ic.sun() : ic.moon()}
      </button>
      {/* Déconnexion vit dans la barre latérale ; sur mobile elle n'existe pas, elle
          remonte donc ici. */}
      <button
        onClick={logoutToLogin}
        className="md:hidden p-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 rounded-xl transition-colors flex-shrink-0"
        aria-label="Se déconnecter"
      >
        {ic.signOut()}
      </button>
    </header>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
function SavPage() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [dark, setDark] = useState(false)
  const [screen, setScreen] = useState<Screen>('clients')
  const [clients, setClients] = useState<Client[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saveError, setSaveError] = useState('')
  // Un minuteur par fiche : les observations se tapent au clavier, on n'envoie pas une
  // requête par frappe.
  const observationTimers = useRef<Record<number, number>>({})

  useEffect(() => {
    if (!getToken()) {
      window.location.replace('/magasin.html')
      return
    }
    void (async () => {
      try {
        const response = await fetch(`${API_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        })
        if (!response.ok) throw new Error('session invalide')
        const me = (await response.json())?.data?.user
        if (!me) throw new Error('session invalide')
        // Le rôle est relu auprès du serveur, jamais cru sur parole depuis localStorage.
        const role = String(getRoleName(me))
        if (!ALLOWED_ROLES.includes(role)) {
          window.location.replace('/magasin.html')
          return
        }
        // Second verrou, comme sur les autres postes : le passage par /magasin.html, qui
        // pose `poste`. Sans lui, la vérification se contournerait en tapant l'URL.
        // SUPER_ADMIN en est dispensé — il entre par la Direction, où rien ne pose `poste`,
        // et n'aurait sinon aucun moyen d'ouvrir cet écran.
        if (role !== 'SUPER_ADMIN' && window.localStorage.getItem('poste') !== 'sav') {
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

  async function reload(silent = false) {
    if (!silent) setLoading(true)
    try {
      const { clients: rows, error } = await loadClients()
      // Une observation ou un message en cours de frappe n'est envoyé qu'après une pause
      // de 600 ms (setObservations/setMessage) : la copie fraîchement rechargée du serveur
      // est donc en retard sur ce qui est affiché tant que ce minuteur n'a pas encore
      // écrit. Sans cette préservation, un rafraîchissement arrivant pendant la frappe
      // effacerait ce que l'agent vient de taper.
      const editingIds = new Set(Object.keys(observationTimers.current).map(Number))
      setClients(previous => {
        if (editingIds.size === 0) return rows
        const byId = new Map(previous.map(client => [client.id, client]))
        return rows.map(row => {
          if (!editingIds.has(row.id)) return row
          const local = byId.get(row.id)
          return local ? { ...row, observations: local.observations, message: local.message } : row
        })
      })
      setLoadError(error)
    } catch (error: any) {
      setLoadError(error?.message || 'Chargement impossible.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!ready) return
    void reload()

    // silent : le rafraîchissement automatique ne doit pas réafficher le squelette de
    // chargement — seul le montage initial (ou un reload() explicite après une action) le
    // fait. Même cadence que la Direction (App.tsx) : 15 s, uniquement onglet visible.
    const handleWindowFocus = () => { void reload(true) }
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
  }, [ready])

  // Nettoie les minuteurs en attente : sans ça, un envoi partirait après le démontage.
  useEffect(() => () => {
    Object.values(observationTimers.current).forEach(id => window.clearTimeout(id))
  }, [])

  function patchLocal(id: number, patch: Partial<Client>) {
    setClients(list => list.map(client => (client.id === id ? { ...client, ...patch } : client)))
  }

  /** Écrit d'abord à l'écran, puis au serveur. Le poste se tient au téléphone : une
   *  case qui attend l'aller-retour réseau avant de réagir se fait cliquer deux fois. */
  async function push(id: number, body: Record<string, unknown>) {
    setSaveError('')
    try {
      const payload = await saveFollowup(id, body)
      const saved = payload?.data?.followup
      if (saved) {
        patchLocal(id, {
          called: Boolean(saved.called),
          calledDate: saved.called_at || null,
          noAnswer: Boolean(saved.no_answer),
          observations: saved.observations || '',
          message: saved.message || '',
          relanceDate: saved.relance_at || null,
        })
      }
    } catch (error: any) {
      setSaveError(error?.message || "L'enregistrement a échoué.")
      // La fiche affichait déjà la valeur souhaitée : on la remet en phase avec le
      // serveur plutôt que de laisser croire que c'est enregistré.
      void reload()
    }
  }

  function toggleCalled(client: Client) {
    patchLocal(client.id, { called: !client.called })
    void push(client.id, { called: !client.called })
  }

  function toggleNoAnswer(client: Client) {
    patchLocal(client.id, { noAnswer: !client.noAnswer })
    void push(client.id, { no_answer: !client.noAnswer })
  }

  function markRetrieved(client: Client) {
    patchLocal(client.id, { labStatus: 'enlevée', retrievedDate: new Date().toISOString() })
  }

  function setObservations(client: Client, value: string) {
    patchLocal(client.id, { observations: value })
    window.clearTimeout(observationTimers.current[client.id])
    observationTimers.current[client.id] = window.setTimeout(() => {
      void push(client.id, { observations: value })
    }, 600)
  }

  function setMessage(client: Client, value: string) {
    patchLocal(client.id, { message: value })
    window.clearTimeout(observationTimers.current[client.id])
    observationTimers.current[client.id] = window.setTimeout(() => {
      void push(client.id, { message: value })
    }, 600)
  }

  const anciens = clients.filter(c => c.type === 'ancien')
  const proformas = clients.filter(c => c.type === 'proformat' && !c.paymentDate)
  const labo = clients.filter(c => c.labStatus === 'prêt')
  const retraits = clients.filter(c => c.labStatus === 'enlevée')

  function filtered(list: Client[]) {
    const needle = query.trim().toLowerCase()
    if (!needle) return list
    return list.filter(c => c.name.toLowerCase().includes(needle) || c.phone.includes(needle))
  }

  const listes: Record<string, { rows: Client[]; color: string; empty: string; retrievable?: boolean }> = {
    clients: { rows: filtered(anciens), color: '#2563eb', empty: 'Aucun ancien client.' },
    proformas: { rows: filtered(proformas), color: '#d97706', empty: 'Aucune proforma à relancer.' },
    labo: { rows: filtered(labo), color: '#0891b2', empty: 'Aucune monture prête au laboratoire.', retrievable: true },
    retraits: { rows: filtered(retraits), color: '#16a34a', empty: 'Aucune monture récupérée.' },
  }

  if (!ready) return null

  const liste = listes[screen]

  return (
    <div className={dark ? 'dark' : ''}>
      <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900">
        <Sidebar
          current={screen}
          onNavigate={setScreen}
          dark={dark}
          onToggleDark={() => setDark(d => !d)}
          user={user}
          todo={proformas.filter(c => !c.called).length}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <TopBar current={screen} dark={dark} onToggleDark={() => setDark(d => !d)} />

          <main className="flex-1 px-4 md:px-6 py-4 md:py-6 pb-24 md:pb-8 overflow-auto">
            {(loadError || saveError) && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
                <span className="flex-shrink-0 text-amber-600">{ic.alert()}</span>
                <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-400">{saveError || loadError}</p>
              </div>
            )}

            {liste ? (
              <div className="space-y-4">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">{ic.search()}</span>
                  <input
                    type="search"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Nom ou téléphone…"
                    className={`${INPUT} pl-9 py-2.5`}
                  />
                </div>

                <SectionTitle action={<span className="text-xs text-slate-500 dark:text-slate-400">{liste.rows.length} fiche{liste.rows.length > 1 ? 's' : ''}</span>}>
                  {NAV.find(item => item.id === screen)?.label}
                </SectionTitle>

                {loading && liste.rows.length === 0 ? (
                  <EmptyState>Chargement…</EmptyState>
                ) : liste.rows.length === 0 ? (
                  <EmptyState>{liste.empty}</EmptyState>
                ) : (
                  <div className="grid gap-3 lg:grid-cols-2">
                    {liste.rows.map(client => (
                      <ClientCard
                        key={client.id}
                        client={client}
                        color={liste.color}
                        onToggleCalled={() => toggleCalled(client)}
                        onToggleNoAnswer={() => toggleNoAnswer(client)}
                        onObservations={value => setObservations(client, value)}
                        onMessage={value => setMessage(client, value)}
                        onRetrieved={liste.retrievable ? () => markRetrieved(client) : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            ) : screen === 'suivi' ? (
              <SuiviScreen clients={clients} />
            ) : (
              <CalendrierScreen clients={clients} />
            )}
          </main>
        </div>

        <MobileNav current={screen} onNavigate={setScreen} />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SavPage />
  </React.StrictMode>,
)