import CoreMotion
import ExpoModulesCore

public class ExpoMotionRecorderModule: Module {

  private let recorder = CMSensorRecorder()

  public func definition() -> ModuleDefinition {
    Name("ExpoMotionRecorder")

    AsyncFunction("isAvailable") { () -> Bool in
      // iPhone 7+ only; false on Simulator and unsupported hardware.
      CMSensorRecorder.isAccelerometerRecordingAvailable()
    }

    AsyncFunction("startRecording") { (durationSeconds: Double) in
      // Requires NSMotionUsageDescription (expo-sensors motionPermission).
      self.recorder.recordAccelerometer(forDuration: durationSeconds)
    }

    AsyncFunction("stopRecording") { () -> Void in
      // CMSensorRecorder has no cancel API — recording expires with the
      // requested duration. Kept for symmetry with the Android stub.
    }

    AsyncFunction("queryAccelerometer") { (fromTs: Double, toTs: Double) -> [String: Double]? in
      let from = Date(timeIntervalSince1970: fromTs / 1000)
      let to = Date(timeIntervalSince1970: toTs / 1000)
      guard let list = self.recorder.accelerometerData(from: from, to: to) else {
        return nil
      }
      var count = 0
      var minZ = Double.greatestFiniteMagnitude
      var maxZ = -Double.greatestFiniteMagnitude
      var sum = 0.0
      for datum in list {
        guard let sample = datum as? CMRecordedAccelerometerData else { continue }
        let z = sample.acceleration.z
        minZ = min(minZ, z)
        maxZ = max(maxZ, z)
        sum += z
        count += 1
      }
      if count == 0 { return nil }
      return [
        "count": Double(count),
        "minZ": minZ,
        "maxZ": maxZ,
        "meanZ": sum / Double(count),
      ]
    }
  }
}
