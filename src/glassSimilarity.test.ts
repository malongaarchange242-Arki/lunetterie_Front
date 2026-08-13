import { describe, expect, it } from 'vitest'
import {
  calculateGlassSimilarity,
  cosineSimilarity,
  getGamme,
  rankSimilarGlasses,
  type SimilarityGlass,
} from './glassSimilarity'

// Les prix tombent dans les paliers de getGamme() : ≤ 50 000 Classique,
// ≤ 100 000 Moyenne gamme, au-delà Luxe.
const LUXE = 150000
const MOYENNE = 80000
const CLASSIQUE = 30000

const A: SimilarityGlass = { gender: 'Homme', shape: 'Carrée', price: LUXE }
const B: SimilarityGlass = { gender: 'Homme', shape: 'Carrée', price: LUXE }
const C: SimilarityGlass = { gender: 'Homme', shape: 'Carrée', price: MOYENNE }
const D: SimilarityGlass = { gender: 'Femme', shape: 'Carrée', price: LUXE }
const E: SimilarityGlass = { gender: 'Femme', shape: 'Ronde', price: CLASSIQUE }
const F: SimilarityGlass = { gender: 'Homme', shape: 'Carrée' }

describe('cosineSimilarity', () => {
  it('applies the textbook formula, not an equality test', () => {
    // 6/(5×5) : deux vecteurs quelconques, dont on connaît le cosinus à la main.
    expect(cosineSimilarity([3, 4], [4, 3])).toBeCloseTo(24 / 25, 10)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1, 10)
  })

  it('returns 0 rather than NaN on a null vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe('calculateGlassSimilarity', () => {
  it('A vs B — identical frames score 100 %', () => {
    expect(calculateGlassSimilarity(A, B)).toBeCloseTo(1, 10)
  })

  it('C — same gender and shape, other gamme: high but under 100 %', () => {
    const score = calculateGlassSimilarity(A, C)
    expect(score).toBeCloseTo(0.7, 10) // genre 0.20 + forme 0.50
    expect(score).toBeLessThan(1)
    expect(score).toBeGreaterThan(0.5)
  })

  it('D — other gender scores under B', () => {
    const score = calculateGlassSimilarity(A, D)
    expect(score).toBeCloseTo(0.8, 10) // forme 0.50 + gamme 0.30
    expect(score).toBeLessThan(calculateGlassSimilarity(A, B))
  })

  it('E — nothing in common scores 0', () => {
    expect(calculateGlassSimilarity(A, E)).toBe(0)
  })

  it('F — a missing gamme costs nothing', () => {
    // Le bloc gamme sort du calcul et les poids restants sont renormalisés
    // (0.20 + 0.50 = 0.70), au lieu de compter comme « gammes différentes ».
    expect(calculateGlassSimilarity(A, F)).toBeCloseTo(1, 10)
    // La pénalité qu'on refuse : 0.70 si la gamme manquante valait « différente ».
    expect(calculateGlassSimilarity(A, F)).toBeGreaterThan(calculateGlassSimilarity(A, C))
  })

  it('weights shape (50 %) above gamme (30 %) above gender (20 %)', () => {
    const ref: SimilarityGlass = { gender: 'Homme', shape: 'Carrée', price: LUXE }
    const otherShape = calculateGlassSimilarity(ref, { ...ref, shape: 'Ronde' })
    const otherGamme = calculateGlassSimilarity(ref, { ...ref, price: CLASSIQUE })
    const otherGender = calculateGlassSimilarity(ref, { ...ref, gender: 'Femme' })

    expect(otherShape).toBeCloseTo(0.5, 10)
    expect(otherGamme).toBeCloseTo(0.7, 10)
    expect(otherGender).toBeCloseTo(0.8, 10)
    // Perdre la forme coûte plus cher que perdre la gamme, elle-même plus que le genre.
    expect(otherShape).toBeLessThan(otherGamme)
    expect(otherGamme).toBeLessThan(otherGender)
  })

  it('ignores case and accents, like the rest of the stock screens', () => {
    // « Carrée » saisi « carree » désigne la même forme — sinon la moitié du stock
    // ne se retrouverait jamais.
    expect(calculateGlassSimilarity(A, { gender: 'HOMME', shape: 'carree', price: LUXE }))
      .toBeCloseTo(1, 10)
  })

  it('scores 0 when no attribute is shared on both sides', () => {
    expect(calculateGlassSimilarity({}, {})).toBe(0)
    expect(calculateGlassSimilarity(A, {})).toBe(0)
    // Un prix hors barème (getGamme rend '—') n'active pas le bloc gamme.
    expect(calculateGlassSimilarity({ price: 'n/a' }, { price: 'n/a' })).toBe(0)
  })

  it('holds the properties of a similarity measure', () => {
    const all = [A, B, C, D, E, F]
    for (const x of all) {
      // similarity(A,A) = 1 dès qu'au moins un attribut est renseigné.
      expect(calculateGlassSimilarity(x, x)).toBeCloseTo(1, 10)
      for (const y of all) {
        const xy = calculateGlassSimilarity(x, y)
        expect(xy).toBeCloseTo(calculateGlassSimilarity(y, x), 10) // symétrie
        expect(xy).toBeGreaterThanOrEqual(0)
        expect(xy).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('rankSimilarGlasses', () => {
  it('sorts from most to least similar and drops the reference itself', () => {
    const ref = { barcode: 'REF001', ...A }
    const ranked = rankSimilarGlasses(ref, [
      ref,
      { barcode: 'REF005', ...E },
      { barcode: 'REF002', ...B },
      { barcode: 'REF004', ...C },
      { barcode: 'REF003', ...D },
    ])

    expect(ranked.map(r => r.glass.barcode)).toEqual(['REF002', 'REF003', 'REF004', 'REF005'])
    expect(ranked[0].score).toBeCloseTo(1, 10)
    expect(ranked[ranked.length - 1].score).toBe(0)
  })
})

describe('getGamme', () => {
  it('keeps the thresholds shared with the other screens', () => {
    expect(getGamme(50000)).toBe('Classique')
    expect(getGamme(50001)).toBe('Moyenne gamme')
    expect(getGamme(100000)).toBe('Moyenne gamme')
    expect(getGamme(100001)).toBe('Luxe')
    expect(getGamme(undefined)).toBe('—')
    expect(getGamme('abc')).toBe('—')
  })
})
