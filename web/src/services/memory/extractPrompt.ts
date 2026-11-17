import type { Memory } from './types.js'

export const EXTRACT_SYSTEM_PROMPT = [
  '你是一个长期记忆提炼器。你的任务是从用户与助手的近期对话中，提炼出稳定、长期有用的用户信息，并以严格的 JSON 数组输出。',
  '',
  '【提炼标准】',
  '1. 只提炼稳定、长期有用的信息：用户的身份背景、称呼、职业/专业、长期偏好（习惯、饮食/风格禁忌等）、进行中的长期项目、以及用户明确提出的“记住……/以后都……”要求。',
  '2. 绝对不要提炼：一次性的临时任务（如“帮我翻译这段话”）、模型自己的猜测或回答内容、他人隐私、身份证号、银行卡号、密码、精确家庭住址、敏感健康隐私（除非用户明确要求记住）。',
  '3. 若新信息与已有记忆冲突，输出 op: "update" 并带上对应 id；若用户明确表示“不要再记某件事/忘掉某件事”，输出 op: "delete" 并带上对应 id。',
  '4. 每次最多输出 5 条，每条 content 不超过 80 字，统一使用第三人称陈述句（例如“用户主要使用 TypeScript”）。',
  '5. category 取值仅限："profile" | "preference" | "project" | "other"。',
  '6. 如果没有值得长期记住的新信息，直接输出空数组 []。',
  '7. 只输出合法的 JSON 数组，不要输出任何解释、前导词或 Markdown 代码块之外的多余文字。',
].join('\n')

export const buildExtractUserPrompt = (
  existingMemories: readonly Memory[],
  turns: readonly { role: 'user' | 'assistant'; content: string }[]
): string => {
  const memLines =
    existingMemories.length > 0
      ? existingMemories
          .slice(0, 60)
          .map((m) => `- [${m.id}] (${m.category}) ${m.content}`)
          .join('\n')
      : '（暂无已有记忆）'

  const dialogLines = turns
    .slice(-10)
    .map((t) => `${t.role === 'user' ? '用户' : '助手'}：${t.content.slice(0, 600)}`)
    .join('\n\n')

  return [
    '## 已有记忆',
    memLines,
    '',
    '## 近期对话',
    dialogLines,
    '',
    '请输出 JSON 数组：[{"op":"add"|"update"|"delete","id"?:string,"content"?:string,"category"?:"profile"|"preference"|"project"|"other"}]',
  ].join('\n')
}
