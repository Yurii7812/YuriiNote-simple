package net.yurii.note

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.webkit.*
import android.widget.EditText
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File

// スマホ版: 画面は assets/phone/index.html（WebView）。書いたものは、受信箱（files/inbox/）に、新しいファイルとして置く。
// PC が USB（adb）で読んで取り込み、取り込んだファイルの名前を files/imported.json で返す。消すかどうかは、画面で利用者が決める。
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var pendingCamera: PermissionRequest? = null
    private var chooser: ValueCallback<Array<Uri>>? = null
    private val host = "app.local"

    private val root: File get() = getExternalFilesDir(null) ?: filesDir
    private val inbox: File get() = File(root, "inbox").also { it.mkdirs() }
    private fun safe(name: String): Boolean = Regex("^[A-Za-z0-9][A-Za-z0-9._-]*$").matches(name) && !name.contains("..")

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        web = WebView(this)
        setContentView(web)
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false
            mediaPlaybackRequiresUserGesture = false; setSupportZoom(false)
        }
        web.addJavascriptInterface(Bridge(), "Native")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, req: WebResourceRequest): WebResourceResponse? {
                if (req.url.host != host) return null
                val p = req.url.path ?: return null
                return try {
                    when {
                        p.startsWith("/phone/") -> asset(p.removePrefix("/"))
                        p.startsWith("/inbox/") -> { val n = p.removePrefix("/inbox/"); if (safe(n)) file(File(inbox, n)) else null }
                        else -> null
                    }
                } catch (e: Exception) { null }
            }
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean = req.url.host != host
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(req: PermissionRequest) {
                runOnUiThread {
                    if (req.origin.host != host) { req.deny(); return@runOnUiThread }
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) req.grant(req.resources)
                    else { pendingCamera = req; requestPermissions(arrayOf(Manifest.permission.CAMERA), 1) }
                }
            }
            override fun onShowFileChooser(w: WebView, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null); chooser = cb
                val i = Intent(Intent.ACTION_GET_CONTENT).apply { addCategory(Intent.CATEGORY_OPENABLE); type = "image/*"; putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true) }
                return try { startActivityForResult(Intent.createChooser(i, "写真を選ぶ"), 2); true } catch (e: Exception) { chooser = null; false }
            }
            override fun onJsConfirm(v: WebView, url: String, msg: String, r: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(msg).setPositiveButton("はい") { _, _ -> r.confirm() }.setNegativeButton("いいえ") { _, _ -> r.cancel() }.setOnCancelListener { r.cancel() }.show(); return true
            }
            override fun onJsAlert(v: WebView, url: String, msg: String, r: JsResult): Boolean {
                AlertDialog.Builder(this@MainActivity).setMessage(msg).setPositiveButton("OK") { _, _ -> r.confirm() }.setOnCancelListener { r.confirm() }.show(); return true
            }
            override fun onJsPrompt(v: WebView, url: String, msg: String, def: String?, r: JsPromptResult): Boolean {
                val e = EditText(this@MainActivity); e.setText(def ?: "")
                AlertDialog.Builder(this@MainActivity).setMessage(msg).setView(e).setPositiveButton("OK") { _, _ -> r.confirm(e.text.toString()) }.setNegativeButton("やめる") { _, _ -> r.cancel() }.setOnCancelListener { r.cancel() }.show(); return true
            }
        }
        web.loadUrl("https://$host/phone/index.html")
    }

    private fun asset(path: String): WebResourceResponse {
        val data = assets.open(path).readBytes()
        val mime = when { path.endsWith(".html") -> "text/html"; path.endsWith(".js") -> "text/javascript"; path.endsWith(".css") -> "text/css"; path.endsWith(".png") -> "image/png"; else -> "application/octet-stream" }
        return WebResourceResponse(mime, "utf-8", ByteArrayInputStream(data))
    }
    private fun file(f: File): WebResourceResponse? {
        if (!f.isFile) return null
        val mime = if (f.name.endsWith(".jpg") || f.name.endsWith(".jpeg")) "image/jpeg" else "application/octet-stream"
        return WebResourceResponse(mime, null, f.inputStream())
    }

    override fun onRequestPermissionsResult(code: Int, perms: Array<out String>, res: IntArray) {
        val r = pendingCamera ?: return; pendingCamera = null
        if (res.isNotEmpty() && res[0] == PackageManager.PERMISSION_GRANTED) r.grant(r.resources) else r.deny()
    }
    @Deprecated("Deprecated in Java")
    override fun onActivityResult(code: Int, result: Int, data: Intent?) {
        if (code != 2) return
        val cb = chooser ?: return; chooser = null
        val uris = ArrayList<Uri>()
        if (result == RESULT_OK && data != null) { data.clipData?.let { c -> for (i in 0 until c.itemCount) uris.add(c.getItemAt(i).uri) } ?: data.data?.let { uris.add(it) } }
        cb.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("(window.onBack&&window.onBack())===true") { if (it != "true") moveTaskToBack(true) }
    }
    override fun onNewIntent(i: Intent) { super.onNewIntent(i); setIntent(i) }
    override fun onResume() {
        super.onResume()
        Alarm.stopRinging(this)
        val prompt = Alarm.takePrompt(this) || intent?.getBooleanExtra(Alarm.EXTRA_PROMPT, false) == true
        intent?.removeExtra(Alarm.EXTRA_PROMPT)
        // 戻ってきたら、今日のものを開く（通知から来たときは、メモ帳の入力まで）
        web.evaluateJavascript(if (prompt) "window.openPrompt&&window.openPrompt()" else "window.resumeToday&&window.resumeToday()", null)
    }

    // 画面（JS）から呼ぶ道具。名前は、英数字・ . _ - だけ
    inner class Bridge {
        @JavascriptInterface fun list(): String {
            val a = JSONArray(); inbox.listFiles()?.sortedBy { it.name }?.forEach { if (it.isFile && !it.name.endsWith(".tmp")) a.put(JSONObject().put("name", it.name).put("size", it.length())) }; return a.toString()
        }
        @JavascriptInterface fun read(name: String): String = if (safe(name)) File(inbox, name).takeIf { it.isFile }?.readText() ?: "" else ""
        @JavascriptInterface fun write(name: String, text: String): Boolean = put(name, text.toByteArray(Charsets.UTF_8))
        @JavascriptInterface fun writeB64(name: String, b64: String): Boolean = put(name, Base64.decode(b64, Base64.DEFAULT))
        @JavascriptInterface fun remove(name: String): Boolean = safe(name) && File(inbox, name).delete()
        // PC が置いたもの（取り込み済みの印・記録の種類・PC のノートの一覧）
        @JavascriptInterface fun meta(name: String): String = if (name in listOf("imported.json", "kinds.json", "notes.json")) File(root, name).takeIf { it.isFile }?.readText() ?: "" else ""
        @JavascriptInterface fun url(name: String): String = if (safe(name)) "https://$host/inbox/$name" else ""
        // 定期の通知（アラーム）
        @JavascriptInterface fun alarmGet(): String = Alarm.toJson(this@MainActivity)
        @JavascriptInterface fun alarmSet(json: String): String {
            val o = JSONObject(json)
            Alarm.save(this@MainActivity, Alarm.Cfg(o.optBoolean("on"), o.optInt("minutes", 60), o.optInt("from", 9), o.optInt("to", 23), o.optInt("ring", 0)))
            Alarm.schedule(this@MainActivity)
            return Alarm.toJson(this@MainActivity)
        }
        @JavascriptInterface fun askNotify() = runOnUiThread {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 3)
            else startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))
        }
        @JavascriptInterface fun askExact() = runOnUiThread {
            if (Build.VERSION.SDK_INT >= 31) startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
        }
        @JavascriptInterface fun pref(key: String): String = getSharedPreferences("yn", MODE_PRIVATE).getString(key, "") ?: ""
        @JavascriptInterface fun setPref(key: String, value: String) { getSharedPreferences("yn", MODE_PRIVATE).edit().putString(key, value).apply() }
        private fun put(name: String, bytes: ByteArray): Boolean {
            if (!safe(name)) return false
            val tmp = File(inbox, "$name.tmp"); tmp.writeBytes(bytes)
            return tmp.renameTo(File(inbox, name))
        }
    }
}
