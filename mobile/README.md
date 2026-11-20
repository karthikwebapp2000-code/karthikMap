# Karthik Map — Android app (APK)

The APK is a thin Android shell that opens your deployed website full-screen, so website and app are always identical.
Build it in the cloud (no Android Studio needed) with the GitHub Actions workflow in `.github/workflows/android-apk.yml`.
Not tested by the author — if the build fails, the Actions log shows which step.

Install the downloaded `app-debug.apk` on the phone (allow "Install unknown apps" for your browser/Files app).
For Play Store release you need a signed release build (keystore) — see Capacitor docs.
