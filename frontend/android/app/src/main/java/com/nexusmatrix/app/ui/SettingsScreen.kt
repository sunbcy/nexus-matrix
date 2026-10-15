package com.nexusmatrix.app.ui

import android.webkit.WebView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.nexusmatrix.app.BuildConfig
import com.nexusmatrix.app.MainActivity
import com.nexusmatrix.app.ShellPrefs
import com.nexusmatrix.app.WebQuery

/**
 * 设置 Tab：阶段 1 中原生壳真正「可做事」的地方。
 *
 * - 同步服务器：存 SharedPreferences，经 URL query 注入 WebView（见 MainActivity.withSyncServer）
 * - 连接状态 / 存储用量：从 Web 侧只读桥读取（验证 IndexedDB 在 WebView 中的实际配额）
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(webView: WebView) {
    val context = LocalContext.current
    val prefs = remember { ShellPrefs(context) }

    var server by remember { mutableStateOf(prefs.syncServer) }
    var savedHint by remember { mutableStateOf(false) }
    var statusText by remember { mutableStateOf<String?>(null) }
    var storageText by remember { mutableStateOf<String?>(null) }

    fun refreshStatus() {
        WebQuery.eval(webView, WebQuery.JS_STATUS) { raw ->
            val o = WebQuery.parseObject(raw)
            statusText = if (o != null) {
                val err = o.optString("lastError").takeIf { it.isNotEmpty() }
                buildString {
                    append("同步状态：${o.optString("status", "?")}")
                    append("，在线设备：${o.optInt("onlineDevices", 0)}")
                    if (err != null) append("\n$err")
                }
            } else "同步状态：读取失败（Web 侧未就绪）"
        }
        WebQuery.eval(webView, WebQuery.JS_STORAGE) { raw ->
            val o = WebQuery.parseObject(raw)
            storageText = if (o != null) {
                val usageMiB = o.optDouble("usage", 0.0) / 1024.0 / 1024.0
                val quotaMiB = o.optDouble("quota", 0.0) / 1024.0 / 1024.0
                String.format("IndexedDB 用量：%.1f MiB / %.0f MiB", usageMiB, quotaMiB)
            } else "IndexedDB：不可用（WebView 未授予存储？）"
        }
    }

    LaunchedEffect(webView) { refreshStatus() }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        TopAppBar(title = { Text("设置") })

        Text("同步服务器", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(
            value = server,
            onValueChange = { server = it; savedHint = false },
            label = { Text("后端地址") },
            placeholder = { Text("http://192.168.1.10:8010") },
            supportingText = { Text("留空 = 纯本地模式（不连后端）") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = {
                val trimmed = server.trim()
                prefs.syncServer = trimmed
                webView.loadUrl(MainActivity.withSyncServer(webView.url, trimmed))
                savedHint = true
                refreshStatus()
            }) { Text("保存并重载") }
            TextButton(onClick = { server = ""; savedHint = false }) { Text("清空") }
        }
        if (savedHint) {
            Text("已保存，编辑器已按新地址重载", color = MaterialTheme.colorScheme.primary)
        }

        HorizontalDivider()

        Text("连接与存储", style = MaterialTheme.typography.titleMedium)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(statusText ?: "读取中…")
                Text(storageText ?: "读取中…")
                TextButton(onClick = { refreshStatus() }) { Text("刷新状态") }
            }
        }

        HorizontalDivider()

        Text("关于", style = MaterialTheme.typography.titleMedium)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Nexus Matrix ${BuildConfig.VERSION_NAME}（build ${BuildConfig.VERSION_CODE}）")
                Text("appId：${BuildConfig.APPLICATION_ID}")
                Text("最低系统要求：Android 8.0（API 26）")
                Text(
                    "架构：原生壳（Compose）+ WebView 编辑器，\n" +
                        "参考 Notion 的 Hybrid 方案。",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
