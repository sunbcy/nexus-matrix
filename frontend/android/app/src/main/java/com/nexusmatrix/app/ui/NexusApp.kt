package com.nexusmatrix.app.ui

import android.webkit.WebView
import androidx.compose.runtime.Composable

/**
 * 原生壳：全屏 WebView，无底部 Tab。
 *
 * 【2026-10-17 变更：彻底移除底部 Tab 导航】
 * 演进过程：
 * 1) 阶段 1 做了 文档/收藏/设置 三个底部 Tab；
 * 2) 随后移除「收藏」——它与 Web 侧边栏的收藏分组是同一份数据
 *    （都过滤 pages.isFavorite），功能重叠，且原生端是启动时快照、会过期；
 * 3) 现在连「设置」Tab 也一并去掉：底部 Tab 对单页编辑器没有导航价值，
 *    反而常驻占用约 56dp 垂直空间，而移动端内容区高度极其宝贵。
 *
 * 设置能力改由 Web 侧承载：入口在侧边栏右上角齿轮，页面级操作在内容页的
 * 「···」菜单里（与 Notion 移动端一致：页面操作走右上 ···）。
 * 需要原生的配置（如同步服务器地址）继续走 ShellPrefs + URL query 注入。
 */
@Composable
fun NexusApp(webView: WebView, controller: PullRefreshController) {
    // 直接铺满：不再用 Scaffold/NavigationBar，底部空间全部还给编辑器。
    // EditorScreen 已内置受控下拉刷新与 WebView 常驻策略（不 destroy）。
    EditorScreen(webView, controller)
}
