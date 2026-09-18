package com.dirtyturf.academy

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.ar.core.Anchor
import com.google.ar.core.Config
import com.google.ar.core.DepthPoint
import com.google.ar.core.Frame
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.TrackingState
import io.github.sceneview.ar.ARSceneView
import io.github.sceneview.math.Position
import io.github.sceneview.rememberEngine
import io.github.sceneview.rememberMaterialLoader
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.sqrt

class LiveMeasureActivity : ComponentActivity() {
    companion object {
        const val EXTRA_AREA_SQUARE_FEET = "areaSquareFeet"
        const val EXTRA_PERIMETER_FEET = "perimeterFeet"
        const val EXTRA_POINTS_JSON = "pointsJson"
        const val EXTRA_CAPTURED_AT = "capturedAt"

        private const val SQUARE_FEET_PER_SQUARE_METER = 10.7639104167
        private const val FEET_PER_METER = 3.280839895
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                LiveMeasureScreen(
                    onCancel = {
                        setResult(Activity.RESULT_CANCELED)
                        finish()
                    },
                    onFinish = ::finishWithResult,
                )
            }
        }
    }

    private fun finishWithResult(points: List<Position>) {
        val areaSquareFeet = polygonAreaSquareMeters(points) * SQUARE_FEET_PER_SQUARE_METER
        val perimeterFeet = polygonPerimeterMeters(points) * FEET_PER_METER
        val pointArray = JSONArray()
        points.forEach { point ->
            pointArray.put(JSONObject().put("x", point.x).put("y", point.y).put("z", point.z))
        }
        val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date())

        setResult(
            Activity.RESULT_OK,
            Intent()
                .putExtra(EXTRA_AREA_SQUARE_FEET, areaSquareFeet)
                .putExtra(EXTRA_PERIMETER_FEET, perimeterFeet)
                .putExtra(EXTRA_POINTS_JSON, pointArray.toString())
                .putExtra(EXTRA_CAPTURED_AT, timestamp),
        )
        finish()
    }
}

@Composable
private fun LiveMeasureScreen(
    onCancel: () -> Unit,
    onFinish: (List<Position>) -> Unit,
) {
    val anchors = remember { mutableStateListOf<Anchor>() }
    var worldPoints by remember { mutableStateOf<List<Position>>(emptyList()) }
    var latestFrame by remember { mutableStateOf<Frame?>(null) }
    var viewportSize by remember { mutableStateOf(Size.Zero) }
    var isTracking by remember { mutableStateOf(false) }
    var status by remember {
        mutableStateOf("Move slowly, aim the reticle at the first turf corner, then add a point.")
    }

    val engine = rememberEngine()
    val materialLoader = rememberMaterialLoader(engine)
    val markerMaterial = remember(materialLoader) {
        materialLoader.createColorInstance(Color(0xFF78C12E), metallic = 0f, roughness = 0.7f)
    }
    val lineMaterial = remember(materialLoader) {
        materialLoader.createColorInstance(Color(0xFFFFFFFF), metallic = 0f, roughness = 0.8f)
    }

    DisposableEffect(Unit) {
        onDispose { anchors.forEach(Anchor::detach) }
    }

    fun updateStatus() {
        status = when {
            worldPoints.size < 3 -> "Point ${worldPoints.size} placed. Move to the next turf corner."
            else -> {
                val squareFeet = polygonAreaSquareMeters(worldPoints) * 10.7639104167
                val feet = polygonPerimeterMeters(worldPoints) * 3.280839895
                "${worldPoints.size} points · ${formatOneDecimal(squareFeet)} sq ft · ${formatOneDecimal(feet)} ft perimeter"
            }
        }
    }

    fun addPoint() {
        val frame = latestFrame
        if (frame == null || !isTracking || viewportSize == Size.Zero) {
            status = "Tracking is not ready. Move the phone slowly across the turf."
            return
        }
        val centerX = viewportSize.width / 2f
        val centerY = viewportSize.height / 2f
        val hit = runCatching { frame.hitTest(centerX, centerY) }.getOrNull().orEmpty().firstOrNull { result ->
            when (val trackable = result.trackable) {
                is Plane -> trackable.trackingState == TrackingState.TRACKING && trackable.isPoseInPolygon(result.hitPose)
                is DepthPoint -> true
                is Point -> true
                else -> false
            }
        }
        if (hit == null) {
            status = "No turf surface found at the reticle. Aim at a textured area and try again."
            return
        }
        anchors.add(hit.createAnchor())
        worldPoints = anchors.map { it.pose.toPosition() }
        updateStatus()
    }

    fun undoPoint() {
        anchors.removeLastOrNull()?.detach()
        worldPoints = anchors.map { it.pose.toPosition() }
        updateStatus()
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF07140C))
            .onSizeChanged { viewportSize = Size(it.width.toFloat(), it.height.toFloat()) },
    ) {
        ARSceneView(
            modifier = Modifier.fillMaxSize(),
            engine = engine,
            materialLoader = materialLoader,
            planeRenderer = true,
            sessionConfiguration = { session, config ->
                config.planeFindingMode = Config.PlaneFindingMode.HORIZONTAL
                config.depthMode = if (session.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) {
                    Config.DepthMode.AUTOMATIC
                } else {
                    Config.DepthMode.DISABLED
                }
            },
            onSessionFailure = { failure ->
                status = failure.cause.localizedMessage ?: "ARCore could not start on this device."
            },
            onSessionUpdated = { _, frame ->
                latestFrame = frame
                isTracking = frame.camera.trackingState == TrackingState.TRACKING
                if (anchors.isNotEmpty()) {
                    val next = anchors.map { it.pose.toPosition() }
                    if (next != worldPoints) worldPoints = next
                }
            },
        ) {
            anchors.forEach { anchor ->
                key(anchor) {
                    AnchorNode(anchor = anchor) {
                        SphereNode(radius = 0.025f, materialInstance = markerMaterial)
                    }
                }
            }
            for (index in 0 until (worldPoints.size - 1).coerceAtLeast(0)) {
                key("segment-$index") {
                    LineNode(
                        start = worldPoints[index],
                        end = worldPoints[index + 1],
                        materialInstance = lineMaterial,
                    )
                }
            }
            if (worldPoints.size >= 3) {
                key("closing-segment") {
                    LineNode(
                        start = worldPoints.last(),
                        end = worldPoints.first(),
                        materialInstance = lineMaterial,
                    )
                }
            }
        }

        Surface(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .fillMaxWidth()
                .padding(14.dp),
            color = Color(0xDD0B2D17),
            contentColor = Color.White,
            shape = RoundedCornerShape(8.dp),
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Text(
                    text = "LIVE TURF MEASUREMENT",
                    color = Color(0xFF78C12E),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Black,
                )
                Spacer(modifier = Modifier.height(5.dp))
                Text(text = status, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
            }
        }

        Box(
            modifier = Modifier
                .align(Alignment.Center)
                .size(58.dp)
                .border(2.dp, Color.White, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Box(modifier = Modifier.width(74.dp).height(2.dp).background(Color.White))
            Box(modifier = Modifier.width(2.dp).height(74.dp).background(Color.White))
        }

        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(14.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(Color(0xDD0B2D17))
                .padding(10.dp),
        ) {
            Button(
                onClick = ::addPoint,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Color(0xFF78C12E),
                    contentColor = Color(0xFF063015),
                ),
                shape = RoundedCornerShape(8.dp),
            ) {
                Text("Add point", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SecondaryAction("Cancel", onClick = onCancel)
                SecondaryAction("Undo", enabled = anchors.isNotEmpty(), onClick = ::undoPoint)
                SecondaryAction(
                    "Finish",
                    enabled = worldPoints.size >= 3,
                    onClick = { onFinish(worldPoints) },
                )
            }
        }
    }
}

@Composable
private fun SecondaryAction(
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    TextButton(onClick = onClick, enabled = enabled) {
        Text(label, color = if (enabled) Color.White else Color.White.copy(alpha = 0.4f), fontWeight = FontWeight.Bold)
    }
}

private fun com.google.ar.core.Pose.toPosition() = Position(x = tx(), y = ty(), z = tz())

private fun polygonAreaSquareMeters(points: List<Position>): Double {
    if (points.size < 3) return 0.0
    var crossX = 0.0
    var crossY = 0.0
    var crossZ = 0.0
    points.indices.forEach { index ->
        val current = points[index]
        val next = points[(index + 1) % points.size]
        crossX += current.y * next.z - current.z * next.y
        crossY += current.z * next.x - current.x * next.z
        crossZ += current.x * next.y - current.y * next.x
    }
    return 0.5 * sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ)
}

private fun polygonPerimeterMeters(points: List<Position>): Double {
    if (points.size < 2) return 0.0
    return points.indices.sumOf { index ->
        val current = points[index]
        val next = points[(index + 1) % points.size]
        val dx = (next.x - current.x).toDouble()
        val dy = (next.y - current.y).toDouble()
        val dz = (next.z - current.z).toDouble()
        sqrt(dx * dx + dy * dy + dz * dz)
    }
}

private fun formatOneDecimal(value: Double): String = String.format(Locale.US, "%.1f", value)
