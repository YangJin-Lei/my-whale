import type { Locale } from '../../services/settings.js'
import type { WerewolfPlayerCount, WerewolfRole, WerewolfSeat, WerewolfState } from './types.js'

const DEFAULT_AI_PET_POOL = [
  'nailong',
  'jiyi',
  'usagi',
  'conan-detective',
  'pikachu-local',
  'hachiware',
  'shisa',
  'xiaohuang',
  'ikkun',
  'gali-boo',
  'natu-white-victory',
] as const

const STORAGE_KEY = 'mywhale_werewolf_pets_v2'

export const loadWerewolfAiPets = (aiCount: number): string[] => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return Array.from({ length: aiCount }, (_, i) =>
          typeof parsed[i] === 'string' && parsed[i]
            ? parsed[i]
            : DEFAULT_AI_PET_POOL[i % DEFAULT_AI_PET_POOL.length]
        )
      }
    }
  } catch {
    // 忽略存储限制
  }
  return Array.from(
    { length: aiCount },
    (_, i) => DEFAULT_AI_PET_POOL[i % DEFAULT_AI_PET_POOL.length]
  )
}

export const saveWerewolfAiPet = (aiIndex: number, petId: string): void => {
  const list = loadWerewolfAiPets(11)
  if (aiIndex >= 0 && aiIndex < list.length) {
    list[aiIndex] = petId
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    } catch {
      // 忽略
    }
  }
}

export const roleLabel = (role: WerewolfRole, locale: Locale): string => {
  if (locale === 'zh-CN') {
    return role === 'wolf'
      ? '狼人'
      : role === 'seer'
        ? '预言家'
        : role === 'witch'
          ? '女巫'
          : role === 'hunter'
            ? '猎人'
            : '平民'
  }
  return role === 'wolf'
    ? 'Werewolf'
    : role === 'seer'
      ? 'Seer'
      : role === 'witch'
        ? 'Witch'
        : role === 'hunter'
          ? 'Hunter'
          : 'Villager'
}

const buildRolePool = (count: WerewolfPlayerCount): WerewolfRole[] => {
  if (count === 9) {
    return ['wolf', 'wolf', 'wolf', 'seer', 'witch', 'hunter', 'villager', 'villager', 'villager']
  }
  if (count === 12) {
    return [
      'wolf',
      'wolf',
      'wolf',
      'wolf',
      'seer',
      'witch',
      'hunter',
      'villager',
      'villager',
      'villager',
      'villager',
      'villager',
    ]
  }
  return ['wolf', 'wolf', 'seer', 'witch', 'villager', 'villager']
}

export const createInitialWerewolfState = (playerCount: WerewolfPlayerCount = 6): WerewolfState => {
  const pool = buildRolePool(playerCount)
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
  }
  const aiPets = loadWerewolfAiPets(playerCount - 1)
  const seats: WerewolfSeat[] = pool.map((role, idx) => ({
    seatIndex: idx,
    isHuman: idx === 0,
    petId:
      idx === 0
        ? ''
        : (aiPets[idx - 1] ?? DEFAULT_AI_PET_POOL[(idx - 1) % DEFAULT_AI_PET_POOL.length]),
    role,
    alive: true,
    lastSpeech: '',
  }))

  return {
    playerCount,
    day: 1,
    phase: 'night_wolf',
    seats,
    speechOrder: [],
    speechCursor: 0,
    tonightWolfTarget: null,
    tonightSeerChecked: false,
    tonightHealed: false,
    tonightPoisonTarget: null,
    seerHistory: [],
    witchHealLeft: 1,
    witchPoisonLeft: 1,
    dayVotes: {},
    pendingVoteSeats: [],
    pendingHunterSeat: null,
    hunterFromPhase: null,
    publicLogs: [
      {
        day: 1,
        kind: 'system',
        text: `第 1 夜降临（${playerCount}人局）：天黑请闭眼，狼人请行动…`,
      },
    ],
    winner: null,
  }
}

export const checkWinner = (seats: readonly WerewolfSeat[]): 'good' | 'wolf' | null => {
  const aliveWolves = seats.filter((s) => s.alive && s.role === 'wolf').length
  const aliveGood = seats.filter((s) => s.alive && s.role !== 'wolf').length
  if (aliveWolves === 0) {
    return 'good'
  }
  if (aliveWolves >= aliveGood) {
    return 'wolf'
  }
  return null
}

/** 根据夜晚步骤推进到下一阶段，自动跳过已出局神职 */
export const advanceNightPhase = (state: WerewolfState): WerewolfState => {
  if (state.phase === 'night_wolf') {
    const aliveSeer = state.seats.find((s) => s.alive && s.role === 'seer')
    if (aliveSeer) {
      return { ...state, phase: 'night_seer' }
    }
    const aliveWitch = state.seats.find((s) => s.alive && s.role === 'witch')
    if (aliveWitch && (state.witchHealLeft > 0 || state.witchPoisonLeft > 0)) {
      return { ...state, phase: 'night_witch' }
    }
    return resolveDawn(state)
  }

  if (state.phase === 'night_seer') {
    const aliveWitch = state.seats.find((s) => s.alive && s.role === 'witch')
    if (aliveWitch && (state.witchHealLeft > 0 || state.witchPoisonLeft > 0)) {
      return { ...state, phase: 'night_witch' }
    }
    return resolveDawn(state)
  }

  if (state.phase === 'night_witch') {
    return resolveDawn(state)
  }

  return state
}

export const resolveDawn = (state: WerewolfState): WerewolfState => {
  const deadToday: number[] = []
  if (state.tonightWolfTarget !== null && !state.tonightHealed) {
    deadToday.push(state.tonightWolfTarget)
  }
  if (state.tonightPoisonTarget !== null && !deadToday.includes(state.tonightPoisonTarget)) {
    deadToday.push(state.tonightPoisonTarget)
  }

  const nextSeats = state.seats.map((s) =>
    deadToday.includes(s.seatIndex) ? { ...s, alive: false } : s
  )

  const dawnNote =
    deadToday.length === 0
      ? `第 ${state.day} 天天亮：昨晚是平安夜，无人出局。`
      : `第 ${state.day} 天天亮：昨晚 ${deadToday.map((i) => `${i + 1}号`).join('、')} 出局。`

  const winner = checkWinner(nextSeats)
  const logs = [...state.publicLogs, { day: state.day, kind: 'system' as const, text: dawnNote }]

  if (winner) {
    const endNote =
      winner === 'good' ? '所有狼人已被放逐，好人阵营获胜！' : '狼人数量占优，狼人阵营获胜！'
    return {
      ...state,
      phase: 'finished',
      seats: nextSeats,
      tonightWolfTarget: null,
      tonightSeerChecked: false,
      tonightHealed: false,
      tonightPoisonTarget: null,
      pendingHunterSeat: null,
      hunterFromPhase: null,
      publicLogs: [...logs, { day: state.day, kind: 'system', text: endNote }],
      winner,
    }
  }

  // 若狼刀导致猎人出局（非女巫毒死），触发猎人开枪
  const wolfVictimIdx =
    state.tonightWolfTarget !== null &&
    !state.tonightHealed &&
    state.tonightPoisonTarget !== state.tonightWolfTarget
      ? state.tonightWolfTarget
      : null
  const deadHunter =
    wolfVictimIdx !== null
      ? nextSeats.find((s) => s.seatIndex === wolfVictimIdx && s.role === 'hunter')
      : undefined
  if (deadHunter) {
    return {
      ...state,
      phase: 'hunter_shoot',
      seats: nextSeats,
      pendingHunterSeat: deadHunter.seatIndex,
      hunterFromPhase: 'dawn',
      tonightWolfTarget: null,
      tonightSeerChecked: false,
      tonightHealed: false,
      tonightPoisonTarget: null,
      dayVotes: {},
      pendingVoteSeats: [],
      publicLogs: [
        ...logs,
        {
          day: state.day,
          kind: 'system',
          text: `${deadHunter.seatIndex + 1}号【猎人】倒牌，可选择开枪带走一名玩家！`,
        },
      ],
    }
  }

  const aliveOrder = nextSeats.filter((s) => s.alive).map((s) => s.seatIndex)
  return {
    ...state,
    phase: 'day_speech',
    seats: nextSeats,
    speechOrder: aliveOrder,
    speechCursor: 0,
    tonightWolfTarget: null,
    tonightSeerChecked: false,
    tonightHealed: false,
    tonightPoisonTarget: null,
    dayVotes: {},
    pendingVoteSeats: [],
    pendingHunterSeat: null,
    hunterFromPhase: null,
    publicLogs: logs,
  }
}

export const advanceSpeechTurn = (
  state: WerewolfState,
  seatIndex: number,
  speech: string,
  thought?: string
): WerewolfState => {
  const nextSeats = state.seats.map((s) =>
    s.seatIndex === seatIndex ? { ...s, lastSpeech: speech, lastThought: thought } : s
  )
  const nextLogs = [
    ...state.publicLogs,
    {
      day: state.day,
      kind: 'speech' as const,
      seatIndex,
      text: `${seatIndex + 1}号：${speech}`,
    },
  ]

  const nextCursor = state.speechCursor + 1
  if (nextCursor < state.speechOrder.length) {
    return {
      ...state,
      seats: nextSeats,
      speechCursor: nextCursor,
      publicLogs: nextLogs,
    }
  }

  const aliveSeats = nextSeats.filter((s) => s.alive).map((s) => s.seatIndex)
  const humanAlive = aliveSeats.includes(0)
  return {
    ...state,
    phase: 'day_vote',
    seats: nextSeats,
    dayVotes: {},
    pendingVoteSeats: aliveSeats.filter((idx) => idx !== 0),
    publicLogs: [
      ...nextLogs,
      {
        day: state.day,
        kind: 'system',
        text: humanAlive ? '全员发言完毕，进入放逐投票阶段！' : '进入放逐投票阶段…',
      },
    ],
  }
}

export const applyHunterShot = (state: WerewolfState, targetSeat: number | null): WerewolfState => {
  const hunterIdx = state.pendingHunterSeat ?? -1
  const fromPhase = state.hunterFromPhase ?? 'dawn'
  let nextSeats = state.seats
  const shotLogs = [...state.publicLogs]

  if (targetSeat !== null) {
    const validTarget = state.seats.find((s) => s.seatIndex === targetSeat && s.alive)
    if (validTarget) {
      nextSeats = state.seats.map((s) => (s.seatIndex === targetSeat ? { ...s, alive: false } : s))
      shotLogs.push({
        day: state.day,
        kind: 'system',
        text: `${hunterIdx + 1}号【猎人】发动技能开枪带走了 ${targetSeat + 1}号！`,
      })
    }
  } else {
    shotLogs.push({
      day: state.day,
      kind: 'system',
      text: `${hunterIdx + 1}号【猎人】选择压枪不开枪。`,
    })
  }

  const winner = checkWinner(nextSeats)
  if (winner) {
    const endNote =
      winner === 'good' ? '所有狼人已被放逐，好人阵营获胜！' : '狼人数量占优，狼人阵营获胜！'
    return {
      ...state,
      phase: 'finished',
      seats: nextSeats,
      pendingHunterSeat: null,
      hunterFromPhase: null,
      publicLogs: [...shotLogs, { day: state.day, kind: 'system', text: endNote }],
      winner,
    }
  }

  if (fromPhase === 'dawn') {
    const aliveOrder = nextSeats.filter((s) => s.alive).map((s) => s.seatIndex)
    return {
      ...state,
      phase: 'day_speech',
      seats: nextSeats,
      speechOrder: aliveOrder,
      speechCursor: 0,
      pendingHunterSeat: null,
      hunterFromPhase: null,
      publicLogs: shotLogs,
    }
  }

  const nextDay = state.day + 1
  return {
    ...state,
    day: nextDay,
    phase: 'night_wolf',
    seats: nextSeats.map((s) => ({ ...s, lastSpeech: '', lastThought: undefined })),
    dayVotes: {},
    pendingVoteSeats: [],
    pendingHunterSeat: null,
    hunterFromPhase: null,
    publicLogs: [
      ...shotLogs,
      { day: nextDay, kind: 'system', text: `第 ${nextDay} 夜降临：天黑请闭眼…` },
    ],
  }
}

export const resolveVoteExile = (state: WerewolfState): WerewolfState => {
  const tally = new Map<number, number>()
  const voteDetails: string[] = []
  const sortedVoters = Object.keys(state.dayVotes)
    .map(Number)
    .sort((a, b) => a - b)
  for (const voterIdx of sortedVoters) {
    const target = state.dayVotes[voterIdx]
    if (typeof target === 'number') {
      tally.set(target, (tally.get(target) ?? 0) + 1)
      voteDetails.push(`${voterIdx + 1}号→${target + 1}号`)
    } else {
      voteDetails.push(`${voterIdx + 1}号弃票`)
    }
  }

  let topVotes = 0
  let topTargets: number[] = []
  for (const [seatIdx, count] of tally.entries()) {
    if (count > topVotes) {
      topVotes = count
      topTargets = [seatIdx]
    } else if (count === topVotes) {
      topTargets.push(seatIdx)
    }
  }

  const exiledSeat = topTargets.length === 1 ? topTargets[0] : null
  const nextSeats = state.seats.map((s) =>
    s.seatIndex === exiledSeat ? { ...s, alive: false } : s
  )

  const detailPrefix = voteDetails.length > 0 ? `票型（${voteDetails.join('，')}）；` : ''
  const voteText =
    exiledSeat !== null
      ? `${detailPrefix}${exiledSeat + 1}号 以 ${topVotes} 票被放逐出局。`
      : `${detailPrefix}平票或全员弃票，无人出局。`

  const logs = [...state.publicLogs, { day: state.day, kind: 'vote' as const, text: voteText }]
  const winner = checkWinner(nextSeats)
  if (winner) {
    const endNote =
      winner === 'good' ? '所有狼人已被放逐，好人阵营获胜！' : '狼人数量占优，狼人阵营获胜！'
    return {
      ...state,
      phase: 'finished',
      seats: nextSeats,
      pendingHunterSeat: null,
      hunterFromPhase: null,
      publicLogs: [...logs, { day: state.day, kind: 'system', text: endNote }],
      winner,
    }
  }

  const exiledHunter =
    exiledSeat !== null
      ? nextSeats.find((s) => s.seatIndex === exiledSeat && s.role === 'hunter')
      : undefined
  if (exiledHunter) {
    return {
      ...state,
      phase: 'hunter_shoot',
      seats: nextSeats,
      dayVotes: {},
      pendingVoteSeats: [],
      pendingHunterSeat: exiledHunter.seatIndex,
      hunterFromPhase: 'vote',
      publicLogs: [
        ...logs,
        {
          day: state.day,
          kind: 'system',
          text: `${exiledHunter.seatIndex + 1}号【猎人】被放逐，可选择开枪带走一名玩家！`,
        },
      ],
    }
  }

  const nextDay = state.day + 1
  return {
    ...state,
    day: nextDay,
    phase: 'night_wolf',
    seats: nextSeats.map((s) => ({ ...s, lastSpeech: '', lastThought: undefined })),
    dayVotes: {},
    pendingVoteSeats: [],
    pendingHunterSeat: null,
    hunterFromPhase: null,
    publicLogs: [
      ...logs,
      { day: nextDay, kind: 'system', text: `第 ${nextDay} 夜降临：天黑请闭眼…` },
    ],
  }
}
