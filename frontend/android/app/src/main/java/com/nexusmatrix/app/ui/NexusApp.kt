package com.nexusmatrix.app.ui

import android.webkit.WebView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.List
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector

/** 底部 Tab（阶段 1 决策：导航形态用底部 Tab） */
enum class ShellTab(val label: String, val icon: ImageVector) {
    DOCS("文档", Icons.Filled.List),
    FAVORITES("收藏", Icons.Filled.Star),
    SETTINGS("设置", Icons.Filled.Settings),
}

/**
 * 原生壳骨架：底部 Tab + 内容区。
 *
 * 文档 Tab = Capacitor WebView（编辑器与页面列表都在 Web 侧，方案 A）；
 * 收藏/设置为原生 Compose UI（阶段 1 的壳能力演示 + 真实可用的设置）。
 */
@Composable
fun NexusApp(webView: WebView) {
    var tab by rememberSaveable { mutableStateOf(ShellTab.DOCS) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                ShellTab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t,
                        onClick = { tab = t },
                        icon = { Icon(t.icon, contentDescription = t.label) },
                        label = { Text(t.label) },
                        alwaysShowLabel = true,
                    )
                }
            }
        },
        // 内容区不再统一让出系统栏 inset：文档 Tab 的 WebView 边到边
        // （状态栏区域由 Web 侧 safe-area CSS 处理，Notion 移动端同款）。
        // 收藏/设置的 TopAppBar 自带状态栏 inset，NavigationBar 自带手势栏 inset。
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
    ) { padding ->
        Box(Modifier.padding(padding)) {
            when (tab) {
                ShellTab.DOCS -> EditorScreen(webView)
                ShellTab.FAVORITES -> FavoritesScreen(
                    webView = webView,
                    onOpenPage = { tab = ShellTab.DOCS },
                )
                ShellTab.SETTINGS -> SettingsScreen(webView)
            }
        }
    }
}
