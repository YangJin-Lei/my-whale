/** 检测可能包含证件号、银行卡号、手机号、密码等敏感信息的文本 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  // 中国大陆 18 位身份证号
  /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/,
  // 16~19 位银行卡号（允许空格或短横线分隔）
  /(?<!\d)(?:\d[ -]?){15,18}\d(?!\d)/,
  // 中国大陆 11 位手机号
  /(?<!\d)1[3-9]\d{9}(?!\d)/,
  // 密码 / 口令 / 密钥字样
  /(?:密码|口令|password|passwd|secret|api[_ -]?key)\s*[:：=]\s*\S+/i,
  // sk- API Key
  /sk-[A-Za-z0-9_-]{16,}/,
]

export const hasSensitiveInfo = (text: string): boolean =>
  SENSITIVE_PATTERNS.some((pattern) => pattern.test(text))
