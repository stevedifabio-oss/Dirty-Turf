package com.dirtyturf.academy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MeasurementOverlayTest {
    private val identity = floatArrayOf(
        1f, 0f, 0f, 0f,
        0f, 1f, 0f, 0f,
        0f, 0f, 1f, 0f,
        0f, 0f, 0f, 1f,
    )
    private val perspective = floatArrayOf(
        1f, 0f, 0f, 0f,
        0f, 1f, 0f, 0f,
        0f, 0f, -11f / 9f, -1f,
        0f, 0f, -20f / 9f, 0f,
    )

    @Test fun projectsWorldCoordinatesUsingColumnMajorCameraMatricesAndDownwardScreenY() {
        val view = identity.copyOf().apply { this[12] = -0.25f }
        val result = projectMeasurementOverlay(
            listOf(MeasurementPoint(0.25f, 0.5f, 0f)), view, identity, 200f, 100f,
        )
        assertEquals(100f, result.points.single().x, 0.001f)
        assertEquals(25f, result.points.single().y, 0.001f)
        assertTrue(result.segments.isEmpty())
    }

    @Test fun closesOnlyACompletedPolygonAndKeepsTwoPointBoundaryOpen() {
        val points = listOf(
            MeasurementPoint(0f, 0f, 0f), MeasurementPoint(0.5f, 0f, 0f), MeasurementPoint(0f, 0.5f, 0f),
        )
        val triangle = projectMeasurementOverlay(points, identity, identity, 100f, 100f)
        assertEquals(3, triangle.segments.size)
        assertEquals(triangle.points.last(), triangle.segments.last().start)
        assertEquals(triangle.points.first(), triangle.segments.last().end)
        assertEquals(1, projectMeasurementOverlay(points.take(2), identity, identity, 100f, 100f).segments.size)
    }

    @Test fun clipsBoundaryAtViewportEdgesInsteadOfDiscardingVisibleCrossing() {
        val result = projectMeasurementOverlay(
            listOf(MeasurementPoint(-2f, 0f, 0f), MeasurementPoint(2f, 0f, 0f)),
            identity, identity, 200f, 100f,
        )
        assertTrue(result.points.isEmpty())
        assertEquals(0f, result.segments.single().start.x, 0.001f)
        assertEquals(200f, result.segments.single().end.x, 0.001f)
    }

    @Test fun clipsAPerspectiveSegmentCrossingTheCameraAndNearPlaneBeforeDividingByW() {
        val result = projectMeasurementOverlay(
            listOf(MeasurementPoint(0f, 0f, 0.5f), MeasurementPoint(0.5f, 0f, -2f)),
            identity, perspective, 100f, 100f,
        )
        assertEquals(1, result.points.size)
        val line = result.segments.single()
        assertEquals(65f, line.start.x, 0.001f)
        assertEquals(62.5f, line.end.x, 0.001f)
        assertEquals(50f, line.start.y, 0.001f)
    }

    @Test fun doesNotMirrorPointsBehindTheCameraOrBeyondTheFarPlane() {
        val result = projectMeasurementOverlay(
            listOf(MeasurementPoint(0f, 0f, 1f), MeasurementPoint(0.5f, 0f, 2f)),
            identity, perspective, 100f, 100f,
        )
        assertEquals(MeasurementOverlay(), result)
        val far = projectMeasurementOverlay(
            listOf(MeasurementPoint(0f, 0f, -11f), MeasurementPoint(0.5f, 0f, -12f)),
            identity, perspective, 100f, 100f,
        )
        assertEquals(MeasurementOverlay(), far)
    }

    @Test fun skipsInvalidPointsWithoutConnectingAcrossThem() {
        val result = projectMeasurementOverlay(
            listOf(MeasurementPoint(0f, 0f, 0f), MeasurementPoint(Float.NaN, 0f, 0f)),
            identity, identity, 100f, 100f,
        )
        assertEquals(1, result.points.size)
        assertTrue(result.segments.isEmpty())
    }

    @Test fun returnsAnEmptyOverlayUntilTheViewportAndMatricesAreValid() {
        val points = listOf(MeasurementPoint(0f, 0f, 0f))
        assertEquals(MeasurementOverlay(), projectMeasurementOverlay(points, identity, identity, 0f, 100f))
        assertEquals(MeasurementOverlay(), projectMeasurementOverlay(points, identity, identity, Float.NaN, 100f))
        assertEquals(MeasurementOverlay(), projectMeasurementOverlay(points, floatArrayOf(), identity, 100f, 100f))
        assertEquals(MeasurementOverlay(), projectMeasurementOverlay(points, identity, identity.copyOf().apply { this[0] = Float.NaN }, 100f, 100f))
    }
}
