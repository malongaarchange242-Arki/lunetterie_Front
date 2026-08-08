export function extractDashboardMetrics(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const totalFrames = items.reduce((sum, item) => sum + Number(item?.qty_total || 0), 0)

  return {
    totalFrames: Number.isFinite(totalFrames) && totalFrames > 0 ? totalFrames : null,
    totalRevenue: null,
    totalVendues: null,
  }
}

export function summarizeStockSummary(rows = []) {
  const totalUnits = rows.reduce((sum, row) => sum + Number(row?.qty_total || 0), 0)
  const generalUnits = rows.reduce((sum, row) => sum + Number(row?.qty_general || 0), 0)
  const localUnits = rows.reduce((sum, row) => sum + Number(row?.qty_local || 0), 0)
  const presentoirUnits = rows.reduce((sum, row) => sum + Number(row?.qty_presentoir || 0), 0)
  const criticalReferences = rows.filter(row => row?.is_critical).length

  return {
    totalUnits,
    generalUnits,
    localUnits,
    presentoirUnits,
    criticalReferences,
    hasData: rows.length > 0,
  }
}

export function formatDashboardMetric(value) {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString('fr-FR')
}
