package net.yurii.note

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import org.json.JSONObject
import java.util.Calendar

/** 定期の通知（「今まで何してた？」）。押すと、今日のメモ帳の入力が開く。初めは、オフ。 */
object Alarm {
    const val CHANNEL = "yurii_note_alarm_v1"
    const val EXTRA_PROMPT = "prompt"
    private const val REQ = 4201
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("alarm", Context.MODE_PRIVATE)

    data class Cfg(val on: Boolean = false, val minutes: Int = 60, val from: Int = 9, val to: Int = 23, val ring: Int = 0)

    fun load(ctx: Context): Cfg {
        val p = prefs(ctx)
        return Cfg(p.getBoolean("on", false), p.getInt("minutes", 60).coerceAtLeast(1), p.getInt("from", 9).coerceIn(0, 24), p.getInt("to", 23).coerceIn(0, 24), p.getInt("ring", 0).coerceIn(0, 600))
    }
    fun save(ctx: Context, c: Cfg) {
        prefs(ctx).edit().putBoolean("on", c.on).putInt("minutes", c.minutes.coerceAtLeast(1)).putInt("from", c.from.coerceIn(0, 24)).putInt("to", c.to.coerceIn(0, 24)).putInt("ring", c.ring.coerceIn(0, 600)).apply()
    }
    fun toJson(ctx: Context): String {
        val c = load(ctx)
        return JSONObject().put("on", c.on).put("minutes", c.minutes).put("from", c.from).put("to", c.to).put("ring", c.ring)
            .put("notif", notificationsEnabled(ctx)).put("exact", canScheduleExact(ctx)).put("next", prefs(ctx).getLong("next", 0)).toString()
    }

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "定期のメモ", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "今まで何をしていたかを書くための通知"
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            ch.enableVibration(true)
            nm.createNotificationChannel(ch)
        }
    }
    fun notificationsEnabled(ctx: Context): Boolean {
        ensureChannel(ctx)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        return nm.areNotificationsEnabled() && nm.getNotificationChannel(CHANNEL).importance != NotificationManager.IMPORTANCE_NONE
    }
    fun canScheduleExact(ctx: Context): Boolean = Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    private fun pending(ctx: Context): PendingIntent =
        PendingIntent.getBroadcast(ctx, REQ, Intent(ctx, AlarmReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        am.cancel(pending(ctx))
        val c = load(ctx)
        if (!c.on) { prefs(ctx).edit().remove("next").apply(); return }
        val at = AlarmTiming.next(c.minutes, c.from, c.to, System.currentTimeMillis())
        try {
            if (canScheduleExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx))
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx))
        } catch (_: SecurityException) { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending(ctx)) }
        prefs(ctx).edit().putLong("next", at).apply()
    }

    /** 鳴ったあと、次にアプリを開いたら、メモ帳の入力を開く（通知を押さずに開いた場合も）。 */
    fun takePrompt(ctx: Context): Boolean {
        val p = prefs(ctx).getBoolean("prompt", false)
        if (p) { prefs(ctx).edit().remove("prompt").apply(); ctx.getSystemService(NotificationManager::class.java).cancel(REQ) }
        return p
    }

    /** ring 秒のあいだ音を繰り返し（FLAG_INSISTENT）、時間が来たら音なしで出し直して止める。0 なら 1 回だけ。 */
    fun notify(ctx: Context, ring: Int = load(ctx).ring, silent: Boolean = false) {
        ensureChannel(ctx)
        prefs(ctx).edit().putBoolean("prompt", true).apply()
        val open = Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP; putExtra(EXTRA_PROMPT, true) }
        val pi = PendingIntent.getActivity(ctx, REQ + 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_note).setContentTitle("今まで何してた？").setContentText("押すと、今日のメモ帳に書けます")
            .setContentIntent(pi).setAutoCancel(true).setCategory(Notification.CATEGORY_ALARM)
        if (silent) b.setOnlyAlertOnce(true).setSound(null).setVibrate(null)   // 音なしで出し直す（鳴っている音を止める）
        val n = b.build()
        if (!silent && ring > 0) n.flags = n.flags or Notification.FLAG_INSISTENT
        val nm = ctx.getSystemService(NotificationManager::class.java)
        try { if (silent) nm.cancel(REQ); nm.notify(REQ, n) } catch (_: SecurityException) { }
        if (!silent && ring > 0) scheduleStop(ctx, ring)
    }
    private fun scheduleStop(ctx: Context, seconds: Int) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val pi = PendingIntent.getBroadcast(ctx, REQ + 2, Intent(ctx, RingStopReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val at = System.currentTimeMillis() + seconds * 1000L
        try { if (canScheduleExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) }
        catch (_: SecurityException) { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) }
    }
    /** 鳴っている通知があれば、音なしで出し直して音を止める（アプリを開いたときも止める）。 */
    fun stopRinging(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.activeNotifications.any { it.id == REQ && (it.notification.flags and Notification.FLAG_INSISTENT) != 0 }) notify(ctx, 0, silent = true)
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val c = Alarm.load(ctx)
        if (!c.on) return
        try {
            // 省電力で配信が遅れて、時間帯の外になっていた場合は、鳴らさない。
            if (AlarmTiming.inside(c.from, c.to, Calendar.getInstance().get(Calendar.HOUR_OF_DAY))) Alarm.notify(ctx)
        } finally { Alarm.schedule(ctx) }
    }
}
class RingStopReceiver : BroadcastReceiver() { override fun onReceive(ctx: Context, intent: Intent) { Alarm.stopRinging(ctx) } }
class BootReceiver : BroadcastReceiver() { override fun onReceive(ctx: Context, intent: Intent) { Alarm.schedule(ctx) } }
