package com.nexusmatrix.app.ui

import androidx.compose.material3.MaterialTheme
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

@Composable
fun NexusTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = NexusLightScheme, content = content)
}
