import ExpoModulesCore
import UIKit

public class ExpoProximityModule: Module {

  /// Block-based observer — Module isn't an NSObject, so @objc/#selector
  /// observation can't be used here.
  private var proximityObserver: NSObjectProtocol?

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
        UIDevice.current.isProximityMonitoringEnabled = true
        if UIDevice.current.isProximityMonitoringEnabled {
          self.proximityObserver = NotificationCenter.default.addObserver(
            forName: UIDevice.proximityStateDidChangeNotification,
            object: nil,
            queue: .main
          ) { [weak self] _ in
            self?.proximityChanged()
          }
        }
      }
    }

    OnStopObserving("onProximityChange") {
      DispatchQueue.main.async {
        if let observer = self.proximityObserver {
          NotificationCenter.default.removeObserver(observer)
          self.proximityObserver = nil
        }
        UIDevice.current.isProximityMonitoringEnabled = false
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
