# my-whale Android（Capacitor 双端共享架构）

> 应用名称：`my-whale`　包名：`com.mywhale.app`　`minSdkVersion`: `24`　分发方式：Universal Release APK

## 1. 架构说明

遵循 [../docs/二次开发文档-引导与余额.md](../docs/二次开发文档-引导与余额.md) 第 6 章与 [../docs/二次开发文档-人设与记忆.md](../docs/二次开发文档-人设与记忆.md) 第 9 章的双端共享架构：

- **UI 与业务逻辑 100% 共用 `../web/`**：Markdown、代码高亮、KaTeX 公式、Mermaid 图表、SSE 流式回复、分支切换、人设库与全局记忆均与 Web 端完全一致，保证与官方应用接近的渲染和交互体验。
- **原生适配层**：位于 [../web/src/platform/native.ts](../web/src/platform/native.ts)，在 `Capacitor.isNativePlatform()` 时激活：
  - 外链（获取 API Key / 充值 / 官网用量）使用 `@capacitor/browser`（Chrome Custom Tabs），保留浏览器登录态。
  - Custom Tab 关闭（`browserFinished`）或切回前台（`resume`）时自动刷新余额并检测剪贴板中的 `sk-` Key。
  - 切到后台（`pause`）时立即触发 `flushPendingExtracts()`，避免 WebView 挂起导致记忆提炼丢失。
  - 物理返回键优先依次关闭抽屉、搜索面板、设置弹窗、Modal 或返回欢迎页，最后退出应用。
  - 历史 ZIP 与 `my-whale-profile.json` 导出通过 [../web/src/services/fileExport.ts](../web/src/services/fileExport.ts) 使用 `@capacitor/filesystem` + `@capacitor/share` 调起系统分享/保存。
- **流式传输保障**：[../web/capacitor.config.ts](../web/capacitor.config.ts) 显式保持 `CapacitorHttp.enabled: false`，避免缓冲响应体影响 SSE 逐字输出（`/user/balance` 已实测支持 `https://localhost` 跨域）。

---

## 2. 开发与真机调试

在 `E:\my-whale\web` 下构建并同步静态产物到本目录：

```powershell
cd E:\my-whale\web
pnpm android:sync   # 等价于 pnpm build && npx cap sync android
pnpm android:open   # 用 Android Studio 打开 E:\my-whale\android
```

在 Android Studio 中连接已开启 USB 调试的手机后，直接点击 **Run (`app`)** 即可安装调试；发版时通过 **Build → Generate Signed Bundle / APK → APK** 使用固定 Release Keystore 签名打包（keystore 与 `keystore.properties` 已被 `.gitignore` 忽略，请勿提交）。
