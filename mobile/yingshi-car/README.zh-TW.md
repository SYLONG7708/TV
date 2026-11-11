# 影視車機正式版

`tw.com.sylong.tvcar`，1.4.31-blue-m-live / versionCode 41。此專案延續原授權影視 1.4.30，與 `mobile/oktv-cloud` 為不同 Android 套件。

Android 9 以上可透過同機藍色 M 的新版直播服務取得 Morphe 公開直播串流，由影視自己的播放器播放；換台及播放期間都留在影視。需要同時更新影視與藍色 M，完整協定與測試範圍見 [直播整合說明](../../docs/iphone/YOUTUBE_IN_APP_RECOVERY.md)。

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

release 建置由環境變數 `YINGSHI_KEYSTORE_FILE`、`YINGSHI_STORE_PASSWORD`、`YINGSHI_KEY_ALIAS`、`YINGSHI_KEY_PASSWORD` 提供原簽章。未提供時只產生 `app-licensed-release-unsigned.apk`。密碼與私鑰不提交、不寫入教學。發布前必須核對原簽章 SHA-256：

```text
b6f8718ac28ae96e1b76bfe7a8c4687e73d2c4f2dcd187a25c6af9427993a9a0
```

以相同套件及簽章執行原位更新，保留原授權／資料，不卸載、不清除資料。GitHub Release 使用獨立的 `yingshi-car-*` 標籤，不改 OKTV 2.x 的 latest。

後續雲端播放器與來源修正會自動載入，不必更換 APK；Android 原生程式或權限改動仍需 APK 原位更新。本版沒有繞過 Android 安裝權限的靜默原生 APK 更新器。
# 1.4.32：短效影片來源適配

`ccc.oiio.fun` 的 MP4 會跳轉到只有約 9 分鐘效期的天翼網址。此版由 App 內部在每次影片 Range 請求重新解析，將原本的範圍標頭轉送到最終 HTTPS 儲存端，串流回傳給同一個播放器。短效簽章不存入片庫、不交給網頁，也不加入 APK。

雲端介面可直接辨識這類來源；需要此功能的選集須使用具備 `resolveSourceMedia` 的 Android 版。其他一般 HTTPS 影片維持既有流程。此版保留影視授權判斷與原套件 `tw.com.sylong.tvcar`，版號 42。

正式覆蓋安裝必須沿用原簽章 `b6f8718ac28ae96e1b76bfe7a8c4687e73d2c4f2dcd187a25c6af9427993a9a0`。目前本機與已查備份的金鑰均不吻合；`licensedRelease` 先提供 unsigned APK，接續既有到店簽章流程。測試用 direct APK 只供隔離模擬器驗證，不能替代正式授權版。

