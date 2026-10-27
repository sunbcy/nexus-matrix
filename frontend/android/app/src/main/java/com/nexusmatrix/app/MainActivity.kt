package com.nexusmatrix.app

import android.graphics.Color
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.platform.ComposeView
import com.getcapacitor.BridgeActivity
import com.nexusmatrix.app.ui.NexusApp
import com.nexusmatrix.app.ui.NexusJsBridge
import com.nexusmatrix.app.ui.NexusTheme
import com.nexusmatrix.app.ui.PullRefreshController

/**
 * 原生壳入口（阶段 1）。
 *
 * 架构：Capacitor BridgeActivity（保留全部插件/生命周期/本地资源服务）
 * + Compose 外壳。编辑器即 Capacitor 的 WebView，从默认布局中取出后嵌入 Compose
 * ——Notion 同款「原生壳 + WebView 编辑器」。
 *
 * 2026-10-17：底部 Tab 导航已全部移除（收藏 → 设置 → 彻底去掉），
 * 现在是全屏 WebView，把垂直空间全部留给编辑器；设置入口迁到 Web 侧边栏右上角。
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // 首行兜底：确保任何代码（enableEdgeToEdge 的 window.decorView 访问等）
        // 触碰窗口前，主题已是 AppCompat 无 ActionBar 主题。PhoneWindow 生成 decor
        // 时读平台属性 android:windowActionBar，启动主题必须是 AppCompat 主题。
        setTheme(R.style.AppTheme_NoActionBar)
        // 边到边（Notion 移动端形态）：WebView 延伸到状态栏/手势栏区域，原生壳不占高度。
        // 系统栏透明 + 亮色图标（暗色 UI）；状态栏与底部手势区均由 Web 侧
        // viewport-fit=cover + env(safe-area-inset-*) 自行避开（底部已无 NavigationBar）。
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        // 启动画面：API 31+ 由系统读取 AppTheme.NoActionBar 上的 windowSplashScreen* 属性；
        // API 26-30 无兼容层（installSplashScreen 静态方法在本机 Gradle 缓存中的
        // core-splashscreen:1.0.1 上解析异常，且不影响主功能），冷启动期间显示
        // 主题的深色 windowBackground（nexusBackground），观感可接受。
        super.onCreate(savedInstanceState)

        val webView = try {
            bridge?.webView
        } catch (e: Throwable) {
            Log.e(TAG, "获取 Capacitor WebView 失败", e)
            null
        } ?: return   // WebView 不可用：保留 Capacitor 默认布局（或错误页），不至于白屏

        // 受控下拉刷新：Web 侧通过 NexusNativeBridge 推送「是否允许刷新 / 列表是否置顶」，
        // 原生据此只在文档列表页顶部启用 SwipeRefreshLayout，触发时走 Web 侧重新同步。
        val pullRefresh = PullRefreshController()
        try {
            webView.addJavascriptInterface(NexusJsBridge(pullRefresh), "NexusNativeBridge")
        } catch (e: Throwable) {
            Log.e(TAG, "注册 NexusNativeBridge 失败", e)
        }

        // WebView 默认白底，冷启动/刷新时会闪一下白屏；改为品牌深色（与 Web 端 nexus-void 一致）
        webView.setBackgroundColor(0xFF090A0C.toInt())

        // 本地存储加固：显式打开 DOM Storage 与 Database（IndexedDB）。
        // 这两项在部分 WebView/ROM 上并非默认开启，一旦关闭，Web 侧的 IndexedDB
        // 不可用会静默降级到 localStorage（5 MiB 且会被系统整 origin 驱逐），
        // 直接表现为「重开 App 数据丢失」。这里显式兜底，不依赖 Capacitor 的默认值。
        try {
            webView.settings.apply {
                domStorageEnabled = true
                databaseEnabled = true
                // 允许 file/https 混合场景下的本地存储访问，避免资产加载时 origin 受限
                allowContentAccess = true
                allowFileAccess = true
            }
        } catch (e: Throwable) {
            Log.e(TAG, "WebView 存储设置失败", e)
        }

        try {
            // 把 WebView 从 Capacitor 默认布局取出，交给 Compose 外壳
            // 注：同步服务器地址不再由原生注入（ShellPrefs 已移除）——设置入口迁到
            // Web 侧边栏右上角后，配置由 Web 设置面板写入 localStorage，
            // 由 runtimeConfig.ts 读取。原生若再注入 URL query，会盖掉用户的新配置。
            val originalParent = webView.parent as? ViewGroup
            originalParent?.removeView(webView)
            try {
                setContentView(ComposeView(this).apply {
                    setContent {
                        NexusTheme { NexusApp(webView = webView, controller = pullRefresh) }
                    }
                })
            } catch (e: Throwable) {
                originalParent?.addView(webView)   // 壳加载失败时回退，至少编辑器可用
                throw e
            }
        } catch (e: Throwable) {
            // 任何意外都保留 Capacitor 默认布局，保证「能装能开能连」
            Log.e(TAG, "原生壳加载失败，保留 Capacitor 默认布局", e)
        }
    }

    companion object {
        private const val TAG = "NexusShell"
    }
}
