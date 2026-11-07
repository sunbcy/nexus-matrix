package com.nexusmatrix.app

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
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
    // 深链 OAuth 状态
    private var jsBridge: NexusJsBridge? = null
    private var localBase: String? = null          // App 自身本地服务源（https://localhost[:port]）
    private var lastOAuthData: String? = null       // 防止 onResume 重复处理同一条深链

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
            val bridge = NexusJsBridge(pullRefresh, this::openInBrowser)
            webView.addJavascriptInterface(bridge, "NexusNativeBridge")
            jsBridge = bridge
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

        // 记录 App 自身本地服务源（用于把令牌 apiKey 带回 localhost 的 SPA）。
        localBase = deriveLocalBase()
        // 注册系统/手势返回（androidx OnBackPressedDispatcher），把返回交给 Web 处理。
        registerBackHandler()
        // 冷启动即由深链唤起（用户已在浏览器完成 Google 登录后回跳）时也需处理。
        handleOAuthDeepLink(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleOAuthDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        // onResume 每次回到前台都会触发；用 lastOAuthData 去重，避免重复处理。
        handleOAuthDeepLink(intent)
    }

    /**
     * 处理 OAuth 深链 com.nexusmatrix.app://oauth/callback：
     *  - 带 code  ：浏览器已拿到 Google 授权码，但令牌交换须由「携带 OAuth session cookie
     *    的同一浏览器」完成。故这里再把浏览器拉起来访问后端回调端点。
     *  - 带 apiKey：后端已换发 JWT，把它带回 App 自己的 WebView（localhost 源）写入
     *    localStorage，完成登录。
     */
    private fun handleOAuthDeepLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "com.nexusmatrix.app") return
        val full = data.toString()
        if (full == lastOAuthData) return
        val webView = bridge?.webView ?: return
        val code = data.getQueryParameter("code")
        val apiKey = data.getQueryParameter("apiKey")
        when {
            !code.isNullOrEmpty() -> {
                val backend = jsBridge?.oauthBackend
                if (backend.isNullOrEmpty()) {
                    Log.e(TAG, "OAuth 深链收到 code，但原生层未记录后端地址（请先在 Web 侧点登录）")
                    return
                }
                val callback = "$backend/api/auth/oauth/google/callback?${data.encodedQuery}"
                if (openInBrowser(callback)) lastOAuthData = full
            }
            !apiKey.isNullOrEmpty() -> {
                lastOAuthData = full
                val base = localBase ?: deriveLocalBase()
                // JWT 用 Uri.encode 兜底转义，避免令牌里出现需编码字符时 URL 被截断。
                val target = "$base/?apiKey=${Uri.encode(apiKey)}"
                Log.i(TAG, "OAuth 完成，回跳 SPA：$target")
                webView.post { webView.loadUrl(target) }
            }
        }
    }

    /** 推算 App 本地服务源（scheme://host[:port]）。优先用 Capacitor 的 serverUrl。 */
    private fun deriveLocalBase(): String {
        val s = bridge?.serverUrl?.takeIf { it.isNotEmpty() }?.removeSuffix("/")
        if (!s.isNullOrEmpty() && s.startsWith("http")) {
            val u = Uri.parse(s)
            val port = if (u.port != -1) ":${u.port}" else ""
            return "${u.scheme}://${u.host}$port"
        }
        val w = bridge?.webView?.url?.takeIf { it.isNotEmpty() }
        if (!w.isNullOrEmpty() && w.startsWith("http")) {
            val u = Uri.parse(w)
            val port = if (u.port != -1) ":${u.port}" else ""
            return "${u.scheme}://${u.host}$port"
        }
        return "https://localhost"
    }

    /** 用系统默认浏览器打开 URL（OAuth 代理：复用其持有的 session cookie）。返回是否成功发起。 */
    private fun openInBrowser(url: String): Boolean {
        return try {
            val i = Intent(Intent.ACTION_VIEW, Uri.parse(url))
            startActivity(i)
            true
        } catch (e: Throwable) {
            Log.e(TAG, "打开浏览器失败: $url", e)
            false
        }
    }

    // === 安卓系统/手势返回（内容页→列表页，列表页→退出 App）===
    // 统一走 androidx OnBackPressedDispatcher：API 33+ 且 manifest 开启
    // enableOnBackInvokedCallback 时，系统把预测性返回手势派发给 ComponentActivity 注册的
    // 系统 OnBackInvokedCallback，再由它转发到 dispatcher 上「最后注册」的回调；旧系统则经
    // Activity.onBackPressed 进入同一条链。此前用裸 OnBackInvokedCallback 直接注册，
    // 与 androidx 的系统回调存在注册顺序竞争（后注册者胜出），返回手势可能被吞——
    // 这正是「滑回失效」的根因之一。统一走 dispatcher 后两条路径都收敛到同一回调。
    private fun registerBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                dispatchBackToWeb()
            }
        })
    }

    /** 把返回手势交给 Web 侧的 window.__nexusBack（内容页→列表页，其余→退出 App）。 */
    private fun dispatchBackToWeb() {
        val webView = bridge?.webView ?: return
        webView.post {
            webView.evaluateJavascript("window.__nexusBack && window.__nexusBack()", null)
        }
    }

    companion object {
        private const val TAG = "NexusShell"
    }
}
