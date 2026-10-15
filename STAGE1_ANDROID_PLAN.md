# 阶段 1 实施方案：原生壳 + WebView 编辑器

> **执行状态：代码侧已完成（2026-10-16），待真机验收（见 `ANDROID_VERIFICATION.md`）。**
>
> **两个待确认项的决策**：
> 1. 最低 API 级别 → **26（Android 8.0）**，已落入 `android/variables.gradle` 的 `minSdkVersion`。
> 2. 导航形态 → **底部 Tab**（文档 / 收藏 / 设置），已落入 `NexusApp.kt` 的 `NavigationBar`。
>
> **执行中发现的与本文档的偏差（以代码为准）**：
> - 计划书写「Java 17」，但 Capacitor 8 模板的 `capacitor.build.gradle` 实际要求 **Java 21**
>   （AGP 8.13 + Gradle 8.14.3），已按 21 配置。
> - `cap add android` / `cap sync` 在 IDE 的 safe-delete shim 下会中断（删除模板残留目录失败）。
>   解法：用 .NET API 预删目标目录后重跑 sync。**重装/重新 add 前先删
>   `frontend/android/` 整个目录再 add**，否则模板残留会双重存在。
> - 「文档」Tab 图标用 `Icons.Filled.List` 而非 `Home`：`material-icons-core` 不含 `Home`
>   （已核实官方 core 清单），不引体积更大的 material-icons-extended。
> - 轮询标题用 `Handler` 而非 `LaunchedEffect+delay`：kotlinx-coroutines 在 compose
>   runtime POM 中是 runtime 作用域，不在编译类路径。
> - Compose BOM 用 2026.09.00（ui 1.12.1 / material3 1.4.0），Kotlin 用 **2.4.21**
>   （编译器不得旧于 runtime）。

> 目标：用 Kotlin + Jetpack Compose 写原生应用外壳（首页 / 页面列表 / 导航 / 设置），
> 编辑器用 WebView 加载现有 Vue 前端。参考 Notion 的 Hybrid 架构。
> 预估 5–8 人天（不含真机调试）。

---

## 一、技术选型与前置条件

| 项 | 选型 | 理由 |
| --- | --- | --- |
| 原生框架 | Kotlin + Jetpack Compose | Notion 同款；CMP for iOS 已 stable，为将来扩 iOS 留路 |
| 容器 | Capacitor 8 | 只需一个 WebView 即可，不必引入完整框架；也便于后续用其插件 |
| WebView 加载 | **本地打包资源**（`webDir: 'dist'`） | 离线可用、启动快；不依赖服务器在线 |
| 后端连接 | `VITE_SYNC_SERVER` 运行时注入 | 第一步已做配置化 |
| 最低版本 | Android 8.0 (API 26) | IndexedDB 在 WebView 的可靠起点；API 23-25 行为不稳 |

**前置依赖**：第一步已完成的两项是硬前提——存储已切 IndexedDB（localStorage 5 MiB 不够）、后端地址已配置化。若这两项未做，本阶段会被卡住。

---

## 二、目录结构

```
frontend/
├── android/                      # Capacitor 生成的原生工程
│   ├── app/
│   │   ├── src/main/
│   │   │   ├── AndroidManifest.xml      # 权限 + cleartext 配置
│   │   │   ├── res/
│   │   │   │   └── xml/
│   │   │   │       └── network_security_config.xml
│   │   │   └── assets/
│   │   │       └── public/              # Vue 构建产物（cap sync 自动拷入）
│   │   └── build.gradle
│   └── build.gradle
├── capacitor.config.ts
└── scripts/
    └── build-android.sh           # 一键构建脚本
```

---

## 三、分步实施

### 步骤 1：安装依赖（约 0.5 人天）

```bash
# 注意本环境 NODE_ENV=production，必须带 --include=dev；
# 且大包安装必须后台执行（前台超时会把包装残）
npm install --include=dev --save-dev @capacitor/cli
npm install --include=dev @capacitor/core @capacitor/android
```

`capacitor.config.ts`：

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nexusmatrix.app',
  appName: 'Nexus Matrix',
  webDir: 'dist',
  android: {
    // 用 https scheme，WebView origin 变成 https://localhost，
    // 与桌面开发行为一致，避免 mixed-content 与 cookie 问题
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,   // 生产环境关闭
  },
  server: {
    androidScheme: 'https',
    // 不用 server.url —— 那会变成加载远程页面，违背「本地打包」初衷
  },
};

export default config;
```

### 步骤 2：生成 Android 工程（约 0.5 人天）

```bash
npm run build                       # 产出 dist/
npx cap add android                 # 生成 android/ 目录
npx cap sync                        # 把 dist 拷进 android/app/src/main/assets/public
```

`package.json` 加脚本：

```json
{
  "scripts": {
    "android:build": "npm run build && cap sync",
    "android:open": "npm run android:build && cap open android",
    "android:run": "npm run android:build && cap run android"
  }
}
```

### 步骤 3：AndroidManifest 与网络配置（约 1 人天，含必踩坑）

`android/app/src/main/AndroidManifest.xml`：

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@style/AppTheme"
        android:networkSecurityConfig="@xml/network_security_config">
        <activity ... />
    </application>
</manifest>
```

**必踩坑：Android 9+ 默认禁止 HTTP 明文。** 本地开发用 `http://192.168.x.x:8010`，不配置会直接失败且报错含糊。`android/app/src/main/res/xml/network_security_config.xml`：

```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- 开发期放行内网明文；生产应改为只信任你的域名 + 走 HTTPS -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <!-- 明确放行常见内网段，避免 base-config 之外的遗漏 -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">10.0.2.2</domain>   <!-- 模拟器访问宿主机 -->
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">192.168.0.0</domain>
    </domain-config>
</network-security-config>
```

> 注意：单独设 `android:usesCleartextTraffic="true"` 在部分机型/系统版本上不生效，官方推荐用 `networkSecurityConfig`。上生产前必须收紧，否则是明确的安全漏洞。

### 步骤 4：原生壳 UI（约 2–3 人天）

用 Compose 写外壳，WebView 只占编辑器区域。Notion 的做法是「原生导航 + WebView 内容」，我们照做：

```kotlin
// ui/AppScaffold.kt
@Composable
fun AppScaffold(vm: AppViewModel = viewModel()) {
    val pages by vm.pages.collectAsStateWithLifecycle()
    var currentPageId by remember { mutableStateOf(pages.firstOrNull()?.id) }

    Scaffold(
        topBar = { NexusTopBar(title = pages.find { it.id == currentPageId }?.title ?: "") },
        bottomBar = { NexusNavBar(...) }
    ) { padding ->
        Row(Modifier.padding(padding)) {
            // 原生页面列表（侧边栏或独立页，按屏幕宽度决定）
            if (LocalConfiguration.current.screenWidthDp >= 600) {
                PageListPanel(pages, currentPageId, onSelect = { currentPageId = it })
            }
            // 编辑器：WebView
            EditorWebView(
                pageId = currentPageId,
                syncServer = BuildConfig.SYNC_SERVER,
                modifier = Modifier.weight(1f)
            )
        }
    }
}
```

**首页/页面列表用原生实现**——这是 Notion 第一个原生化的部分，也是启动速度提升 3 倍的来源。列表数据来源有两种选择：

- **方案 A（推荐，MVP）**：列表也走 WebView 的侧边栏，原生壳只管导航框架。成本最低，但启动时仍需等 WebView 初始化。
- **方案 B**：原生列表读本地 Room/IndexedDB，WebView 只负责编辑器。体验最好，但需要原生端也实现数据读取——**这就踏入了阶段 2 的范围**。

**本阶段选 A**，把「原生列表 + 原生数据层」留给阶段 2。否则范围会失控。

### 步骤 5：EditorWebView 封装（约 1–2 人天）

```kotlin
// ui/EditorWebView.kt
@Composable
fun EditorWebView(pageId: String?, syncServer: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val webView = remember { WebView(context) }

    // 注入后端地址（走第一步的 VITE_SYNC_SERVER 机制）
    LaunchedEffect(pageId) {
        val url = if (pageId != null) "https://localhost/index.html#$pageId"
                  else "https://localhost/index.html"
        webView.loadUrl(url)
    }

    AndroidView(factory = { webView }, modifier = modifier)

    DisposableEffect(Unit) {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true       // 必须：IndexedDB/localStorage 依赖
            databaseEnabled = true
            allowFileAccess = false        // 安全：不放行 file://
            allowContentAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        // 本地资源走 WebViewAssetLoader，origin 为 https://localhost/
        webView.webViewClient = WebViewClient()
        onDispose { webView.destroy() }
    }
}
```

**关键点**：Capacitor 默认已用 `WebViewAssetLoader` 处理 `https://localhost/` 到 assets 的映射，无需自己实现。但**必须确认 `domStorageEnabled = true`**——这是 IndexedDB 能否工作的前提，而 IndexedDB 又是第一步存储改造的基础。

### 步骤 6：JS Bridge（约 0.5–1 人天）

原生壳与 Web 层需要双向通信。MVP 阶段只需要「原生 → Web」注入配置，「Web → 原生」可选：

```kotlin
// 原生 → Web：注入同步服务器地址
webView.evaluateJavascript(
    "window.__NEXUS_CONFIG__ = { syncServer: '${BuildConfig.SYNC_SERVER}' };",
    null
)
```

前端 `main.ts` 读取（在 `useSync` 之前）：

```ts
// 运行时注入优先于构建期 env，便于同一份产物切换环境
const runtimeServer = (window as any).__NEXUS_CONFIG__?.syncServer;
if (runtimeServer) (import.meta.env as any).VITE_SYNC_SERVER = runtimeServer;
```

「Web → 原生」的通知（如页面切换、请求分享）本阶段可不做，留到阶段 3。

### 步骤 7：构建与签名（约 0.5 人天）

```bash
# debug 包
npm run android:build && cd android && ./gradlew assembleDebug

# release 包（需配置签名）
cd android && ./gradlew assembleRelease
```

`android/app/build.gradle` 注意 Java 17（AGP 8.x 要求）：

```gradle
compileOptions {
    sourceCompatibility JavaVersion.VERSION_17
    targetCompatibility JavaVersion.VERSION_17
}
kotlinOptions { jvmTarget = "17" }
```

---

## 四、真机验证清单（我做不了，需要你执行）

这五项只能在真机确认，是阶段 1 的验收标准：

1. **冷启动时间**：从点击图标到可输入，目标 < 2s（Notion 原生化后是此量级）
2. **`navigator.storage.persist()` 是否授予**：在 WebView 内执行，看返回值
3. **IndexedDB 读写**：断网、杀进程、重启，数据是否仍在
4. **cleartext 是否放行**：连 `http://192.168.x.x:8010`，看 WebSocket 是否建立（这是步骤 3 配置的验证）
5. **软键盘与布局**：聚焦输入时键盘弹出、`safe-area` 适配、横竖屏切换

我会把这些写成一份 `ANDROID_VERIFICATION.md`，每项给出具体的 ADB 或页面内执行方式。

---

## 五、风险与规避

| 风险 | 影响 | 规避 |
| --- | --- | --- |
| **IndexedDB 在 WebView 表现不佳** | 数据丢失或读写慢 | 真机验证第 2、3 项；若失败，数据层下沉到原生 SQLite（踏入阶段 2） |
| **cleartext 配置不生效** | 连不上后端，且报错含糊 | 同时配 `networkSecurityConfig` 与 `usesCleartextTraffic`；用 `adb logcat` 看真实错误 |
| **WebView 内存占用** | 大文档下 OOM | 限制 `maxWidth`，监控 `onTrimMemory`；必要时分段加载 |
| **软键盘遮挡输入区** | 移动端体验崩 | `android:windowSoftInputMode="adjustResize"` + `WindowInsets` 处理 |
| **本地资源 origin 问题** | IndexedDB 被视为 third-party 而被限制 | Capacitor 的 `https://localhost` scheme 已规避；不要改用 `file://` |
| **后端未启动时白屏** | 用户误以为 app 坏了 | Web 端已有纯本地模式降级；需在原生壳加一个「后端未连接」提示 |

---

## 六、明确不在本阶段范围

以下都属于阶段 2/3，本阶段刻意不做，避免范围失控：

- 原生页面列表读本地数据（这是阶段 2 的数据层联动）
- WebView 内的原生下拉刷新、分享菜单
- 小部件、快捷方式、通知
- iOS 端（CMP for iOS 已 stable，但是独立工作项）

---

## 七、交付物

1. `frontend/android/` 工程，可 `assembleDebug` 产出 APK
2. `capacitor.config.ts` 与 `package.json` 脚本
3. `network_security_config.xml` + Manifest 配置
4. `main.ts` 的运行时配置注入
5. `ANDROID_VERIFICATION.md` 真机验证清单
6. README 补充「Android 构建」章节

---

## 八、执行顺序

步骤 1→2→3→7 是纯配置，可一次完成；步骤 4、5 是 UI，占大头；步骤 6 穿插其间。建议顺序：

**1 → 2 → 3 → 7**（先跑通「能装能开能连」的最小闭环）→ **5**（WebView 加载）→ **4**（原生壳）→ **6**（Bridge）→ 真机验证。

这样做的好处是尽早暴露环境问题（Node 版本、AGP、cleartext），而不是等 UI 写完才发现装不上。

---

## 下一步

确认这个方案后我就开始执行。有两个点想先听你的意见：

**一、最低 API 级别**：我选 API 26（Android 8.0）。如果要兼容更老设备需降到 23，但 IndexedDB 在 API 23-25 的 WebView 上行为不稳，可能需要额外处理。你的目标用户群体是什么？

**二、原生壳的导航形态**：底部 Tab（首页/收藏/设置）还是侧边抽屉？这影响步骤 4 的 Compose 结构。Notion 移动端是底部 Tab + 侧边抽屉两者结合。
