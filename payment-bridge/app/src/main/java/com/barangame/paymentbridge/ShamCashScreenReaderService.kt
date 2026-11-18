package com.barangame.paymentbridge

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.ArrayDeque

/** Opt-in, read-only screen text reader. It never clicks, gestures, or transmits data. */
class ShamCashScreenReaderService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        applySelectedPackageFilter()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val selected = getSharedPreferences(NotificationCaptureService.PREFS, MODE_PRIVATE)
            .getString(NotificationCaptureService.KEY_SOURCE_PACKAGE, null) ?: return
        applySelectedPackageFilter(selected)

        if (event == null || event.packageName?.toString() != selected) return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED &&
            event.eventType != AccessibilityEvent.TYPE_VIEW_SCROLLED) return

        val root = rootInActiveWindow ?: return
        if (root.packageName?.toString() != selected) return
        val lines = collectVisibleText(root)
        if (lines.isEmpty()) return
        val joined = lines.joinToString("\n")
        if (HISTORY_TERMS.none { joined.contains(it, ignoreCase = true) }) return
        if (SENSITIVE_TERMS.any { joined.contains(it, ignoreCase = true) }) return
        saveSnapshot(selected, lines)
    }

    override fun onInterrupt() = Unit

    private fun applySelectedPackageFilter(packageName: String? = null) {
        val selected = packageName ?: getSharedPreferences(
            NotificationCaptureService.PREFS, MODE_PRIVATE
        ).getString(NotificationCaptureService.KEY_SOURCE_PACKAGE, null)
        serviceInfo = AccessibilityServiceInfo().apply {
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                AccessibilityEvent.TYPE_VIEW_SCROLLED
            feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
            notificationTimeout = 500
            flags = AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
            packageNames = if (selected.isNullOrBlank()) emptyArray() else arrayOf(selected)
        }
    }

    private fun collectVisibleText(root: AccessibilityNodeInfo): List<String> {
        val result = LinkedHashSet<String>()
        val pending = ArrayDeque<AccessibilityNodeInfo>()
        pending.add(root)
        var visited = 0
        while (pending.isNotEmpty() && visited < MAX_NODES && result.size < MAX_TEXT_ITEMS) {
            val node = pending.removeFirst()
            visited++
            try {
                if (!node.isPassword && node.isVisibleToUser) {
                    node.text?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { result.add(it.take(MAX_TEXT_LENGTH)) }
                    node.contentDescription?.toString()?.trim()?.takeIf { it.isNotBlank() }?.let { result.add(it.take(MAX_TEXT_LENGTH)) }
                }
                for (index in 0 until node.childCount) {
                    node.getChild(index)?.let { pending.add(it) }
                }
            } finally {
                node.recycle()
            }
        }
        return result.toList()
    }

    private fun saveSnapshot(packageName: String, lines: List<String>) {
        val prefs = getSharedPreferences(NotificationCaptureService.PREFS, MODE_PRIVATE)
        val current = try {
            JSONArray(prefs.getString(NotificationCaptureService.KEY_SCREEN_READS, "[]") ?: "[]")
        } catch (_: Exception) { JSONArray() }
        val text = lines.joinToString("\n").take(MAX_SNAPSHOT_LENGTH)
        val fingerprint = sha256("$packageName|$text")
        if ((0 until current.length()).any {
                current.optJSONObject(it)?.optString("fingerprint") == fingerprint
            }) return

        val item = JSONObject().apply {
            put("fingerprint", fingerprint)
            put("capturedAt", System.currentTimeMillis())
            put("text", text)
        }
        val updated = JSONArray().apply {
            put(item)
            for (index in 0 until minOf(current.length(), MAX_SNAPSHOTS - 1)) put(current.getJSONObject(index))
        }
        prefs.edit().putString(NotificationCaptureService.KEY_SCREEN_READS, updated.toString()).apply()
    }

    private fun sha256(value: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val MAX_NODES = 250
        private const val MAX_TEXT_ITEMS = 80
        private const val MAX_TEXT_LENGTH = 400
        private const val MAX_SNAPSHOT_LENGTH = 8000
        private const val MAX_SNAPSHOTS = 30
        private val HISTORY_TERMS = listOf(
            "سجل الحوالات", "الحوالات", "الحركات", "العمليات", "تفاصيل الحوالة",
            "transaction history", "transactions", "transfer history"
        )
        private val SENSITIVE_TERMS = listOf(
            "كلمة المرور", "رمز التحقق", "رمز الدخول", "رمز otp", "password",
            "passcode", "one-time", "verification code", "تسجيل الدخول"
        )
    }
}
