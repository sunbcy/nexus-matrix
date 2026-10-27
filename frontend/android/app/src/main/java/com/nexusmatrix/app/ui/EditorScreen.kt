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
 * - 下拉刷新改为「受控」：仅文档列表页顶部生效、内容编辑页禁用，
 *   触发时走 Web 侧重新同步（window.__NEXUS_API__.triggerResync），不再整页 reload。
 */
@Composable
fun EditorScreen(webView: WebView, controller: PullRefreshController) {
    AndroidWebView(
        webView = webView,
        controller = controller,
        modifier = Modifier.fillMaxSize(),
    )
}
