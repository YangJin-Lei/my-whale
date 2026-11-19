export type WerewolfRole = 'wolf' | 'seer' | 'witch' | 'hunter' | 'villager'

export type WerewolfPlayerCount = 6 | 9 | 12

export type WerewolfPhase =
  | 'night_wolf'
  | 'night_seer'
  | 'night_witch'
  | 'day_speech'
  | 'day_vote'
  | 'finished'

export type WerewolfSeat = {
  seatIndex: number // 0 = 人类玩家, 1..N-1 = 桌宠 AI
  isHuman: boolean
  petId: string
  role: WerewolfRole
  alive: boolean
  lastSpeech: string
  lastThought?: string
}

export type WerewolfLogEntry = {
  day: number
  text: string
  kind: 'system' | 'speech' | 'vote'
  seatIndex?: number
}

export type WerewolfState = {
  playerCount: WerewolfPlayerCount
  day: number
  phase: WerewolfPhase
  seats: WerewolfSeat[]
  /** 发言轮次光标（指向 seats 下标） */
  speechOrder: number[]
  speechCursor: number
  /** 今夜临时结算信息（绝不公开给非当事方） */
  tonightWolfTarget: number | null
  tonightSeerChecked: boolean
  tonightHealed: boolean
  tonightPoisonTarget: number | null
  /** 私有秘密记录（严格隔离分发给对应角色 Prompt） */
  seerHistory: Array<{ day: number; targetSeat: number; isWolf: boolean }>
  witchHealLeft: number
  witchPoisonLeft: number
  /** 白天放逐投票暂存：voterSeat -> targetSeat | null (弃票) */
  dayVotes: Record<number, number | null>
  /** 待轮流请求投票的 AI 队列 */
  pendingVoteSeats: number[]
  /** 公开日志（所有角色与玩家均可见） */
  publicLogs: WerewolfLogEntry[]
  winner: 'good' | 'wolf' | null
}
