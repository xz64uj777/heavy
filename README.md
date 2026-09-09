# Helios Heavy

Android-first 2D heavy-lift launch simulator. Career missions, autopilot, coach, projected path, booster recovery.

## Play

Open the live web build, or install the APK (Android 8+). Phone Back pauses. The game saves if you leave and resume later.

## Web (standalone)

```
npm install
npx vite build --config scripts/vite.standalone.config.ts
```

## Android

The `android/` folder is a WebView wrapper around the standalone build. Copy `dist-helios/` into `android/app/src/main/assets/www/` then assemble a release APK.

Package: `com.lumendynamics.helios`
