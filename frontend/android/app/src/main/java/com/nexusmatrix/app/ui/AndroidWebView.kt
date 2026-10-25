package com.nexusmatrix.app.ui

import android.view.ViewGroup
import android.webkit.WebView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * 把 Capacitor 的 WebView 实例嵌入 Compose。
 *
 * 实例由 MainActivity 创建（Capacitor Bridge 持有），此处只负责挂载/卸载，
 * 不重复创建——否则会丢掉 Capacitor 的 JS Bridge 与页面状态。
 *
 * 不再套原生 SwipeRefreshLayout 做下拉刷新：WebView 内部滚动容器（而非根文档）承载滚动，
 * 导致 SwipeRefreshLayout 的 canChildScrollUp 永远为 false，于是「任何界面下滑都触发整页
 * reload」、且与安卓手势导航（顶部下滑=通知栏）冲突。数据本身本地持久化 + WebSocket 自动
 * 同步，无需整页刷新；手动重连走 Web 侧同步指示器即可。
 */
@Composable
fun AndroidWebView(
    webView: WebView,
    modifier: Modifier = Modifier,
) {
    DisposableEffect(webView) {
        onDispose {
            // 只从视图树摘下，不 destroy：WebView 归 Capacitor Bridge 管理，
            // 切 Tab 时它继续在后台运行（与 Notion 的 WebView 常驻策略一致）。
            (webView.parent as? ViewGroup)?.removeView(webView)
        }
    }
    AndroidView(
        factory = { webView },
        modifier = modifier,
    )
}
