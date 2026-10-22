package com.dirtyturf.academy

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.ar.core.exceptions.CameraNotAvailableException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class GuardedArLifecycleTest {
    private class Owner : LifecycleOwner {
        val registry = LifecycleRegistry.createUnsafe(this)
        override val lifecycle: Lifecycle get() = registry
    }

    @Test fun cameraResumeFailureCannotEscapeIntoTheActivityOrResumeTheFailedRenderLoop() {
        val owner = Owner()
        val failure = CameraNotAvailableException()
        val failures = mutableListOf<Exception>()
        val camera = GuardedArLifecycle(owner.lifecycle, failures::add)
        var cameraPaused = false
        var renderResumed = false
        var appResumed = false
        camera.addObserver(object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { throw failure }
            override fun onPause(owner: LifecycleOwner) { cameraPaused = true }
        })
        camera.addObserver(object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { renderResumed = true }
        })
        owner.lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { appResumed = true }
        })

        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        assertEquals(Lifecycle.State.RESUMED, owner.lifecycle.currentState)
        assertSame(failure, failures.single())
        assertFalse(renderResumed)
        assertTrue(appResumed)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
        assertTrue(cameraPaused)
    }

    @Test fun normalCameraEventsFollowTheSourceLifecycleAndExactObserverRemovalWorks() {
        val owner = Owner()
        val events = mutableListOf<Lifecycle.Event>()
        val camera = GuardedArLifecycle(owner.lifecycle) { fail("Unexpected session failure") }
        val observer = LifecycleEventObserver { _, event -> events.add(event) }
        camera.addObserver(observer)
        camera.addObserver(observer)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        assertEquals(listOf(
            Lifecycle.Event.ON_CREATE, Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME,
            Lifecycle.Event.ON_PAUSE, Lifecycle.Event.ON_RESUME,
        ), events)
        assertEquals(owner.lifecycle.currentState, camera.currentState)
        camera.removeObserver(observer)
        camera.removeObserver(observer)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_DESTROY)
        assertEquals(5, events.size)
        assertEquals(0, owner.registry.observerCount)
    }

    @Test fun observerWithBothInterfacesUsesAndroidXDefaultThenEventOrdering() {
        val owner = Owner()
        val calls = mutableListOf<String>()
        val camera = GuardedArLifecycle(owner.lifecycle) { fail("Unexpected session failure") }
        camera.addObserver(object : DefaultLifecycleObserver, LifecycleEventObserver {
            override fun onResume(owner: LifecycleOwner) { calls.add("default") }
            override fun onStateChanged(source: LifecycleOwner, event: Lifecycle.Event) {
                if (event == Lifecycle.Event.ON_RESUME) calls.add("event")
            }
        })
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        assertEquals(listOf("default", "event"), calls)
    }

    @Test fun pauseFailureIsReportedOnceAndOtherObserversCanStillReleaseTheirResources() {
        val owner = Owner()
        val failures = mutableListOf<Exception>()
        val camera = GuardedArLifecycle(owner.lifecycle, failures::add)
        var released = 0
        camera.addObserver(LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_PAUSE) throw IllegalStateException("Camera disconnected")
        })
        camera.addObserver(object : DefaultLifecycleObserver {
            override fun onPause(owner: LifecycleOwner) { released += 1 }
        })
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_PAUSE)
        assertEquals(1, failures.size)
        assertEquals(2, released)
    }

    @Test fun aFreshCameraAttemptCanResumeAfterTheFailedSceneHasBeenRemoved() {
        val owner = Owner()
        owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
        val failedCamera = GuardedArLifecycle(owner.lifecycle) { }
        val observer = object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { throw CameraNotAvailableException() }
        }
        failedCamera.addObserver(observer)
        failedCamera.removeObserver(observer)
        assertEquals(0, owner.registry.observerCount)
        var resumed = 0
        val restarted = GuardedArLifecycle(owner.lifecycle) { fail("Fresh scene failed") }
        restarted.addObserver(object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { resumed += 1 }
        })
        assertEquals(1, resumed)
    }

    @Test fun fatalJvmErrorsAreNeverSwallowedAsCameraFailures() {
        val owner = Owner()
        val camera = GuardedArLifecycle(owner.lifecycle) { fail("Must not catch JVM errors") }
        val fatal = LinkageError("Native library error")
        camera.addObserver(object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { throw fatal }
        })
        try {
            owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_RESUME)
            fail("Fatal error was swallowed")
        } catch (caught: LinkageError) {
            assertSame(fatal, caught)
        }
    }

    @Test fun nonSessionLifecycleExceptionsAreNotHiddenByTheCameraGuard() {
        val owner = Owner()
        val camera = GuardedArLifecycle(owner.lifecycle) { fail("Not a camera resume/pause error") }
        val failure = IllegalArgumentException("Bad create callback")
        camera.addObserver(LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_CREATE) throw failure
        })
        try {
            owner.registry.handleLifecycleEvent(Lifecycle.Event.ON_CREATE)
            fail("Non-session exception was swallowed")
        } catch (caught: IllegalArgumentException) {
            assertSame(failure, caught)
        }
    }

    @Test fun hitTestingRejectsMissingStaleOrReversedTimeFramesAndAcceptsFreshFrames() {
        assertFalse(isMeasurementFrameFresh(0L, 50L))
        assertFalse(isMeasurementFrameFresh(500L, 499L))
        assertTrue(isMeasurementFrameFresh(500L, 500L))
        assertTrue(isMeasurementFrameFresh(500L, 1_500L))
        assertFalse(isMeasurementFrameFresh(500L, 1_501L))
    }
}
