# YouTube 直播留在影視內：恢復功能測試版

日期：2026-11-11（UTC+8）。使用者指定播放畫面全程留在影視內。

## 這次實作

直播仍在影視的官方 YouTube 嵌入播放器播放。參考藍色 M 的故障恢復策略，在同一播放器頁面內重建同一個影片 ID 的播放器，讓官方播放器重新連接目前串流。沒有開啟藍色 M、其他 App 或外部播放分頁。

- 已起播後進度停滯或持續緩衝約 6 秒，先重新載入同一個頻道一次；再失敗才交回既有同頻道備援與退避重試流程。
- 暫時性播放器錯誤等候 2 秒再恢復；重複錯誤事件不建立多個恢復工作。
- 實際播放累計 90 秒後可處理後續的新故障。只回報「播放中」但進度沒有前進不算成功。
- 前置廣告／準備期間的時鐘前進不算已驗證直播，也不因啟播等待而中斷它。
- 暫停、背景、直播結束、瀏覽器阻擋自動播放時不強制重播；返回前景重新觀察，離線交回既有連線恢復流程。
- 網址無效、移除／私人影片、禁止嵌入及來源驗證錯誤保留明確說明，停止無效自動重試。手動重新開啟或重新連線可重試。
- 關閉播放器與換台會取消舊工作的計時器，舊頻道回呼不能操作新頻道。

## 與完整藍色 M 核心的差別

**這份變更沒有移植 Morphe 的原生取流、SABR、PoToken、帳號或去廣告核心；官方嵌入仍可能顯示 YouTube 廣告。不能將本測試版稱為「藍色 M 核心已內建影視」。**

藍色 M 在既有 YouTube APK 中修補其播放器與串流資料；它不是可供影視直接載入的播放器 SDK。參考程式：

- [藍色 M 實作與恢復策略](https://github.com/SYLONG7708/Morphe/blob/main/bluem/README.md)
- [上游取流程式](https://github.com/MorpheApp/morphe-patches/blob/main/extensions/shared-youtube/library/src/main/java/app/morphe/extension/shared/spoof/requests/StreamingDataRequest.java)

本機對單一公開直播測試四種取流設定，三種要求登入驗證，iOS 設定回傳 OK 但只有分離影音與專用串流資料，沒有 HLS manifest。此結果只代表當時本機測試，不能推論所有裝置或所有頻道。完整原生核心仍需另外處理取流與媒體協定整合並在 Android 實機驗證；本次不假裝這部分已完成。

## 驗證與使用範圍

142 項儲存庫 Node 測試通過，包括 11 項新增播放器／恢復工作測試。另建置車機版相容頁，4 項相容頁回歸及內嵌程式／CSP 雜湊驗證通過。

隱藏 Chromium 以本機修改程式替換測試頁面，使用正式雲端頻道資料與未替換的 YouTube 影音。三立 iNEWS 實際解碼 854×480 畫面，播放時間與解碼影格數持續增加，頁面與單一分頁保持不變。檢查桌面 1365×900 與手機 390×844 畫面。這是瀏覽器與短時間啟播測試；未接 Android 裝置、未逐台測全部直播，也不能保證第三方長期可用。

本次修改共用雲端播放器，未產生或安裝新 APK。尚未合併的分支不會改變正式站。

```powershell
node --test tests/*.test.mjs
node tools/update-iphone-csp.mjs --check
cd mobile/yingshi-car
npm ci
npm run build:compat
npm test
npm run verify:bundle
```
