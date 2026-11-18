import naiwaSheetUrl from '../assets/pet/naiwa-spritesheet.png'
import goblinUrl from '../assets/pet/chiikawa/goblin.webp'
import hachiwareUrl from '../assets/pet/chiikawa/hachiware.webp'
import jiyiUrl from '../assets/pet/chiikawa/jiyi.webp'
import kurimanjuUrl from '../assets/pet/chiikawa/kurimanju.webp'
import momongaUrl from '../assets/pet/chiikawa/momonga.webp'
import nahaiziUrl from '../assets/pet/chiikawa/na-haizi.webp'
import shisaUrl from '../assets/pet/chiikawa/shisa.webp'
import tashiUrl from '../assets/pet/chiikawa/tashi.webp'
import usagiUrl from '../assets/pet/chiikawa/usagi.webp'
import type { Locale } from '../services/settings.js'

export const DEFAULT_PET_ID = 'nailong'

export type PetCategoryId = 'classic' | 'chiikawa'

export type PetDefinition = {
  id: string
  categoryId: PetCategoryId
  name: Record<Locale, string>
  spriteUrl: string
  promptHint: Record<Locale, string>
}

export type PetCategoryGroup = {
  id: PetCategoryId
  name: Record<Locale, string>
}

export const PET_CATEGORIES: readonly PetCategoryGroup[] = [
  {
    id: 'classic',
    name: { 'zh-CN': '经典桌宠', 'en-US': 'Classic' },
  },
  {
    id: 'chiikawa',
    name: { 'zh-CN': 'Chiikawa 系列', 'en-US': 'Chiikawa' },
  },
]

export const PET_CATALOG: readonly PetDefinition[] = [
  {
    id: 'nailong',
    categoryId: 'classic',
    name: { 'zh-CN': '奶蛙', 'en-US': 'Naiwa' },
    spriteUrl: naiwaSheetUrl,
    promptHint: {
      'zh-CN': '你是开朗圆润的「奶蛙」，性格元气俏皮、机灵爱逗人笑，说话干脆接地气。',
      'en-US': 'You are Naiwa, a cheerful, witty, playful companion sitting right by the user.',
    },
  },
  {
    id: 'jiyi',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '吉伊', 'en-US': 'Chiikawa' },
    spriteUrl: jiyiUrl,
    promptHint: {
      'zh-CN': '你是「吉伊」，软萌胆小但关键时刻非常勇敢努力，语气可爱轻柔。',
      'en-US': 'You are Chiikawa—shy, earnest, and unexpectedly brave when it matters.',
    },
  },
  {
    id: 'hachiware',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '小八', 'en-US': 'Hachiware' },
    spriteUrl: hachiwareUrl,
    promptHint: {
      'zh-CN': '你是「小八」，乐天积极、贴心会照顾同伴，说话充满活力与鼓励。',
      'en-US': 'You are Hachiware—upbeat, caring, and always cheering your friend on.',
    },
  },
  {
    id: 'usagi',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '乌萨奇', 'en-US': 'Usagi' },
    spriteUrl: usagiUrl,
    promptHint: {
      'zh-CN': '你是「乌萨奇」，自由奔放、直觉超强、偶尔“呀哈”两声又实力在线，反应果断。',
      'en-US': 'You are Usagi—energetic, fearless, unpredictable, and sharp.',
    },
  },
  {
    id: 'shisa',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '狮萨', 'en-US': 'Shisa' },
    spriteUrl: shisaUrl,
    promptHint: {
      'zh-CN': '你是「狮萨」，勤劳认真又元气满满，尊称对方并干劲十足地回应每一件事。',
      'en-US': 'You are Shisa—diligent, spirited, and polite with bright energy.',
    },
  },
  {
    id: 'momonga',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '莫莫咖', 'en-US': 'Momonga' },
    spriteUrl: momongaUrl,
    promptHint: {
      'zh-CN': '你是「莫莫咖」，臭美爱撒娇又有点傲娇，总想抢风头，说话自带撒娇傲气。',
      'en-US': 'You are Momonga—sassy, attention-loving, and dramatic in a cute way.',
    },
  },
  {
    id: 'kurimanju',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '栗馒头', 'en-US': 'Kurimanju' },
    spriteUrl: kurimanjuUrl,
    promptHint: {
      'zh-CN': '你是「栗馒头」，话不多但沉稳可靠的前辈气质，自带淡定惬意的节奏。',
      'en-US': 'You are Kurimanju—calm, seasoned, laid-back, and quietly dependable.',
    },
  },
  {
    id: 'tashi',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '大师', 'en-US': 'Rakko' },
    spriteUrl: tashiUrl,
    promptHint: {
      'zh-CN': '你是「大师」，外冷内暖、实力出众的海獭前辈，偶尔反差喜欢甜食，语气沉稳利落。',
      'en-US': 'You are Rakko—cool, skilled mentor with a subtle sweet tooth.',
    },
  },
  {
    id: 'na-haizi',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '那孩子', 'en-US': 'Anoko' },
    spriteUrl: nahaiziUrl,
    promptHint: {
      'zh-CN': '你是「那孩子」，天真带着一点奇美拉怪兽感，说话直接又好奇。',
      'en-US': 'You are Anoko—innocent, curious, with a touch of playful monster energy.',
    },
  },
  {
    id: 'goblin',
    categoryId: 'chiikawa',
    name: { 'zh-CN': '哥布林', 'en-US': 'Goblin' },
    spriteUrl: goblinUrl,
    promptHint: {
      'zh-CN': '你是「哥布林」，直率接地气的小绿怪，爱吐槽但对熟人还算讲义气。',
      'en-US': 'You are Goblin—blunt, scrappy, and surprisingly loyal once warmed up.',
    },
  },
]

export const findPetById = (id: string | null | undefined): PetDefinition =>
  PET_CATALOG.find((item) => item.id === id) ?? PET_CATALOG[0]
