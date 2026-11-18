package com.barangame.paymentbridge

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

class NotificationCaptureService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
        val selectedPackage = prefs.getString(KEY_SOURCE_PACKAGE, null) ?: return
        if (sbn.packageName != selectedPackage || sbn.isOngoing) return

        val extras = sbn.notification.extras
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val text = buildString {
            extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.let { append(it) }
            if (isEmpty()) extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.let { append(it) }
            extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.forEach { line ->
                val value = line?.toString().orEmpty()
                if (value.isNotBlank() && !contains(value)) {
                    if (isNotEmpty()) append("\n")
                    append(value)
                }
            }
        }.trim()
        if (title.isBlank() && text.isBlank()) return

        val current = try {
            JSONArray(prefs.getString(KEY_CAPTURED, "[]") ?: "[]")
        } catch (_: Exception) { JSONArray() }

        val fingerprint = "${sbn.packageName}|${sbn.postTime}|$title|$text"
        if ((0 until current.length()).any {
                current.optJSONObject(it)?.optString("fingerprint") == fingerprint
            }) return

        val item = JSONObject().apply {
            put("id", sbn.key)
            put("fingerprint", fingerprint)
            put("receivedAt", sbn.postTime)
            put("title", title)
            put("text", text)
        }
        val updated = JSONArray().apply {
            put(item)
            for (i in 0 until minOf(current.length(), 49)) put(current.getJSONObject(i))
        }
        prefs.edit().putString(KEY_CAPTURED, updated.toString()).apply()
    }

    companion object {
        const val PREFS = "baro_bridge_local"
        const val KEY_SOURCE_PACKAGE = "source_package"
        const val KEY_CAPTURED = "captured_notifications"
        const val KEY_SCREEN_READS = "screen_reads"
    }
}
