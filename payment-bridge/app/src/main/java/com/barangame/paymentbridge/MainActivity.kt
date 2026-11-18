package com.barangame.paymentbridge

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

data class LaunchableApp(val label: String, val packageName: String)

class MainActivity : ComponentActivity() {
    private val prefs by lazy {
        getSharedPreferences(NotificationCaptureService.PREFS, MODE_PRIVATE)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) { BridgeScreen() }
            }
        }
    }

    private fun notificationAccessEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners").orEmpty()
        return enabled.split(":").any {
            ComponentName.unflattenFromString(it)?.packageName == packageName
        }
    }

    private fun screenReadAccessEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
        val expected = ComponentName(this, ShamCashScreenReaderService::class.java)
        return enabled.split(":").any { ComponentName.unflattenFromString(it) == expected }
    }

    private fun installedApps(): List<LaunchableApp> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL)
            .map { LaunchableApp(it.loadLabel(packageManager).toString(), it.activityInfo.packageName) }
            .distinctBy { it.packageName }
            .filter { it.packageName != packageName }
            .sortedBy { it.label.lowercase() }
    }

    @Composable
    private fun BridgeScreen() {
        var selectedPackage by remember { mutableStateOf(prefs.getString(NotificationCaptureService.KEY_SOURCE_PACKAGE, null)) }
        var selectedLabel by remember { mutableStateOf(selectedPackage?.let { appLabel(it) } ?: "لم يتم اختيار تطبيق") }
        var notificationAccess by remember { mutableStateOf(notificationAccessEnabled()) }
        var screenAccess by remember { mutableStateOf(screenReadAccessEnabled()) }
        var showApps by remember { mutableStateOf(false) }
        var refresh by remember { mutableIntStateOf(0) }

        val captured = remember(refresh) {
            readArray(NotificationCaptureService.KEY_CAPTURED)
        }
        val snapshots = remember(refresh) {
            readArray(NotificationCaptureService.KEY_SCREEN_READS)
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            Text("BARO Payment Bridge", style = MaterialTheme.typography.headlineSmall)
            Text("قارئ محلي لإشعارات وتفاصيل الحوالات الظاهرة", style = MaterialTheme.typography.titleMedium)

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("الخصوصية", style = MaterialTheme.typography.titleMedium)
                    Text("القراءة اختيارية ومحلية. لا يوجد اتصال بالإنترنت أو إرسال إلى BARAN GAME. لا يقرأ كلمات المرور ولا ينفذ نقرات أو تحويلات.")
                }
            }

            Text("التطبيق المحدد: $selectedLabel")
            OutlinedButton(onClick = { showApps = true }, modifier = Modifier.fillMaxWidth()) {
                Text("اختيار / تغيير تطبيق الدفع")
            }

            Text("إذن الإشعارات: ${if (notificationAccess) "مفعّل" else "غير مفعّل"}")
            OutlinedButton(
                onClick = { startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) },
                modifier = Modifier.fillMaxWidth()
            ) { Text("إعداد إذن الإشعارات") }

            Text("إذن قراءة الشاشة: ${if (screenAccess) "مفعّل" else "غير مفعّل"}")
            Button(
                onClick = { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) },
                modifier = Modifier.fillMaxWidth()
            ) { Text("إعداد إمكانية الوصول لقراءة تفاصيل الحوالات") }

            Button(
                onClick = {
                    notificationAccess = notificationAccessEnabled()
                    screenAccess = screenReadAccessEnabled()
                    selectedPackage = prefs.getString(NotificationCaptureService.KEY_SOURCE_PACKAGE, null)
                    selectedLabel = selectedPackage?.let { appLabel(it) } ?: "لم يتم اختيار تطبيق"
                    refresh++
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("تحديث الحالة والسجلات") }

            Button(
                onClick = {
                    val target = selectedPackage ?: return@Button
                    val launch = packageManager.getLaunchIntentForPackage(target)
                    if (launch != null) startActivity(launch)
                },
                enabled = selectedPackage != null,
                modifier = Modifier.fillMaxWidth()
            ) { Text("فتح تطبيق الدفع") }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("صفحات تفاصيل حوالات محتملة: ${snapshots.size}", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = {
                    prefs.edit().remove(NotificationCaptureService.KEY_SCREEN_READS).apply()
                    refresh++
                }) { Text("مسح") }
            }
            if (snapshots.isEmpty()) {
                Text("لم تُلتقط تفاصيل حوالة بعد. افتح سجل الحوالات، ثم افتح حوالة واردة لعرض تفاصيلها، وبعدها ارجع واضغط تحديث. قد لا تظهر البيانات إذا لم يوفّرها شام كاش لخدمة إمكانية الوصول.")
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.weight(1f)) {
                items(snapshots, key = { it.optString("fingerprint") }) { item ->
                    SnapshotCard(item)
                }
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("إشعارات التطبيق: ${captured.size}", style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = {
                    prefs.edit().remove(NotificationCaptureService.KEY_CAPTURED).apply()
                    refresh++
                }) { Text("مسح الإشعارات") }
            }
        }

        if (showApps) {
            val apps = remember { installedApps() }
            AlertDialog(
                onDismissRequest = { showApps = false },
                title = { Text("اختر شام كاش") },
                text = {
                    LazyColumn {
                        items(apps) { app ->
                            TextButton(
                                onClick = {
                                    selectedPackage = app.packageName
                                    selectedLabel = app.label
                                    prefs.edit().putString(NotificationCaptureService.KEY_SOURCE_PACKAGE, app.packageName).apply()
                                    showApps = false
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(Modifier.fillMaxWidth()) {
                                    Text(app.label)
                                    Text(app.packageName, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { showApps = false }) { Text("إغلاق") } }
            )
        }
    }

    @Composable
    private fun SnapshotCard(item: JSONObject) {
        val capturedAt = item.optLong("capturedAt")
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(DateFormat.getDateTimeInstance().format(Date(capturedAt)), style = MaterialTheme.typography.labelSmall)
                Text(item.optString("text"), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }

    private fun readArray(key: String): List<JSONObject> {
        return try {
            val array = JSONArray(prefs.getString(key, "[]") ?: "[]")
            (0 until array.length()).map { array.getJSONObject(it) }
        } catch (_: Exception) { emptyList() }
    }

    private fun appLabel(packageName: String): String {
        return try {
            val info = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(info).toString()
        } catch (_: Exception) { packageName }
    }
}
