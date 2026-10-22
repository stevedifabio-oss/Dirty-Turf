package com.dirtyturf.academy

import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.LifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.IdentityHashMap

/**
 * SceneView 4.33 catches session creation failures but lets resume/pause exceptions escape
 * its lifecycle observer. Scope this adapter to that camera scene, never the app's lifecycle.
 */
internal class GuardedArLifecycle(
    private val source: Lifecycle,
    private val onSessionFailure: (Exception) -> Unit,
) : Lifecycle() {
    private val observers = IdentityHashMap<LifecycleObserver, LifecycleObserver>()
    private var failed = false

    override val currentState: State
        get() = source.currentState

    override fun addObserver(observer: LifecycleObserver) {
        if (observers.containsKey(observer)) return
        val guarded = if (observer is DefaultLifecycleObserver || observer is LifecycleEventObserver) {
            LifecycleEventObserver { owner, event ->
                // A failed scene is disposed on the next composition. Do not resume another
                // observer (including its render loop) in the meantime; still forward teardown.
                if (failed && event == Event.ON_RESUME) return@LifecycleEventObserver
                try {
                    if (observer is DefaultLifecycleObserver) dispatchDefault(observer, owner, event)
                    if (observer is LifecycleEventObserver) observer.onStateChanged(owner, event)
                } catch (exception: Exception) {
                    if (event != Event.ON_RESUME && event != Event.ON_PAUSE) throw exception
                    if (!failed) {
                        failed = true
                        onSessionFailure(exception)
                    }
                }
            }
        } else observer
        observers[observer] = guarded
        source.addObserver(guarded)
    }

    override fun removeObserver(observer: LifecycleObserver) {
        observers.remove(observer)?.let(source::removeObserver)
    }

    private fun dispatchDefault(observer: DefaultLifecycleObserver, owner: LifecycleOwner, event: Event) {
        // Match AndroidX ordering: DefaultLifecycleObserver first, then LifecycleEventObserver
        // when one object implements both interfaces.
        when (event) {
            Event.ON_CREATE -> observer.onCreate(owner)
            Event.ON_START -> observer.onStart(owner)
            Event.ON_RESUME -> observer.onResume(owner)
            Event.ON_PAUSE -> observer.onPause(owner)
            Event.ON_STOP -> observer.onStop(owner)
            Event.ON_DESTROY -> observer.onDestroy(owner)
            Event.ON_ANY -> error("ON_ANY must not be dispatched")
        }
    }
}
