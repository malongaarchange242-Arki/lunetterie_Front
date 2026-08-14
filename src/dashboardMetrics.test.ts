import { describe, expect, it } from 'vitest'
import { summarizeStockSummary } from './dashboardMetrics'
import { resolveStationCity } from './App'
import { businessBlocKeyOf, businessBlocLabel } from './businessBloc'

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

  it('groups the presentoir by the business A-F bloc rules instead of location codes', () => {
    expect(businessBlocKeyOf({ gender: 'Homme', price: 45000 })).toBe('A')
    expect(businessBlocKeyOf({ gender: 'Femme', price: 55000 })).toBe('B')
    expect(businessBlocKeyOf({ gender: 'Homme', price: 85000 })).toBe('C')
    expect(businessBlocKeyOf({ gender: 'Femme', price: 95000 })).toBe('D')
    expect(businessBlocKeyOf({ gender: 'Enfant', price: 30000 })).toBe('E')
    expect(businessBlocKeyOf({ gender: 'Homme', price: 0, status: 'OFFERTE' })).toBe('F')
    expect(businessBlocLabel('A')).toBe('Classique homme')
  })
})
