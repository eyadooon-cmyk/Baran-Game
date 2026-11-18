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
                Surface(modifier = Modifier.fillMaxSize()) {
                    BridgeScreen()
                }
            }
        }
    }

    private fun notificationAccessEnabled(): Boolean {
        val enabled = Settings.Secure.getString(contentResolver, "enabled_notification_listeners").orEmpty()
        return enabled.split(":").any {
            ComponentName.unflattenFromString(it)?.packageName == packageName
        }
    }

    private fun installedApps(): List<LaunchableApp> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return packageManager.queryIntentActivities(intent, PackageManager.MATCH_ALL)
            .map {
                LaunchableApp(
                    it.loadLabel(packageManager).toString(),
                    it.activityInfo.packageName
                )
            }
            .distinctBy { it.packageName }
            .filter { it.packageName != packageName }
            .sortedBy { it.label.lowercase() }
    }

    @Composable
    private fun BridgeScreen() {
        var selectedPackage by remember { mutableStateOf(prefs.getString(NotificationCaptureService.KEY_SOURCE_PACKAGE, null)) }
        var selectedLabel by remember { mutableStateOf(selectedPackage?.let { appLabel(it) } ?: "لم يتم اختيار تطبيق") }
        var access by remember { mutableStateOf(notificationAccessEnabled()) }
        var showApps by remember { mutableStateOf(false) }
        var refresh by remember { mutableIntStateOf(0) }
        val captured = remember(refresh) {
            val raw = prefs.getString(NotificationCaptureService.KEY_CAPTURED, "[]") ?: "[]"
            try {
                val arr = JSONArray(raw)
                (0 until arr.length()).map { arr.getJSONObject(it) }
            } catch (_: Exception) { emptyList() }
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(18.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("BARO Payment Bridge", style = MaterialTheme.typography.headlineSmall)
            Text("قارئ إشعارات محلي لحساب شام كاش", style = MaterialTheme.typography.titleMedium)
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("الخصوصية والأمان", style = MaterialTheme.typography.titleMedium)
                    Text("هذه النسخة تجريبية محلية فقط. لا تتصل بالإنترنت ولا ترسل أي بيانات إلى BARAN GAME. لا تسجل دخولك البنكي ولا تطلب كلمة مرور أو رمز QR.")
                }
            }
            Text("1. اختر تطبيق الدفع")
            OutlinedButton(onClick = { showApps = true }, modifier = Modifier.fillMaxWidth()) {
                Text(selectedLabel)
            }
            Text("2. فعّل إذن قراءة الإشعارات")
            Text(if (access) "الإذن مفعّل" else "الإذن غير مفعّل")
            Button(
                onClick = {
                    startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("فتح إعدادات الوصول للإشعارات") }
            Button(
                onClick = {
                    access = notificationAccessEnabled()
                    selectedPackage = prefs.getString(NotificationCaptureService.KEY_SOURCE_PACKAGE, null)
                    selectedLabel = selectedPackage?.let { appLabel(it) } ?: "لم يتم اختيار تطبيق"
                    refresh++
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("تحديث الحالة") }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("الإشعارات الملتقطة: ${captured.size}", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = {
                    prefs.edit().remove(NotificationCaptureService.KEY_CAPTURED).apply()
                    refresh++
                }) { Text("مسح السجل") }
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(captured, key = { it.optString("fingerprint") }) { item ->
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(item.optString("title", "إشعار"), style = MaterialTheme.typography.titleSmall)
                            Text(item.optString("text", "لا يوجد نص"))
                            val time = item.optLong("receivedAt")
                            Text(
                                DateFormat.getDateTimeInstance().format(Date(time)),
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }

        if (showApps) {
            val apps = remember { installedApps() }
            AlertDialog(
                onDismissRequest = { showApps = false },
                title = { Text("اختر تطبيق شام كاش") },
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
                confirmButton = {
                    TextButton(onClick = { showApps = false }) { Text("إغلاق") }
                }
            )
        }
    }

    private fun appLabel(packageName: String): String {
        return try {
            val info = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            packageName
        }
    }
}
