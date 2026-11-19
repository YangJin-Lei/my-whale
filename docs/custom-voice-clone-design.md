# 自定义音色与声音克隆设计文档（仅设计文档，暂未开发）

> **状态**：仅规划设计文档（Design Doc Only），当前版本暂不进行代码开发。

---

## 1. 背景与用户需求

目前 `my-whale` 的语音播报仅内置两款预设音色（`stella` 女声 / `tide` 男声）。用户希望能够自由调节或定制回复声音：
- 选择或微调自己喜欢的说话音色、语调与语速（如清新、御姐、少年、奶音等风格）；
- 导入或录制喜欢的参考音频（例如喜欢的明星声线、动漫角色、亲友或自定义桌宠专属声音），并在对话、桌宠及斗地主/狼人杀等多角色小游戏中分别为不同角色绑定独立音色。

---

## 2. 技术方案选型

结合 `my-whale` 纯前端 + Capacitor Android 壳架构，规划三档可组合方案：

### 方案 A：云端 Zero-Shot 声音克隆接口（推荐主力）
- **代表能力**：CosyVoice Cloud、Fish Audio、MiniMax Speech、Seed-TTS 或自建推理网关。
- **工作方式**：
  1. 用户上传 3～15 秒干净人声参考片段（`.wav` / `.mp3` / `.m4a`）及对应参考文本；
  2. 提交至支持零样本克隆的 TTS 服务生成或缓存 `voiceId`；
  3. 聊天或游戏触发朗读时传入 `voiceId` + 待合成文本，返回 MP3/PCM 音频流，复用现有 `readAloud.ts` 的 WebAudio 播放器与自动朗读队列。
- **优点**：手机端零算力压力、音色相似度高、支持多情感控制。
- **代价**：需另行配置语音服务 API Key 或网关，产生独立语音推理费用。

### 方案 B：本地 / 局域网私有推理服务（GPT-SoVITS / CosyVoice2 / F5-TTS）
- **工作方式**：用户在设置页填写本地/局域网 HTTP 推理服务地址（如 `http://192.168.x.x:9880/tts`），前端请求 `/tts` 传入 `refAudio` 与 `text`。
- **优点**：数据不出内网、不按字数计费、适合桌面端（Tauri）搭配本机显卡用户。
- **缺点**：依赖用户自行部署推理服务，手机外出场景需内网穿透或仅局域网使用。

### 方案 C：轻量参数调音（免外部克隆接口兜底）
- **工作方式**：基于现有默认 TTS 音频流或 WebAudio 节点链增加可控音频后处理：
  - `playbackRate`（0.75x ～ 1.35x 语速调节）
  - 音高偏移（Pitch Shift / BiquadFilter 泛音塑形，模拟低沉、明快、卡通童声等质感）
- **优点**：零额外接口成本、立即可用，适合作为“声音调校”基础滑块长期保留。

---

## 3. 数据模型设计

```ts
export type VoiceSourceType = 'builtin' | 'cloud_clone' | 'local_http' | 'dsp_preset'

export interface CustomVoiceProfile {
  id: string
  /** 展示名称，例如「奶龙奶音」「低沉大叔」「自用参考声线」 */
  name: string
  sourceType: VoiceSourceType
  /** 云端服务生成的 voice_id，或 builtin 名称 (stella/tide) */
  remoteVoiceId?: string
  /** 存储在 IndexedDB 中的参考音频键名（local/cloud 上传复用） */
  refAudioKey?: string
  /** 参考音频转写文本（Zero-Shot 必填） */
  refText?: string
  /** 私有推理服务地址（sourceType === 'local_http'） */
  endpointUrl?: string
  /** 播放语速 0.75 ~ 1.35 */
  rate: number
  /** 音调偏移 -6 ~ +6 半音 */
  pitchSemitones: number
  createdAt: number
}
```

### 角色与桌宠映射（与现有能力联动）
```ts
/** 为不同桌宠或小游戏角色指定默认音色 */
export type PetVoiceBindingMap = Record<string, string> // key: petId | personaId -> CustomVoiceProfile.id
```

---

## 4. 核心交互流程规划

1. **入口位置**：「设置 → 通用设置 → 语音模式 → 音色管理」（打开独立子页 / 弹窗）。
2. **创建自定义音色**：
   - 支持「文件上传（MP3/WAV）」与「麦克风现场录制（3～15 秒）」两种录入方式；
   - 自动检测时长与峰值音量并提示试听；
   - 选择预设风格滑块（语速、音色明暗、音高）或关联云端/本地克隆通道。
3. **试听与设为默认**：提供「试听一句话」按钮，一键切换聊天默认朗读音色，或在「桌宠库 / 角色设置」中为具体宠物单独绑定。
4. **播报调度**：复用 `web/src/services/speech/readAloud.ts` 的全局播放队列与「自动朗读」开关：
   - 对话完成 -> 查询当前角色/桌宠绑定的 `CustomVoiceProfile` -> 路由至对应驱动（官方 TTS / 云端克隆 / 本地 HTTP / DSP 后处理）-> 解码并播放。

---

## 5. 合规、版权与风险边界

1. **声音权与肖像权合规声明**：
   - 在上传自定义参考音频前强制弹出确认勾选框：用户需确认所上传声音仅用于个人学习娱乐，且不用于冒充他人身份、商业宣传、电信诈骗或侵害他人人格权。
2. **禁止隐蔽存储第三方声纹**：
   - 参考音频文件原则上仅存于用户本地 IndexedDB；若用户启用云端第三方接口，仅在显式配置接口并点击上传时传输。
3. **成本透明**：
   - 若未来接入第三方商业克隆 TTS API，需与现有 DeepSeek 余额计费明确区分，避免用户误以为涵盖在 DeepSeek API 额度中。

---

## 6. 分阶段演进计划

| 阶段 | 内容 | 说明 |
| --- | --- | --- |
| Phase 1 | 音频参数调节与风格预设 | 基于 WebAudio 为现有 `stella`/`tide` 增加语速、音高滑块与声音风格预设 |
| Phase 2 | 本地 / 通用 HTTP TTS 接入 | 支持填写兼容 GPT-SoVITS / OpenAI TTS `/audio/speech` 的服务地址与参考音频上传 |
| Phase 3 | 桌宠与多角色小游戏联动 | 为奶龙、吉伊、柯南等桌宠及斗地主/狼人杀每位玩家分配独立声线 |
