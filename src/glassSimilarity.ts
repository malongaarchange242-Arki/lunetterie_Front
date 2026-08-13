/** Similarité entre deux montures : vrai encodage vectoriel, vrai cosinus.
 *
 *  Isolé de vendeuse.tsx parce que ce fichier-là appelle createRoot() à la racine du
 *  module : l'importer depuis un test monterait le poste Vendeuse en entier. Même
 *  découpage que dashboardMetrics.ts et chatContext.ts.
 */

/** Les champs dont la similarité a besoin. Structurel : l'interface `Glass` de
 *  vendeuse.tsx, caisse.tsx, labo.tsx et responsable.tsx s'y conforme déjà. */
export interface SimilarityGlass {
  gender?: string
  shape?: string
  price?: number | string
}

/** Même barème que getGamme() de presentoir.js. */
export function getGamme(price: unknown) {
  const value = Number(price)
  if (!price || Number.isNaN(value)) return '—'
  if (value <= 50000) return 'Classique'
  if (value <= 100000) return 'Moyenne gamme'
  return 'Luxe'
}

/** Compare deux attributs saisis à la main : « Écaille » et « ecaille » désignent la
 *  même couleur. Accents retirés et casse ignorée, comme normalizeSendValue() de
 *  ../Frontend/scan.js — sans quoi la moitié du stock ne se retrouverait jamais. */
export function normalizeAttr(value: unknown) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    // Les marques diacritiques que NFD vient de détacher. En échappements plutôt
    // qu'en caractères bruts : ceux-ci se collent au crochet dans un éditeur.
    .replace(/[\u0300-\u036f]/g, '')
}

// ── Le modèle vectoriel ────────────────────────────────────────────────────────

type BlockName = 'genre' | 'forme' | 'gamme'

/** Les poids du Présentoir. Ceux de calculateRecommendationScore() (recherche de
 *  remplacement) sont volontairement ailleurs : les deux scores ne répondent pas à la
 *  même question. */
export const SIMILARITY_WEIGHTS: Record<BlockName, number> = {
  genre: 0.2,
  forme: 0.5,
  gamme: 0.3,
}

/** Une dimension du vecteur : un bloc, une valeur possible de ce bloc. Un bloc occupe
 *  autant de dimensions qu'il a de valeurs distinctes — c'est le one-hot. */
interface Axis {
  block: BlockName
  value: string
}

/** L'espace vectoriel dans lequel deux montures données se comparent.
 *
 *  Il est construit **par paire**, et non une fois pour toutes, pour deux raisons :
 *
 *  1. Les poids effectifs dépendent des blocs renseignés **des deux côtés** (voir
 *     buildVectorSpace) — un vecteur calculé monture par monture ne peut pas les
 *     connaître.
 *  2. Le vocabulaire des formes n'est pas clos : scan.tsx en propose 9, App.tsx en
 *     filtre 14, et le backend accepte du texte libre. Une liste figée renverrait un
 *     bloc nul pour toute valeur hors liste, donc une similarité fausse entre deux
 *     « Clubmaster ».
 *
 *  Mathématiquement c'est le même résultat qu'un one-hot global : deux montures
 *  n'activent au plus que 2 dimensions par bloc, toutes les autres seraient nulles des
 *  deux côtés et ne pèsent ni dans le produit scalaire ni dans les normes. */
interface VectorSpace {
  axes: Axis[]
  /** √poids effectif du bloc, l'amplitude de sa composante one-hot. */
  scale: Partial<Record<BlockName, number>>
}

/** Les trois attributs d'une monture, normalisés. `undefined` = non renseigné. */
function readBlocks(glass: SimilarityGlass): Partial<Record<BlockName, string>> {
  const gamme = getGamme(glass?.price)
  return {
    genre: glass?.gender ? normalizeAttr(glass.gender) || undefined : undefined,
    forme: glass?.shape ? normalizeAttr(glass.shape) || undefined : undefined,
    // getGamme() rend '—' quand le prix manque ou n'est pas un nombre.
    gamme: gamme !== '—' ? normalizeAttr(gamme) : undefined,
  }
}

/** Construit l'espace commun aux deux montures.
 *
 *  Un bloc n'est retenu que s'il est renseigné **des deux côtés** : une gamme inconnue
 *  d'un côté ne doit pas se lire comme « gammes différentes ». Les poids des blocs
 *  retenus sont alors renormalisés pour sommer à 1 — sans quoi une monture incomplète
 *  serait pénalisée pour ce qu'on ignore d'elle. */
function buildVectorSpace(a: SimilarityGlass, b: SimilarityGlass): VectorSpace {
  const blocksA = readBlocks(a)
  const blocksB = readBlocks(b)

  const active = (Object.keys(SIMILARITY_WEIGHTS) as BlockName[])
    .filter(block => blocksA[block] !== undefined && blocksB[block] !== undefined)

  const totalWeight = active.reduce((sum, block) => sum + SIMILARITY_WEIGHTS[block], 0)
  if (totalWeight === 0) return { axes: [], scale: {} }

  const axes: Axis[] = []
  const scale: Partial<Record<BlockName, number>> = {}

  for (const block of active) {
    // √poids et non le poids : le cosinus élève les composantes au carré, donc c'est
    // bien √w qui restitue w dans le produit scalaire comme dans les normes.
    scale[block] = Math.sqrt(SIMILARITY_WEIGHTS[block] / totalWeight)

    const values = new Set<string>([blocksA[block]!, blocksB[block]!])
    for (const value of Array.from(values).sort()) axes.push({ block, value })
  }

  return { axes, scale }
}

/** Encode une monture dans l'espace donné : 1 sur l'axe de sa valeur, 0 ailleurs,
 *  le tout à l'échelle √poids effectif du bloc. */
export function glassToVector(glass: SimilarityGlass, space: VectorSpace): number[] {
  const blocks = readBlocks(glass)
  return space.axes.map(axis => (blocks[axis.block] === axis.value ? (space.scale[axis.block] ?? 0) : 0))
}

/** cos(A,B) = (A · B) / (‖A‖ × ‖B‖) */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let sumA = 0
  let sumB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    sumA += a[i] * a[i]
    sumB += b[i] * b[i]
  }

  const normA = Math.sqrt(sumA)
  const normB = Math.sqrt(sumB)
  if (normA === 0 || normB === 0) return 0

  // Les arrondis flottants peuvent sortir de [0,1] d'un ulp ; un score à 100,0000001 %
  // se verrait à l'écran.
  return Math.max(0, Math.min(1, dotProduct / (normA * normB)))
}

/**
 * Similarité du Présentoir entre deux montures : genre (20 %), forme (50 %),
 * gamme (30 %).
 *
 * Chaque monture devient un vecteur one-hot pondéré, puis on applique la formule du
 * cosinus. Résultat dans [0,1], symétrique, et 1 pour une monture comparée à
 * elle-même. Un attribut manquant d'un côté sort du calcul au lieu de compter comme
 * une différence.
 */
export function calculateGlassSimilarity(a: SimilarityGlass, b: SimilarityGlass): number {
  const space = buildVectorSpace(a, b)
  if (space.axes.length === 0) return 0
  return cosineSimilarity(glassToVector(a, space), glassToVector(b, space))
}

/** Classe les montures par similarité par rapport à `reference`. Exclut la référence. */
export function rankSimilarGlasses<T extends SimilarityGlass & { barcode?: string }>(
  reference: T,
  glasses: T[],
) {
  const list = [] as { glass: T; score: number }[]
  for (const g of glasses) {
    if (reference.barcode && g.barcode && reference.barcode === g.barcode) continue
    list.push({ glass: g, score: calculateGlassSimilarity(reference, g) })
  }
  list.sort((x, y) => y.score - x.score)
  return list
}
