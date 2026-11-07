package expo.modules.focusservice

import android.content.Context
import android.content.Intent
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoFocusServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoFocusService")

    AsyncFunction("isAvailable") {
      val sm =
        appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      // startForegroundService / NotificationChannel are API 26+ but minSdk
      // is 24 — degrade honestly instead of crashing on older devices.
      // The WAKE-UP proximity variant is required: the non-wake-up sensor
      // stops delivering in Doze, so a device without it can't honestly
      // claim suspension coverage.
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        sm?.getDefaultSensor(Sensor.TYPE_PROXIMITY, true) != null
    }

    AsyncFunction("startService") {
      // Must be called while the app is foreground — API 31+ forbids
      // starting a FGS from background, and the service would throw.
      // A null context is a real failure: returning silently would let JS
      // mark the provider running and claim coverage with zero evidence.
      val ctx =
        appContext.reactContext
          ?: throw CodedException(
            "ERR_FOCUS_NO_CONTEXT",
            "Cannot start the focus service — the app is not attached",
            null,
          )
      // A double-start while the service still runs must not discard
      // buffered undrained edges — coverage claimed but never reported.
      if (!FocusSessionService.running) {
        synchronized(FocusSessionService.transitions) {
          FocusSessionService.transitions.clear()
        }
      }
      ContextCompat.startForegroundService(ctx, Intent(ctx, FocusSessionService::class.java))
    }

    AsyncFunction("stopService") {
      // Symmetric with startService — a silent no-op while the service runs
      // would leave a wake lock held after JS believes coverage ended.
      val ctx =
        appContext.reactContext
          ?: throw CodedException(
            "ERR_FOCUS_NO_CONTEXT",
            "Cannot stop the focus service — the app is not attached",
            null,
          )
      ctx.stopService(Intent(ctx, FocusSessionService::class.java))
    }

    AsyncFunction("drainTransitions") {
      // Liveness stamp: when the service is running, append a fresh
      // heartbeat so the newest drained row proves it survived to now.
      if (FocusSessionService.running) {
        FocusSessionService.addTransition(
          near = false,
          kind = FocusSessionService.KIND_HEARTBEAT,
        )
      }
      // Producers only append, so the snapshot prefix is exactly what we
      // consume — remove by position inside the same monitor addTransition
      // takes (a blind removeAll would also drop an equal-valued row
      // appended after the snapshot).
      val drained =
        synchronized(FocusSessionService.transitions) {
          val d = FocusSessionService.transitions.toList()
          repeat(d.size) { FocusSessionService.transitions.removeAt(0) }
          d
        }
      drained.map { mapOf("near" to it.near, "ts" to it.ts.toDouble(), "kind" to it.kind) }
    }
  }
}
