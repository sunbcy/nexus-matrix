package com.nexusmatrix.app

import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject

/**
 * 原生壳 → Web 的查询助手（阶段 1 的 JS Bridge 方向之一）。
 *
 * 通过 webView.evaluateJavascript 调用前端 nativeBridge.ts 挂在
 * window.__NEXUS_API__ 上的只读 API。所有方法对失败宽容：
 * Web 端未就绪/解析失败时返回空值，由 UI 层呈现「不可用」。
 *
 * 注意：evaluateJavascript 的回调在 UI 线程，可直接更新 Compose 状态。
 */
object WebQuery {

    data class PageSummary(
        val id: String,
        val title: String,
        val icon: String?,
        val isFavorite: Boolean,
        val updatedAt: Long?,
    )

    // === 与前端 nativeBridge.ts 对齐的查询脚本 ===
    const val JS_FAVORITES =
        "window.__NEXUS_API__ ? JSON.stringify(window.__NEXUS_API__.getFavorites()) : 'null'"
    const val JS_ACTIVE =
        "window.__NEXUS_API__ ? JSON.stringify(window.__NEXUS_API__.getActivePage()) : 'null'"
    const val JS_STATUS =
        "window.__NEXUS_API__ ? JSON.stringify(window.__NEXUS_API__.getSyncStatus()) : 'null'"
    const val JS_STORAGE =
        "navigator.storage && navigator.storage.estimate ? JSON.stringify(navigator.storage.estimate()) : 'null'"

    fun openPageScript(id: String): String =
        "window.__NEXUS_API__ ? window.__NEXUS_API__.openPage('${id.filter { it.isLetterOrDigit() || it == '-' }}') : false"

    /** 执行 JS 查询；result 为 JSON 字面量字符串（或 "null"），失败为 null */
    fun eval(webView: WebView, script: String, onResult: (String?) -> Unit) {
        try {
            webView.evaluateJavascript(script) { result -> onResult(result) }
        } catch (e: Throwable) {
            onResult(null)
        }
    }

    fun parseArray(raw: String?): List<JSONObject> {
        if (raw.isNullOrEmpty() || raw == "null") return emptyList()
        return try {
            val arr = JSONArray(raw)
            (0 until arr.length()).map { arr.getJSONObject(it) }
        } catch (e: Throwable) {
            emptyList()
        }
    }

    fun parseObject(raw: String?): JSONObject? {
        if (raw.isNullOrEmpty() || raw == "null") return null
        return try {
            JSONObject(raw)
        } catch (e: Throwable) {
            null
        }
    }

    fun parsePages(raw: String?): List<PageSummary> = parseArray(raw).map { o ->
        PageSummary(
            id = o.optString("id", ""),
            title = o.optString("title", "未命名"),
            icon = o.optString("icon").takeIf { it.isNotEmpty() && it != "null" },
            isFavorite = o.optBoolean("isFavorite", false),
            updatedAt = if (o.has("updatedAt")) o.optLong("updatedAt") else null,
        )
    }
}
