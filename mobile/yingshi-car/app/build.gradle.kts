plugins {
    id("com.android.application")
}

android {
    namespace = "tw.com.sylong.tvcar"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "tw.com.sylong.tvcar"
        minSdk = 21
        targetSdk = 35
        versionCode = 40
        versionName = "1.4.30-cloud-license"
        buildConfigField("String", "LICENSE_API_BASE_URL", "\"https://yingshi-license.pppp77088.workers.dev\"")
        buildConfigField("String", "LICENSE_PRODUCT_ID", "\"yingshi\"")
        buildConfigField(
            "String",
            "LICENSE_PUBLIC_KEY_SPKI_B64",
            "\"MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA5XHmjYNztqYbJxC2gowa9Zg0ebOf/4qp+SECxMWPGOU8RhrteJtA8I1ciyiJn8gi46UF+WT2JNCLDytbstfOuPsAVQs8hHLdhNkkS5zJF7DE8L4/mJk6Q5h4AlL7XLWsNvVj3+jWGUc/q/28ZJ4G9/EwxqWtQDUMihqwYQ1YLmotG35mUChD4gzJzsno5ms9DaVyvpgP2Zl31Bom78PtHLIB4XBtqn2LPYz0jRETlTBMZpXNG8QpDzKu8GVTsd1QpDZShA+0YFD1JOvePu0oPDP4HLnElzRH1ADMjQe3bCefw0dPRzzKodkDIgZ/geCl1rZrKU2yNMdjxQaNTpZOTGLHfHqjptwEVSV9YIbIYZ8F+SdmhyR/GLNMBOiWGoI4F/vA0pj8xDJIot2a6YHrQyhXI066PjEYGHOximLkmvzJx2OaxT3cp0xUu6O7pwkQP+rbdAdXG1lTxcbE5v2sbUkvzTLx6QPDJ0uc/T2I8gIelVVuRi6LJhk02wQDIytVAgMBAAE=\""
        )
    }

    flavorDimensions += "access"

    productFlavors {
        create("licensed") {
            dimension = "access"
            applicationId = "tw.com.sylong.tvcar"
            versionCode = 40
            versionName = "1.4.30-cloud-license"
            buildConfigField("boolean", "REQUIRE_LICENSE", "true")
        }
        create("direct") {
            dimension = "access"
            applicationId = "tw.com.sylong.tvcar.direct"
            versionCode = 12
            versionName = "1.4.9-no-license"
            buildConfigField("boolean", "REQUIRE_LICENSE", "false")
        }
    }

    buildTypes {
        release {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("debug")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
        disable += "ExpiredTargetSdkVersion"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}
