# 影視車機正式版

`tw.com.sylong.tvcar`，1.4.30-cloud-license / versionCode 40。此專案延續原授權影視 1.4.28，與 `mobile/oktv-cloud` 為不同 Android 套件。

正式版關閉 Android / WebView 開發偵錯。線上優先讀取受信任的 Pages 播放器；啟動、載入或渲染失敗時使用內建相容播放器。片庫、直播、節目備援與健康資料由雲端取得，不將片庫或影片打包。

播放器每 5 分鐘在空閒時檢查雲端程式版本，影片播放、暫停、搜尋或編輯時延後更新。每 6 小時更新同集備援，每日雲端巡檢提供健康排序。沒有可用的同集同版本來源時保留失敗狀態，不播放別集冒充修復。

正式版持續保存最多 64 筆、7 日內的播放／啟動錯誤及最新狀態摘要，存在 App 私有資料。摘要只含版本、載入模式、解碼畫面數、時間、錯誤分類與重試次數，不保存片名、播放網址、搜尋、授權、帳號或 Cookie，不自動上傳裝置紀錄。可以用已授權的 ADB 讀取：

```text
adb shell dumpsys activity tw.com.sylong.tvcar/.MainActivity
```

查找 `YINGSHI_DIAGNOSTICS=`。正式版不需要開啟 WebView DevTools。

## 建置

需要 JDK 21、Android SDK 36.1、Node。Gradle wrapper 已鎖定版本與校驗。

```text
npm ci
npm run build:compat
npm test
gradlew :app:assembleLicensedRelease :app:lintLicensedRelease
```

相容頁由儲存庫 `docs/iphone` 建立；也可透過 `TV_CLOUD_SOURCE` 指向該儲存庫。產生的相容頁、node_modules、SDK 路徑、建置輸出及簽章私鑰不提交。

既有 APK 使用原設備保留的簽章；目前 Gradle 簽章名稱為 `debug`，不代表 release 的 `debuggable` 為 true。換一台電腦產生新的 debug keystore 會產生不同簽章，不能作為原位更新。發布前必須核對原簽章 SHA-256：

```text
b6f8718ac28ae96e1b76bfe7a8c4687e73d2c4f2dcd187a25c6af9427993a9a0
```

以相同套件及簽章執行原位更新，保留原授權／資料，不卸載、不清除資料。GitHub Release 使用獨立的 `yingshi-car-*` 標籤，不改 OKTV 2.x 的 latest。

後續雲端播放器與來源修正會自動載入，不必更換 APK；Android 原生程式或權限改動仍需 APK 原位更新。本版沒有繞過 Android 安裝權限的靜默原生 APK 更新器。
