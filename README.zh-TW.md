# 影視 5.1.6 內置來源修改包

本專案包含：

- 已內置點播與直播來源的 APK。
- 目前來源設定 JSON。
- 可重新修改來源並重打包 APK 的 PowerShell 腳本。
- 給零基礎使用者看的完整網頁教學。

## 檔案位置

| 類型 | 路徑 |
| --- | --- |
| 已完成 APK | `releases/OKTV_5.1.6_builtin_sources.apk` |
| 來源設定 | `sources/current-sources.json` |
| 科技感圖標 | `branding/icon-tech-20260528.png` |
| 穩定直播源 | `sources/live-stable.txt` |
| 原始穩定直播底表 | `sources/live-base.txt` |
| 直播驗活報告 | `sources/live-stability-report.json` |
| YouTube 直播頻道表 | `sources/youtube-live-channels.csv` |
| YouTube 解析直播源 | `sources/live-youtube-stable.txt` |
| YouTube 解析報告 | `sources/live-youtube-report.json` |
| LunaTV 點播候選源 | `sources/vod-lunatv-jin18-oktv.json` |
| LunaTV 點播檢測報告 | `sources/vod-lunatv-jin18-report.json` |
| LunaTV full 全量候選源 | `sources/vod-lunatv-full-oktv.json` |
| LunaTV full 全量檢測報告 | `sources/vod-lunatv-full-report.json` |
| LunaTV full 全量分析表 | `sources/vod-lunatv-full-analysis.csv` |
| 修改腳本 | `tools/update-oktv-sources.ps1` |
| 直播穩定源生成腳本 | `tools/build-stable-live.ps1` |
| YouTube 直播自動解析腳本 | `tools/update-youtube-live.ps1` |
| LunaTV 點播自動更新腳本 | `tools/update-lunatv-vod.ps1` |
| 網頁教學 | `docs/index.html` |
| 修改後 smali 備份 | `patches/Config.modified.smali` |

## 驗證紀錄

這版 APK 已確認：

- `apksigner verify` 通過 v1 / v2 / v3。
- `aapt dump badging` 可讀取，版本為 `5.1.6`，顯示名稱為 `影視`。
- `zipalign -c` 通過。
- `classes.dex` 內已包含點播與直播 URL。
- 全尺寸螢幕支援已加入，硬體功能需求保持非必須，以提高手機、平板、電視盒與模擬器相容性。

## 安裝提醒

此 APK 已重新簽名，不能直接覆蓋原簽名版本。若裝置已安裝原版，請先卸載原版再安裝。

直播內的「私密頻道」已設為密碼群組，密碼為 `7708`。

## 修改來源

請看 `docs/index.html`，或直接執行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\update-oktv-sources.ps1 `
  -InputApk .\releases\OKTV_5.1.6_builtin_sources.apk `
  -OutputApk .\releases\OKTV_5.1.6_custom_sources.apk `
  -VodUrl "你的點播 JSON URL" `
  -LiveUrl "你的直播 TXT/M3U URL"
```

請只使用自己有權使用或可合法分享的來源。

## LunaTV 點播候選源自動更新

LunaTV `jin18` 與 `full` 來源會從 `https://github.com/hafrey1/LunaTV-config` 的最新 raw JSON 讀取，轉成 OKTV/FongMi 可讀格式，並與 `sources/current-sources.json` 裡的 `vod.compareUrl` 做 API/host 去重。腳本會實測 `ac=list`、詳情資料、`vod_play_url` 與搜尋 `ac=detail&wd=...`，重複或不可用來源不會寫入候選源。

目前輸出：

- 候選源：`https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/vod-lunatv-jin18-oktv.json`
- 檢測報告：`https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/vod-lunatv-jin18-report.json`
- full 全量候選源：`https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/vod-lunatv-full-oktv.json`
- full 全量檢測報告：`https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/vod-lunatv-full-report.json`
- full 全量分析表：`https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/vod-lunatv-full-analysis.csv`

手動更新：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\update-lunatv-vod.ps1 -SourceName jin18 -TimeoutSec 12 -MaxDetailProbe 3
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\update-lunatv-vod.ps1 -SourceName full -TimeoutSec 12 -MaxDetailProbe 2 -RedactSampleNames
```

關閉 Codex 後仍會自動更新：本機 Windows 工作排程 `OKTV LunaTV VOD Auto Update` 會在開機、登入、以及每 2 小時執行 `tools/update-lunatv-vod-local.ps1`，同時刷新 `jin18` 與 `full`，更新後自動 commit / push 到 GitHub。GitHub Actions 也會每 6 小時自動複測。

注意：這些檔案是「候選點播源 / 技術檢測報告」，已驗活與去重，但內容授權需人工確認後才可設為 APK 預設播放源。`full` 包含 18+ 上游項目，只保留在全量報告與候選檔中，不作為一般影視預設播放源。

## 重新生成穩定直播源

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-stable-live.ps1
```

此腳本會抓取原始直播源，去除重複線路，預設每條線路短測 2 次，並只把通過短測、能回傳 HLS 播放清單的線路寫入 `sources/live-stable.txt`。完整整理清單會保留在 `sources/live-cleaned-backup.txt`，不直接作為 APK 預設播放清單。
腳本預設會把「私密頻道」輸出為密碼群組，密碼為 `7708`。

輸出檔案：

- `sources/live-stable.txt`
- `sources/live-cleaned-backup.txt`
- `sources/live-verified-only.txt`
- `sources/live-stability-report.json`

## YouTube 即時直播自動更新

已把使用者提供的 98 個公開 YouTube 直播頻道整理到 `sources/youtube-live-channels.csv`，依照網路第四台常見邏輯分成新聞、購物、綜合娛樂、國際新聞、亞洲新聞、兒童動畫、文化紀實、音樂體育風景等群組，頻道名稱前方保留三位數序號，方便在直播列表中掃描。

YouTube 真實播放 URL 是短效網址，不能永久固定；OKTV 直播 TXT 也不能直接播放 `https://www.youtube.com/watch?v=...` 頁面。本機已加入 Windows 排程，每次開機 / 登入後會執行 `tools/update-youtube-live-local.ps1`，之後每 2 小時用 `yt-dlp` 擷取可播放 URL，優先選擇 480p HLS 以降低卡頓，並實測影片分段下載速度；只有達到 600 kbps 以上的項目才合併到 APK 已使用的 `sources/live-stable.txt` 並推送到 GitHub。

手動更新指令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\update-youtube-live.ps1 -DownloadYtDlp -IncludeOriginalOnFailure
```

本次解析結果會寫到：

- `sources/live-youtube-stable.txt`
- `sources/live-youtube-report.json`
- `sources/live-stable.txt`

若要新增或調整 YouTube 頻道，只要修改 `sources/youtube-live-channels.csv` 的 `Order`、`Group`、`Name`、`Url`，再執行上方指令即可。地區限制、影片下架、非公開、DRM 或無 cookies 無法解析時，原 YouTube 頁面 URL 只會記錄在報告檔，不會寫入主播放清單。

安裝或重裝本機開機自動更新：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\install-youtube-live-autoupdate-task.ps1
```

### 沒 cookies 的 100% 成功模式

GitHub runner 沒有 YouTube cookies 時，workflow 會保持目前的 `sources/live-stable.txt` 不變，避免把本機已刷新好的可播放 HLS 清單洗掉。除非 GitHub 已設定 `YOUTUBE_COOKIES_B64`，否則主要更新來源是本機 Windows 排程。

這個模式代表清單更新成功，且已避免不可播放的 watch 頁面 URL 進入主清單；不代表已取得短效 HLS。若要讓報告中的 `hlsSuccessRate` 提高，仍需設定 `YOUTUBE_COOKIES_B64`。

### GitHub Actions 被 YouTube 擋住時

GitHub runner 有時會被 YouTube 要求登入或驗證機器人。此時 `sources/live-youtube-report.json` 會記錄原 YouTube URL，主播放清單會排除這些 watch 頁面。要讓 GitHub Actions 也能解析，請在 repo 設定一個 Actions secret：

```powershell
.\.tools\yt-dlp.exe --cookies-from-browser chrome --cookies youtube-cookies.txt --skip-download "https://www.youtube.com/"
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\youtube-cookies.txt")) | Set-Clipboard
```

到 GitHub repo 的 `Settings` → `Secrets and variables` → `Actions` → `New repository secret`，名稱填 `YOUTUBE_COOKIES_B64`，內容貼上剪貼簿的 Base64 字串。cookies 是登入憑證，請只放在 GitHub Secret，不要提交到 repo。
