# 影視 OKTV 2.1.4 片名修正・雲端同步版

Android 套件 `com.yingshi.player`，版本代碼 8，版本名稱 `2.1.4-cloud-20261002`。啟動後直接開啟正式網頁：

https://sylong7708.github.io/TV/docs/iphone/

電影、劇集、短劇、動漫、綜藝的介面與影片目錄都由雲端載入。APK 只含 Capacitor Android 外殼、啟動畫面與離線重試頁；沒有打包點播來源、片單或搜尋索引。完整結束 App 後再開啟，會重新連線取得目前發布的網頁；觀看中的畫面不會強制重新整理。原生 WebView 在首次載入前停用舊 HTTP 快取，離線時可按「重新連線」。

本次雲端修正：搜尋用的單字片名備援資料不再混入一般瀏覽；同名不同年份或不同類型的作品分開合併；每個訊號保留自己的片名、年份及海報；詳情與清單的片名、年份或來源不符時停止載入。HTML 標籤與字元實體會清理，全問號及破損編碼名稱會暫停展示，原始資料保留。真正的單字片名仍可搜尋。

## 建置

需要 Node.js、Java 21、Android SDK 36，並用 `ANDROID_HOME` 或本機的 `android/local.properties` 指定 SDK。於本資料夾執行：

```powershell
npm ci
npx cap sync android
Set-Location android
.\gradlew.bat assembleRelease lintRelease --no-daemon
```

產物：`android\app\build\outputs\apk\release\app-release.apk`，Android 7.0 以上。交付 APK 使用既有本機簽章，與 2.1.3 的憑證 SHA-256 同為 `b26fca7ea810d7f4c34fcd12814cbe26fdbbab46e5ce6844543efb2f28315203`，可覆蓋安裝同簽章的 2.1.2／2.1.3。重新建置時必須使用同一份原簽章才能覆蓋；私人簽章不包含在原始碼 ZIP 或 GitHub。Release 已關閉偵錯與 App 日誌。原生影視 5.1.6 使用不同套件 `com.fongmi.android.tv`。

## 驗證紀錄

- `assembleRelease` 成功；`lintRelease` 通過，0 errors、1 個既有未使用資源警告。
- `aapt`：`com.yingshi.player`、`versionCode=8`、`versionName=2.1.4-cloud-20261002`。
- APK 內 `capacitor.config.json` 指向正式雲端網址；內置網頁只有啟動畫面和離線提示，沒有點播資料檔。
- 新舊行動版 APK 的簽章憑證 SHA-256 相同。
- 片名全量檢查結果及程式測試見倉庫 `docs/TITLE_AUDIT_20261002.md`。
- 目前沒有連接 Android 裝置，尚未做實機啟動驗證。
