package com.nexusmatrix.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Compose 外壳配色：跟随 Web 默认「纸白」主题，避免 WebView 加载前露出深色底。 */
private val NexusLightScheme = lightColorScheme(
    primary = Color(0xFF2383E2),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFDCEBFA),
    onPrimaryContainer = Color(0xFF0B3D6B),
    background = Color(0xFFFFFFFF),
    onBackground = Color(0xFF37352F),
    surface = Color(0xFFF7F7F5),
    onSurface = Color(0xFF37352F),
    surfaceVariant = Color(0xFFEFEFED),
    onSurfaceVariant = Color(0xFF6B6B66),
    outline = Color(0xFFD3D3CE),
    error = Color(0xFFD44C47),
)

/** Web 深色主题（酷黑）下的外壳配色，避免 WebView 加载前 / 过滚动时露出纸白底。 */
private val NexusDarkScheme = darkColorScheme(
    primary = Color(0xFF00F0FF),
    onPrimary = Color(0xFF090A0C),
    primaryContainer = Color(0xFF1E2126),
    onPrimaryContainer = Color(0xFFE5E7EB),
    background = Color(0xFF090A0C),
    onBackground = Color(0xFFE5E7EB),
    surface = Color(0xFF14161A),
    onSurface = Color(0xFFE5E7EB),
    surfaceVariant = Color(0xFF1E2126),
    onSurfaceVariant = Color(0xFF9CA3AF),
    outline = Color(0xFF30343B),
    error = Color(0xFFFF6B66),
)

@Composable
fun NexusTheme(darkTheme: Boolean = false, content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) NexusDarkScheme else NexusLightScheme,
        content = content,
    )
}
