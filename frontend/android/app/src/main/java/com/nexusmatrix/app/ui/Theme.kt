package com.nexusmatrix.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Nexus 暗色主题（与前端 #0b0e14 底色 / #00f0ff 强调色一致） */
private val NexusDarkScheme = darkColorScheme(
    primary = Color(0xFF00F0FF),
    onPrimary = Color(0xFF00363D),
    primaryContainer = Color(0xFF004E57),
    onPrimaryContainer = Color(0xFF97F0FF),
    background = Color(0xFF0B0E14),
    onBackground = Color(0xFFE5E7EB),
    surface = Color(0xFF14161A),
    onSurface = Color(0xFFE5E7EB),
    surfaceVariant = Color(0xFF1E2126),
    onSurfaceVariant = Color(0xFF9CA3AF),
    outline = Color(0xFF374151),
    error = Color(0xFFFF6B6B),
)

@Composable
fun NexusTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = NexusDarkScheme, content = content)
}
