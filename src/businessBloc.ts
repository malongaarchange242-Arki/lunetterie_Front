export type BusinessBlocKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

function normalizeBusinessGender(value?: string) {
  const raw = String(value || '').trim()
  if (!raw) return ''

  const normalized = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (normalized.startsWith('femme') || normalized.includes('feminin')) return 'Femme'
  if (normalized.startsWith('homme') || normalized.includes('masculin')) return 'Homme'
  if (normalized.startsWith('enfant') || normalized.startsWith('junior') || normalized.includes('garcon') || normalized.includes('fille')) return 'Enfant'
  if (normalized.startsWith('unisex') || normalized.startsWith('mixte')) return 'Unisexe'
  return raw
}

function isOfferedGlass(glass: { price?: number | string; status?: string; is_offered?: boolean | string; offered?: boolean | string }) {
  const status = String(glass.status || '').trim().toUpperCase()
  if (status.includes('OFFERTE') || status.includes('OFFERT')) return true

  const offeredFlags = [glass.is_offered, glass.offered]
  if (offeredFlags.some(value => value === true || value === 'true' || value === '1')) return true

  const price = Number(glass.price ?? 0)
  return Number.isFinite(price) && price === 0
}

export function businessBlocKeyOf(glass: { gender?: string; price?: number | string; status?: string; is_offered?: boolean | string; offered?: boolean | string }): BusinessBlocKey | 'Non affecté' {
  if (!glass) return 'Non affecté'

  if (isOfferedGlass(glass)) return 'F'

  const gender = normalizeBusinessGender(glass.gender)
  if (gender === 'Enfant') return 'E'

  const price = Number(glass.price ?? 0)
  const isClassique = !Number.isFinite(price) || price <= 70000

  if (gender === 'Homme') return isClassique ? 'A' : 'C'
  if (gender === 'Femme') return isClassique ? 'B' : 'D'

  if (gender === 'Unisexe') return isClassique ? 'A' : 'C'

  return isClassique ? 'A' : 'C'
}

export function businessBlocLabel(key: string) {
  const normalized = String(key || '').trim().toUpperCase()
  const labels: Record<string, string> = {
    A: 'Classique homme',
    B: 'Classique femme',
    C: 'Moyenne gamme homme',
    D: 'Moyenne gamme femme',
    E: 'Enfant',
    F: 'Monture offerte',
  }
  return labels[normalized] || 'Bloc'
}
