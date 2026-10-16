package com.nexusmatrix.app.ui

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

/**
 * 文档 Tab：Capacitor 的 WebView（编辑器 + 页面列表）。
 *
 * 形态参考 Notion 移动端：
 * - 无原生顶栏，WebView 全屏边到边（状态栏区域由 Web 侧 safe-area CSS 兜底）；
 * - 刷新 = 下拉手势（SwipeRefreshLayout），不再放顶栏按钮；
 * - 标题/图标由 Web 页内展示，原生壳不再轮询（省掉 1.5s 一次的 JS 调用）。
 */
@Composable
fun EditorScreen(webView: WebView) {
    var refreshing by remember { mutableStateOf(false) }
    val handler = remember { Handler(Looper.getMainLooper()) }

    DisposableEffect(webView) {
        onDispose { handler.removeCallbacksAndMessages(null) }
    }

    fun onPullRefresh() {
        refreshing = true
        webView.reload()
        // 轮询加载进度收指示器：>=100 或超时（15s）即收起；
        // 最少显示 500ms，避免缓存命中时 spinner 一闪而过。
        val start = SystemClock.uptimeMillis()
        val poll = object : Runnable {
            override fun run() {
                val elapsed = SystemClock.uptimeMillis() - start
                val loaded = webView.progress >= 100
                if (elapsed >= 500 && (loaded || elapsed >= 15_000)) {
                    refreshing = false
                } else {
                    handler.postDelayed(this, 100)
                }
            }
        }
        handler.post(poll)
    }

    AndroidWebView(
        webView = webView,
        onRefresh = { onPullRefresh() },
        isRefreshing = refreshing,
        modifier = Modifier.fillMaxSize(),
    )
}
