import { MEMORY_BUDGET_CHARS } from '../persona/types.js'
import type { Memory } from './types.js'

const tokenize = (text: string): Set<string> => {
  const normalized = text.toLowerCase().trim()
  const tokens = new Set<string>()
  if (!normalized) {
    return tokens
  }
  // 英文/数字词元
  for (const word of normalized.match(/[a-z0-9_]+/g) ?? []) {
    if (word.length >= 2) {
      tokens.add(word)
    }
  }
  // 中文连续字块二元分词
  for (const chunk of normalized.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (chunk.length === 1) {
      tokens.add(chunk)
    } else {
      for (let i = 0; i < chunk.length - 1; i += 1) {
        tokens.add(chunk.slice(i, i + 2))
      }
    }
  }
  return tokens
}

const overlapScore = (queryTokens: Set<string>, content: string): number => {
  if (queryTokens.size === 0) {
    return 0
  }
  const contentTokens = tokenize(content)
  let hits = 0
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      hits += 1
    }
  }
  return hits
}

export const selectMemories = (
  memories: readonly Memory[],
  query: string,
  budgetChars = MEMORY_BUDGET_CHARS
): Memory[] => {
  const candidates = memories.filter((memory) => memory.enabled && memory.content.trim().length > 0)
  if (candidates.length === 0) {
    return []
  }

  const totalChars = candidates.reduce((sum, item) => sum + item.content.length, 0)
  if (candidates.length <= 50 && totalChars <= budgetChars) {
    return [...candidates].sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1
      }
      return (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt)
    })
  }

  const queryTokens = tokenize(query)
  const scored = candidates
    .map((memory) => ({
      memory,
      score: overlapScore(queryTokens, memory.content),
      recency: memory.lastUsedAt ?? memory.updatedAt,
    }))
    .sort((a, b) => {
      if (a.memory.pinned !== b.memory.pinned) {
        return a.memory.pinned ? -1 : 1
      }
      if (a.score !== b.score) {
        return b.score - a.score
      }
      return b.recency - a.recency
    })

  const selected: Memory[] = []
  let usedChars = 0
  for (const item of scored) {
    const len = item.memory.content.length
    if (selected.length > 0 && usedChars + len > budgetChars) {
      continue
    }
    if (len <= budgetChars) {
      selected.push(item.memory)
      usedChars += len
    }
  }
  return selected
}
