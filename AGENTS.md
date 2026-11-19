# AGENTS.md — my-whale 开发、排查与发布指南

本文档汇总了 `my-whale` 在多端（Android Capacitor、Tauri Desktop、Web/PWA、本地缓存后端）迭代中踩过的真实问题、根因排查方法、不可破坏的架构契约与发布前校验清单。后续开发与 AI Agent 修改代码前请先阅读。

---

## 1. 仓库结构与代码规范

| 目录 | 作用 | 关键技术与注意事项 |
| --- | --- | --- |
| `web/` | 前端核心（React + Zustand + Rspack） | **所有相对导入必须带 `.js` 扩展名**；`oxlint` 启用了 `curly: all`、`no-any`、禁用 `!` 非空断言、禁用 `console`、禁用 `no-dynamic-delete`。 |
| `android/` | Capacitor 8 Android 原生壳 | 原生插件：`AppUpdaterPlugin`、`CacheBackendPlugin`、`SecureStoragePlugin`，本地代理 `LocalCacheServer.java`。 |
| `desktop/` | Tauri v2 桌面端 | Rust 内置缓存与更新逻辑在 `desktop/src-tauri/src/local_cache.rs` 与 `lib.rs`；改 `tauri.conf.json` 后务必 `JSON.parse` 校验。 |
| `cache-server/` | 独立 Node.js 缓存代理服务 | 用于桌面/本地独立启动调试，需与 Android Java、Tauri Rust 保持协议与搜索回退逻辑三端一致。 |
| `site/` | GitHub Pages 官网展示与跳转页 | 含版本号徽章，`pages.yml` 部署时会读取 `web/package.json` 生成 `version.json`。 |
| `vender/` | 参考源码与本地签名文件（已 gitignore） | **严禁把 `vender/*.jks` 或密码提交进 Git**。 |

### 格式化与 CRLF 注意事项（Windows）
- **禁止**全量执行 `oxfmt src`，否则会把无关文件从 CRLF 刷成 LF 污染 diff。
- **只格式化本次修改过的文件**（在 `web/` 下执行）：
  ```powershell
  .\node_modules\.bin\oxfmt.cmd --write src/path/to/changed1.ts src/path/to/changed2.tsx
  ```

---

## 2. Android 构建、签名与更新异常排查

### 2.1 签名证书一致性铁律
- **唯一正式发布证书 SHA-256 指纹**：
  `49defdc7e1aebdb8d57bdea20b4f5fceac22db53cb121cbaec60b3706e272063`
  （DN: `CN=yangjinlei, OU=Dev, O=my-whale, L=China, ST=China, C=CN`）。
- GitHub Actions Secret `ANDROID_KEYSTORE_BASE64` 与本地 `vender/my-whale-release.jks` 为同一套正式证书。
- **禁止行为**：
  - **严禁**重新生成或覆盖正式 keystore（会导致所有已安装用户无法覆盖升级）。
  - 本地 `assembleDebug` 产出的包使用 `~/.android/debug.keystore`（指纹 `f5f59eca...`），**无法直接覆盖正式版**，反之亦然。
  - [android/app/build.gradle](file:///E:/my-whale/android/app/build.gradle) 已设置防呆：无 `android/keystore.properties`、`ANDROID_KEYSTORE_*` 环境变量或 `-Pandroid.injected.signing.*` 时，执行 Release 构建会直接失败拒绝产出未签名/错签包。
  - [.github/workflows/release.yml](file:///E:/my-whale/.github/workflows/release.yml) 禁止在缺少 `ANDROID_KEYSTORE_BASE64` 时静默退化产出 `-android-debug.apk`。

### 2.2 更新器异常排查（“已安装相同版本” / “解析错误” / “签名不一致”）
如果用户更新时出现系统安装器报错，按以下顺序核对：
1. **弹出“已安装相同版本”或版本号倒退**：
   - 检查 7 处版本号是否忘记同步递增，`versionCode` 必须满足 `MAJ * 10000 + MIN * 100 + PAT` 严格递增。
   - 检查 [AppUpdaterPlugin.java](file:///E:/my-whale/android/app/src/main/java/com/mywhale/app/AppUpdaterPlugin.java)：下载包必须写入按 tag 隔离的 `cacheDir/updates/my-whale-<tag>.apk`，并在安装前通过 `getPackageArchiveInfo` 校验 `archiveVersionCode > installedVersionCode`（相同或更低版本直接拦截报错 `SAME_VERSION` / `DOWNGRADE_BLOCKED`）。
2. **弹出“解析包错误”**：
   - 常见于镜像节点（`ghfast.top` / `gh-proxy.com`）断流截断或返回了 HTML 报错页。
   - `AppUpdaterPlugin` 已校验 HTTP `Content-Type`（拒绝 `text/*`、`application/json`）、`receivedBytes == Content-Length`、`ZipFile` 打开并含 `AndroidManifest.xml`，以及可选 `expectedSha256`。排查时重点确认前端是否从 Release API 拿到了正确的 `.apk` URL 与 digest。
3. **检查更新提示新版，点更新却 404**：
   - `Deploy GitHub Pages`（生成 `version.json`）在推送后约 45 秒完成，而 `Release Multi-Platform Builds` 编完 Android + Desktop 并上传 APK 需要 7~10 分钟。
   - [update.ts](file:///E:/my-whale/web/src/services/update.ts) 已通过 `verifyReleaseTagPublished()` 二次核实 `/releases/tags/<tag>` 确实存在 `-android.apk` 资产后才标记 `available`；切勿绕开此核实或把 `-android-debug.apk` 加回下载候选列表。
4. **“签名不一致 / 应用未安装”**：
   - 早期 `v0.1.0`–`v0.1.5` 及本地 `assembleDebug` 均非正式签名；`AppUpdaterPlugin` 安装前会对比已安装签名指纹与下载包签名指纹，不匹配时返回 `SIGNATURE_MISMATCH`。此时唯一安全路径是提示用户先通过「全量加密备份」导出全部会话/附件/Key，卸载旧测试版，再装正式版恢复。

### 2.3 每次发布必须同步更新的 7 个文件
发布新版本 `vX.Y.Z`（例如 `0.1.17` -> `117`）时，缺一不可：
1. `web/package.json` (`"version"`)
2. `android/app/build.gradle` (`versionCode` 与 `versionName`)
3. `desktop/package.json` (`"version"`)
4. `desktop/src-tauri/Cargo.toml` (`version`)
5. `desktop/src-tauri/tauri.conf.json` (`"version"`)
6. `site/index.html` (`<span class="badge">vX.Y.Z</span>`)
7. `cache-server/package.json` (`"version"`)

---

## 3. WebView Origin、本地存储与全量备份规范

### 3.1 锁定 WebView Origin（不可变契约）
- [web/capacitor.config.ts](file:///E:/my-whale/web/capacitor.config.ts) 显式锁定 `server: { androidScheme: 'https', hostname: 'localhost' }`，确保 Android WebView 永远运行在 **`https://localhost`**。
- **严禁**随意变更 scheme、hostname 或切换 `server.url` 指向远程域名——一旦 Origin 变化，浏览器底层会隔离 `localStorage` 与 `IndexedDB`，导致用户历史对话、设置、附件全部“失踪”。
- API 地址与 WebView Origin 保持解耦，切换官方/代理请求地址只改 `client.ts` 与 `cacheBackend.ts`。

### 3.2 API Key 硬件加密与冷启动防竞态
- Android 原生通过 [SecureStoragePlugin.java](file:///E:/my-whale/android/app/src/main/java/com/mywhale/app/SecureStoragePlugin.java) 使用 **Android Keystore (`AES/GCM/NoPadding`)** 加密 API Key 后存入 `mywhale_secure_prefs`。
- [settings.ts](file:///E:/my-whale/web/src/services/settings.ts) 中 `hydrateNativeApiKey()` 会自动把老版本遗留在 `localStorage['chat-demo:api-key']` 的明文迁入 Keystore 并擦除明文。
- **高危时序坑（已修复，勿破坏）**：`localStorage` 同步读取在迁移后为 `null`，而 Keystore 读取是异步 `Promise`。**必须在 [App.tsx](file:///E:/my-whale/web/src/app/App.tsx) 中 `await waitForApiKeyHydration()` 后再调用 `ensureApiKey()`**；否则每次冷启动首帧都会误判“无 API Key”而弹出首次引导页「欢迎使用 my-whale」。
- `AndroidManifest.xml` 关联的 `backup_rules.xml` 与 `data_extraction_rules.xml` 排除了 `mywhale_secure_prefs.xml`（Android Keystore 密钥无法跨卸载/换机迁移，带走密文只会失效）、`mywhale_cache.db` 与 `updates/`。

### 3.3 全量加密备份与 DeepSeek 归档分工
- **禁止**在启动、刷新、重连、版本升级时调用 `clearCache`、`clearHistory`、`deleteDatabase`、`localStorage.clear()`。
- **DeepSeek 兼容归档**（[exportArchive.ts](file:///E:/my-whale/web/src/services/chat/history/exportArchive.ts) / [importArchive.ts](file:///E:/my-whale/web/src/services/chat/history/importArchive.ts)）：用于与 DeepSeek 官方 `deepseek_data-*.zip` 互通；受限于其 V3 格式定义，只导出图片原件，`export_path` 不承载非图片文件。
- **完整迁移/灾备专用全量包**（[fullBackup.ts](file:///E:/my-whale/web/src/services/fullBackup.ts)，`my-whale-backup-YYYY-MM-DD.zip`）：
  - 完整包含：`conversations.json`（含分支树、`persona`、`compaction`）、`attachments/` + `attachments_meta.json`（**包含图片与 PDF/DOCX/TXT/ZIP 全部原件二进制与 MIME/引用关系**）、`personas.json`、`memories.json`、`custom_pets.json`、`settings.json`（无明文 Key）。
  - 加密机制：仅在用户设置密码时写入 `encrypted-secrets.bin`，使用 Web Crypto **`PBKDF2-HMAC-SHA256`（310,000 次迭代 + 随机 16B salt）+ `AES-256-GCM`（随机 12B IV）** 加密 API Key；未设密码绝不导出 API Key 明文。
  - 恢复安全原则：密码错误在任何数据库写入前由 AES-GCM 认证拒绝；「覆盖恢复」走 IndexedDB `staging` 单事务原子替换，「合并恢复」按 ID 在单事务内去重，失败自动回滚，绝不破坏当前数据。

---

## 4. 缓存后端、联网检索与上下文压缩

1. **网络层与搜索三端同步**：
   - 任何涉及缓存代理、`/anthropic/v1/messages` 请求转发、内置搜索与抓取、SSE 合成块的改动，必须同步检查并更新三端：
     - `cache-server/server.mjs`（及 `tools.mjs`、`cache-store.mjs`）
     - `android/app/src/main/java/com/mywhale/app/LocalCacheServer.java`
     - `desktop/src-tauri/src/local_cache.rs`
2. **默认开启缓存模式的安全回退**：
   - `cacheModeEnabled` 默认开启；[client.ts](file:///E:/my-whale/web/src/services/api/client.ts) 在原生端先等待本地端口绑定就绪，若纯网页端本地 `127.0.0.1:8787` 不可达则静默回退直连 `API_ORIGIN`，不能让聊天卡死在网络错误。
3. **搜索失败自动跳转官方检索**：
   - 当内置搜索链（Tavily / Bing / 百度 / DuckDuckGo）连续返回空结果时，三端均不得向模型伪造空搜索结果并剥离工具，必须保留请求里的 `deepseek_web_search` 等工具直透给 DeepSeek 官方执行搜索。
4. **论文分级上下文压缩（[compaction.ts](file:///E:/my-whale/web/src/services/chat/compaction.ts)）**：
   - 默认档位为 `light`（轻度），另支持 `medium` / `heavy` 与手动弹窗调整。
   - **前缀缓存保护原则**：静态阶段摘要/结构化记忆固定写入 `system` 并在两次压缩之间保持不变；按需召回的早期原文片段（`recallCompactedEvidence`）只拼在当轮提问末尾，绝不每轮改动前部前缀，避免破坏 DeepSeek KV Prefix Cache 命中。
5. **跨平台构建注意事项**：
   - `CapacitorHttp` 必须保持 `enabled: false`（[capacitor.config.ts](file:///E:/my-whale/web/capacitor.config.ts)），否则会缓冲流式响应导致 SSE 无法逐字输出。
   - React / Rspack 注意避开模块循环依赖引发生产环境 TDZ 白屏，以及老旧 Android WebView 语法兼容性（保持 `rspack.config.ts` 中 `android >= 7` 目标）。

---

## 5. 前端 UI 与小游戏高频约束

- **精简界面原则**：设置弹窗、备份弹窗、工具栏等非注意事项区域**不要堆砌解释性小字**，只保留核心标题、状态与按钮；仅在明确要求说明注意事项或操作步骤处（如「档位推荐」「DeepSeek 导出路径」「小游戏 API 消耗提醒」）保留精炼提示。
- **移动端输入区与附件布局**：确保添加 PDF 等多类附件后，底部「深度思考 / 智能搜索 / 发送」功能行保持完整可见、不被裁剪或被软键盘双倍顶偏；`+` 菜单与底部提示行中的上下文压缩入口不得撑高或挤压输入框和消息气泡。
- **小游戏规则（`web/src/game/`）**：
  - AI 发言/思考内容隔离主对话上下文且不得泄露底牌（如斗地主）。
  - 「你画我猜」AI 想词/出题保持成语，生成的 HTML 模板不含注释，保留 `[user_input]` 与一键复制提示词能力，并在选择器保留高频调用消耗更多 API 费用的提醒。

---

## 6. 本地验证与打包命令清单

### Web 检查与打包（`E:\my-whale\web`）
```powershell
pnpm type
pnpm lint
pnpm build
pnpm exec cap sync android
```
> 注意：`cap sync android` **必须**在 `web/` 目录执行（`capacitor.config.ts` 在此目录）。

### 桌面端校验（`E:\my-whale\desktop\src-tauri`）
```powershell
node -e "JSON.parse(require('fs').readFileSync('E:/my-whale/desktop/src-tauri/tauri.conf.json','utf8')); console.log('ok')"
cargo check
```

### Android 编译与验包（`E:\my-whale\android`）
```powershell
$env:JAVA_HOME = 'C:\Users\App\Google_IDE\Android_Studio\jbr'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

# 日常调试包
.\gradlew.bat assembleDebug --no-daemon

# 验证产物版本号与签名指纹（替换为 build-tools 实际目录）
$bt = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" | Sort-Object Name -Descending | Select-Object -First 1
& "$($bt.FullName)\aapt2.exe" dump badging app\build\outputs\apk\release\app-release.apk | Select-String "package:"
& "$($bt.FullName)\apksigner.bat" verify --print-certs app\build\outputs\apk\release\app-release.apk
```
> 本地打包 Release 时，优先通过本机临时环境变量或已 gitignore 的 `android/keystore.properties` 提供密钥库路径与口令，**切勿把口令写进脚本或提交记录**。
