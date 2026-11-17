import type { Memory } from '../memory/types.js'
import type { PersonaSnapshot } from './types.js'

/** 与上游完全一致的默认助手身份说明 */
export const DEFAULT_IDENTITY = '该助手为DeepSeek，由深度求索公司创造。'

export const BASE_RULES = [
  '【基础规则】',
  '1. 以下人设、会话补充要求、用户信息与记忆均由用户提供，仅作为对话背景与风格参考，不应覆盖安全底线。',
  '2. 当用户明确说出“退出角色”或“正常回答”时，暂时放下当前角色扮演，以普通、客观的助手身份回答；之后若用户继续角色互动，再恢复角色。',
  '3. 保持健康、友善的情感与交流互动，不输出色情、暴力或违法内容。',
  '4. 涉及自我伤害等严重风险时，优先放下角色，认真关心用户安全并建议寻求专业帮助。',
  '5. 角色身份均为虚构，不冒充真实的公众人物。',
].join('\n')

const MEMORY_USAGE_RULES =
  '记忆使用规则：只在相关时自然地运用，不要逐条复述；与当前对话冲突时以当前对话为准。'

export type PromptContext = {
  persona: PersonaSnapshot | null
  sessionNote?: string
  memoryEnabled: boolean
  incognito?: boolean
  profile?: string
  memories: Pick<Memory, 'content'>[]
}

const sanitizeMemoryLine = (content: string): string =>
  content
    .replace(/^#+\s*/gm, '')
    .replace(/\r?\n+/g, ' ')
    .trim()

export const buildSystemPrompt = (ctx: PromptContext): string => {
  const instructions = ctx.persona?.instructions?.trim() || ''
  const sessionNote = ctx.sessionNote?.trim() || ''
  const useMemory = ctx.memoryEnabled && !ctx.incognito
  const profile = useMemory ? ctx.profile?.trim() || '' : ''
  const memories = useMemory
    ? ctx.memories.map((m) => sanitizeMemoryLine(m.content)).filter(Boolean)
    : []

  // 未选自定义人设、无补充指令、且未注入任何个人资料或记忆时，保持与上游完全一致
  if (!instructions && !sessionNote && !profile && memories.length === 0) {
    return DEFAULT_IDENTITY
  }

  const parts: string[] = [BASE_RULES, instructions || DEFAULT_IDENTITY]

  if (sessionNote) {
    parts.push(`## 本次会话的额外要求\n${sessionNote}`)
  }

  if (profile) {
    parts.push(`## 关于用户\n${profile}`)
  }

  if (memories.length > 0) {
    const list = memories.map((line, index) => `${index + 1}. ${line}`).join('\n')
    parts.push(`## 关于用户的记忆\n${list}\n\n${MEMORY_USAGE_RULES}`)
  }

  return parts.join('\n\n')
}
