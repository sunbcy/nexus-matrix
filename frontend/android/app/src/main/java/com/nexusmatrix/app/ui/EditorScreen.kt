package com.nexusmatrix.app.ui

import android.webkit.WebView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * 文档 Tab：Capacitor 的 WebView（编辑器 + 页面列表）。
 *
 * 形态参考 Notion 移动端：
 * - 无原生顶栏，WebView 全屏边到边（状态栏区域由 Web 侧 safe-area CSS 兜底）；
 * - 不再做原生下拉刷新（SwipeRefreshLayout 会与安卓手势冲突、且触发整页 reload 丢失编辑态）；
 *   数据本地持久化 + WebSocket 自动同步，手动重连走 Web 侧同步指示器。
 */
@Composable
fun EditorScreen(webView: WebView) {
    AndroidWebView(
        webView = webView,
        modifier = Modifier.fillMaxSize(),
    )
}
