package com.nexusmatrix.app

import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.platform.ComposeView
import com.getcapacitor.BridgeActivity
import com.nexusmatrix.app.ui.NexusApp
import com.nexusmatrix.app.ui.NexusTheme

/**
 * 原生壳入口（阶段 1）。
 *
 * 架构：Capacitor BridgeActivity（保留全部插件/生命周期/本地资源服务）
 * + Compose 外壳（底部 Tab 导航）。编辑器即 Capacitor 的 WebView，
 * 从默认布局中取出后嵌入 Compose——Notion 同款「原生壳 + WebView 编辑器」。
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        // 首行兜底：确保任何代码（enableEdgeToEdge 的 window.decorView 访问等）
        // 触碰窗口前，主题已是 AppCompat 无 ActionBar 主题。PhoneWindow 生成 decor
        // 时读平台属性 android:windowActionBar，启动主题必须是 AppCompat 主题。
        setTheme(R.style.AppTheme_NoActionBar)
        // 边到边（Notion 移动端形态）：WebView 延伸到状态栏/手势栏区域，原生壳不占高度。
        // 系统栏透明 + 亮色图标（暗色 UI）；状态栏区域由 Web 侧 viewport-fit=cover +
        // env(safe-area-inset-*) 避开，底部手势区由底部 NavigationBar 兜底。
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

        // WebView 默认白底，冷启动/刷新时会闪一下白屏；改为品牌深色（与 Web 端 nexus-void 一致）
        webView.setBackgroundColor(0xFF090A0C.toInt())

        try {
            // 若用户配置过后端地址，抢在首页提交前用带 ?syncServer= 的 URL 重新加载：
            // Bridge 构造器已同步发起 loadUrl(appUrl)，此次调用会取消那次尚未提交的导航，
            // 保证前端 runtimeConfig.ts 在模块初始化时就能读到服务器地址。
            val server = ShellPrefs(this).syncServer
            if (server.isNotEmpty()) {
                webView.loadUrl(withSyncServer(bridge.appUrl, server))
            }

            // 把 WebView 从 Capacitor 默认布局取出，交给 Compose 外壳
            val originalParent = webView.parent as? ViewGroup
            originalParent?.removeView(webView)
            try {
                setContentView(ComposeView(this).apply {
                    setContent {
                        NexusTheme { NexusApp(webView = webView) }
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

        /**
         * 把同步服务器地址编码进 URL query（前端 runtimeConfig.ts 读取，优先级高于构建期 env）。
         * 幂等：总是基于去掉 query 的 base 重建，重复保存不会叠加参数。
         */
        fun withSyncServer(url: String?, server: String): String {
            val base = (url ?: "https://localhost/index.html").substringBefore('?')
            if (server.isEmpty()) return base
            return "$base?syncServer=${Uri.encode(server)}"
        }
    }
}
