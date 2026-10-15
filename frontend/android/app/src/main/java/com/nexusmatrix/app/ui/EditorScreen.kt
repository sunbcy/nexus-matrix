package com.nexusmatrix.app.ui

import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import com.nexusmatrix.app.WebQuery

/**
 * 文档 Tab：Capacitor 的 WebView（编辑器 + 页面列表）。
 *
 * 顶栏标题轮询 Web 侧当前页面（与 location.hash 同一通道），
 * 让原生壳「看起来」知道用户在编辑哪一页，但数据仍以 Web 侧为准。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditorScreen(webView: WebView) {
    var title by remember { mutableStateOf("") }
    var icon by remember { mutableStateOf<String?>(null) }

    // 轮询当前页面标题（1.5s 一次；Web 侧无 __NEXUS_API__ 时保持空标题）。
    // 用 Handler 而非 LaunchedEffect+delay：kotlinx-coroutines 不在编译类路径
    // （compose runtime 只以 runtime 作用域依赖它）。
    DisposableEffect(webView) {
        val handler = Handler(Looper.getMainLooper())
        val poll = object : Runnable {
            override fun run() {
                WebQuery.eval(webView, WebQuery.JS_ACTIVE) { raw ->
                    val page = WebQuery.parseObject(raw)
                    if (page != null) {
                        title = page.optString("title", "")
                        icon = page.optString("icon").takeIf { it.isNotEmpty() && it != "null" }
                    }
                }
                handler.postDelayed(this, 1500)
            }
        }
        handler.post(poll)
        onDispose { handler.removeCallbacks(poll) }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Text(
                    text = listOfNotNull(icon, title.ifEmpty { "Nexus Matrix" }).joinToString(" "),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            },
            actions = {
                IconButton(onClick = { webView.reload() }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "重载编辑器")
                }
            },
            colors = TopAppBarDefaults.topAppBarColors(),
        )
        AndroidWebView(webView = webView, modifier = Modifier.fillMaxSize())
    }
}
