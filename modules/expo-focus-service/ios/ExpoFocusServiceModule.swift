import ExpoModulesCore

/// iOS stub — the foreground-service coverage path is Android-only.
/// Registered so requireNativeModule() doesn't throw; the provider chain
/// uses the accelerometer + CMSensorRecorder on this platform instead.
public class ExpoFocusServiceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExpoFocusService")

    AsyncFunction("isAvailable") { () -> Bool in
      false
    }

    AsyncFunction("startService") { () -> Void in
      // iOS has no FGS concept — suspended coverage comes from
      // CMSensorRecorder retro queries. Throw rather than silently resolve:
      // a resolved start would let the JS provider mark `running` and claim
      // suspended coverage with zero evidence (same honesty rule the Kotlin
      // side enforces with ERR_FOCUS_NO_CONTEXT).
      throw Exception(name: "ERR_UNSUPPORTED_PLATFORM", description: "Foreground service is Android-only")
    }

    AsyncFunction("stopService") { () -> Void in
      throw Exception(name: "ERR_UNSUPPORTED_PLATFORM", description: "Foreground service is Android-only")
    }

    AsyncFunction("drainTransitions") { () -> [[String: Any]] in
      // Throw like the other verbs — a resolved [] could read as
      // "covered, zero edges" instead of "unsupported platform".
      throw Exception(name: "ERR_UNSUPPORTED_PLATFORM", description: "Foreground service is Android-only")
    }
  }
}
