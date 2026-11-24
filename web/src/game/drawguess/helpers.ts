const normalizeGuess = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[《》「」"'`.,，。！？!?、\s]+/g, '')

export const isGuessMatch = (guess: string, answer: string): boolean => {
  const g = normalizeGuess(guess)
  const a = normalizeGuess(answer)
  if (!g || !a) {
    return false
  }
  return g === a || (a.length >= 2 && g.includes(a))
}

/** 清理 AI 生成或用户输入的 HTML，移除脚本与内联事件确保沙箱安全 */
export const sanitizeDrawingHtml = (raw: string): string =>
  raw
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(".*?"|'.*?'|[^\s>]+)/gi, '')
    .trim()
