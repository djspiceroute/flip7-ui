package com.flip7ui.icons

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

/** Shown when a launcher opens the pack directly: explains where to apply it. */
class ApplyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val padding = (24 * resources.displayMetrics.density).toInt()
        setContentView(
            TextView(this).apply {
                text = getString(R.string.apply_hint, getString(R.string.app_name))
                textSize = 16f
                setPadding(padding, padding, padding, padding)
            },
        )
    }
}
