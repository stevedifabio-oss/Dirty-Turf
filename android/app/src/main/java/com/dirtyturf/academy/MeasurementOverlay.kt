package com.dirtyturf.academy

/** Pure projection math. The camera overlay owns no Filament entities or geometry buffers. */
internal data class MeasurementPoint(val x: Float, val y: Float, val z: Float)
internal data class OverlayPoint(val x: Float, val y: Float)
internal data class OverlaySegment(val start: OverlayPoint, val end: OverlayPoint)
internal data class MeasurementOverlay(
    val points: List<OverlayPoint> = emptyList(),
    val segments: List<OverlaySegment> = emptyList(),
)

/** ARCore matrices are column-major OpenGL matrices, with clip depth in [-w, w]. */
internal fun projectMeasurementOverlay(
    points: List<MeasurementPoint>,
    view: FloatArray,
    projection: FloatArray,
    width: Float,
    height: Float,
): MeasurementOverlay {
    if (width <= 0 || height <= 0 || !width.isFinite() || !height.isFinite()
        || view.size != 16 || projection.size != 16
        || view.any { !it.isFinite() } || projection.any { !it.isFinite() }) return MeasurementOverlay()

    fun transform(matrix: FloatArray, point: FloatArray) = FloatArray(4) { row ->
        (0..3).sumOf { column -> (matrix[column * 4 + row] * point[column]).toDouble() }.toFloat()
    }
    val clipPoints = points.map { point ->
        if (!point.x.isFinite() || !point.y.isFinite() || !point.z.isFinite()) null
        else transform(projection, transform(view, floatArrayOf(point.x, point.y, point.z, 1f)))
            .takeIf { result -> result.all { it.isFinite() } }
    }
    fun screen(point: FloatArray) = OverlayPoint(
        (point[0] / point[3] + 1f) * width / 2f,
        (1f - point[1] / point[3]) * height / 2f,
    )
    // All six clip planes, plus a positive-w guard, prevent behind-camera points from
    // flipping across the screen and boundaries from exploding through the near plane.
    fun distances(point: FloatArray) = floatArrayOf(
        point[3] + point[0], point[3] - point[0],
        point[3] + point[1], point[3] - point[1],
        point[3] + point[2], point[3] - point[2], point[3] - 0.0001f,
    )
    fun segment(start: FloatArray, end: FloatArray): OverlaySegment? {
        var first = 0f
        var last = 1f
        val startDistances = distances(start)
        val endDistances = distances(end)
        for (plane in startDistances.indices) {
            val a = startDistances[plane]
            val b = endDistances[plane]
            if (a < 0f && b < 0f) return null
            if (a < 0f || b < 0f) {
                val crossing = a / (a - b)
                if (a < 0f) first = maxOf(first, crossing) else last = minOf(last, crossing)
                if (first > last) return null
            }
        }
        fun at(fraction: Float) = FloatArray(4) { start[it] + (end[it] - start[it]) * fraction }
        return OverlaySegment(screen(at(first)), screen(at(last)))
    }
    val segments = mutableListOf<OverlaySegment>()
    val edgeCount = if (points.size >= 3) points.size else (points.size - 1).coerceAtLeast(0)
    repeat(edgeCount) { index ->
        val start = clipPoints[index]
        val end = clipPoints[(index + 1) % points.size]
        if (start != null && end != null) segment(start, end)?.let(segments::add)
    }
    return MeasurementOverlay(
        points = clipPoints.filterNotNull().filter { distances(it).all { distance -> distance >= 0f } }.map(::screen),
        segments = segments,
    )
}
