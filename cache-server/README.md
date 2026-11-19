# my-whale 轻量缓存后端（Cache Server）

基于并优化自 `vender/APP_test`，用于开启「缓存模式」时承担本地缓存与内置搜索/网页抓取，同时在默认关闭时让主客户端保持直连 DeepSeek API。

## 快速启动

需要 Node.js >= 18（零额外依赖）：

```bash
cd cache-server
npm start
# 或：CACHE_HOST=0.0.0.0 CACHE_PORT=8787 node server.mjs
```

> 手机端 APK 与桌面端 Tauri 也内置了本地缓存后端：在客户端「设置 → 通用设置 → 缓存模式」开启即可自动启动，无需手动跑终端；网页端或手机想共用电脑缓存时再启动本服务即可。

## 优化要点（相对 APP_test）

1. **多模态附件保留**：保留 `image` / `document`（PDF/Word/代码）附件块并透传 `/anthropic/v1/files`，不再在缓存层丢失文件。
2. **PDF / ZIP / 图片二进制安全防护**：抓取网页时先校验 `Content-Type` 与文件魔数并限制 5MB 上限，图片返回结构化元信息、ZIP 仅读取中央目录与小型文本预览、PDF 支持基础 `FlateDecode` 流文本提取与安全提示，避免把二进制乱码送进模型。
3. **搜索与网页提取修复**：真 `AbortController` 超时中止、解码 `cn.bing.com/ck/a` 跳转链接、`b_caption` 摘要补充、`GB18030/GBK` 汉字网页解码及移除 `<nav>/<header>/<footer>/<aside>` 导航噪声。
4. **前缀缓存与结果缓存**：剥离历史轮次中易变的 `latest_reminder` 维持前缀逐字节稳定（提升 DeepSeek KV Prefix Cache 命中率），并为搜索（20 分钟）和网页抓取（60 分钟）提供持久化结果缓存。
