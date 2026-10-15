package com.nexusmatrix.app

import android.content.Context

/**
 * 原生壳的本地偏好（SharedPreferences）。
 *
 * 只存「壳」自己的配置（同步服务器地址）。
 * 页面数据仍在 WebView 的 IndexedDB 里——原生数据层是阶段 2 的事，不在这里重复实现。
 */
class ShellPrefs(context: Context) {
    private val prefs = context.applicationContext
        .getSharedPreferences("nexus_shell", Context.MODE_PRIVATE)

    /** 同步服务器地址，如 http://192.168.1.10:8010；空 = 纯本地模式 */
    var syncServer: String
        get() = prefs.getString(KEY_SYNC_SERVER, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SYNC_SERVER, value.trim()).apply()

    companion object {
        private const val KEY_SYNC_SERVER = "sync_server"
    }
}
