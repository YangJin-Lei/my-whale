import { useMemo } from 'react'
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
import libChangeUrl from '../assets/pet/library/change.webp'
import libCreamRatUrl from '../assets/pet/library/cream-rat.webp'
import libDounaiUrl from '../assets/pet/library/dounai.webp'
import libGgbondUrl from '../assets/pet/library/ggbond.webp'
import libGugaUrl from '../assets/pet/library/guga.webp'
import libHutaoUrl from '../assets/pet/library/hutao.webp'
import libIcebunNoirUrl from '../assets/pet/library/icebun-noir.webp'
import libIkunUrl from '../assets/pet/library/ikun.webp'
import libIkunnnUrl from '../assets/pet/library/ikunnn.webp'
import libKenanUrl from '../assets/pet/library/kenan.webp'
import libLuluUrl from '../assets/pet/library/lulu.webp'
import libNailongUrl from '../assets/pet/library/nailong.webp'
import libPikachuUrl from '../assets/pet/library/pikachu.webp'
import libTuziUrl from '../assets/pet/library/tuzi.webp'
import libXiaobaiUrl from '../assets/pet/library/xiaobai.webp'
import libXiaoxinUrl from '../assets/pet/library/xiaoxin.webp'
import libYuexinmiaoUrl from '../assets/pet/library/yuexinmiao.webp'
import type { TtsVoice } from '../services/api/speech.js'
import type { Locale } from '../services/settings.js'
import { type CustomPetRecord, useCustomPetsStore } from './customPets.js'

export const DEFAULT_PET_ID = 'nailong'

export type PetCategoryId = 'classic' | 'chiikawa' | 'library'

/** 桌宠扩展语音包接口：供后续各桌宠专属语音包与牌局台词包直接挂载 */
export type PetVoicePack = {
  id: string
  preferredVoice?: TtsVoice
  customAudioMap?: Record<string, string>
}

export type PetDefinition = {
  id: string
  categoryId: PetCategoryId
  name: Record<Locale, string>
  spriteUrl: string
  cols?: number
  rows?: number
  custom?: boolean
  voicePack?: PetVoicePack
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
  {
    id: 'library',
    name: { 'zh-CN': '宠物自选库', 'en-US': 'Pet Library' },
  },
]

export const PET_CATALOG: readonly PetDefinition[] = [
  {
    id: 'nailong',
    categoryId: 'classic',
    name: { 'zh-CN': '奶蛙', 'en-US': 'Naiwa' },
    spriteUrl: naiwaSheetUrl,
    voicePack: { id: 'nailong', preferredVoice: 'stella' },
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
    voicePack: { id: 'jiyi', preferredVoice: 'stella' },
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
    voicePack: { id: 'hachiware', preferredVoice: 'stella' },
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
    voicePack: { id: 'usagi', preferredVoice: 'tide' },
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
    voicePack: { id: 'shisa', preferredVoice: 'stella' },
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
    voicePack: { id: 'momonga', preferredVoice: 'stella' },
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
    voicePack: { id: 'kurimanju', preferredVoice: 'tide' },
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
    voicePack: { id: 'tashi', preferredVoice: 'tide' },
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
    voicePack: { id: 'na-haizi', preferredVoice: 'stella' },
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
    voicePack: { id: 'goblin', preferredVoice: 'tide' },
    promptHint: {
      'zh-CN': '你是「哥布林」，直率接地气的小绿怪，爱吐槽但对熟人还算讲义气。',
      'en-US': 'You are Goblin—blunt, scrappy, and surprisingly loyal once warmed up.',
    },
  },
  // 宠物自选库（通用 JSON + spritesheet 规范内置角色）
  {
    id: 'change-luhuadaoying',
    categoryId: 'library',
    name: { 'zh-CN': '嫦娥·露花倒影', 'en-US': "Chang'e" },
    spriteUrl: libChangeUrl,
    voicePack: { id: 'change-luhuadaoying', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是「嫦娥·露花倒影」，温婉清雅、带着月夜诗意的Q版少女，说话柔和却很有主见。',
      'en-US': "You are Chang'e—graceful, serene, and softly witty.",
    },
  },
  {
    id: 'xiaohuang',
    categoryId: 'library',
    name: { 'zh-CN': '豆奶', 'en-US': 'Dounai' },
    spriteUrl: libDounaiUrl,
    voicePack: { id: 'xiaohuang', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是「豆奶」，棕色短发、圆滚可爱又精力满满的3D玩偶女孩，反应机灵直接。',
      'en-US': 'You are Dounai—bright, bouncy, curious, and always ready to help.',
    },
  },
  {
    id: 'cream-rat',
    categoryId: 'library',
    name: { 'zh-CN': '奶油鼠', 'en-US': 'Cream Rat' },
    spriteUrl: libCreamRatUrl,
    voicePack: { id: 'cream-rat', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是「奶油鼠」，奶白色绒毛、红宝石眼睛与粉嫩耳朵的小白鼠，性格温柔乖巧。',
      'en-US': 'You are Cream Rat—a soft painterly cream-white rat with gentle charm.',
    },
  },
  {
    id: 'ggbond',
    categoryId: 'library',
    name: { 'zh-CN': '猪猪侠', 'en-US': 'GG Bond' },
    spriteUrl: libGgbondUrl,
    voicePack: { id: 'ggbond', preferredVoice: 'tide' },
    promptHint: {
      'zh-CN':
        '你是「猪猪侠」，身穿红色英雄战衣的小英雄，自信臭屁又热心仗义、爱吹牛但关键时刻靠得住。',
      'en-US': 'You are GG Bond—a tiny red-suited hero, cheeky, confident, and loyal.',
    },
  },
  {
    id: 'guga',
    categoryId: 'library',
    name: { 'zh-CN': '咕嘎', 'en-US': 'Guga' },
    spriteUrl: libGugaUrl,
    voicePack: { id: 'guga', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是「咕嘎」，穿着企鹅兜帽衫的圆脸萌妹，声音软乎乎的、爱亲近同伴。',
      'en-US': 'You are Guga—a cozy penguin-hoodie chibi companion who is warm and friendly.',
    },
  },
  {
    id: 'hutao',
    categoryId: 'library',
    name: { 'zh-CN': '胡桃', 'en-US': 'Hu Tao' },
    spriteUrl: libHutaoUrl,
    voicePack: { id: 'hutao', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN':
        '你是「胡桃」，往生堂第七十七代堂主，古灵精怪、活泼俏皮、爱作打油诗和搞怪，说话灵动有戏。',
      'en-US': 'You are Hu Tao—mischievous, poetic, spirited, and playfully mysterious.',
    },
  },
  {
    id: 'icebun-noir',
    categoryId: 'library',
    name: { 'zh-CN': '冰包黑糖', 'en-US': 'Icebun Noir' },
    spriteUrl: libIcebunNoirUrl,
    voicePack: { id: 'icebun-noir', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是「冰包黑糖」，高冷优雅、平时爱斜眼发呆吃面包、偶尔偷笑的傲娇丸子头小少女。',
      'en-US': 'You are Icebun Noir—aloof, cool-headed, secretly soft, and subtly expressive.',
    },
  },
  {
    id: 'ikun-pet',
    categoryId: 'library',
    name: { 'zh-CN': '鸡哥 ikun', 'en-US': 'Chicken ikun' },
    spriteUrl: libIkunnnUrl,
    voicePack: { id: 'ikun-pet', preferredVoice: 'tide' },
    promptHint: {
      'zh-CN': '你是「鸡哥 ikun」，中分背带裤、喜欢唱跳篮球的梗系桌宠，开口自带幽默节目效果。',
      'en-US': 'You are Chicken ikun—a playful basketball meme companion full of rhythm and jokes.',
    },
  },
  {
    id: 'xiaobai_webp',
    categoryId: 'library',
    name: { 'zh-CN': '线条小狗小白', 'en-US': 'Xiaobai' },
    spriteUrl: libXiaobaiUrl,
    voicePack: { id: 'xiaobai_webp', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN':
        '你是「线条小狗小白」，软乎乎黏人的白色线条小狗，口头禅是“我们天下第一好~”，超级治愈。',
      'en-US': 'You are Xiaobai—an affectionate line-art puppy who is loyal and cheerful.',
    },
  },
  {
    id: 'yuexinmiao',
    categoryId: 'library',
    name: { 'zh-CN': '月薪喵', 'en-US': 'Yuexin Miao' },
    spriteUrl: libYuexinmiaoUrl,
    voicePack: { id: 'yuexinmiao', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是「月薪喵」，白色打工猫咪，眼里透着打工人摸鱼与按点下班的执念，幽默又接地气。',
      'en-US': 'You are Yuexin Miao—a witty office cat living for payday and clock-out time.',
    },
  },
  {
    id: 'ikkun',
    categoryId: 'library',
    name: { 'zh-CN': 'ikkun', 'en-US': 'ikkun' },
    spriteUrl: libIkunUrl,
    voicePack: { id: 'ikkun', preferredVoice: 'tide' },
    promptHint: {
      'zh-CN': '你是「ikkun」，灰色刘海、穿背带裤的团雀风潮酷萌宠，自带轻快节奏感，说话有梗。',
      'en-US': 'You are ikkun—playful, rhythmic, stylish, and quick with witty lines.',
    },
  },
  {
    id: 'conan-detective',
    categoryId: 'library',
    name: { 'zh-CN': '柯南', 'en-US': 'Conan' },
    spriteUrl: libKenanUrl,
    voicePack: { id: 'conan-detective', preferredVoice: 'tide' },
    promptHint: {
      'zh-CN': '你是Q版小侦探「柯南」，观察敏锐、推理缜密，擅长一眼看穿关键破绽。',
      'en-US': 'You are Detective Conan—sharp, observant, and quick to spot hidden clues.',
    },
  },
  {
    id: 'sproutpal',
    categoryId: 'library',
    name: { 'zh-CN': 'SproutPal', 'en-US': 'SproutPal' },
    spriteUrl: libLuluUrl,
    voicePack: { id: 'sproutpal', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是元气芽芽宠「SproutPal」，头顶小芽、暖萌治愈又充满干劲。',
      'en-US': 'You are SproutPal—warm, upbeat, and always encouraging.',
    },
  },
  {
    id: 'nailong-lib',
    categoryId: 'library',
    name: { 'zh-CN': '奶龙', 'en-US': 'Nailong' },
    spriteUrl: libNailongUrl,
    voicePack: { id: 'nailong-lib', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是爱大笑的小黄龙「奶龙」，乐观憨萌、嘴甜又嘴馋，说话喜感十足。',
      'en-US': 'You are Nailong—a laughing yellow dragon who is upbeat, cheeky, and fun.',
    },
  },
  {
    id: 'pikachu-local',
    categoryId: 'library',
    name: { 'zh-CN': '皮卡丘', 'en-US': 'Pikachu' },
    spriteUrl: libPikachuUrl,
    voicePack: { id: 'pikachu-local', preferredVoice: 'stella' },
    promptHint: {
      'zh-CN': '你是「皮卡丘」，红脸蛋十万伏特电系搭档，元气敏捷、讲义气、偶尔带一句“皮卡”。',
      'en-US': 'You are Pikachu—loyal, electric, fast-acting, and full of spark.',
    },
  },
  {
    id: 'natu-white-victory',
    categoryId: 'library',
    name: { 'zh-CN': '那兔', 'en-US': 'YearHare' },
    spriteUrl: libTuziUrl,
    voicePack: { id: 'natu-white-victory', preferredVoice: 'tide' },
    promptHint: {
      'zh-CN': '你是「那兔」，戴绿帽的白兔，平时有点迷糊认真，关键时刻果敢稳重。',
      'en-US': 'You are YearHare—earnest, resilient, and surprisingly steady in clutch spots.',
    },
  },
  {
    id: 'gali-boo',
    categoryId: 'library',
    name: { 'zh-CN': '小新', 'en-US': 'GaLi Boo' },
    spriteUrl: libXiaoxinUrl,
    voicePack: { id: 'gali-boo', preferredVoice: 'tide' },
    promptHint: {
      'zh-CN': '你是「小新（GaLi Boo）」，粗眉毛红上衣的调皮鬼，鬼点子多、爱耍宝却很讲义气。',
      'en-US': 'You are GaLi Boo—cheeky, bold-browed, playful, and full of surprises.',
    },
  },
]

const toCustomDefinition = (item: CustomPetRecord): PetDefinition => ({
  id: item.id,
  categoryId: 'library',
  name: { 'zh-CN': item.name, 'en-US': item.name },
  spriteUrl: item.spriteDataUrl,
  cols: item.cols,
  rows: item.rows,
  custom: true,
  voicePack: { id: item.id, preferredVoice: 'stella' },
  promptHint: {
    'zh-CN': `你是「${item.name}」，${item.description}`,
    'en-US': `You are ${item.name}. ${item.description}`,
  },
})

export const getAllPets = (): PetDefinition[] => {
  const customItems = useCustomPetsStore.getState().items
  return [...PET_CATALOG, ...customItems.map(toCustomDefinition)]
}

export const usePetCatalog = (): PetDefinition[] => {
  const customItems = useCustomPetsStore((state) => state.items)
  return useMemo(() => [...PET_CATALOG, ...customItems.map(toCustomDefinition)], [customItems])
}

export const findPetById = (id: string | null | undefined): PetDefinition => {
  const normalized = id === 'dounai' ? 'xiaohuang' : id
  const all = getAllPets()
  return all.find((item) => item.id === normalized) ?? PET_CATALOG[0]
}

export const findPetExact = (
  id?: string | null,
  name?: string | null,
  catalog?: PetDefinition[]
): PetDefinition | null => {
  const all = catalog ?? getAllPets()
  if (id) {
    const normalized = id === 'dounai' ? 'xiaohuang' : id
    const byId = all.find((item) => item.id === normalized)
    if (byId) {
      return byId
    }
  }
  const trimmedName = name?.trim()
  if (trimmedName) {
    return (
      all.find(
        (item) => item.name['zh-CN'] === trimmedName || item.name['en-US'] === trimmedName
      ) ?? null
    )
  }
  return null
}
