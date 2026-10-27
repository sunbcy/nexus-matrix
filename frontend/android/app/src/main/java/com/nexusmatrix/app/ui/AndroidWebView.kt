package com.nexusmatrix.app.ui

import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * 把 Capacitor 的 WebView 实例嵌入 Compose。
 *
 * 实例由 MainActivity 创建（Capacitor Bridge 持有），此处只负责挂载/卸载，不重复创建。
 *
 * 受控下拉刷新：仅当 controller.enabled 为真（文档列表页）且 controller.atTop 为真
 * （列表滚动到顶部）时才允许 SwipeRefreshLayout 触发；触发后调用 Web 侧
 * window.__NEXUS_API__.triggerResync() 做"重新同步"，而非整页 reload（不丢编辑态）。
 * 内容编辑页 controller.enabled 为假 → 整个手势禁用，与安卓手势导航不再冲突。
 */
@Composable
fun AndroidWebView(
    webView: WebView,
    controller: PullRefreshController,
    modifier: Modifier = Modifier,
) {
    val enabled by controller.enabled
    val atTop by controller.atTop
    val refreshing by controller.refreshing

    DisposableEffect(webView) {
        onDispose {
            // 只从视图树摘下，不 destroy：WebView 归 Capacitor Bridge 管理，
            // 切 Tab 时它继续在后台运行（与 Notion 的 WebView 常驻策略一致）。
            (webView.parent as? ViewGroup)?.removeView(webView)
        }
    }
    AndroidView(
        factory = { context ->
            val srl = object : SwipeRefreshLayout(context) {
                // 仅当列表置顶时允许触发下拉刷新；否则让 WebView 内部正常滚动，
                // 避免阅读时下滑误触发。enabled=false（内容编辑页）时整体禁用。
                override fun canChildScrollUp(): Boolean = !controller.atTop.value
            }
            srl.setColorSchemeColors(0xFF00F0FF.toInt())
            srl.setProgressBackgroundColorSchemeColor(0xFF14161A.toInt())
            (webView.parent as? ViewGroup)?.removeView(webView)
            webView.layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            srl.addView(webView)
            srl.setOnRefreshListener {
                controller.refreshing.value = true
                // 安全网：即便 Web 侧未回调，8s 后也强制收起 spinner。
                srl.postDelayed({ controller.refreshing.value = false }, 8000)
                webView.evaluateJavascript(
                    "window.__NEXUS_API__ && window.__NEXUS_API__.triggerResync && window.__NEXUS_API__.triggerResync()",
                    null,
                )
            }
            srl
        },
        update = { view ->
            val srl = view as SwipeRefreshLayout
            srl.isEnabled = enabled
            srl.isRefreshing = refreshing
        },
        modifier = modifier,
    )
}
