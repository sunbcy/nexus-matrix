package com.nexusmatrix.app.ui

import android.webkit.WebView
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.nexusmatrix.app.WebQuery

/**
 * 收藏 Tab：原生列表，数据来自 Web 侧只读桥（__NEXUS_API__.getFavorites）。
 *
 * 这是阶段 1 的「原生 UI + Web 数据」混合形态——原生端不落数据，
 * 点击后通过 openPage 让 Web 编辑器跳转（阶段 2 再做原生数据层）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FavoritesScreen(webView: WebView, onOpenPage: () -> Unit) {
    var pages by remember { mutableStateOf<List<WebQuery.PageSummary>>(emptyList()) }
    var loaded by remember { mutableStateOf(false) }

    fun refresh() {
        WebQuery.eval(webView, WebQuery.JS_FAVORITES) { raw ->
            pages = WebQuery.parsePages(raw)
            loaded = true
        }
    }

    LaunchedEffect(webView) { refresh() }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("收藏") },
            actions = {
                IconButton(onClick = { refresh() }) {
                    Icon(Icons.Filled.Refresh, contentDescription = "刷新收藏")
                }
            },
        )
        when {
            pages.isEmpty() && !loaded -> Box(
                Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) { Text("读取中…", color = MaterialTheme.colorScheme.onSurfaceVariant) }

            pages.isEmpty() -> Box(
                Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "还没有收藏页面\n在编辑器里把页面标为收藏后显示在这里",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            else -> LazyColumn(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(pages, key = { it.id }) { page ->
                    Card(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                WebQuery.eval(webView, WebQuery.openPageScript(page.id)) { _ -> }
                                onOpenPage()
                            },
                    ) {
                        Row(
                            Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Text(page.icon ?: "★", style = MaterialTheme.typography.titleLarge)
                            Text(
                                page.title,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                    }
                }
            }
        }
    }
}
