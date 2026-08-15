import { describe, expect, it } from 'vitest'
import { computeReferenceLocationBreakdown, criticalReferenceRows, summarizeStockSummary } from './dashboardMetrics'
import { resolveStationCity } from './App'

describe('summarizeStockSummary', () => {
  it('aggregates active units and critical references from backend stock-summary data', () => {
    const summary = summarizeStockSummary([
      { qty_total: 12, qty_general: 8, qty_local: 2, qty_presentoir: 1, qty_labo: 1, qty_reserve: 0, is_critical: false },
      { qty_total: 3, qty_general: 1, qty_local: 1, qty_presentoir: 1, qty_labo: 0, qty_reserve: 1, is_critical: true },
    ])

    expect(summary.totalUnits).toBe(15)
    expect(summary.generalUnits).toBe(9)
    expect(summary.localUnits).toBe(3)
    expect(summary.presentoirUnits).toBe(2)
    expect(summary.laboUnits).toBe(1)
    expect(summary.reserveUnits).toBe(1)
    expect(summary.criticalReferences).toBe(1)
    // Le dénominateur des références critiques : 1 sur 2, pas 1 sur les 15 montures.
    expect(summary.totalReferences).toBe(2)
    expect(summary.hasData).toBe(true)
  })

  it('returns an empty state when there is no stock-summary data', () => {
    const summary = summarizeStockSummary([])

    expect(summary.totalUnits).toBe(0)
    expect(summary.hasData).toBe(false)
  })

  it('keeps the real city of a station even for presentoir or laboratoire entries', () => {
    expect(resolveStationCity({ id: 1, name: 'Station Pointe-Noire', city: 'Pointe-Noire', type: 'SOUS_STATION' })).toBe('Pointe-Noire')
    expect(resolveStationCity({ id: 2, name: 'Présentoir', city: 'Brazzaville', type: 'SOUS_STATION' })).toBe('Brazzaville')
    expect(resolveStationCity({ id: 3, name: 'Laboratoire', city: 'Dolisie', type: 'SOUS_STATION' })).toBe('Dolisie')
  })
})

describe('criticalReferenceRows', () => {
  it('classifies references as rupture, critical, or ok around the shared threshold', () => {
    const rows = criticalReferenceRows([
      { reference: 'REF-RUPTURE', brand: 'A', qty_total: 0 },
      { reference: 'REF-CRITICAL', brand: 'B', qty_total: 1 },
      { reference: 'REF-AT-THRESHOLD', brand: 'C', qty_total: 2 },
      { reference: 'REF-OK', brand: 'D', qty_total: 3 },
    ], 2)

    const byRef = Object.fromEntries(rows.map(row => [row.reference, row]))
    expect(byRef['REF-RUPTURE'].level).toBe('rupture')
    expect(byRef['REF-RUPTURE'].gap).toBe(-2)
    expect(byRef['REF-CRITICAL'].level).toBe('critical')
    expect(byRef['REF-CRITICAL'].gap).toBe(-1)
    expect(byRef['REF-AT-THRESHOLD'].level).toBe('critical')
    expect(byRef['REF-OK'].level).toBe('ok')
  })

  it('sorts the lowest stock first', () => {
    const rows = criticalReferenceRows([
      { reference: 'REF-B', qty_total: 5 },
      { reference: 'REF-A', qty_total: 1 },
    ])
    expect(rows.map(row => row.reference)).toEqual(['REF-A', 'REF-B'])
  })

  it('defaults to the shared global threshold of 2', () => {
    const [row] = criticalReferenceRows([{ reference: 'REF-A', qty_total: 2 }])
    expect(row.threshold).toBe(2)
    expect(row.level).toBe('critical')
  })

  it('returns an empty array with no data', () => {
    expect(criticalReferenceRows([])).toEqual([])
  })
})

describe('computeReferenceLocationBreakdown', () => {
  const stationCityMap = new Map([[1, 'Pointe-Noire'], [2, 'Brazzaville']])

  it('splits active stock (général/magasin/présentoir) from réserve/labo/transit', () => {
    const glasses = [
      { reference: 'REF-A', status: 'EN_STOCK_GENERAL', station_id: 1 },
      { reference: 'REF-A', status: 'EN_PRESENTOIR', station_id: 2 },
      { reference: 'REF-A', status: 'RESERVEE', station_id: 1 },
      { reference: 'REF-A', status: 'EN_LABORATOIRE', station_id: 1 },
      { reference: 'REF-A', status: 'EN_TRANSIT', station_id: 1 },
    ]
    const breakdown = computeReferenceLocationBreakdown(glasses, stationCityMap)
    const refA = breakdown.get('REF-A')!

    expect(refA.general).toBe(1)
    expect(refA.magasin).toBe(0)
    expect(refA.presentoir).toBe(1)
    expect(refA.activeTotal).toBe(2)
    expect(refA.reserve).toBe(1)
    expect(refA.labo).toBe(1)
    expect(refA.transit).toBe(1)
  })

  it('lists distinct cities only for stations carrying active stock', () => {
    const glasses = [
      { reference: 'REF-A', status: 'EN_STOCK_GENERAL', station_id: 1 },
      { reference: 'REF-A', status: 'EN_STOCK_SOUS_STATION', station_id: 2 },
      { reference: 'REF-A', status: 'EN_STOCK_GENERAL', station_id: 1 },
      { reference: 'REF-A', status: 'RESERVEE', station_id: 2 },
    ]
    const breakdown = computeReferenceLocationBreakdown(glasses, stationCityMap)
    expect(breakdown.get('REF-A')!.cities).toEqual(['Brazzaville', 'Pointe-Noire'])
  })

  it('ignores glasses without a reference and unmapped statuses', () => {
    const glasses = [
      { status: 'EN_STOCK_GENERAL', station_id: 1 },
      { reference: 'REF-A', status: 'VENDUE', station_id: 1 },
    ]
    expect(computeReferenceLocationBreakdown(glasses, stationCityMap).size).toBe(0)
  })
})
