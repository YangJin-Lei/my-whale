import clsx from 'clsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ensureApiKey } from '../../components/settings/settingsDialogState.js'
import { findPetById, usePetCatalog } from '../../pet/catalog.js'
import { PetSprite } from '../../pet/PetSprite.js'
import { streamMessage } from '../../services/api/client.js'
import { getActiveApiKey, useSettings } from '../../services/settings.js'
import { updateGameFeedback, useGameStore } from '../store.js'
import type { BoardComponentProps } from '../types.js'
import {
  advanceNightPhase,
  advanceSpeechTurn,
  applyHunterShot,
  createInitialWerewolfState,
  resolveVoteExile,
  roleLabel,
  saveWerewolfAiPet,
} from './engine.js'
import type { WerewolfPlayerCount, WerewolfState } from './types.js'
import styles from './Werewolf.module.css'

const extractJson = (raw: string): Record<string, unknown> | null => {
  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  const a = clean.indexOf('{')
  const b = clean.lastIndexOf('}')
  if (a === -1 || b <= a) {
    return null
  }
  try {
    const parsed = JSON.parse(clean.slice(a, b + 1)) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export const WerewolfBoard = ({
  state,
  onPlayerMove,
}: BoardComponentProps<WerewolfState, WerewolfState>) => {
  const locale = useSettings((s) => s.locale)
  const thinkingMode = useGameStore((s) => s.thinkingMode)
  const aiThinking = useGameStore((s) => s.aiThinking)
  const errorText = useGameStore((s) => s.errorText)
  const pets = usePetCatalog()

  const [speechDraft, setSpeechDraft] = useState('')
  const [editingPetSeat, setEditingPetSeat] = useState<number | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const stateRef = useRef(state)
  stateRef.current = state
  const inflightKeyRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const humanSeat = state.seats[0]
  const currentSpeakerIdx =
    state.phase === 'day_speech' ? (state.speechOrder[state.speechCursor] ?? -1) : -1
  const currentVoterIdx =
    state.phase === 'day_vote' && (!humanSeat.alive || state.dayVotes[0] !== undefined)
      ? (state.pendingVoteSeats[0] ?? -1)
      : -1

  const callAiWerewolf = useCallback(
    async (seatIndex: number, systemPrompt: string, userPrompt: string) => {
      if (!ensureApiKey()) {
        throw new Error(locale === 'zh-CN' ? '请先配置 API Key' : 'Configure API Key')
      }
      const apiKey = getActiveApiKey()
      const pet = findPetById(stateRef.current.seats[seatIndex]?.petId)
      const petName = pet.name[locale]

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      updateGameFeedback({
        aiThinking: true,
        errorText: null,
        bubbleText:
          locale === 'zh-CN'
            ? `${seatIndex + 1}号 ${petName} 正在思考…`
            : `${petName} is thinking…`,
        thoughtText: '',
      })

      let rawText = ''
      let rawThought = ''
      let lastThoughtEmit = 0
      const events = streamMessage(
        apiKey,
        {
          model: 'deepseek-flash',
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
          thinking: { type: thinkingMode ? 'enabled' : 'disabled' },
          safety_check: { level: 'high' },
        },
        controller.signal
      )

      for await (const ev of events) {
        if (ev.type !== 'content_block_delta') {
          continue
        }
        if (ev.delta.type === 'text_delta') {
          rawText += ev.delta.text
        } else if (ev.delta.type === 'thinking_delta') {
          rawThought += ev.delta.thinking
          const now = Date.now()
          if (now - lastThoughtEmit >= 400) {
            lastThoughtEmit = now
            updateGameFeedback({ thoughtText: rawThought.trim() })
          }
        }
      }

      return { parsed: extractJson(rawText), rawText, rawThought: rawThought.trim() }
    },
    [locale, thinkingMode]
  )

  // 自动推进 AI 行动回合
  useEffect(() => {
    const s = stateRef.current
    if (s.phase === 'finished') {
      return
    }

    const human = s.seats[0]
    let stepKey: string | null = null
    let runner: (() => Promise<void>) | null = null

    const publicSummary = s.publicLogs
      .slice(-14)
      .map((l) => l.text)
      .join('\n')
    const aliveListText = s.seats
      .filter((x) => x.alive)
      .map((x) => `${x.seatIndex + 1}号`)
      .join('、')

    if (s.phase === 'night_wolf' && !(human.alive && human.role === 'wolf')) {
      const aliveWolf = s.seats.find((x) => !x.isHuman && x.alive && x.role === 'wolf')
      if (aliveWolf) {
        stepKey = `${s.day}:night_wolf:${retryCount}`
        runner = async () => {
          const partnerSeats = s.seats
            .filter((x) => x.role === 'wolf' && x.alive)
            .map((x) => `${x.seatIndex + 1}号`)
            .join('、')
          const nonWolfAlive = s.seats.filter((x) => x.alive && x.role !== 'wolf')
          const sys = `你在 ${s.playerCount} 人狼人杀中扮演 ${aliveWolf.seatIndex + 1}号【狼人】。存活狼同伴：${partnerSeats}。仅根据公开局势刀一名好人，绝不自爆。严格返回 JSON：{"target": <整数座位号 1~${s.playerCount}>, "speech":"简短心声"}。`
          const usr = `当前第 ${s.day} 夜。全部存活座位：${aliveListText}。\n建议刀口候选（非狼玩家）：${nonWolfAlive.map((x) => `${x.seatIndex + 1}号`).join('、')}。\n公开记录：\n${publicSummary}`
          const { parsed } = await callAiWerewolf(aliveWolf.seatIndex, sys, usr)
          const rawNum = Number(parsed?.target)
          const picked =
            s.seats.find((x) => x.seatIndex === rawNum - 1 && x.alive && x.role !== 'wolf')
              ?.seatIndex ??
            nonWolfAlive[0]?.seatIndex ??
            0
          updateGameFeedback({ aiThinking: false })
          onPlayerMove(advanceNightPhase({ ...stateRef.current, tonightWolfTarget: picked }))
        }
      }
    } else if (
      s.phase === 'night_seer' &&
      !(human.alive && human.role === 'seer') &&
      !s.tonightSeerChecked
    ) {
      const aliveSeer = s.seats.find((x) => !x.isHuman && x.alive && x.role === 'seer')
      if (aliveSeer) {
        stepKey = `${s.day}:night_seer:${retryCount}`
        runner = async () => {
          const candidates = s.seats.filter((x) => x.alive && x.seatIndex !== aliveSeer.seatIndex)
          const knownSet = new Set(s.seerHistory.map((h) => h.targetSeat))
          const unchecked = candidates.filter((c) => !knownSet.has(c.seatIndex))
          const sys = `你在 ${s.playerCount} 人狼人杀中扮演 ${aliveSeer.seatIndex + 1}号【预言家】。请选择今晚查验的座位号（1~${s.playerCount}），严格返回 JSON：{"target": <整数座位号>}。`
          const usr = `当前第 ${s.day} 夜。已查验：${s.seerHistory.map((h) => `${h.targetSeat + 1}号=${h.isWolf ? '狼' : '好人'}`).join('、') || '暂无'}。未查验存活座位：${(unchecked.length > 0 ? unchecked : candidates).map((x) => `${x.seatIndex + 1}号`).join('、')}。\n公开记录：\n${publicSummary}`
          const { parsed } = await callAiWerewolf(aliveSeer.seatIndex, sys, usr)
          const rawNum = Number(parsed?.target)
          const targetObj =
            candidates.find((x) => x.seatIndex === rawNum - 1) ?? unchecked[0] ?? candidates[0]
          const nextHistory = targetObj
            ? [
                ...stateRef.current.seerHistory,
                {
                  day: s.day,
                  targetSeat: targetObj.seatIndex,
                  isWolf: targetObj.role === 'wolf',
                },
              ]
            : stateRef.current.seerHistory
          updateGameFeedback({ aiThinking: false })
          onPlayerMove(
            advanceNightPhase({
              ...stateRef.current,
              tonightSeerChecked: true,
              seerHistory: nextHistory,
            })
          )
        }
      }
    } else if (s.phase === 'night_witch' && !(human.alive && human.role === 'witch')) {
      const aliveWitch = s.seats.find((x) => !x.isHuman && x.alive && x.role === 'witch')
      if (aliveWitch) {
        stepKey = `${s.day}:night_witch:${retryCount}`
        runner = async () => {
          const victimText =
            s.tonightWolfTarget !== null ? `${s.tonightWolfTarget + 1}号` : '无人被刀'
          const sys = `你在 ${s.playerCount} 人狼人杀中扮演 ${aliveWitch.seatIndex + 1}号【女巫】。每晚只能用一瓶药或跳过。返回 JSON：{"action":"heal"|"poison"|"skip", "target": <毒人时的座位号 1~${s.playerCount}>}。`
          const usr = `第 ${s.day} 夜，今晚倒牌的是：${victimText}。解药剩余：${s.witchHealLeft}，毒药剩余：${s.witchPoisonLeft}。存活座位：${aliveListText}。\n公开记录：\n${publicSummary}`
          const { parsed } = await callAiWerewolf(aliveWitch.seatIndex, sys, usr)
          const act = String(parsed?.action ?? 'skip')
          let healed = false
          let healLeft = s.witchHealLeft
          let poisonLeft = s.witchPoisonLeft
          let poisonTarget: number | null = null
          if (act === 'heal' && healLeft > 0 && s.tonightWolfTarget !== null) {
            healed = true
            healLeft -= 1
          } else if (act === 'poison' && poisonLeft > 0) {
            const tIdx = Number(parsed?.target) - 1
            const validTarget = s.seats.find(
              (x) => x.seatIndex === tIdx && x.alive && x.seatIndex !== aliveWitch.seatIndex
            )
            if (validTarget) {
              poisonTarget = validTarget.seatIndex
              poisonLeft -= 1
            }
          }
          updateGameFeedback({ aiThinking: false })
          onPlayerMove(
            advanceNightPhase({
              ...stateRef.current,
              tonightHealed: healed,
              tonightPoisonTarget: poisonTarget,
              witchHealLeft: healLeft,
              witchPoisonLeft: poisonLeft,
            })
          )
        }
      }
    } else if (s.phase === 'day_speech' && currentSpeakerIdx > 0) {
      stepKey = `${s.day}:speech:${s.speechCursor}:${retryCount}`
      runner = async () => {
        const speaker = s.seats[currentSpeakerIdx]
        const pet = findPetById(speaker.petId)
        let privateHint = `你的底牌是【${roleLabel(speaker.role, 'zh-CN')}】。`
        if (speaker.role === 'wolf') {
          const partners = s.seats
            .filter((x) => x.role === 'wolf' && x.seatIndex !== speaker.seatIndex)
            .map((x) => `${x.seatIndex + 1}号`)
            .join('、')
          privateHint += `狼同伴是 ${partners}（注意伪装成好人发言）。`
        } else if (speaker.role === 'seer') {
          privateHint += `你查验过：${s.seerHistory.map((h) => `${h.targetSeat + 1}号是${h.isWolf ? '狼人' : '好人'}`).join('；') || '暂无'}。`
        } else if (speaker.role === 'witch') {
          privateHint += `解药剩 ${s.witchHealLeft}，毒药剩 ${s.witchPoisonLeft}。`
        }

        const sys = `你在 ${s.playerCount} 人狼人杀中扮演 ${speaker.seatIndex + 1}号「${pet.name[locale]}」（${pet.promptHint[locale]}）。${privateHint}\n请严格只输出 JSON：{"speech":"你的白日公开简短口语发言（25~60字，不要用Emoji）","thoughtSummary":"私密推理"}。`
        const usr = `今天是第 ${s.day} 天白日。存活玩家：${aliveListText}（1号是人类玩家）。\n公开记录：\n${publicSummary}\n现在轮到你（${speaker.seatIndex + 1}号）发言：`
        const { parsed, rawThought } = await callAiWerewolf(speaker.seatIndex, sys, usr)
        const speechText =
          typeof parsed?.speech === 'string' && parsed.speech.trim()
            ? parsed.speech.trim().slice(0, 120)
            : '我先听听后面几位发言再站边。'
        const thoughtText = [
          typeof parsed?.thoughtSummary === 'string' ? parsed.thoughtSummary : '',
          rawThought,
        ]
          .filter(Boolean)
          .join('\n\n')
        updateGameFeedback({
          aiThinking: false,
          bubbleText: `${speaker.seatIndex + 1}号 ${pet.name[locale]}：${speechText}`,
          thoughtText,
          speechToSpeak: speechText,
        })
        onPlayerMove(
          advanceSpeechTurn(stateRef.current, speaker.seatIndex, speechText, thoughtText)
        )
      }
    } else if (s.phase === 'day_vote' && currentVoterIdx > 0) {
      stepKey = `${s.day}:vote:${s.pendingVoteSeats.length}:${retryCount}`
      runner = async () => {
        const voter = s.seats[currentVoterIdx]
        const aliveOthers = s.seats.filter((x) => x.alive && x.seatIndex !== voter.seatIndex)
        const partnerHint =
          voter.role === 'wolf'
            ? `你是狼人（狼同伴：${s.seats
                .filter((x) => x.role === 'wolf')
                .map((x) => `${x.seatIndex + 1}号`)
                .join('、')}），请投给好人。`
            : `你的身份是【${roleLabel(voter.role, 'zh-CN')}】，请把票投给最像狼的玩家或 0 弃票。`
        const sys = `${s.playerCount}人狼人杀放逐投票。${partnerHint}返回 JSON：{"target": <整数座位号 1~${s.playerCount} 或 0 弃票>}。`
        const usr = `可投存活座位：${aliveOthers.map((x) => `${x.seatIndex + 1}号`).join('、')}。\n白日发言记录：\n${publicSummary}`
        const { parsed } = await callAiWerewolf(voter.seatIndex, sys, usr)
        const rawTarget = Number(parsed?.target)
        const chosen =
          rawTarget === 0
            ? null
            : (aliveOthers.find((x) => x.seatIndex === rawTarget - 1)?.seatIndex ??
              aliveOthers[0]?.seatIndex ??
              null)
        const nextVotes = { ...stateRef.current.dayVotes, [voter.seatIndex]: chosen }
        const nextPending = stateRef.current.pendingVoteSeats.slice(1)
        const nextState: WerewolfState = {
          ...stateRef.current,
          dayVotes: nextVotes,
          pendingVoteSeats: nextPending,
        }
        updateGameFeedback({ aiThinking: false })
        onPlayerMove(nextPending.length === 0 ? resolveVoteExile(nextState) : nextState)
      }
    } else if (
      s.phase === 'hunter_shoot' &&
      typeof s.pendingHunterSeat === 'number' &&
      s.pendingHunterSeat > 0
    ) {
      const hunterIdx = s.pendingHunterSeat
      stepKey = `${s.day}:hunter:${hunterIdx}:${retryCount}`
      runner = async () => {
        const aliveOthers = s.seats.filter((x) => x.alive && x.seatIndex !== hunterIdx)
        const sys = `你在 ${s.playerCount} 人狼人杀中扮演 ${hunterIdx + 1}号【猎人】，刚刚出局发动开枪技能。请结合公开局势决定开枪带走一名最像狼的玩家或 0 不开枪。返回 JSON：{"target": <整数座位号 1~${s.playerCount} 或 0 不开枪>}。`
        const usr = `可带走存活座位：${aliveOthers.map((x) => `${x.seatIndex + 1}号`).join('、')}。\n公开记录：\n${publicSummary}`
        const { parsed } = await callAiWerewolf(hunterIdx, sys, usr)
        const rawTarget = Number(parsed?.target)
        const chosen =
          rawTarget === 0
            ? null
            : (aliveOthers.find((x) => x.seatIndex === rawTarget - 1)?.seatIndex ?? null)
        updateGameFeedback({ aiThinking: false })
        onPlayerMove(applyHunterShot(stateRef.current, chosen))
      }
    }

    if (!stepKey || !runner || inflightKeyRef.current === stepKey) {
      return
    }
    inflightKeyRef.current = stepKey
    const activeKey = stepKey

    void runner()
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        updateGameFeedback({
          aiThinking: false,
          errorText: err instanceof Error ? err.message : '请求失败',
        })
      })
      .finally(() => {
        if (inflightKeyRef.current === activeKey) {
          inflightKeyRef.current = null
        }
      })
  }, [
    state.day,
    state.phase,
    state.speechCursor,
    state.pendingVoteSeats.length,
    state.pendingHunterSeat,
    state.tonightSeerChecked,
    currentSpeakerIdx,
    currentVoterIdx,
    retryCount,
    callAiWerewolf,
    locale,
    onPlayerMove,
  ])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const switchPlayerCount = (count: WerewolfPlayerCount) => {
    abortRef.current?.abort()
    inflightKeyRef.current = null
    updateGameFeedback({ aiThinking: false, errorText: null, thoughtText: '' })
    onPlayerMove(createInitialWerewolfState(count))
  }

  const phaseTitle = (() => {
    if (state.phase === 'night_wolf') {
      return `第 ${state.day} 夜 · 狼人行动`
    }
    if (state.phase === 'night_seer') {
      return `第 ${state.day} 夜 · 预言家查验`
    }
    if (state.phase === 'night_witch') {
      return `第 ${state.day} 夜 · 女巫用药`
    }
    if (state.phase === 'hunter_shoot') {
      return `第 ${state.day} 天 · 猎人开枪`
    }
    if (state.phase === 'day_speech') {
      return `第 ${state.day} 天 · 轮流发言`
    }
    if (state.phase === 'day_vote') {
      return `第 ${state.day} 天 · 放逐投票`
    }
    return state.winner === 'good' ? '好人阵营获胜' : '狼人阵营获胜'
  })()

  const humanWaitingWolf =
    state.phase === 'night_wolf' && humanSeat.alive && humanSeat.role === 'wolf'
  const humanWaitingSeer =
    state.phase === 'night_seer' &&
    humanSeat.alive &&
    humanSeat.role === 'seer' &&
    !state.tonightSeerChecked
  const latestSeerCheck = state.seerHistory[state.seerHistory.length - 1]
  const humanSeerCheckedBanner =
    state.phase === 'night_seer' &&
    humanSeat.alive &&
    humanSeat.role === 'seer' &&
    state.tonightSeerChecked &&
    latestSeerCheck
      ? `查验结果：${latestSeerCheck.targetSeat + 1}号 是【${latestSeerCheck.isWolf ? '狼人' : '好人'}】`
      : null
  const humanWaitingWitch =
    state.phase === 'night_witch' && humanSeat.alive && humanSeat.role === 'witch'
  const humanWaitingHunter = state.phase === 'hunter_shoot' && state.pendingHunterSeat === 0
  const humanWaitingSpeech = state.phase === 'day_speech' && currentSpeakerIdx === 0
  const humanWaitingVote =
    state.phase === 'day_vote' && humanSeat.alive && state.dayVotes[0] === undefined

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <span className={styles.phasePill}>{phaseTitle}</span>
        <div className={styles.countTabs}>
          {([6, 9, 12] as const).map((cnt) => (
            <button
              key={cnt}
              type="button"
              className={clsx(styles.countBtn, state.playerCount === cnt && styles.countBtnActive)}
              onClick={() => switchPlayerCount(cnt)}
            >
              {cnt}人
            </button>
          ))}
        </div>
        <span className={styles.roleTag}>
          你的底牌：{roleLabel(humanSeat.role, locale)}
          {!humanSeat.alive ? '（已出局）' : ''}
        </span>
      </div>

      {/* 环桌席位 */}
      <div className={clsx(styles.seatGrid, state.playerCount >= 12 && styles.seatGrid12)}>
        {state.seats.map((seat) => {
          const pet = !seat.isHuman ? findPetById(seat.petId) : null
          const isSpeaking = state.phase === 'day_speech' && currentSpeakerIdx === seat.seatIndex
          const showRole =
            state.phase === 'finished' ||
            seat.isHuman ||
            (humanSeat.role === 'wolf' && seat.role === 'wolf')
          const checkedInfo =
            humanSeat.role === 'seer'
              ? state.seerHistory.find((h) => h.targetSeat === seat.seatIndex)
              : undefined

          return (
            <div
              key={seat.seatIndex}
              className={clsx(
                styles.seatCard,
                !seat.alive && styles.seatDead,
                isSpeaking && styles.seatSpeaking
              )}
            >
              <div className={styles.seatHead}>
                {pet ? (
                  <button
                    type="button"
                    className={styles.petSwapBtn}
                    onClick={() =>
                      setEditingPetSeat((prev) => (prev === seat.seatIndex ? null : seat.seatIndex))
                    }
                  >
                    <PetSprite
                      spriteUrl={pet.spriteUrl}
                      mood={
                        !seat.alive ? 'sad' : isSpeaking ? 'speak' : aiThinking ? 'think' : 'wait'
                      }
                      width={34}
                      cols={pet.cols}
                      rows={pet.rows}
                    />
                  </button>
                ) : (
                  <div className={styles.humanBadge}>1号</div>
                )}

                <div className={styles.seatMeta}>
                  <div className={styles.seatName}>
                    {seat.seatIndex + 1}号 {seat.isHuman ? '你' : pet?.name[locale]}
                  </div>
                  <div className={styles.seatBadges}>
                    <span className={seat.alive ? styles.aliveTag : styles.deadTag}>
                      {seat.alive ? '存活' : '出局'}
                    </span>
                    {showRole ? (
                      <span className={styles.revealTag}>{roleLabel(seat.role, locale)}</span>
                    ) : null}
                    {checkedInfo ? (
                      <span className={checkedInfo.isWolf ? styles.wolfCheck : styles.goodCheck}>
                        {checkedInfo.isWolf ? '已验:狼' : '已验:好人'}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {editingPetSeat === seat.seatIndex && !seat.isHuman ? (
                <select
                  className={styles.petSelect}
                  value={seat.petId}
                  onChange={(e) => {
                    const nextId = e.target.value
                    saveWerewolfAiPet(seat.seatIndex - 1, nextId)
                    setEditingPetSeat(null)
                    onPlayerMove({
                      ...state,
                      seats: state.seats.map((x) =>
                        x.seatIndex === seat.seatIndex ? { ...x, petId: nextId } : x
                      ),
                    })
                  }}
                >
                  {pets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name[locale]}
                    </option>
                  ))}
                </select>
              ) : null}

              {seat.lastSpeech ? <div className={styles.seatSpeech}>{seat.lastSpeech}</div> : null}
            </div>
          )
        })}
      </div>

      {/* 人类玩家行动面板 */}
      {humanWaitingWolf ? (
        <div className={styles.actionBox}>
          <div className={styles.actionTitle}>选择今晚袭击目标：</div>
          <div className={styles.targetRow}>
            {state.seats
              .filter((x) => x.alive)
              .map((x) => (
                <button
                  key={x.seatIndex}
                  type="button"
                  className={styles.actionBtn}
                  onClick={() =>
                    onPlayerMove(advanceNightPhase({ ...state, tonightWolfTarget: x.seatIndex }))
                  }
                >
                  刀 {x.seatIndex + 1}号
                </button>
              ))}
          </div>
        </div>
      ) : null}

      {humanWaitingSeer ? (
        <div className={styles.actionBox}>
          <div className={styles.actionTitle}>选择今晚要查验的玩家：</div>
          <div className={styles.targetRow}>
            {state.seats
              .filter((x) => x.alive && !x.isHuman)
              .map((x) => (
                <button
                  key={x.seatIndex}
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    const isWolf = x.role === 'wolf'
                    onPlayerMove({
                      ...state,
                      tonightSeerChecked: true,
                      seerHistory: [
                        ...state.seerHistory,
                        { day: state.day, targetSeat: x.seatIndex, isWolf },
                      ],
                    })
                  }}
                >
                  查 {x.seatIndex + 1}号
                </button>
              ))}
          </div>
        </div>
      ) : null}

      {humanSeerCheckedBanner ? (
        <div className={styles.actionBox}>
          <div className={styles.actionTitle}>{humanSeerCheckedBanner}</div>
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => onPlayerMove(advanceNightPhase(state))}
          >
            确认，进入下一步
          </button>
        </div>
      ) : null}

      {humanWaitingHunter ? (
        <div className={styles.actionBox}>
          <div className={styles.actionTitle}>你已出局，可发动【猎人】技能开枪带走一名玩家：</div>
          <div className={styles.targetRow}>
            {state.seats
              .filter((x) => x.alive && !x.isHuman)
              .map((x) => (
                <button
                  key={x.seatIndex}
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => onPlayerMove(applyHunterShot(state, x.seatIndex))}
                >
                  带走 {x.seatIndex + 1}号
                </button>
              ))}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onPlayerMove(applyHunterShot(state, null))}
            >
              压枪不开枪
            </button>
          </div>
        </div>
      ) : null}

      {humanWaitingWitch ? (
        <div className={styles.actionBox}>
          <div className={styles.actionTitle}>
            今晚倒牌：
            {state.tonightWolfTarget !== null ? `${state.tonightWolfTarget + 1}号` : '无人'}
            （解药 {state.witchHealLeft} · 毒药 {state.witchPoisonLeft}）
          </div>
          <div className={styles.targetRow}>
            {state.witchHealLeft > 0 && state.tonightWolfTarget !== null ? (
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() =>
                  onPlayerMove(
                    advanceNightPhase({
                      ...state,
                      tonightHealed: true,
                      witchHealLeft: state.witchHealLeft - 1,
                    })
                  )
                }
              >
                用解药救 {state.tonightWolfTarget + 1}号
              </button>
            ) : null}
            {state.witchPoisonLeft > 0
              ? state.seats
                  .filter((x) => x.alive && !x.isHuman)
                  .map((x) => (
                    <button
                      key={x.seatIndex}
                      type="button"
                      className={styles.actionBtn}
                      onClick={() =>
                        onPlayerMove(
                          advanceNightPhase({
                            ...state,
                            tonightPoisonTarget: x.seatIndex,
                            witchPoisonLeft: state.witchPoisonLeft - 1,
                          })
                        )
                      }
                    >
                      毒 {x.seatIndex + 1}号
                    </button>
                  ))
              : null}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onPlayerMove(advanceNightPhase(state))}
            >
              跳过不用药
            </button>
          </div>
        </div>
      ) : null}

      {humanWaitingSpeech ? (
        <div className={styles.actionBox}>
          <div className={styles.actionTitle}>轮到你（1号）白日发言：</div>
          <div className={styles.speechRow}>
            <input
              type="text"
              className={styles.speechInput}
              value={speechDraft}
              placeholder="输入你的发言或推理…"
              onChange={(e) => setSpeechDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && speechDraft.trim()) {
                  const text = speechDraft.trim()
                  setSpeechDraft('')
                  onPlayerMove(advanceSpeechTurn(state, 0, text))
                }
              }}
            />
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={!speechDraft.trim()}
              onClick={() => {
                const text = speechDraft.trim()
                setSpeechDraft('')
                onPlayerMove(advanceSpeechTurn(state, 0, text))
              }}
            >
              发言
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => {
                const fallback = '我是好人，先听听大家发言和票型。'
                setSpeechDraft('')
                onPlayerMove(advanceSpeechTurn(state, 0, fallback))
              }}
            >
              快捷过麦
            </button>
          </div>
        </div>
      ) : null}

      {humanWaitingVote ? (
        <div className={styles.actionBox}>
          <div className={styles.actionTitle}>请选择放逐投票对象：</div>
          <div className={styles.targetRow}>
            {state.seats
              .filter((x) => x.alive && !x.isHuman)
              .map((x) => (
                <button
                  key={x.seatIndex}
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => {
                    const nextVotes = { ...state.dayVotes, 0: x.seatIndex }
                    const nextState: WerewolfState = { ...state, dayVotes: nextVotes }
                    onPlayerMove(
                      state.pendingVoteSeats.length === 0 ? resolveVoteExile(nextState) : nextState
                    )
                  }}
                >
                  投 {x.seatIndex + 1}号
                </button>
              ))}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => {
                const nextVotes = { ...state.dayVotes, 0: null }
                const nextState: WerewolfState = { ...state, dayVotes: nextVotes }
                onPlayerMove(
                  state.pendingVoteSeats.length === 0 ? resolveVoteExile(nextState) : nextState
                )
              }}
            >
              弃票
            </button>
          </div>
        </div>
      ) : null}

      {/* 如果 AI 步骤请求出错，允许玩家点击继续 */}
      {!aiThinking && errorText ? (
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={() => setRetryCount((prev) => prev + 1)}
        >
          重试当前桌宠行动
        </button>
      ) : null}

      {/* 法官公开日志 */}
      <div className={styles.logBox}>
        {state.publicLogs.slice(-10).map((entry, idx) => (
          <div key={idx} className={styles.logLine}>
            {entry.text}
          </div>
        ))}
      </div>
    </div>
  )
}
