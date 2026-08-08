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
