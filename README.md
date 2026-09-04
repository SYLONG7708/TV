# 影視 5.1.6 內置點播 / 直播源版

這個 repo 保存已修改好的 APK、目前內置來源設定、可重新打包的 PowerShell 腳本，以及零基礎網頁教學。

## 下載 APK

- APK：[`releases/OKTV_5.1.6_builtin_sources.apk`](releases/OKTV_5.1.6_builtin_sources.apk)
- 版本：`5.1.6`
- 顯示名稱：`影視`
- 套件：`com.fongmi.android.tv`
- 圖標：[`branding/icon-tech-20260528.png`](branding/icon-tech-20260528.png)
- 簽名：debug key 重新簽名

如果手機或模擬器已經安裝原版，因為簽名不同，請先卸載原版再安裝這個 APK。

相容性：保留 Android 6.0+ / arm64-v8a 架構，並把相機、Wi-Fi、橫向螢幕等硬體需求設為非必須，補上全尺寸螢幕支援，方便手機、平板、電視盒與模擬器安裝。

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

YouTube 的真實播放 URL 會過期，OKTV 直播 TXT 不能直接播放 `https://www.youtube.com/watch?v=...` 頁面。本機已加入 Windows 排程，每次開機 / 登入後會執行 `tools/update-youtube-live-local.ps1`，之後每 3 小時使用 `yt-dlp` 重新擷取 480p HLS、測試實際影片分段速度，只有達到 600 kbps 以上的項目才會合併到 APK 目前讀取的 `sources/live-stable.txt` 並推送到 GitHub。修改直播表不需要重新打包 APK，因為 APK 讀的是同一個 raw URL。

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

安裝或重裝本機開機自動更新：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-youtube-live-autoupdate-task.ps1
```

### No-cookies GitHub Actions mode

When GitHub runner has no YouTube cookies, the workflow still runs public best-effort extraction on the schedule. Channels that cannot produce a fresh HLS URL remain available through their official YouTube watch URL and the iPhone/Android WebView iframe fallback. Expired generated HLS URLs are no longer treated as the only usable copy.

This means scheduled runs can auto-detect changed YouTube live signals and commit them when they differ, while still protecting the playlist from YouTube bot-block or regional failures. To improve direct-HLS `hlsSuccessRate`, set `YOUTUBE_COOKIES_B64`; the iframe fallback does not require that secret.

## Automatic diagnosis and recovery

`.github/workflows/oktv-self-heal.yml` runs every hour and checks the public shell, metadata, complete catalog totals, newest feed, every published source index, VOD API availability, and live fallbacks. It dispatches only the affected updater and applies a six-hour cooldown to avoid retry storms.

Generated gzip files use content-stable writes, so a changed timestamp cannot rewrite multi-gigabyte indexes. `tools/publish-gh-pages-batched.ps1` uploads in bounded batches and publishes a single current snapshot commit, preventing generated deployment history from growing without limit. `tools/push-commit-with-recovery.ps1` distinguishes quota and permission failures from transient network or concurrent-update failures.

Run the same complete public diagnosis locally:

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

- [`docs/index.html`](docs/index.html)

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
