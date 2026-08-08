import { describe, expect, it } from 'vitest'
import { buildAssistantPayload, mapChatActionToScreen } from './chatContext'

describe('buildAssistantPayload', () => {
  it('includes the message, history and a context block with the current screen and stock summary', () => {
    const payload = buildAssistantPayload(
      'Combien de montures en stock ?',
      [{ role: 'assistant', content: 'Bonjour' }],
      {
        screen: 'dashboard',
        stockSummary: [{ reference: 'REF-001', qty_total: 12, qty_general: 8, qty_local: 2, qty_presentoir: 2, is_critical: false }],
      },
    )

    expect(payload.message).toBe('Combien de montures en stock ?')
    expect(payload.history).toHaveLength(1)
    expect(payload.context.screen).toBe('dashboard')
    expect(payload.context.stockSummary[0].reference).toBe('REF-001')
  })
})

describe('mapChatActionToScreen', () => {
  it('maps known assistant actions to app navigation targets', () => {
    expect(mapChatActionToScreen({ type: 'navigate', page: 'employes' })).toEqual({ type: 'module', id: 'employees' })
    expect(mapChatActionToScreen({ type: 'navigate', page: 'ca' })).toEqual({ type: 'pays', block: 'ca' })
    expect(mapChatActionToScreen({ type: 'navigate', page: 'inconnu' })).toBeNull()
  })
})
