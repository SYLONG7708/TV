# 藍色 M 公開直播在影視內播放

日期：2026-11-11（UTC+8）。Android 9 以上的影視使用同機藍色 M 的 Morphe 核心解析 YouTube 公開直播，影音由影視自己的播放器解碼與顯示。點選頻道、換台、暫停、繼續及關閉都在影視內完成。

## 實作

1. 影視從既有直播清單取得 YouTube 影片 ID，明確綁定藍色 M 的 `com.sylong.bluem.live.LiveResolveService`。
2. 雙方驗證套件簽章。藍色 M 以 Android `Message.sendingUid` 驗證呼叫者，只接受原簽章的影視授權版；QA 建置額外接受獨立套件的影視測試版。
3. 藍色 M 呼叫已修補的 `StreamingDataRequest.fetchRequest`，取回公開直播 AVC/AAC 影音軌。新版服務不開啟藍色 M Activity，也不傳遞帳號、Cookie 或授權標頭。
4. 影視原生層把分離的 fragmented MP4 轉為應用程式內的 HLS 視窗。`shouldInterceptRequest` 供應當次 UUID 的播放清單、初始化資料及片段；頁面只收到應用程式內網址。
5. 既有 Hls.js 播放器負責畫質、音量、暫停與影音解碼。換台、關閉、頁面重載及 App 銷毀會取消舊請求、解除綁定與關閉串流。

每次最多等待 35 秒，逾時交回原有同頻道備援與退避重連。設定／簽章不相容時顯示更新提示並提供「重新連線」；不跳轉外部 App。解析期間的暫停意圖會保留，舊頻道的回呼不能重新開啟播放器。

網頁及 iPhone 沒有 Android 服務介面，沿用原官方嵌入播放器與恢復策略。這次整合供 Android 影視使用。

## Android 驗證

使用隱藏的 API 35 x86_64 Android 模擬器、Morphe patches 2.1.0 / YouTube 21.23.492 基底及配套 QA APK：

- 三立 iNEWS 播放達 1280×720，時間、解碼影格數與音訊解碼位元組持續增加，已持續播放數分鐘。
- 中視新聞換台後保留正確頻道，使用相同 `blue-m` 播放後端。
- 暫停停住進度、繼續播放恢復進度、關閉後不被舊回呼重新打開。
- 播放時影視為前景 Activity，YouTube iframe 的 `src` 為空。
- 關閉藍色 M 程序後，影視可背景冷啟動解析服務；模擬器實際斷網 45 秒後自動恢復同頻道 720p，解碼影音持續前進。

與最新 main 整合後，164 項 Node 測試、4 項內建頁回歸、19 項 Java 影音邊界檢查通過；授權 release 與 QA APK 建置通過，Android lint 0 錯誤。配套 Morphe 的 [完整雲端未簽章建置](https://github.com/SYLONG7708/Morphe/actions/runs/42864631140) 通過。

這是 Android 模擬器的影音解碼驗證；沒有連接使用者車機，模擬器關閉聲音輸出，因此沒有宣稱完成實機喇叭聽測。支援公開直播 AVC/AAC，最高 720p；尚未驗證私人、會員、付費、地區限制或全部頻道。串流供應與裝置環境改變仍可能影響可用性。

## 建置與簽章

正式影視為 `tw.com.sylong.tvcar`，版本 1.4.31-blue-m-live / code 41，保留授權機制。需使用影視原簽章，才能保留既有安裝與資料：

```text
b6f8718ac28ae96e1b76bfe7a8c4687e73d2c4f2dcd187a25c6af9427993a9a0
```

藍色 M 正式版須由 Morphe 儲存庫現有受保護簽章流程建置，且帶有 `com.sylong.bluem.LIVE_BRIDGE=1`、更新修訂 11。既有未提供服務的藍色 M APK 需配套更新。

影視未提供原金鑰時只輸出未簽章授權版；本機 debug 簽章 QA APK 不可當成正式覆蓋更新。不要為測試而卸載使用者的既有 App 或清除資料。

```powershell
node --test tests/*.test.mjs
node tools/update-iphone-csp.mjs --check
./tools/test-blue-m-media.ps1
cd mobile/yingshi-car
npm ci
npm run build:compat
npm test
npm run verify:bundle
./gradlew.bat :app:assembleDirectDebug :app:assembleLicensedRelease :app:lintLicensedRelease
```

新增 Morphe 服務與反射 API 相容性檢查已合併至 [Morphe PR #28](https://github.com/SYLONG7708/Morphe/pull/28)。正式可安裝版本仍以原簽章的發布產物為準；影視缺少原金鑰時不發布替代簽章更新。
