# Android 真机验证清单（阶段 1 验收标准）

> 阶段 1（原生壳 + WebView 编辑器）已完成代码侧全部工作。以下五项只能在真机确认，
> 是阶段 1 的验收标准。每项都给出了具体操作方式与预期结果。

## 前置：构建 APK

需要 JDK 21 与 Android SDK（API 36）。本机未装：安装 Android Studio（Ladybug 或更新，
自带 JBR 21），首次同步 Gradle 会自动下载 Gradle 8.14.3 与 AGP 8.13.0 依赖。

```powershell
# 1. 构建 Web 产物并同步进 android 工程
cd frontend
npm run android:build        # = npm run build && cap sync

# 2. 打 debug 包
cd android
.\gradlew.bat assembleDebug
```

产物：`android/app/build/outputs/apk/debug/app-debug.apk`。

安装到设备：

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

> 注意：`capacitor-cordova-android-plugins/` 与 `app/src/main/assets/public/` 均被
> `.gitignore` 忽略（Capacitor 惯例）。**全新克隆后必须先跑一次 `npm run android:build`**
> 再构建 APK，否则 Gradle 会报 `:capacitor-cordova-android-plugins` 工程缺失。

---

## 1. 冷启动时间

**操作**：完全杀掉 App（`adb shell am force-stop com.nexusmatrix.app`），点击图标启动，
从按下到编辑器可输入计时。

```powershell
adb shell am start -W -n com.nexusmatrix.app/.MainActivity
```

看输出的 `TotalTime`。**目标 < 2000ms**（Notion 原生化后是此量级）。
未达标时的排查方向：`Theme.SplashScreen` 启动主题是否生效、`domStorageEnabled` 是否拖慢首帧。

## 2. `navigator.storage.persist()` 是否授予

Android WebView 的 localStorage 每 origin 仅 5 MiB 且会被整 origin 驱逐；IndexedDB
配额约为磁盘 60%，但**默认仍是 best-effort**，存储压力下可能被清理。本项目已切 IndexedDB
并在 `idbStore.ts` 调用 `requestPersistence()`，需确认 WebView 内实际授予情况。

**操作**：App 内「设置」Tab 直接显示 `navigator.storage.estimate()` 的 usage/quota
（代码路径：`SettingsScreen` → `WebQuery.JS_STORAGE`）。如需更精确的判断，PC 上
`chrome://inspect` 远程调试 WebView（`capacitor.config.ts` 已开
`webContentsDebuggingEnabled`），在 Console 执行：

```js
await navigator.storage.persisted   // 期望 true；false 则需手动 navigator.storage.persist()
```

**预期**：`persisted === true`。若为 `false`，在存储压力大的设备上仍可能丢数据——
记录在案即可，阶段 2 的数据层下沉（原生 SQLite）是最终解法。

## 3. IndexedDB 读写（离线 / 杀进程 / 重启）

**操作**：
1. 新建几个页面、写点内容、传一张封面图（走 IndexedDB 资产存储）；
2. 开飞行模式，编辑一个页面；
3. `adb shell am force-stop com.nexusmatrix.app`，重启 App；
4. 关飞行模式，启动后端（`python backend/main.py`），看编辑器左下角同步状态是否转 `online`
   并自动重连推送（`retrySync` 最多重试 5 次）。

**预期**：内容、封面、离线期间的编辑全部还在；同步状态最终 `online`。
**若丢数据**：先看第 2 项是否授予持久化；若 granted 仍丢，说明 WebView 的 IndexedDB
在此机型不可靠，触发阶段 2 预案（数据层下沉原生 SQLite + JS Bridge）。

## 4. cleartext 是否放行（HTTP 后端可达性）

Android 9+ 默认禁止明文 HTTP。本项目已配 `network_security_config.xml`
（开发期放行内网段）+ `android:usesCleartextTraffic="true"` 双保险。

**操作**：
1. 电脑与手机连同一 Wi-Fi，后端监听 `0.0.0.0:8010`；
2. App「设置」Tab 填入 `http://<电脑局域网IP>:8010`，点「保存并重载」；
3. 看「连接与存储」卡片中同步状态是否变 `online`；
4. 若仍是 `offline`，抓日志看真实错误：

```powershell
adb logcat -s NexusBridge chromium | findstr /i "cleartext\|net::ERR"
```

**预期**：WebSocket 建立，状态 `online`，在线设备数 ≥ 2（PC 浏览器 + App）。
**注意**：上生产前必须把 `network_security_config.xml` 收紧为只信任你的域名 + HTTPS——
当前配置是明确的安全漏洞，仅限开发期。

## 5. 软键盘与布局

**操作**：聚焦任意块输入，观察：
- 键盘弹出时编辑器是否被遮挡（Manifest 已设 `android:windowSoftInputMode="adjustResize"`）；
- 底部 Tab 栏是否随键盘上浮或保持合理位置；
- 横竖屏切换、分屏（Android 12+）是否崩溃；
- 折叠屏展开/折叠时 WebView 重排是否正常。

**预期**：输入区始终可见，切换不崩。若 Tab 栏行为异常，可在 `NexusApp.kt` 的
`NavigationBar` 上加 `Modifier.windowInsetsPadding`（已引入 compose foundation layout）。

---

## 已知事项（非阻断）

- **底部 Tab 的「收藏」依赖 Web 侧数据**：原生列表通过只读桥
  （`window.__NEXUS_API__.getFavorites()`）读取，Web 编辑器未就绪时显示「读取中…」。
  原生数据层（Room）是阶段 2 范围。
- **发布前必须关闭 WebView 远程调试**：`capacitor.config.ts` 的
  `webContentsDebuggingEnabled` 改为 `false` 后重新 `npm run android:build`。
- **签名**：`assembleRelease` 需自行配置 keystore；`app/build.gradle` 未内置签名配置。
