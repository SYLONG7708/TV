# 影視 OKTV

最新行動版是 **2.1.4 片名修正・雲端同步版**，安裝入口見下方「行動雲端版 APK」。原生 5.1.6 為另一個套件。

這個 repo 保存目前內置來源設定、可重新打包的 PowerShell 腳本，以及零基礎網頁教學。已修改好的 APK 與圖示保存在唯讀安全封存倉庫，正式來源 URL 仍指向本 repo，因此更新來源不需要重新安裝 APK。

## 下載 APK

- APK：[`OKTV_5.1.6_builtin_sources.apk`](https://github.com/SYLONG7708/TV-archive-20260904/raw/refs/heads/main/releases/OKTV_5.1.6_builtin_sources.apk)
- 版本：`5.1.6`
- 顯示名稱：`影視`
- 套件：`com.fongmi.android.tv`
- 圖標：[`icon-tech-20260528.png`](https://github.com/SYLONG7708/TV-archive-20260904/raw/refs/heads/main/branding/icon-tech-20260528.png)
- 簽名：debug key 重新簽名

如果手機或模擬器已經安裝原版，因為簽名不同，請先卸載原版再安裝這個 APK。

相容性：保留 Android 6.0+ / arm64-v8a 架構，並把相機、Wi-Fi、橫向螢幕等硬體需求設為非必須，補上全尺寸螢幕支援，方便手機、平板、電視盒與模擬器安裝。

## 行動雲端版 APK（最新點播介面）

- [下載影視 OKTV 2.1.4 片名修正・雲端同步版 APK](https://github.com/SYLONG7708/TV/releases/download/oktv-cloud-2.1.4-20261002/OKTV_2.1.4_cloud_fixed_20261002.apk)
- [下載可重新建置的 Android 專案](https://github.com/SYLONG7708/TV/releases/download/oktv-cloud-2.1.4-20261002/OKTV_2.1.4_cloud_source_20261002.zip)
- 套件：`com.yingshi.player`；版本代碼：`8`；Android 7.0 以上。
- [Android 原始碼與建置方式](mobile/oktv-cloud/README.zh-TW.md)、[全量片名檢查與修正報告](docs/TITLE_AUDIT_20261002.md)。

這個版本直接開啟[正式點播網頁](https://sylong7708.github.io/TV/docs/iphone/)，介面、分類、片單與搜尋資料皆由雲端載入，APK 不含點播來源或搜尋索引。完整結束 App 後再開啟即可取得目前雲端頁面，離線頁提供重新連線按鈕。可覆蓋安裝同簽章的 2.1.2／2.1.3。已修正單字搜尋備援資料混入瀏覽、同名作品誤合併及訊號 metadata 混用；無法核實的破損名稱暫停展示並保留原始資料。

## 目前內置來源

- 點播：`https://raw.githubusercontent.com/SYLONG7708/TV/refs/heads/main/sources/TVBOX`
- 直播穩定版：`https://raw.githubusercontent.com/SYLONG7708/TV/refs/heads/main/sources/live-stable.txt`
- 直播私密頻道密碼：`7708`

設定檔在 [`sources/current-sources.json`](sources/current-sources.json)。APK 預設值寫入 `classes.dex` 的 `com.fongmi.android.tv.bean.Config.vod()` 與 `Config.live()`；使用者在 App 設定畫面修改後，會保存到 Android App 私有資料庫。

## 點播完整索引與防暴跌保護

iPhone 網頁採「小型 catalog + 分來源完整索引/明細分片」架構。每日更新只刷新各來源前幾頁時，不能把局部樣本數誤當成完整索引總量。`tools/guard-vod-catalog-coverage.mjs` 會將本次結果與 `main`、公開 `gh-pages` 兩份基準交叉比對：單一來源低於基準 90%、全域低於基準 95%，或總量低於 100 萬筆時會保留最後完整版本或直接中止發布。

`tools/build-pages-public-catalog.mjs` 另有第二層發布閘門，局部索引不得覆蓋完整索引 metadata。相關回歸測試：

```powershell
node --test .\tests\*.test.mjs
node .\tools\update-iphone-csp.mjs --check
```

`.github/workflows/validate-oktv-integrity.yml` 會在 PR 與主分支相關變更時，以稀疏 checkout 自動重跑相同檢查並驗證 catalog 絕對下限及加總一致性。

公開 catalog 的 `totals.items` / `totals.playableItems` 代表完整索引覆蓋量；本次更新的局部樣本會記錄在每個來源的 `coverageGuard.observedItemCount`，兩者不再混用。

## 直播穩定加強

已從原始安博直播源重新生成：

- `sources/live-stable.txt`：APK 目前使用的穩定版，只放短測通過、能回傳 HLS 播放清單的來源；目前已移除 404 與 YouTube watch 頁面 URL。
- `sources/live-base.txt`：YouTube 直播合併前的完整備份底表，不直接作為 APK 預設播放清單。
- `sources/live-cleaned-backup.txt`：去重與整理後的完整備份。
- `sources/live-verified-only.txt`：本次短測通過的精簡清單，也是 YouTube 無 cookies 時合併用的安全底表。
- `sources/live-stability-report.json`：測速與驗活報告。
- `sources/youtube-live-channels.csv`：98 個公開 YouTube 直播頻道表。
- `sources/live-youtube-stable.txt`：YouTube 頻道解析後的短效播放 URL。
- `sources/live-youtube-report.json`：YouTube 解析成功與失敗報告。
- `sources/live-signal-sources.json` / `sources/live-signal-sources.csv`：掃描 repo 內每個直播名稱的所有訊號源，標記可持續更新的長效來源，以及短效播放產物。

重新整理直播源：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-stable-live.ps1
```

腳本預設會把直播內的「私密頻道」輸出為密碼群組，密碼為 `7708`。

## YouTube 即時直播自動更新

已將提供的 YouTube 直播整理為新聞、購物、綜合娛樂、國際新聞、亞洲新聞、兒童動畫、文化紀實、音樂體育風景等群組，並以三位數序號排列。

YouTube 的真實播放 URL 會過期，OKTV 直播 TXT 不能直接播放 `https://www.youtube.com/watch?v=...` 頁面。店內 Windows 排程在專用的 `E:\CODEX\Automation\OKTVLiveUpdate` checkout 執行 `tools/run-youtube-live-managed.ps1`，每 3 小時使用本機 `yt-dlp` 擷取與驗證 HLS。至少 10 個頻道通過分段測速後，才會更新雲端資料；不足時保留舊版並記錄狀態。APK 讀取雲端 TXT，來源更新無須重包 APK。

手動更新：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\update-youtube-live.ps1 -DownloadYtDlp -IncludeOriginalOnFailure
```

新增或調整頻道時，修改 `sources/youtube-live-channels.csv` 的 `Order`、`Group`、`Name`、`Url` 後重新執行上方指令。地區限制、影片下架、非公開、DRM 或無 cookies 無法解析時，原 YouTube 頁面 URL 只會記錄在 `sources/live-youtube-report.json`，不會寫入主播放清單。

重新建立每個直播名稱的訊號源索引：

```powershell
node .\tools\build-live-signal-index.mjs --tvRoot .
```

這會更新 `sources/live-signal-sources.json` 與 `sources/live-signal-sources.csv`。`direct-hls` 與 `youtube-page` 會標記為可持續更新；`youtube-generated-hls` 是短效播放 URL，只作為目前播放產物記錄。

從專用 checkout 安裝或重裝本機隱藏排程；若 Windows 不允許建立排程，安裝程式會改用使用者登入時啟動的隱藏背景程序，每 3 小時更新一次：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-youtube-live-autoupdate-task.ps1 -RepoRoot 'E:\CODEX\Automation\OKTVLiveUpdate'
```

### 無 cookies 的雲端更新

GitHub runner 沒有 YouTube cookies 時，定時工作只檢查並保留現有資料，不再用 watch 頁面網址重建直播 TXT 或寫入時間戳。店內排程負責取得可供 APK 使用的 HLS；手機網頁仍可透過官方嵌入播放器使用 YouTube 頁面。執行記錄與狀態保存在專用 checkout 的 `.patch-work/youtube-live-managed.log` 和 `.patch-work/youtube-live-managed-status.json`。

### 雲端自動診斷與修復

已啟用每小時診斷，以及直播、點播、部署或完整性工作失敗後的自動檢查。系統檢查公開網頁、完整目錄加總、最新內容、每個來源索引、API 可用率與直播資料，只重新派送需要修復的工作；已有更新執行時會等待。首次失敗可立即重試，連續失敗依次延後 15／60／360 分鐘，後續排程仍會繼續處理。

2026-09-10 起，GitHub Pages 僅部署約 18 MB 的網頁與必要清單，設 100 MiB 硬上限；大型索引保留在 `gh-pages`，按固定資料 commit 讀取，避免原本約 3.56 GB 部署包造成的逾時。直播與點播共用部署流程，上線後核對實際版本與索引；單獨部署失敗時優先重新部署，避免重做完整來源更新。

gzip 穩定輸出、分批發布及推送衝突恢復機制持續保留。排程與處理範圍詳見 [自動修復說明](docs/AUTOMATIC_RECOVERY.md)。點播等日常更新由 GitHub 雲端執行；YouTube HLS 由店內電腦執行，電腦需保持開機與連網。外部來源關站、登入或地區限制無法由本專案強制修復。

開發人員可使用相同診斷命令：

```powershell
node .\tools\check-oktv-system-health.mjs --baseUrl "https://sylong7708.github.io/TV" --probeApis true
```

### GitHub Actions cookies

GitHub runner may be blocked by YouTube with `Sign in to confirm you're not a bot`. When that happens, the workflow keeps the original YouTube URL in the report and excludes it from the playable playlist. To let Actions resolve HLS URLs, add an Actions secret named `YOUTUBE_COOKIES_B64`:

```powershell
.\.tools\yt-dlp.exe --cookies-from-browser chrome --cookies youtube-cookies.txt --skip-download "https://www.youtube.com/"
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\youtube-cookies.txt")) | Set-Clipboard
```

Paste the Base64 text into GitHub `Settings` → `Secrets and variables` → `Actions` → `New repository secret`. Cookies are login credentials; keep them in GitHub Secrets only and do not commit them.

## 零基礎網頁教學

完整網頁版教學在：

- [手機網頁版](https://sylong7708.github.io/TV/docs/iphone/index.html)
- [原始教學 HTML（安全封存，可下載開啟）](https://github.com/SYLONG7708/TV-archive-20260904/blob/main/docs/index.html)

若 GitHub Pages 設定為從 `main` 分支根目錄或 `/docs` 發佈，可用網頁方式閱讀。

## 重新修改來源並打包

Windows PowerShell 範例：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\update-oktv-sources.ps1 `
  -InputApk .\releases\OKTV_5.1.6_builtin_sources.apk `
  -OutputApk .\releases\OKTV_5.1.6_custom_sources.apk `
  -VodUrl "你的點播 JSON URL" `
  -LiveUrl "https://raw.githubusercontent.com/SYLONG7708/TV/refs/heads/main/sources/live-stable.txt"
```

請只使用自己有權使用或可合法分享的來源。
