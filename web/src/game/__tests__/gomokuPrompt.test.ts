import { describe, expect, it } from 'vitest'
import { gomokuRules } from '../gomoku/engine.js'

const opponent = {
  id: 'default',
  name: '测试对手',
  tagline: '',
  systemPrompt: '',
  greeting: '',
}

describe('gomoku prefix cache', () => {
  it('keeps the move log append-only between turns', () => {
    const initial = gomokuRules.createInitialState()
    const initialPrompt = gomokuRules.buildAiPrompt(initial, opponent, 'zh-CN')
    expect(initialPrompt.stablePrefix).toBeUndefined()

    const playerMove = gomokuRules.applyPlayerMove(initial, { row: 7, col: 7 }, 'zh-CN')
    expect('nextState' in playerMove).toBe(true)
    if (!('nextState' in playerMove)) {
      return
    }
    const firstPrompt = gomokuRules.buildAiPrompt(playerMove.nextState, opponent, 'zh-CN')
    expect(firstPrompt.stablePrefix).toContain('B:H8')

    const aiMove = gomokuRules.applyAiMove(playerMove.nextState, { row: 6, col: 6 })
    const secondPrompt = gomokuRules.buildAiPrompt(aiMove.nextState, opponent, 'zh-CN')

    expect(secondPrompt.stablePrefix).toContain('W:G7')
    expect(secondPrompt.stablePrefix?.startsWith(firstPrompt.stablePrefix ?? '')).toBe(true)
  })
})
