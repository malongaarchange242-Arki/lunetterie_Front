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
