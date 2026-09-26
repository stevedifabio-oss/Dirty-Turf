package com.dirtyturf.academy;

import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.net.Uri;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the real packaged plugin, OS intent and JavaScript callback together. */
@RunWith(AndroidJUnit4.class)
public class AuthBridgeTest {
    @Test
    public void warmEmailLinkReachesJavaScript() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> assertNotNull("App plugin must be registered", activity.getBridge().getPlugin("App")));
            awaitText(scenario, "Welcome back.");
            Intent callback = callbackIntent("Warm callback received");
            scenario.onActivity(activity -> activity.startActivity(callback));
            awaitText(scenario, "Warm callback received");
        }
    }

    @Test
    public void coldEmailLinkReachesJavaScript() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(callbackIntent("Cold callback received"))) {
            awaitText(scenario, "Cold callback received");
        }
    }

    private Intent callbackIntent(String message) {
        return new Intent(Intent.ACTION_VIEW,
            Uri.parse("com.dirtyturf.academy://auth/callback?error_description=" + Uri.encode(message)),
            ApplicationProvider.getApplicationContext(), MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    }

    private void awaitText(ActivityScenario<MainActivity> scenario, String text) throws Exception {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(25);
        String last = "";
        while (System.nanoTime() < deadline) {
            CountDownLatch evaluated = new CountDownLatch(1);
            AtomicReference<String> value = new AtomicReference<>("");
            scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                "document.body.innerText", result -> { value.set(result); evaluated.countDown(); }));
            assertTrue("WebView did not respond", evaluated.await(5, TimeUnit.SECONDS));
            last = value.get();
            if (last.contains(text)) return;
            Thread.sleep(100);
        }
        assertTrue("Expected native callback message: " + text + "; screen: " + last, last.contains(text));
    }
}
