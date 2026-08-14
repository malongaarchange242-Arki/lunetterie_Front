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

  it('strips markdown and decorative characters before sending the chat payload', () => {
    const payload = buildAssistantPayload(
      'Stock **critique** • Pointe-Noire • 12 montures',
      [{ role: 'assistant', content: 'Réponse: **OK** — 3 montures' }],
      {
        screen: 'dashboard',
        stockSummary: [{ reference: '**REF-001**', qty_total: 12, qty_general: 8, qty_local: 2, qty_presentoir: 2, is_critical: false }],
      },
    )

    expect(payload.message).toBe('Stock critique Pointe-Noire 12 montures')
    expect(payload.history[0].content).toBe('Réponse: OK 3 montures')
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
