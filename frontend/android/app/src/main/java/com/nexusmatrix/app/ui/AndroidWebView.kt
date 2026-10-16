package com.nexusmatrix.app.ui

import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * 把 Capacitor 的 WebView 实例嵌入 Compose。
 *
 * 实例由 MainActivity 创建（Capacitor Bridge 持有），此处只负责挂载/卸载，
 * 不重复创建——否则会丢掉 Capacitor 的 JS Bridge 与页面状态。
 *
 * onRefresh 非空时套一层 SwipeRefreshLayout 提供下拉刷新（Notion 移动端交互）。
 * 为什么不用 Compose 的 PullToRefreshBox：WebView 不实现 NestedScrollingChild，
 * 拖动事件不会进入 Compose 嵌套滚动体系，PullToRefreshBox 收不到手势；
 * View 层的 SwipeRefreshLayout 用 canChildScrollUp 判断，对 WebView 有效。
 */
@Composable
fun AndroidWebView(
    webView: WebView,
    modifier: Modifier = Modifier,
    onRefresh: (() -> Unit)? = null,
    isRefreshing: Boolean = false,
) {
    DisposableEffect(webView) {
        onDispose {
            // 只从视图树摘下，不 destroy：WebView 归 Capacitor Bridge 管理，
            // 切 Tab 时它继续在后台运行（与 Notion 的 WebView 常驻策略一致）。
            (webView.parent as? ViewGroup)?.removeView(webView)
        }
    }
    AndroidView(
        factory = { context ->
            if (onRefresh == null) {
                webView
            } else {
                SwipeRefreshLayout(context).apply {
                    setOnRefreshListener { onRefresh() }
                    // 品牌色：青色进度条 + 深色轨道（对齐 Web 端 cyan-glow / nexus-surface）
                    setColorSchemeColors(0xFF00F0FF.toInt())
                    setProgressBackgroundColorSchemeColor(0xFF14161A.toInt())
                    (webView.parent as? ViewGroup)?.removeView(webView)
                    webView.layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )
                    addView(webView)
                }
            }
        },
        update = { view ->
            if (view is SwipeRefreshLayout) view.isRefreshing = isRefreshing
        },
        modifier = modifier,
    )
}
