export interface StockSummaryRow {
  reference?: string | null
  brand?: string | null
  qty_general?: number
  qty_local?: number
  qty_presentoir?: number
  qty_total?: number
  is_critical?: boolean
}

export interface DashboardSummary {
  totalUnits: number
  generalUnits: number
  localUnits: number
  presentoirUnits: number
  criticalReferences: number
  hasData: boolean
}

export function summarizeStockSummary(rows: StockSummaryRow[] = []): DashboardSummary {
  const totalUnits = rows.reduce((sum, row) => sum + (row.qty_total ?? 0), 0)
  const generalUnits = rows.reduce((sum, row) => sum + (row.qty_general ?? 0), 0)
  const localUnits = rows.reduce((sum, row) => sum + (row.qty_local ?? 0), 0)
  const presentoirUnits = rows.reduce((sum, row) => sum + (row.qty_presentoir ?? 0), 0)
  const criticalReferences = rows.filter(row => row.is_critical).length

  return {
    totalUnits,
    generalUnits,
    localUnits,
    presentoirUnits,
    criticalReferences,
    hasData: rows.length > 0,
  }
}
