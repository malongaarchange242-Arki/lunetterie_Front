// Réglages "activer/désactiver" par poste, pilotés depuis la page Fonctionnalités —
// fonctionnalites.html, un poste à part entière avec sa propre connexion (SSAdmin), pas un
// module de la Direction. Chaque poste (Direction comprise) est une page Vite séparée (site
// multi-pages, cf. AGENTS.md) : ce module est importé à la fois par fonctionnalites.tsx (qui
// écrit) et par entry.tsx / vendeuse.tsx / caisse.tsx / labo.tsx / sav.tsx / responsable.tsx /
// scan.tsx / magasin.tsx (qui lisent), donc les réglages doivent passer par un canal commun
// aux deux — l'API distante est la source principale, avec un repli local transitoire.
//
export type PosteId = 'vendeuse' | 'caisse' | 'labo' | 'sav' | 'responsable' | 'magasinier' | 'direction'

export interface FeatureDef {
  id: string
  label: string
}

export const POSTE_LABELS: Record<PosteId, string> = {
  vendeuse: 'Vendeuse',
  caisse: 'Caisse',
  labo: 'Laboratoire',
  sav: 'SAV',
  responsable: 'Responsable Station',
  magasinier: 'Magasinier',
  direction: 'Direction',
}

export const POSTE_ORDER: PosteId[] = ['direction', 'vendeuse', 'caisse', 'labo', 'sav', 'responsable', 'magasinier']

// Un item par entrée de la nav/des onglets de chaque poste (NAV dans vendeuse.tsx /
// caisse.tsx / sav.tsx / scan.tsx, TABS dans labo.tsx / responsable.tsx, SIDEBAR_MODULES
// dans App.tsx) : la case à cocher désactive l'écran exactement comme il apparaît déjà dans
// le menu du poste, pas une fonctionnalité inventée à côté.
export const POSTE_FEATURES: Record<PosteId, FeatureDef[]> = {
  direction: [
    { id: 'dashboard', label: 'Tableau de bord' },
    // Chaque tuile du Tableau de bord, activable indépendamment des autres et du Tableau
    // de bord lui-même (qui reste le verrou d'accès à l'écran entier).
    { id: 'total', label: 'Total lunettes' },
    { id: 'ca', label: "Chiffre d'affaire" },
    { id: 'suivi', label: 'Suivi des lunettes' },
    { id: 'stock-initial', label: 'Stock initial (tuile)' },
    { id: 'stock-general', label: 'Stock général (tuile)' },
    { id: 'stock-magasin', label: 'Stock magasin (tuile)' },
    { id: 'labo-tuile', label: 'Labo (tuile)' },
    { id: 'reserve', label: 'Réserve (tuile)' },
    { id: 'presentoir-tuile', label: 'Présentoir (tuile)' },
    { id: 'reception', label: 'Expédition' },
    { id: 'history', label: 'Suivi Global' },
    { id: 'presentoir-bloc', label: 'Présentoir par bloc' },
  ],
  vendeuse: [
    { id: 'dashboard', label: 'Tableau de bord' },
    { id: 'proforma', label: 'Faire une proforma' },
    { id: 'ventes', label: 'Ventes & proformas' },
    { id: 'scan', label: 'Scan monture / Présentoir' },
    { id: 'bloc', label: 'Présentoir par bloc' },
    { id: 'reclamation', label: 'Réclamation' },
    { id: 'stats', label: 'Mes stats' },
  ],
  caisse: [
    { id: 'attente', label: 'À traiter' },
    { id: 'reglees', label: 'Labo payé' },
    { id: 'reserve', label: 'Réserve' },
    { id: 'journee', label: 'Inventaire' },
  ],
  labo: [
    { id: 'arrivees', label: 'Arrivées' },
    { id: 'stock', label: 'Stock Labo' },
    { id: 'afaire', label: 'À faire' },
    { id: 'prete', label: 'Montures prêtes' },
    { id: 'magasin', label: 'Magasin' },
  ],
  sav: [
    { id: 'clients', label: 'Anciens clients' },
    { id: 'proformas', label: 'Proformas à relancer' },
    { id: 'labo', label: 'Prêtes au labo' },
    { id: 'retraits', label: 'Récupérées' },
    { id: 'suivi', label: 'KPI' },
    { id: 'calendrier', label: 'Calendrier' },
  ],
  responsable: [
    { id: 'tableau', label: 'Tableau de bord' },
    { id: 'ventes', label: 'Ventes' },
    { id: 'cartons', label: 'Cartons reçus' },
    { id: 'presentoir', label: 'Scanner' },
    { id: 'remise', label: 'Remise client' },
    { id: 'bloc', label: 'Présentoir par bloc' },
    { id: 'stock', label: 'Stock' },
  ],
  magasinier: [
    { id: 'wizard', label: 'Enregistrement' },
    { id: 'listes', label: 'Listes reçues' },
    { id: 'historique', label: 'Historique' },
    { id: 'sessions', label: 'Mes sessions' },
  ],
}

const FEATURES_STORAGE_KEY = 'featureFlags'
const POSTES_STORAGE_KEY = 'posteEnabled'
export const FEATURE_FLAGS_EVENT = 'feature-flags-changed'

type FlagMap = Record<string, Record<string, boolean>>
type PosteMap = Record<string, boolean>

interface RemoteConfig {
  featureFlags: FlagMap
  posteEnabled: PosteMap
  countryEnabled: Record<string, boolean>
  cityEnabled: Record<string, boolean>
  sousStationEnabled: Record<string, Partial<Record<SousStationId, boolean>>>
}

const API_URL = import.meta.env.VITE_API_URL || 'https://api-lunetterie.universearch.com/api/v1'
let remoteConfig: RemoteConfig | null = null
let remoteLoadStarted = false

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Stockage plein ou navigation privée : le réglage ne survivra pas au rechargement,
    // mais ça ne doit pas faire planter l'écran pour autant.
  }
  // 'storage' seul ne se déclenche pas dans l'onglet qui vient d'écrire (spec navigateur) :
  // sans cet événement, la page Fonctionnalités elle-même ne verrait pas son propre clic.
  window.dispatchEvent(new Event(FEATURE_FLAGS_EVENT))
}

function localConfig(): RemoteConfig {
  return {
    featureFlags: readJSON<FlagMap>(FEATURES_STORAGE_KEY, {}),
    posteEnabled: readJSON<PosteMap>(POSTES_STORAGE_KEY, {}),
    countryEnabled: readJSON(CountryMapKey, {}),
    cityEnabled: readJSON(CityMapKey, {}),
    sousStationEnabled: readJSON(SousStationMapKey, {}),
  }
}

const CountryMapKey = 'countryEnabled'
const CityMapKey = 'cityEnabled'
const SousStationMapKey = 'sousStationEnabled'

export async function loadRemoteFlags(token = window.localStorage.getItem('token') || '') {
  if (remoteLoadStarted || !token) return
  remoteLoadStarted = true
  try {
    const response = await fetch(`${API_URL}/settings/features`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error('settings unavailable')
    const payload = await response.json().catch(() => ({}))
    const settings = payload?.data?.settings || {}
    const fallback = localConfig()
    remoteConfig = {
      featureFlags: settings.featureFlags || fallback.featureFlags,
      posteEnabled: settings.posteEnabled || fallback.posteEnabled,
      countryEnabled: settings.countryEnabled || fallback.countryEnabled,
      cityEnabled: settings.cityEnabled || fallback.cityEnabled,
      sousStationEnabled: settings.sousStationEnabled || fallback.sousStationEnabled,
    }
    window.dispatchEvent(new Event(FEATURE_FLAGS_EVENT))
  } catch {
    remoteLoadStarted = false
  }
}

function currentConfig(): RemoteConfig {
  if (!remoteConfig) void loadRemoteFlags()
  return remoteConfig || localConfig()
}

function persistConfig() {
  const token = window.localStorage.getItem('token')
  if (!remoteConfig || !token) return
  void fetch(`${API_URL}/settings/features`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(remoteConfig),
  }).catch(() => undefined)
}

export function getAllFeatureFlags(): FlagMap {
  return currentConfig().featureFlags
}

export function getAllPosteFlags(): PosteMap {
  return currentConfig().posteEnabled
}

// Absent du stockage = activé : un écran ou un poste qu'on n'a jamais touché depuis la page
// Fonctionnalités reste visible, pas besoin de le lister explicitement.
export function isFeatureEnabled(poste: PosteId, featureId: string): boolean {
  return currentConfig().featureFlags[poste]?.[featureId] !== false
}

export function setFeatureEnabled(poste: PosteId, featureId: string, enabled: boolean) {
  const config = currentConfig()
  const flags = config.featureFlags
  if (!flags[poste]) flags[poste] = {}
  flags[poste][featureId] = enabled
  if (remoteConfig) persistConfig()
  writeJSON(FEATURES_STORAGE_KEY, flags)
}

// Le poste entier, pas un de ses écrans : désactivé, il disparaît du choix de poste
// (magasin.tsx) et son propre écran refuse la connexion même en tapant l'URL directement.
export function isPosteEnabled(poste: PosteId): boolean {
  return currentConfig().posteEnabled[poste] !== false
}

export function setPosteEnabled(poste: PosteId, enabled: boolean) {
  const config = currentConfig()
  const flags = config.posteEnabled
  flags[poste] = enabled
  if (remoteConfig) persistConfig()
  writeJSON(POSTES_STORAGE_KEY, flags)
}

// Même logique, pour la géographie : un pays, une ville (= un magasin) ou une sous-station
// (Stock magasin / Présentoir / Laboratoire / Réserve) désactivée disparaît de Suivi Global
// côté Direction (PaysScreen dans App.tsx). Statique comme POSTE_LABELS/POSTE_FEATURES —
// l'enseigne n'opère qu'au Congo pour l'instant (cf. AGENTS.md) ; une nouvelle ville s'ajoute
// ici, pas depuis un formulaire, cette page n'ayant aucun accès au backend.
export type SousStationId = 'stock' | 'presentoire' | 'labo' | 'placement'

export const SOUS_STATION_LABELS: Record<SousStationId, string> = {
  stock: 'Stock magasin',
  presentoire: 'Présentoir',
  labo: 'Laboratoire',
  placement: 'Réserve',
}

export const SOUS_STATION_ORDER: SousStationId[] = ['stock', 'presentoire', 'labo', 'placement']

export interface GeoCity {
  country: string
  flag: string
  city: string
}

export const GEO_CITIES: GeoCity[] = [
  { country: 'République du Congo', flag: '🇨🇬', city: 'Brazzaville' },
  { country: 'République du Congo', flag: '🇨🇬', city: 'Pointe-Noire' },
]

const COUNTRY_STORAGE_KEY = 'countryEnabled'
const CITY_STORAGE_KEY = 'cityEnabled'
const SOUS_STATION_STORAGE_KEY = 'sousStationEnabled'

type CountryMap = Record<string, boolean>
type CityMap = Record<string, boolean>
type SousStationMap = Record<string, Partial<Record<SousStationId, boolean>>>

export function isCountryEnabled(country: string): boolean {
  return currentConfig().countryEnabled[country] !== false
}

export function setCountryEnabled(country: string, enabled: boolean) {
  const flags = currentConfig().countryEnabled
  flags[country] = enabled
  if (remoteConfig) persistConfig()
  writeJSON(COUNTRY_STORAGE_KEY, flags)
}

export function isCityEnabled(city: string): boolean {
  return currentConfig().cityEnabled[city] !== false
}

export function setCityEnabled(city: string, enabled: boolean) {
  const flags = currentConfig().cityEnabled
  flags[city] = enabled
  if (remoteConfig) persistConfig()
  writeJSON(CITY_STORAGE_KEY, flags)
}

export function isSousStationEnabled(city: string, sousStation: SousStationId): boolean {
  return currentConfig().sousStationEnabled[city]?.[sousStation] !== false
}

export function setSousStationEnabled(city: string, sousStation: SousStationId, enabled: boolean) {
  const flags = currentConfig().sousStationEnabled
  if (!flags[city]) flags[city] = {}
  flags[city][sousStation] = enabled
  if (remoteConfig) persistConfig()
  writeJSON(SOUS_STATION_STORAGE_KEY, flags)
}
