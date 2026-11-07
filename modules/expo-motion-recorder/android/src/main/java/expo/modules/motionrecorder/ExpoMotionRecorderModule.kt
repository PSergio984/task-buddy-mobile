package expo.modules.motionrecorder

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Android stub — CMSensorRecorder is iOS-only. The module registers so
 * requireNativeModule() doesn't throw on Android; isAvailable reports
 * false and the verbs throw rather than silently pretending to record —
 * same honest-stub convention as the iOS focus-service module.
 */
class ExpoMotionRecorderModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoMotionRecorder")

    AsyncFunction("isAvailable") { false }

    AsyncFunction("startRecording") { _: Double ->
      throw CodedException(
        "ERR_UNSUPPORTED_PLATFORM",
        "CMSensorRecorder is iOS-only — no Android retro recording exists",
        null,
      )
    }

    AsyncFunction("stopRecording") {
      throw CodedException(
        "ERR_UNSUPPORTED_PLATFORM",
        "CMSensorRecorder is iOS-only — no Android retro recording exists",
        null,
      )
    }

    AsyncFunction("queryAccelerometer") { _: Double, _: Double ->
      // Throw like the other verbs — a resolved null could read as
      // "no motion data" instead of "unsupported platform".
      throw CodedException(
        "ERR_UNSUPPORTED_PLATFORM",
        "CMSensorRecorder is iOS-only — no Android retro recording exists",
        null,
      )
    }
  }
}
