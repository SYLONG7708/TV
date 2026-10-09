# Keep the launcher activity name stable for manifest-based startup and ADB testing.
-keep class tw.com.sylong.tvcar.MainActivity { *; }

# JavaScript calls these methods by their source names.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
