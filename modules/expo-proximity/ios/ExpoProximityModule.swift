import ExpoModulesCore
import UIKit

public class ExpoProximityModule: Module {

  /// Block-based observer — Module isn't an NSObject, so @objc/#selector
  /// observation can't be used here.
  private var proximityObserver: NSObjectProtocol?
  /// True only when THIS module enabled the process-wide monitor — stop
  /// must not disable a monitor another consumer turned on before us.
  private var monitoringOwnedByUs = false

  public func definition() -> ModuleDefinition {
    Name("ExpoProximity")

    Events("onProximityChange")

    AsyncFunction("isAvailable") { () -> Bool in
      // A second call while OnStartObserving holds monitoring active must
      // not kill the event stream — report true without toggling.
      if UIDevice.current.isProximityMonitoringEnabled { return true }
      // Enabling monitoring fails (stays false) on devices without the sensor.
      UIDevice.current.isProximityMonitoringEnabled = true
      let available = UIDevice.current.isProximityMonitoringEnabled
      UIDevice.current.isProximityMonitoringEnabled = false
      return available
    }.runOnQueue(.main)

    OnStartObserving("onProximityChange") {
      DispatchQueue.main.async {
        // Only disable on stop when we were the ones who enabled it.
        self.monitoringOwnedByUs = !UIDevice.current.isProximityMonitoringEnabled
        UIDevice.current.isProximityMonitoringEnabled = true
        if UIDevice.current.isProximityMonitoringEnabled {
          self.proximityObserver = NotificationCenter.default.addObserver(
            forName: UIDevice.proximityStateDidChangeNotification,
            object: nil,
            queue: .main
          ) { [weak self] _ in
            self?.proximityChanged()
          }
          // The notification only fires on CHANGE — a phone already
          // covered at registration would report uncovered until the
          // first lift. Emit the current state so the machine starts
          // from the truth.
          self.proximityChanged()
        }
      }
    }

    OnStopObserving("onProximityChange") {
      DispatchQueue.main.async {
        if let observer = self.proximityObserver {
          NotificationCenter.default.removeObserver(observer)
          self.proximityObserver = nil
        }
        if self.monitoringOwnedByUs {
          UIDevice.current.isProximityMonitoringEnabled = false
          self.monitoringOwnedByUs = false
        }
      }
    }
  }

  private func proximityChanged() {
    sendEvent("onProximityChange", [
      "near": UIDevice.current.proximityState,
      "ts": Date().timeIntervalSince1970 * 1000,
    ])
  }
}
