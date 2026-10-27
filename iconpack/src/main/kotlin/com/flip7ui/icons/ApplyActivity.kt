package com.flip7ui.icons

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.xmlpull.v1.XmlPullParser

/**
 * Explains where to apply the pack, and lists the installed apps it has no
 * icon for, with the component names needed to add them to tools/apps.json.
 */
class ApplyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val covered = readAppfilter()
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val missing = packageManager.queryIntentActivities(launcherIntent, 0)
            .map { it.activityInfo }
            .filter { it.packageName != packageName }
            .filter { ComponentName(it.packageName, it.name).flattenToString() !in covered }
            .map { "${it.loadLabel(packageManager)}\nComponentInfo{${it.packageName}/${it.name}}" }
            .distinct()
            .sortedBy { it.lowercase() }
        val report = missing.joinToString("\n\n")

        val dp = resources.displayMetrics.density
        val pad = (24 * dp).toInt()
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, pad)
        }
        root.addView(TextView(this).apply {
            text = getString(R.string.apply_hint, getString(R.string.app_name))
            textSize = 16f
        })
        root.addView(TextView(this).apply {
            text = if (missing.isEmpty()) getString(R.string.missing_none) else resources.getQuantityString(R.plurals.missing_count, missing.size, missing.size)
            textSize = 16f
            setPadding(0, pad, 0, (8 * dp).toInt())
        })
        if (missing.isNotEmpty()) {
            root.addView(Button(this).apply {
                text = getString(R.string.share_list)
                setOnClickListener {
                    val send = Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, getString(R.string.missing_subject))
                        .putExtra(Intent.EXTRA_TEXT, report)
                    startActivity(Intent.createChooser(send, null))
                }
            })
            root.addView(ScrollView(this).apply {
                addView(TextView(this@ApplyActivity).apply {
                    text = report
                    textSize = 13f
                    setTextIsSelectable(true)
                    setPadding(0, pad / 2, 0, 0)
                })
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }

        // Android 15+ draws apps edge to edge; keep the text clear of the bars.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            root.setOnApplyWindowInsetsListener { view, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars())
                view.setPadding(pad + bars.left, pad + bars.top, pad + bars.right, pad + bars.bottom)
                insets
            }
        }
        setContentView(root)
    }

    /** Components this pack has icons for, in ComponentName's flattened form. */
    private fun readAppfilter(): Set<String> {
        val covered = HashSet<String>()
        val parser = resources.getXml(R.xml.appfilter)
        try {
            while (parser.next() != XmlPullParser.END_DOCUMENT) {
                if (parser.eventType != XmlPullParser.START_TAG || parser.name != "item") continue
                val component = parser.getAttributeValue(null, "component") ?: continue
                ComponentName.unflattenFromString(component.removePrefix("ComponentInfo{").removeSuffix("}"))
                    ?.let { covered += it.flattenToString() }
            }
        } finally {
            parser.close()
        }
        return covered
    }
}
