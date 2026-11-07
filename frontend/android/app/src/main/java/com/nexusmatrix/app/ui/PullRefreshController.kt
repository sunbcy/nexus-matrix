package com.nexusmatrix.app.ui

import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf

/**
 * 受控下拉刷新的共享状态：Web 侧通过 JS Bridge 写入，Compose 的 SwipeRefreshLayout 读取。
 *
 * - enabled：当前是否允许下拉刷新（仅文档列表页为 true，内容编辑页为 false）。
 * - atTop：列表滚动容器是否已在顶部（仅顶部允许触发，避免阅读时误刷新）。
 * - refreshing：刷新进行中（驱动 spinner）；由 Web 侧同步完成后回调清除。
 */
class PullRefreshController {
    val enabled: MutableState<Boolean> = mutableStateOf(false)
    val atTop: MutableState<Boolean> = mutableStateOf(true)
    val refreshing: MutableState<Boolean> = mutableStateOf(false)
}

/**
 * Web → 原生 桥（写入侧）：Web 侧通过 window.NexusNativeBridge 调用，
 * 把"是否允许下拉刷新""列表是否置顶"推给原生，并在同步完成后通知收起 spinner。
 */
class NexusJsBridge(
    private val controller: PullRefreshController,
    private val openExternalHandler: (String) -> Boolean,
) {
    /**
     * 安卓原生登录 OAuth 时，由 Web 侧（auth.ts）在点击「用 Google 登录」时写入后端
     * （OAuth 入口）地址。深链回跳拿到 code 后，原生层要用它构造后端回调 URL，
     * 以便在携带 OAuth session cookie 的浏览器里完成令牌交换。
     *
     * 注意：谷歌 OAuth 的回跳必须是公网 https，故该地址须为公网后端；纯局域网后端
     * 无法用于谷歌登录（谷歌不接受局域网 / localhost 回跳）。
     */
    var oauthBackend: String? = null

    @android.webkit.JavascriptInterface
    fun setOAuthBackend(origin: String) {
        oauthBackend = origin.trim().removeSuffix("/")
    }

    @android.webkit.JavascriptInterface
    fun setPullRefresh(enabled: Boolean) {
        controller.enabled.value = enabled
    }

    @android.webkit.JavascriptInterface
    fun setListScrollAtTop(atTop: Boolean) {
        controller.atTop.value = atTop
    }

    @android.webkit.JavascriptInterface
    fun finishPullRefresh() {
        controller.refreshing.value = false
    }

    /**
     * Web 侧（auth.ts）请求用系统浏览器打开外部 URL——安卓 Google OAuth 必须在系统浏览器
     * 完成（WebView 内会被 Google 以 disallowed_useragent 拒绝）。返回是否成功发起。
     */
    @android.webkit.JavascriptInterface
    fun openExternal(url: String): Boolean {
        // 必须用 openExternalHandler（构造参数）：若写成 openExternal(url)，
        // Kotlin 会优先解析到这个同名成员函数自身 → 无限递归 → StackOverflowError，
        // JS 侧表现为「点 Google 登录完全没反应」。
        return openExternalHandler(url)
    }
}
