export interface ChatHistoryItem {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatContextState {
  screen?: string
  stockSummary?: Array<{
    reference?: string | null
    brand?: string | null
    qty_general?: number
    qty_local?: number
    qty_presentoir?: number
    qty_total?: number
    is_critical?: boolean
  }>
  summary?: Record<string, unknown>
  /** Digest complet (montures, mouvements, employés…), étalé à la racine du contexte. */
  digest?: Record<string, unknown>
}

export interface AssistantDigestInput {
  glasses: any[]
  movements: any[]
  users: any[]
  stations: any[]
  receptionCommands: any[]
  supplierOrders: any[]
}

// Statuts comptés comme « stock actif », par opposition à vendue/perdue/cassée/retournée.
// La liste brute `toutes_les_montures` garde TOUS les statuts : c'est le champ `status`
// de chaque entrée qui permet au chatbot de filtrer lui-même.
const ACTIVE_GLASS_STATUSES = [
  'RECU_FOURNISSEUR', 'EN_STOCK_GENERAL', 'EN_TRANSIT', 'EN_STOCK_SOUS_STATION',
  'EN_PRESENTOIR', 'RESERVEE', 'EN_LABORATOIRE', 'PRETE_A_LIVRER',
]

function countBy<T>(list: T[], keyFn: (item: T) => unknown) {
  const counts: Record<string, number> = {}
  for (const item of list) {
    const raw = keyFn(item)
    const key = raw === null || raw === undefined || raw === '' ? 'Non renseigné' : String(raw)
    counts[key] = (counts[key] || 0) + 1
  }
  return counts
}

function categoryBreakdown(list: any[]) {
  return {
    par_forme: countBy(list, g => g.shape),
    par_couleur: countBy(list, g => g.color),
    par_matiere: countBy(list, g => g.material),
    par_genre: countBy(list, g => g.gender),
    par_marque: countBy(list, g => g.brand),
    par_taille: countBy(list, g => g.size),
  }
}

function glassSummary(glass: any) {
  return {
    barcode: glass.barcode,
    reference: glass.reference,
    station: glass.station_name,
    emplacement: glass.location_code,
    status: glass.status,
    shape: glass.shape,
    color: glass.color,
    material: glass.material,
    gender: glass.gender,
    size: glass.size,
    brand: glass.brand,
    price: glass.price,
    enregistre_le: glass.created_at,
  }
}

// Construit le digest envoyé au chatbot. Même forme que buildAssistantContext() de
// direction.js, à laquelle le prompt système du service IA fait explicitement référence
// (`toutes_les_montures`, `mouvements`…) — s'en écarter revient à priver le chatbot des
// données qu'il croit avoir.
export function buildStockDigest(input: AssistantDigestInput) {
  const glasses = input.glasses || []
  const movements = input.movements || []

  const stockActif = glasses.filter(g => ACTIVE_GLASS_STATUSES.includes(String(g.status)))
  const vendues = glasses.filter(g => String(g.status) === 'VENDUE')

  return {
    // Horodatage complet : sans lui le chatbot ne peut pas répondre à « ce matin ».
    maintenant: new Date().toISOString(),
    today: new Date().toISOString().slice(0, 10),

    stations: (input.stations || []).map((s: any) => ({ id: s.id, name: s.name, type: s.type })),

    // Nom/rôle/poste/statut uniquement : ni téléphone ni e-mail ne partent vers l'API tierce.
    employees: (input.users || []).map((u: any) => ({
      name: `${String(u.first_name || '').trim()} ${String(u.last_name || '').trim()}`.trim(),
      role: u.role_name || u.role,
      poste: u.station_name || 'Non assigné',
      status: u.is_active ? 'Actif' : 'Inactif',
    })),

    stock_actuel: {
      total_global: glasses.length,
      total_actif: stockActif.length,
      par_statut: countBy(glasses, g => g.status),
      par_station: countBy(stockActif, g => g.station_name),
      par_categorie: categoryBreakdown(stockActif),
    },

    toutes_les_montures: glasses.map(glassSummary),

    ventes_par_categorie: categoryBreakdown(vendues),
    total_ventes: vendues.length,

    // created_at est laissé en ISO complet (date ET heure) pour les questions horaires.
    mouvements: movements.map((m: any) => ({
      date: m.created_at,
      action: m.action,
      barcode: m.barcode,
      reference: m.reference,
      from: m.from_station_name,
      to: m.to_station_name,
      operateur: `${String(m.user_first_name || '').trim()} ${String(m.user_last_name || '').trim()}`.trim() || 'Système',
    })),
    mouvements_par_jour: countBy(movements, (m: any) => String(m.created_at || '').slice(0, 10)),

    sessions_reception: input.receptionCommands || [],
    commandes_fournisseur: input.supplierOrders || [],
  }
}

export interface ChatActionPayload {
  type: string
  page?: string
}

export function buildAssistantPayload(message: string, history: ChatHistoryItem[], context: ChatContextState) {
  return {
    message,
    history: history.map(item => ({ role: item.role, content: item.content })),
    context: {
      screen: context.screen || 'dashboard',
      stockSummary: context.stockSummary || [],
      summary: context.summary || {},
      // Étalé à la racine : le prompt système nomme ses clés directement (`mouvements`,
      // `toutes_les_montures`…), pas via un sous-objet.
      ...(context.digest || {}),
    },
  }
}

export function mapChatActionToScreen(action: ChatActionPayload) {
  const pageMap: Record<string, { type: 'module'; id: 'employees' | 'history' | 'reception' | 'orders' | 'supplier' } | { type: 'pays'; block: 'total' | 'ca' | 'suivi' }> = {
    employes: { type: 'module', id: 'employees' },
    historique: { type: 'module', id: 'history' },
    reception: { type: 'module', id: 'reception' },
    commandes: { type: 'module', id: 'orders' },
    fournisseur: { type: 'module', id: 'supplier' },
    ca: { type: 'pays', block: 'ca' },
    lunettes: { type: 'pays', block: 'total' },
    suivi: { type: 'pays', block: 'suivi' },
  }

  return pageMap[action.page || ''] ?? null
}
