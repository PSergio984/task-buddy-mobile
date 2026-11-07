package expo.modules.proximity

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoProximityModule : Module(), SensorEventListener {

  private var sensorManager: SensorManager? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoProximity")

    Events("onProximityChange")

    AsyncFunction("isAvailable") {
      val sm =
        appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
      sm?.getDefaultSensor(Sensor.TYPE_PROXIMITY) != null
    }

    OnStartObserving("onProximityChange") {
      val sm =
        appContext.reactContext?.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
          ?: return@OnStartObserving
      val sensor = sm.getDefaultSensor(Sensor.TYPE_PROXIMITY) ?: return@OnStartObserving
      sensorManager = sm
      sm.registerListener(this@ExpoProximityModule, sensor, SensorManager.SENSOR_DELAY_NORMAL)
    }

    OnStopObserving("onProximityChange") {
      sensorManager?.unregisterListener(this@ExpoProximityModule)
      sensorManager = null
    }
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type != Sensor.TYPE_PROXIMITY) return
    // Anything closer than the sensor's max range counts as covered —
    // desk, pocket or hand are all equally unreadable for this purpose.
    val near = event.values[0] < event.sensor.maximumRange
    sendEvent(
      "onProximityChange",
      mapOf(
        "near" to near,
        "ts" to System.currentTimeMillis().toDouble(),
      ),
    )
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit
}
