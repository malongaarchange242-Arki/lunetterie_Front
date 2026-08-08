import { describe, expect, it } from 'vitest'
import { summarizeStockSummary } from './dashboardMetrics'

describe('summarizeStockSummary', () => {
  it('aggregates active units and critical references from backend stock-summary data', () => {
    const summary = summarizeStockSummary([
      { qty_total: 12, qty_general: 8, qty_local: 2, qty_presentoir: 2, is_critical: false },
      { qty_total: 3, qty_general: 1, qty_local: 1, qty_presentoir: 1, is_critical: true },
    ])

    expect(summary.totalUnits).toBe(15)
    expect(summary.generalUnits).toBe(9)
    expect(summary.localUnits).toBe(3)
    expect(summary.presentoirUnits).toBe(3)
    expect(summary.criticalReferences).toBe(1)
    expect(summary.hasData).toBe(true)
  })

  

  it('returns an empty state when there is no stock-summary data', () => {
    const summary = summarizeStockSummary([])

    expect(summary.totalUnits).toBe(0)
    expect(summary.hasData).toBe(false)
  })
})
