package com.dirtyturf.academy;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.ar.core.ArCoreApk;
import org.json.JSONException;

@CapacitorPlugin(
    name = "DirtyTurfMeasure",
    permissions = @Permission(alias = "camera", strings = { Manifest.permission.CAMERA })
)
public class DirtyTurfMeasurePlugin extends Plugin {
    @PluginMethod
    public void isAvailable(PluginCall call) {
        ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(getContext());
        JSObject result = new JSObject();
        result.put("available", availability != ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE);
        call.resolve(result);
    }

    @PluginMethod
    public void startAreaMeasurement(PluginCall call) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermissionResult");
            return;
        }
        launchMeasurement(call);
    }

    @PermissionCallback
    public void cameraPermissionResult(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) {
            launchMeasurement(call);
        } else {
            call.reject("Camera access is required for live turf measurement.");
        }
    }

    private void launchMeasurement(PluginCall call) {
        ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(getContext());
        if (availability == ArCoreApk.Availability.UNSUPPORTED_DEVICE_NOT_CAPABLE) {
            call.reject("Live measurement is not supported on this Android device.");
            return;
        }
        Intent intent = new Intent(getContext(), LiveMeasureActivity.class);
        startActivityForResult(call, intent, "measurementResult");
    }

    @ActivityCallback
    public void measurementResult(PluginCall call, ActivityResult activityResult) {
        if (call == null) return;
        Intent data = activityResult.getData();
        if (activityResult.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("Measurement cancelled.");
            return;
        }

        JSObject result = new JSObject();
        result.put("areaSquareFeet", data.getDoubleExtra(LiveMeasureActivity.EXTRA_AREA_SQUARE_FEET, 0));
        result.put("perimeterFeet", data.getDoubleExtra(LiveMeasureActivity.EXTRA_PERIMETER_FEET, 0));
        result.put("capturedAt", data.getStringExtra(LiveMeasureActivity.EXTRA_CAPTURED_AT));
        try {
            result.put("points", new JSArray(data.getStringExtra(LiveMeasureActivity.EXTRA_POINTS_JSON)));
            call.resolve(result);
        } catch (JSONException exception) {
            call.reject("The live measurement returned invalid point data.", exception);
        }
    }
}
