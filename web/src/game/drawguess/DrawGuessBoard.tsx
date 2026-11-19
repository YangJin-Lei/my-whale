import clsx from 'clsx'
import { useEffect, useRef, useState } from 'react'
import { ensureApiKey } from '../../components/settings/settingsDialogState.js'
import { showToast } from '../../components/base/toastState.js'
import { useTranslate } from '../../i18n/index.js'
import { streamMessage, uploadFile } from '../../services/api/client.js'
import type { MessageParam } from '../../services/api/types.js'
import { writeClipboardText } from '../../services/clipboard.js'
import { useSettings } from '../../services/settings.js'
import { resolveCurrentOpponent } from '../opponents.js'
import { updateGameFeedback, useGameStore } from '../store.js'
import type { BoardComponentProps } from '../types.js'
import styles from './DrawGuess.module.css'
import {
  type DrawGuessMove,
  type DrawGuessState,
  IDIOM_PRESETS,
  isGuessMatch,
  sanitizeDrawingHtml,
} from './index.js'

const COLORS = ['#0f172a', '#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#9333ea'] as const
const DEFAULT_HTML_TEMPLATE = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fffdf7;">
  <svg viewBox="0 0 260 180" width="260" height="180">
    <path d="M40 130 Q100 40 160 120 T220 90" fill="none" stroke="#16a34a" stroke-width="8" stroke-linecap="round"/>
    <circle cx="220" cy="90" r="8" fill="#16a34a"/>
    <path d="M120 112 L105 148 M142 115 L155 150" stroke="#ef4444" stroke-width="5" stroke-linecap="round"/>
  </svg>
</div>`

const stripJsonFences = (raw: string): string => {
  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const a = clean.indexOf('{')
  const b = clean.lastIndexOf('}')
  return a !== -1 && b > a ? clean.slice(a, b + 1) : clean
}

const canvasToPngFile = (canvas: HTMLCanvasElement): Promise<File> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to export drawing'))
        return
      }
      resolve(new File([blob], 'drawing.png', { type: 'image/png' }))
    }, 'image/png')
  })

const renderHtmlToPngFile = async (html: string): Promise<File | null> => {
  try {
    const safe = sanitizeDrawingHtml(html)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="340"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:520px;height:340px;background:#ffffff;overflow:hidden;">${safe}</div></foreignObject></svg>`
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('HTML rasterize failed'))
      el.src = dataUrl
    })
    const offscreen = document.createElement('canvas')
    offscreen.width = 520
    offscreen.height = 340
    const ctx = offscreen.getContext('2d')
    if (!ctx) {
      return null
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 520, 340)
    ctx.drawImage(img, 0, 0)
    return await canvasToPngFile(offscreen)
  } catch {
    return null
  }
}

export const DrawGuessBoard = ({
  state,
  onPlayerMove,
}: BoardComponentProps<DrawGuessState, DrawGuessMove>) => {
  const t = useTranslate()
  const locale = useSettings((s) => s.locale)
  const thinkingMode = useGameStore((s) => s.thinkingMode)
  const aiThinking = useGameStore((s) => s.aiThinking)

  const [mode, setMode] = useState<'canvas' | 'html'>('canvas')
  const [answerInput, setAnswerInput] = useState('')
  const [htmlInput, setHtmlInput] = useState(DEFAULT_HTML_TEMPLATE)
  const [guessInput, setGuessInput] = useState('')
  const [brushColor, setBrushColor] = useState<string>(COLORS[0])
  const [brushWidth, setBrushWidth] = useState<number>(5)
  const [eraser, setEraser] = useState(false)
  const [showAiCode, setShowAiCode] = useState(false)
  const [pickingIdiom, setPickingIdiom] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const undoFramesRef = useRef<ImageData[]>([])
  const drawingRef = useRef<{ active: boolean; x: number; y: number }>({
    active: false,
    x: 0,
    y: 0,
  })
  const abortRef = useRef<AbortController | null>(null)

  const initBlankCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    undoFramesRef.current = []
  }

  useEffect(() => {
    if (state.drawer === 'player' && mode === 'canvas') {
      initBlankCanvas()
    }
  }, [state.round, state.drawer, mode])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const getCanvasPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) {
      return { x: 0, y: 0 }
    }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (aiThinking) {
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    undoFramesRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (undoFramesRef.current.length > 20) {
      undoFramesRef.current.shift()
    }
    const pt = getCanvasPoint(event.clientX, event.clientY)
    drawingRef.current = { active: true, x: pt.x, y: pt.y }
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, (eraser ? 14 : brushWidth) / 2, 0, Math.PI * 2)
    ctx.fillStyle = eraser ? '#ffffff' : brushColor
    ctx.fill()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current.active) {
      return
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      return
    }
    const pt = getCanvasPoint(event.clientX, event.clientY)
    ctx.beginPath()
    ctx.moveTo(drawingRef.current.x, drawingRef.current.y)
    ctx.lineTo(pt.x, pt.y)
    ctx.strokeStyle = eraser ? '#ffffff' : brushColor
    ctx.lineWidth = eraser ? 14 : brushWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    drawingRef.current.x = pt.x
    drawingRef.current.y = pt.y
  }

  const handlePointerUp = () => {
    drawingRef.current.active = false
  }

  const undoStroke = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const prev = undoFramesRef.current.pop()
    if (ctx && prev) {
      ctx.putImageData(prev, 0, 0)
    }
  }

  const streamSingleJsonCall = async (
    apiKey: string,
    systemPrompt: string,
    messages: MessageParam[],
    signal: AbortSignal
  ): Promise<{ text: string; thought: string }> => {
    let text = ''
    let thought = ''
    const events = streamMessage(
      apiKey,
      {
        model: 'deepseek-flash',
        system: systemPrompt,
        messages,
        thinking: { type: thinkingMode ? 'enabled' : 'disabled' },
        safety_check: { level: 'high' },
      },
      signal
    )
    for await (const ev of events) {
      if (ev.type !== 'content_block_delta') {
        continue
      }
      if (ev.delta.type === 'text_delta') {
        text += ev.delta.text
      } else if (ev.delta.type === 'thinking_delta') {
        thought += ev.delta.thinking
        updateGameFeedback({ thoughtText: thought.trim() })
      }
    }
    return { text, thought }
  }

  /** AI 作为画方：生成一道隐藏答案 + 纯 HTML/SVG 画面 */
  const generateAiHtmlDrawing = async (
    baseState: DrawGuessState,
    apiKey: string,
    signal: AbortSignal
  ) => {
    const opponent = resolveCurrentOpponent(locale)
    updateGameFeedback({
      aiThinking: true,
      bubbleText:
        locale === 'zh-CN' ? '我来画一幅图考考你，正在写画面…' : 'Sketching a puzzle for you…',
      thoughtText: '',
      errorText: null,
    })

    const sys =
      locale === 'zh-CN'
        ? `你是「${opponent.name}」（${opponent.systemPrompt}），现在玩你画我猜并且轮到你【画图出题】。\n请自由构思任意一个适合用画面表现的成语或俗语（不必局限于常见那几个，尽量有新意、好分辨），并用纯静态 HTML+SVG 画出来。\n要求：简单一些的，不需要复杂动效，不可以出现任何提示（绝不要在 HTML/SVG 中写汉字、拼音、字母提示），只需要描述这个词语的画面就好了，只画，不加 script 标签。\n严格输出 JSON：{"answer":"成语","hint":"简短类别提示","html":"<div style='width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#fff;'>...<svg viewBox='0 0 260 180'>...</svg></div>","speech":"我画好了，猜猜这是什么成语？"}`
        : `You are ${opponent.name}. Freely invent ANY vivid, drawable idiom or phrase (do not repeat cliché ones) and draw it cleanly with simple static HTML+SVG (no complex animation, no text/letter hints inside HTML, no <script>, just illustrate the concept). Output ONLY JSON: {"answer":"...","hint":"...","html":"...","speech":"..."}`

    const { text, thought } = await streamSingleJsonCall(
      apiKey,
      sys,
      [{ role: 'user', content: locale === 'zh-CN' ? '请开始画一题。' : 'Draw one puzzle now.' }],
      signal
    )

    const parsed = JSON.parse(stripJsonFences(text)) as {
      answer?: string
      hint?: string
      html?: string
      speech?: string
    }
    const answer = (parsed.answer ?? '画蛇添足').trim()
    const html = sanitizeDrawingHtml(parsed.html || DEFAULT_HTML_TEMPLATE)
    const hint = (parsed.hint ?? (locale === 'zh-CN' ? '四字成语' : 'Idiom')).trim()
    const speech = (
      parsed.speech || (locale === 'zh-CN' ? '画好啦，你来猜猜看！' : 'Done drawing—your guess!')
    ).trim()

    updateGameFeedback({
      aiThinking: false,
      bubbleText: speech,
      thoughtText: thought.trim(),
      speechToSpeak: speech,
    })

    onPlayerMove({
      ...baseState,
      aiPuzzle: { answer, hint, html },
    })
  }

  /** 用户画好并输入标准答案 -> 上传图片让 DeepSeek 识图猜测 */
  const submitDrawingToAi = async () => {
    const answer = answerInput.trim()
    if (!answer) {
      updateGameFeedback({
        errorText:
          locale === 'zh-CN' ? '请先输入标准答案（建议四字成语）' : 'Enter the target answer first',
      })
      return
    }
    if (!ensureApiKey()) {
      return
    }

    const apiKey = useSettings.getState().apiKey ?? ''
    const opponent = resolveCurrentOpponent(locale)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    updateGameFeedback({
      aiThinking: true,
      errorText: null,
      bubbleText: locale === 'zh-CN' ? '让我想想你画的是什么…' : 'Inspecting your drawing…',
      thoughtText: '',
    })

    try {
      let imageFile: File | null = null
      if (mode === 'canvas' && canvasRef.current) {
        imageFile = await canvasToPngFile(canvasRef.current)
      } else {
        imageFile = await renderHtmlToPngFile(htmlInput)
      }

      const contentBlocks: Array<
        | { type: 'image'; source: { type: 'file'; file_id: string } }
        | { type: 'text'; text: string }
      > = []

      if (imageFile) {
        const uploaded = await uploadFile(apiKey, imageFile, null, controller.signal)
        contentBlocks.push({ type: 'image', source: { type: 'file', file_id: uploaded.id } })
      }

      const promptText =
        mode === 'html'
          ? locale === 'zh-CN'
            ? `这是对方用画板/HTML 画出的谜题（附画面与 HTML 片段供辅助理解）：\n${htmlInput.slice(
                0,
                1600
              )}\n请猜这是什么成语或词语（优先四字成语），直接返回 JSON：{"guess":"你的猜测词","thoughtSummary":"看图依据","speech":"口语猜测台词"}。`
            : `Guess the idiom/word depicted in this drawing + HTML:\n${htmlInput.slice(
                0,
                1600
              )}\nReturn JSON: {"guess":"...","thoughtSummary":"...","speech":"..."}.`
          : locale === 'zh-CN'
            ? '请认真观察图片里的绘画内容，猜这是什么成语或词语（优先考虑四字成语），直接返回 JSON：{"guess":"你的猜测词","thoughtSummary":"简短看图依据","speech":"口语猜测台词"}。'
            : 'Look at this drawing and guess the word/idiom. Return JSON: {"guess":"...","thoughtSummary":"...","speech":"..."}.'

      contentBlocks.push({ type: 'text', text: promptText })

      const sys =
        locale === 'zh-CN'
          ? `你是「${opponent.name}」（${opponent.systemPrompt}），正在和人类玩家玩你画我猜。严格只返回 JSON：{"guess":"...", "thoughtSummary":"...", "speech":"..."}。`
          : `You are ${opponent.name} playing Draw & Guess. Return ONLY JSON: {"guess":"...","thoughtSummary":"...","speech":"..."}.`

      const { text, thought } = await streamSingleJsonCall(
        apiKey,
        sys,
        [{ role: 'user', content: contentBlocks }],
        controller.signal
      )

      const parsed = JSON.parse(stripJsonFences(text)) as {
        guess?: string
        thoughtSummary?: string
        speech?: string
      }
      const guess = (parsed.guess ?? '').trim()
      const correct = isGuessMatch(guess, answer)

      const resultLine = correct
        ? locale === 'zh-CN'
          ? `哈哈，我猜到了！是「${answer}」吧？接下来换我画一幅！`
          : `Got it! "${answer}"! Now it's my turn to draw.`
        : locale === 'zh-CN'
          ? `我猜是「${guess || '...'}」……不对吗？快告诉我标准答案吧！`
          : `Is it "${guess}"? Oh, show me the answer!`

      updateGameFeedback({
        aiThinking: false,
        bubbleText: parsed.speech || resultLine,
        thoughtText: [parsed.thoughtSummary, thought].filter(Boolean).join('\n\n'),
        speechToSpeak: parsed.speech || resultLine,
      })

      setAnswerInput('')
      const nextBase: DrawGuessState = {
        round: state.round + 1,
        drawer: correct ? 'ai' : 'player',
        playerScore: state.playerScore,
        aiScore: state.aiScore + (correct ? 1 : 0),
        aiPuzzle: null,
        lastReveal: {
          round: state.round,
          drawer: 'player',
          answer,
          guess,
          correct,
        },
      }
      onPlayerMove(nextBase)

      // 若 AI 猜对赢下此局，由胜方（AI）出下一道 HTML 题
      if (correct) {
        await generateAiHtmlDrawing(nextBase, apiKey, controller.signal)
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return
      }
      updateGameFeedback({
        aiThinking: false,
        errorText: error instanceof Error ? error.message : t('retry'),
      })
    }
  }

  /** 用户提交对 AI 所画 HTML 的猜测 */
  const submitHumanGuess = (skipReveal = false) => {
    if (!state.aiPuzzle) {
      return
    }
    const { answer } = state.aiPuzzle
    const guess = skipReveal ? '' : guessInput.trim()
    if (!skipReveal && !guess) {
      return
    }
    const correct = !skipReveal && isGuessMatch(guess, answer)
    const msg = correct
      ? locale === 'zh-CN'
        ? `答对啦！就是「${answer}」，下一轮归你画！`
        : `Correct! "${answer}" — your turn to draw!`
      : locale === 'zh-CN'
        ? `我画的标准答案是「${answer}」哦，再来一局！`
        : `The answer was "${answer}". Next round!`

    updateGameFeedback({
      bubbleText: msg,
      speechToSpeak: msg,
      errorText: null,
    })
    setGuessInput('')
    setShowAiCode(false)

    const nextBase: DrawGuessState = {
      round: state.round + 1,
      drawer: correct ? 'player' : 'ai',
      playerScore: state.playerScore + (correct ? 1 : 0),
      aiScore: state.aiScore,
      aiPuzzle: null,
      lastReveal: {
        round: state.round,
        drawer: 'ai',
        answer,
        guess,
        correct,
      },
    }
    onPlayerMove(nextBase)

    if (!correct && ensureApiKey()) {
      const apiKey = useSettings.getState().apiKey ?? ''
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      void generateAiHtmlDrawing(nextBase, apiKey, controller.signal).catch(() => {
        updateGameFeedback({ aiThinking: false })
      })
    }
  }

  const downloadHtml = (html: string, filename: string) => {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const pickRandomIdiom = () => {
    const candidate = IDIOM_PRESETS[Math.floor(Math.random() * IDIOM_PRESETS.length)]
    setAnswerInput(candidate)
  }

  /** 让 AI 自由构思一个未局限在固定词表里的适合绘画成语 */
  const askAiForIdiom = async () => {
    if (pickingIdiom || aiThinking || !ensureApiKey()) {
      return
    }
    const apiKey = useSettings.getState().apiKey ?? ''
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPickingIdiom(true)
    try {
      const sys =
        locale === 'zh-CN'
          ? '请自由构思一个适合你画我猜、画面具象且有新意的四字成语或常见词语（不要只局限于画蛇添足、守株待兔那几个固定词），严格只返回 JSON：{"idiom":"词语"}。'
          : 'Invent a vivid, concrete idiom or phrase ideal for Pictionary (do not stick to clichés). Return ONLY JSON: {"idiom":"..."}.'
      const { text } = await streamSingleJsonCall(
        apiKey,
        sys,
        [
          {
            role: 'user',
            content: locale === 'zh-CN' ? '帮我想一个新词' : 'Give me one fresh phrase',
          },
        ],
        controller.signal
      )
      const parsed = JSON.parse(stripJsonFences(text)) as { idiom?: string }
      const next = (parsed.idiom ?? '').trim()
      if (next) {
        setAnswerInput(next)
      } else {
        pickRandomIdiom()
      }
    } catch {
      if (!controller.signal.aborted) {
        pickRandomIdiom()
      }
    } finally {
      setPickingIdiom(false)
    }
  }

  /** 一键复制给 AI 生成画图 HTML 的提示词，空输入时保留 [user_input] 占位 */
  const copyDrawingPrompt = async () => {
    const target = answerInput.trim() || '[user_input]'
    const prompt =
      locale === 'zh-CN'
        ? `请用纯静态 HTML + SVG 画一幅图表达：${target}。要求：简单一些的，不需要复杂动效，不可以出现任何提示，只需要描述这个词语就好了，只画。不要加 <script> 或多余解释。`
        : `Draw "${target}" using simple static HTML + SVG: keep it simple, no complex animations, no text hints or labels at all, just visually depict the word only (no <script> or extra text).`
    await writeClipboardText(prompt)
    showToast({ key: 'copied' })
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.scoreBar}>
        <span>{locale === 'zh-CN' ? `第 ${state.round} 轮` : `Round ${state.round}`}</span>
        <span>
          {locale === 'zh-CN'
            ? `你 ${state.playerScore} : ${state.aiScore} AI`
            : `You ${state.playerScore} : ${state.aiScore} AI`}
        </span>
        <span className={styles.turnTag}>
          {state.drawer === 'player'
            ? locale === 'zh-CN'
              ? '你画 AI 猜'
              : 'You Draw'
            : locale === 'zh-CN'
              ? 'AI 画你猜'
              : 'AI Draws'}
        </span>
      </div>

      {state.drawer === 'player' ? (
        <>
          <div className={styles.modeTabs}>
            <button
              type="button"
              className={clsx(styles.tabBtn, mode === 'canvas' && styles.tabBtnActive)}
              onClick={() => setMode('canvas')}
            >
              {locale === 'zh-CN' ? '手绘白板' : 'Canvas'}
            </button>
            <button
              type="button"
              className={clsx(styles.tabBtn, mode === 'html' && styles.tabBtnActive)}
              onClick={() => setMode('html')}
            >
              {locale === 'zh-CN' ? 'HTML 程序画图' : 'HTML Code'}
            </button>
          </div>

          {mode === 'canvas' ? (
            <div className={styles.canvasCard}>
              <div className={styles.toolRow}>
                <div className={styles.colorList}>
                  {COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      className={clsx(
                        styles.colorDot,
                        !eraser && brushColor === color && styles.colorDotActive
                      )}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setEraser(false)
                        setBrushColor(color)
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className={clsx(styles.toolBtn, eraser && styles.toolBtnActive)}
                  onClick={() => setEraser((prev) => !prev)}
                >
                  {locale === 'zh-CN' ? '橡皮' : 'Eraser'}
                </button>
                <button
                  type="button"
                  className={styles.toolBtn}
                  onClick={() => setBrushWidth((prev) => (prev === 5 ? 11 : 5))}
                >
                  {brushWidth === 5 ? '细笔' : '粗笔'}
                </button>
                <button type="button" className={styles.toolBtn} onClick={undoStroke}>
                  {locale === 'zh-CN' ? '撤销' : 'Undo'}
                </button>
                <button type="button" className={styles.toolBtn} onClick={initBlankCanvas}>
                  {locale === 'zh-CN' ? '清空' : 'Clear'}
                </button>
              </div>
              <canvas
                ref={canvasRef}
                width={520}
                height={340}
                className={styles.canvas}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />
            </div>
          ) : (
            <div className={styles.htmlWorkspace}>
              <textarea
                className={styles.codeArea}
                value={htmlInput}
                spellCheck={false}
                onChange={(e) => setHtmlInput(e.target.value)}
              />
              <iframe
                title="User HTML Drawing"
                sandbox=""
                srcDoc={sanitizeDrawingHtml(htmlInput)}
                className={styles.previewFrame}
              />
              <div className={styles.htmlHelpTip}>
                {locale === 'zh-CN'
                  ? '提示：如果您不会写 HTML，可以使用主页对话框让 AI 帮你写哦；游戏消息与主页消息隔开的，它不会作弊的哦。'
                  : 'Tip: You can ask the AI in the main chat to write HTML code for you—game state is isolated so it will not peek or cheat.'}
              </div>
            </div>
          )}

          <div className={styles.answerBar}>
            <input
              type="text"
              className={styles.textInput}
              value={answerInput}
              placeholder={
                locale === 'zh-CN' ? '输入标准答案（建议四字成语）' : 'Target answer (e.g. idiom)'
              }
              onChange={(e) => setAnswerInput(e.target.value)}
            />
            <button type="button" className={styles.toolBtn} onClick={pickRandomIdiom}>
              {locale === 'zh-CN' ? '随机成语' : 'Random'}
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              disabled={aiThinking || pickingIdiom}
              onClick={() => void askAiForIdiom()}
            >
              {pickingIdiom ? '…' : t('drawGuessAiIdiom')}
            </button>
            <button
              type="button"
              className={styles.toolBtn}
              onClick={() => void copyDrawingPrompt()}
            >
              {t('drawGuessCopyPrompt')}
            </button>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={aiThinking || pickingIdiom || !answerInput.trim()}
              onClick={() => void submitDrawingToAi()}
            >
              {aiThinking
                ? locale === 'zh-CN'
                  ? '识图中…'
                  : 'Guessing…'
                : locale === 'zh-CN'
                  ? '让 AI 猜'
                  : 'Ask AI'}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.aiPuzzleBox}>
          {state.aiPuzzle ? (
            <>
              <div className={styles.puzzleHeader}>
                <span>
                  {locale === 'zh-CN'
                    ? `提示：${state.aiPuzzle.hint}`
                    : `Hint: ${state.aiPuzzle.hint}`}
                </span>
                <div className={styles.puzzleActions}>
                  <button
                    type="button"
                    className={styles.toolBtn}
                    onClick={() => setShowAiCode((prev) => !prev)}
                  >
                    {showAiCode ? '看画' : '源码'}
                  </button>
                  <button
                    type="button"
                    className={styles.toolBtn}
                    onClick={() =>
                      downloadHtml(state.aiPuzzle?.html ?? '', `ai-drawing-r${state.round}.html`)
                    }
                  >
                    下载 HTML
                  </button>
                </div>
              </div>

              {showAiCode ? (
                <pre className={styles.codePreview}>{state.aiPuzzle.html}</pre>
              ) : (
                <iframe
                  title="AI HTML Drawing"
                  sandbox=""
                  srcDoc={state.aiPuzzle.html}
                  className={styles.previewFrame}
                />
              )}

              <div className={styles.answerBar}>
                <input
                  type="text"
                  className={styles.textInput}
                  value={guessInput}
                  placeholder={locale === 'zh-CN' ? '输入你猜的成语' : 'Your guess'}
                  onChange={(e) => setGuessInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      submitHumanGuess(false)
                    }
                  }}
                />
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={!guessInput.trim()}
                  onClick={() => submitHumanGuess(false)}
                >
                  {locale === 'zh-CN' ? '猜词' : 'Guess'}
                </button>
                <button
                  type="button"
                  className={styles.toolBtn}
                  onClick={() => submitHumanGuess(true)}
                >
                  {locale === 'zh-CN' ? '公布答案' : 'Reveal'}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.loadingPuzzle}>
              {aiThinking
                ? locale === 'zh-CN'
                  ? 'AI 正在编写 HTML 绘图中…'
                  : 'AI is coding HTML drawing…'
                : locale === 'zh-CN'
                  ? '准备生成新画面…'
                  : 'Preparing puzzle…'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
