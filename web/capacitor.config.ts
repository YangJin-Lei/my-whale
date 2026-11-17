import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.mywhale.app',
  appName: 'my-whale',
  webDir: 'dist',
  android: {
    path: '../android',
    allowMixedContent: false,
  },
  plugins: {
    // 必须保持 false，否则会缓冲流式响应导致 SSE 逐字输出失效；/user/balance 已实测支持 https://localhost CORS
    CapacitorHttp: { enabled: false },
  },
}

export default config
