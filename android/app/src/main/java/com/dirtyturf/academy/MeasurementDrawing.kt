package com.dirtyturf.academy

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import kotlin.math.hypot

/** Screen-space artwork anchored to the existing, clipped AR camera projection. */
internal fun DrawScope.drawMeasurementBoundary(overlay: MeasurementOverlay) {
    val tape = Color(0xFFFFFF32)
    val outline = Color(0xDD111811)
    (overlay.segments + listOfNotNull(overlay.previewSegment)).forEach { segment ->
        val start = Offset(segment.start.x, segment.start.y)
        val end = Offset(segment.end.x, segment.end.y)
        val delta = end - start
        val length = hypot(delta.x, delta.y)
        if (!length.isFinite() || length < 1f) return@forEach
        drawLine(outline, start, end, strokeWidth = 12.dp.toPx())
        drawLine(tape, start, end, strokeWidth = 9.dp.toPx())
        val direction = delta / length
        val normal = Offset(-direction.y, direction.x)
        // Ruler styling only: spacing is in screen pixels, not calibrated distance.
        // Keep work bounded even for very large or unusually dense boundaries.
        val spacing = 8.dp.toPx()
        val count = (length / spacing).toInt().coerceAtMost(512)
        for (tick in 1..count) {
            val center = start + direction * (tick * spacing)
            val top = center - normal * 4.dp.toPx()
            val depth = if (tick % 5 == 0) 8.dp.toPx() else 4.dp.toPx()
            drawLine(outline, top, top + normal * depth, strokeWidth = 1.dp.toPx())
        }
    }
    overlay.points.forEach { point ->
        val base = Offset(point.x, point.y)
        val top = base - Offset(0f, 48.dp.toPx())
        // The foot, not the pennant, marks the measured corner.
        drawCircle(outline, 6.dp.toPx(), base)
        drawCircle(tape, 4.dp.toPx(), base)
        drawLine(outline, base, top, strokeWidth = 6.dp.toPx())
        drawLine(Color.White, base, top, strokeWidth = 3.dp.toPx())
        val pennant = Path().apply {
            moveTo(top.x, top.y)
            lineTo(top.x + 29.dp.toPx(), top.y + 10.dp.toPx())
            lineTo(top.x, top.y + 21.dp.toPx())
            close()
        }
        drawPath(pennant, Color(0xFFE5372E))
        drawPath(pennant, outline, style = Stroke(1.5.dp.toPx()))
    }
}
