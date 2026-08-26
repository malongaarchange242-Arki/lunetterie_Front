export interface StockSummaryRow {
  reference?: string | null
  brand?: string | null
  qty_general?: number
  qty_local?: number
  qty_presentoir?: number
  qty_labo?: number
  qty_reserve?: number
  qty_total?: number
  is_critical?: boolean
}

export interface DashboardSummary {
  totalUnits: number
  generalUnits: number
  localUnits: number
  presentoirUnits: number
  laboUnits: number
  reserveUnits: number
  criticalReferences: number
  // Le dénominateur des références critiques : elles se comptent en références, pas en
  // montures, et les rapporter à totalUnits mélangerait deux unités.
  totalReferences: number
  hasData: boolean
}

export interface ReceptionCommandRow {
  id?: number | string | null
  target_count?: number | string | null
  registered_count?: number | string | null
}

export interface ReceptionSessionProgress {
  initialStock: number
  registeredStock: number
  remainingStock: number
  matchedSessions: number
  hasData: boolean
}

export function summarizeReceptionSessionProgress(
  commands: ReceptionCommandRow[] = [],
  sessionIds?: readonly number[]
): ReceptionSessionProgress {
  const allowedIds = sessionIds ? new Set(sessionIds.map(id => Number(id))) : null
  const tracked = allowedIds
    ? commands.filter(command => allowedIds.has(Number(command.id)))
    : commands

  const initialStock = tracked.reduce((sum, command) => sum + Math.max(0, Number(command.target_count) || 0), 0)
  const registeredStock = tracked.reduce((sum, command) => sum + Math.max(0, Number(command.registered_count) || 0), 0)

  return {
    initialStock,
    registeredStock,
    remainingStock: Math.max(0, initialStock - registeredStock),
    matchedSessions: tracked.length,
    hasData: tracked.length > 0,
  }
}

export function stockSummaryRowsFromReceptionProgress(progress: ReceptionSessionProgress): StockSummaryRow[] {
  if (!progress.hasData) return []

  return [{
    reference: 'SESSIONS_RECEPTION_SUIVIES',
    brand: 'Reception',
    qty_general: progress.registeredStock,
    qty_local: 0,
    qty_presentoir: 0,
    qty_labo: 0,
    qty_reserve: 0,
    qty_total: progress.registeredStock,
    is_critical: false,
  }]
}

// ==============================================
// FONCTION PRINCIPALE — FILTRAGE PAR SESSIONS
// ==============================================
export function summarizeStockSummary(rows: StockSummaryRow[] = []): DashboardSummary {
  const totalUnits = rows.reduce((sum, row) => sum + (row.qty_total ?? 0), 0)
  const generalUnits = rows.reduce((sum, row) => sum + (row.qty_general ?? 0), 0)
  const localUnits = rows.reduce((sum, row) => sum + (row.qty_local ?? 0), 0)
  const presentoirUnits = rows.reduce((sum, row) => sum + (row.qty_presentoir ?? 0), 0)
  const laboUnits = rows.reduce((sum, row) => sum + (row.qty_labo ?? 0), 0)
  const reserveUnits = rows.reduce((sum, row) => sum + (row.qty_reserve ?? 0), 0)
  const criticalReferences = rows.filter(row => row.is_critical).length

  return {
    totalUnits,
    generalUnits,
    localUnits,
    presentoirUnits,
    laboUnits,
    reserveUnits,
    criticalReferences,
    totalReferences: rows.length,
    hasData: rows.length > 0,
  }
}

// ── Références critiques ─────────────────────────────────────────────────────────

/** Même seuil que `stockCriticalThreshold` côté backend (`glass_repository.go`) : une
 *  référence est critique quand qty_general+qty_local+qty_presentoir (= qty_total sur
 *  cet endpoint, qui exclut déjà labo/réserve/transit/vendu) tombe à ce seuil ou en
 *  dessous. Un seuil personnalisé par référence demanderait une colonne côté backend —
 *  hors périmètre ici. */
export const STOCK_CRITICAL_THRESHOLD = 2

export type CriticalLevel = 'rupture' | 'critical' | 'ok'

export interface CriticalReferenceRow {
  reference: string
  brand: string
  stock: number
  threshold: number
  gap: number
  level: CriticalLevel
}

/** Transforme les lignes de /inventory/stock-summary (déjà chargées, déjà agrégées par
 *  référence côté serveur) en lignes exploitables pour un vrai tableau : combien il
 *  manque avant le seuil. Trois paliers : rupture (stock nul), critique (entre 1 et le
 *  seuil inclus), ok (au-delà). */
export function criticalReferenceRows(
  rows: StockSummaryRow[] = [],
  threshold: number = STOCK_CRITICAL_THRESHOLD
): CriticalReferenceRow[] {
  return rows
    .map(row => {
      const stock = row.qty_total ?? 0
      const gap = stock - threshold
      const level: CriticalLevel = stock <= 0 ? 'rupture' : stock <= threshold ? 'critical' : 'ok'
      return {
        reference: String(row.reference || '—'),
        brand: String(row.brand || '—'),
        stock,
        threshold,
        gap,
        level,
      }
    })
    .sort((a, b) => a.stock - b.stock || a.reference.localeCompare(b.reference, 'fr'))
}

// ── Détail d'une référence (montures individuelles) ─────────────────────────────
//
// Le détail par emplacement (Général/Magasin/Présentoir/Réserve/Labo/Transit) et les
// villes n'existent pas sur /inventory/stock-summary — cet endpoint exclut déjà
// réserve/labo/transit du calcul. Il faut les montures individuelles
// (GET /inventory/glasses?status=...), chargées à la demande seulement pour l'écran de
// détail d'une référence, pas pour tout le dashboard.

export interface ReferenceDetailGlassRow {
  reference?: string | null
  status?: string | null
  station_id?: number | string | null
}

export interface ReferenceLocationBreakdown {
  reference: string
  general: number
  magasin: number
  presentoir: number
  activeTotal: number
  reserve: number
  labo: number
  transit: number
  cities: string[]
}

const REFERENCE_STATUS_BUCKET: Record<string, keyof Omit<ReferenceLocationBreakdown, 'reference' | 'activeTotal' | 'cities'>> = {
  EN_STOCK_GENERAL: 'general',
  EN_STOCK_SOUS_STATION: 'magasin',
  EN_PRESENTOIR: 'presentoir',
  RESERVEE: 'reserve',
  RESERVE: 'reserve',
  EN_LABORATOIRE: 'labo',
  EN_TRANSIT: 'transit',
}

const ACTIVE_BUCKETS = new Set(['general', 'magasin', 'presentoir'])

/** Regroupe des montures individuelles par référence. Le stock actif (général + magasin
 *  + présentoir) est ce qui détermine la criticité — le même total que qty_total sur
 *  /inventory/stock-summary, pour que la page de détail ne contredise jamais le chiffre
 *  du tableau. Réserve/labo/transit et les villes ne comptent que pour la lecture, pas
 *  pour le niveau. Les villes ne retiennent que les stations qui portent du stock actif :
 *  une référence en réserve ailleurs n'y "est" pas au sens où le magasin peut la vendre. */
export function computeReferenceLocationBreakdown(
  glasses: ReferenceDetailGlassRow[] = [],
  stationCityMap: Map<number, string> = new Map()
): Map<string, ReferenceLocationBreakdown> {
  const byReference = new Map<string, ReferenceLocationBreakdown>()

  glasses.forEach(glass => {
    const reference = String(glass.reference || '').trim()
    if (!reference) return

    const bucket = REFERENCE_STATUS_BUCKET[String(glass.status || '').trim().toUpperCase()]
    if (!bucket) return

    const entry = byReference.get(reference) || {
      reference, general: 0, magasin: 0, presentoir: 0, activeTotal: 0, reserve: 0, labo: 0, transit: 0, cities: [],
    }
    entry[bucket] += 1
    if (ACTIVE_BUCKETS.has(bucket)) {
      entry.activeTotal += 1
      const city = stationCityMap.get(Number(glass.station_id))
      if (city && !entry.cities.includes(city)) entry.cities.push(city)
    }
    byReference.set(reference, entry)
  })

  byReference.forEach(entry => entry.cities.sort((a, b) => a.localeCompare(b, 'fr')))

  return byReference
}

