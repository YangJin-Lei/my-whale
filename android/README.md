# my-whale Android（Kotlin 原生客户端）

> 应用名称：`my-whale`　包名：`com.mywhale.app`　分发方式：Universal Release APK

## 1. 单一事实来源（Spec）

协议与数据完全以以下两处为唯一标准（Single Source of Truth），确保 Android APK 与 Web 端之间可以无缝迁移数据：

- 上层需求与业务规范：[../docs/二次开发文档-引导与余额.md](../docs/二次开发文档-引导与余额.md)、[../docs/二次开发文档-人设与记忆.md](../docs/二次开发文档-人设与记忆.md)
- 参考实现（Reference Implementation）：`../web`（与上游基线对比可参考 `../vender/chat-demo`）

两端必须保持 **100% 一致** 的核心规范：
1. **API 请求格式**：DeepSeek 开放平台鉴权（`/models`）、余额查询（`GET /user/balance`）、Anthropic 兼容消息流式接口（`POST /anthropic/v1/messages`）与 Files API（`/anthropic/v1/files`），包括 `thinking`、`safety_check: { level: "high" }`、`tools`（`deepseek_read_url` / `deepseek_web_search`）、`title` 及 `latest_reminder` 机制。
2. **系统提示词拼装逻辑（`buildSystemPrompt`）**：按 `[1] 基础规则 → [2] 人设指令 → [3] 会话补充指令 → [4] 关于用户 → [5] 精选记忆 + 使用规则` 的固定顺序与字符预算组装，保持同一会话内 `system` 稳定以命中上下文缓存。
3. **人设与记忆数据结构**：`Persona`、`SessionPersona`（会话快照）、`Memory` 的字段语义与限制（如头像 `dataURL ≤ 64KB`、人设指令 `≤ 4000` 字、记忆注入预算 `≤ 3000` 字、敏感信息过滤规则）。
4. **跨端迁移格式**：
   - 独立人设/记忆包：`my-whale-profile.json`（`format: "my-whale-profile"`, `version: 1`，不含 API Key）。
   - 会话归档：与 Web 端兼容的 `export_format_version: 3` ZIP 格式（含可选会话人设快照字段）。

---

## 2. 技术栈

| 模块 | 选型 | 说明 |
|---|---|---|
| 语言与异步 | **Kotlin + Coroutines / Flow** | 统一异步流、SSE 状态机与生命周期管理 |
| UI 框架 | **Jetpack Compose (Material 3)** | 声明式 UI、深浅色主题、动态手势与返回栈 |
| 网络与流式 | **OkHttp (SSE)** | 原生直连 DeepSeek API，无 CORS 限制；严格流式解析与超时/重试控制 |
| 本地数据库 | **Room (SQLite)** | 存储 `sessions`、`messages`、`files`、`personas`、`memories` |
| 轻量配置与安全 | **DataStore + Android Keystore / EncryptedSharedPreferences** | 保存设置项及加密存储 API Key |
| 外部页面与登录/充值 | **AndroidX Browser (Chrome Custom Tabs)** | 拉起官网获取 API Key / 充值页，共享浏览器登录态并在 `onResume` 刷新余额与检测剪贴板 |
| 图片加载 | **Coil** | 本地图片附件与人设头像加载 |
| 富文本渲染 | **Compose Markdown + 局部轻量 WebView（按需）** | 文本/代码块原生渲染；Mermaid 图表与复杂 LaTeX 公式可按需内嵌轻量 WebView 保证还原度 |

---

## 3. 分期推进计划

### 一期：核心闭环（打通主流程）
1. **引导与鉴权**：首次启动引导页、Custom Tabs 跳转 `platform.deepseek.com/api_keys`、`onResume` 剪贴板 `sk-` Key 检测与一键粘贴、`GET /models` 校验与加密保存。
2. **实时余额**：调用 `GET /user/balance`、余额展示徽标（支持 CNY/USD 字符串精确展示，不做浮点运算）、`402` 状态联动、“没有余额？点击这里”跳转 `top_up`、允许“稍后充值，先进入”。
3. **基础聊天流式输出**：OkHttp SSE 流式解析、`thinking` 深度思考折叠与耗时统计、`deepseek_read_url` / `deepseek_web_search` 步骤与引用展示、`latest_reminder` 注入、停止/重试。
4. **人设系统（核心）**：`buildSystemPrompt` 接入请求、内置模板（3 个必做角色陪伴人设 + 实用助手）、人设库 CRUD、欢迎页卡片与开场白、会话人设快照与会话内切换、角色括号动作斜体渲染、试聊。

### 二期：进阶能力与数据互通
1. **消息树与分支切换**：支持编辑用户提问、重新生成多版本回复及分支切换（对齐 `parentId` / `selectedChildId`）。
2. **多模态附件与语音**：图片/文档上传（Files API 与 `file_id` 失效自动补传重试）、`RECORD_AUDIO` 语音输入与回复朗读。
3. **全局记忆与自动提炼**：关于我、记忆管理（增删改查/置顶/停用/搜索/无痕会话）、`selectMemories` 预算挑选、后台静默自动提炼（`WorkManager` / 协程退避 + 敏感信息过滤 + 撤销提示条）。
4. **全量数据互通**：兼容 `export_format_version: 3` 历史 ZIP 导入导出与 `my-whale-profile.json` 导入导出（SAF / Share）。
5. **渲染增强与发版**：Mermaid 图表与 KaTeX 公式渲染完善、Release 签名与 Universal APK 打包发布。
