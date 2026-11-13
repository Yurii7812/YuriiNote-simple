plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val packageJson = rootProject.file("../package.json").readText()
val versionParts = Regex(""""version"\s*:\s*"([0-9]+)\.([0-9]+)\.([0-9]+)"""").find(packageJson)
    ?.groupValues?.drop(1)?.map(String::toInt) ?: error("package.json version missing")
val (majorVersion, minorVersion, patchVersion) = versionParts
val unifiedVersion = "$majorVersion.$minorVersion.$patchVersion"
val unifiedVersionCode = majorVersion * 1_000_000 + minorVersion * 1_000 + patchVersion

android {
    namespace = "net.yurii.note"
    compileSdk = 34
    defaultConfig {
        applicationId = "net.yurii.note"
        minSdk = 26
        targetSdk = 34
        versionCode = unifiedVersionCode
        versionName = unifiedVersion
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
        // PC はスマホのデータを、アプリ専用の外部領域（Android/data/<アプリ>/files）から adb で読み書きする。
        // デバッグ可能にしない（デバッグ可能だと、端末が事前の最適化をしてくれない）。R8 で軽くする。
        create("fast") {
            initWith(getByName("release"))
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    packaging { resources { excludes += "/META-INF/{AL2.0,LGPL2.1}" } }
}

// 部品は使わない（WebView と Android の標準の道具だけ）
