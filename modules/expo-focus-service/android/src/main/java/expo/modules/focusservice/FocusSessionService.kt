package expo.modules.focusservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Keeps a PARTIAL_WAKE_LOCK and a proximity listener alive while the app is
 * suspended, buffering every covered/uncovered transition with a timestamp.
 * JS drains the buffer on resume — the wake-up proximity sensor fires even
 * in Doze, so transitions during suspension aren't lost.
 *
 * Heartbeat rows are interleaved every ~60s (plus a drain-time stamp) so JS
 * can prove the service stayed alive across a gap: START_NOT_STICKY means a
 * killed service never restarts, so alive-at-drain ⇒ covered the whole gap,
 * and the last heartbeat bounds a mid-gap death honestly.
 */
class FocusSessionService : Service(), SensorEventListener {

  companion object {
    const val CHANNEL_ID = "task-buddy-focus-session"
    const val NOTIFICATION_ID = 4701
    const val HEARTBEAT_MS = 60_000L
    const val MAX_BUFFERED_TRANSITIONS = 2048
    const val KIND_EDGE = "edge"
    const val KIND_HEARTBEAT = "heartbeat"

    data class Transition(val near: Boolean, val ts: Long, val kind: String)

    /** Process-lifetime buffer — a killed service loses in-flight history
     *  and the span degrades to unverified rather than lying about it. */
    val transitions = CopyOnWriteArrayList<Transition>()

    /** Rows lost to the bounded buffer since the last drain — a dropped
     *  edge means the replayed history is a SUFFIX, so JS must treat the
     *  affected coverage as unprovable rather than replaying it as fact. */
    var droppedTransitions = 0L

    /** True between onCreate and onDestroy — NOT_STICKY means an alive
     *  service ran continuously, so this flag is the liveness proof. */
    @Volatile
    var running = false
      private set

    fun addTransition(near: Boolean, kind: String) {
      // Bounded buffer — drop the oldest rows first. Shares drain's
      // monitor so a bounded-add can't splice inside a snapshot remove.
      synchronized(transitions) {
        while (transitions.size >= MAX_BUFFERED_TRANSITIONS) {
          transitions.removeAt(0)
          droppedTransitions++
        }
        transitions.add(Transition(near, System.currentTimeMillis(), kind))
      }
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var sensorManager: SensorManager? = null
  private val handler = Handler(Looper.getMainLooper())
  private val heartbeat =
    object : Runnable {
      override fun run() {
        addTransition(near = false, kind = KIND_HEARTBEAT)
        handler.postDelayed(this, HEARTBEAT_MS)
      }
    }

  override fun onCreate() {
    super.onCreate()
    // Fresh service lifetime = fresh coverage window: rows buffered under a
    // previous instance would replay into this session otherwise.
    synchronized(transitions) {
      transitions.clear()
      droppedTransitions = 0L
    }
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // NotificationChannel is API 26+ — isAvailable() already gates the
    // module to O+, so this is belt-and-braces against a manual start.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Focus session", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val notification: Notification =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Focus session active")
        .setContentText("Recording phone-down transitions")
        .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
        .setOngoing(true)
        .build()
    val type =
      if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
      else ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)

    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock =
      pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "taskbuddy:FocusSession").apply {
        setReferenceCounted(false)
        acquire()
      }

    sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    // Wake-up variant only — the non-wake-up sensor stops delivering in
    // Doze, which would drop transitions while coverage is being claimed.
    // A missing sensor or rejected registration fails CLOSED: a heartbeat-
    // only service would prove liveness while recording no transitions,
    // claiming covered windows nothing observed. stopSelf kills it so
    // drains return honest no-proof instead of fabricated coverage.
    val sensor = sensorManager?.getDefaultSensor(Sensor.TYPE_PROXIMITY, true)
    if (
      sensor == null ||
      sensorManager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_NORMAL) != true
    ) {
      stopSelf()
      return
    }
    // Only claim liveness once the service is provably foreground AND
    // its sensor stream is live — both must hold before `running` can
    // stand in as the coverage flag.
    synchronized(transitions) { running = true }

    // First beat lands now so short gaps still carry a proof row.
    handler.post(heartbeat)
  }

  // NOT_STICKY — a restart without JS would re-create a wake-lock zombie
  // buffering transitions nobody drains.
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_NOT_STICKY

  override fun onTaskRemoved(rootIntent: Intent?) {
    // Swiped from recents — JS is gone, so stop rather than hold a
    // wake-lock zombie with an empty buffer owner.
    stopSelf()
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (event.sensor.type != Sensor.TYPE_PROXIMITY) return
    val near = event.values[0] < event.sensor.maximumRange
    addTransition(near, KIND_EDGE)
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onDestroy() {
    // Same monitor the drain's check+append takes — a drain mid-destroy
    // either stamps the heartbeat before this flip (legit last proof) or
    // sees running=false after it (honest no-proof). Never a post-mortem
    // stamp claiming liveness for a dead service.
    synchronized(transitions) { running = false }
    handler.removeCallbacks(heartbeat)
    sensorManager?.unregisterListener(this)
    sensorManager = null
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
