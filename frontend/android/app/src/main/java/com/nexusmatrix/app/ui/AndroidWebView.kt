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
 */
@Composable
fun AndroidWebView(webView: WebView, modifier: Modifier = Modifier) {
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
