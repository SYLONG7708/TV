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
| 修改腳本 | `tools/update-oktv-sources.ps1` |
| 直播穩定源生成腳本 | `tools/build-stable-live.ps1` |
| YouTube 直播自動解析腳本 | `tools/update-youtube-live.ps1` |
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

## 重新生成穩定直播源

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-stable-live.ps1
```

此腳本會抓取原始直播源，去除重複線路，預設每條線路短測 2 次，並把通過短測的線路放到 `Verified Fastest` 優先分類；原分類仍保留完整備援。
腳本預設會把「私密頻道」輸出為密碼群組，密碼為 `7708`。

輸出檔案：

- `sources/live-stable.txt`
- `sources/live-cleaned-backup.txt`
- `sources/live-verified-only.txt`
- `sources/live-stability-report.json`

## YouTube 即時直播自動更新

已把使用者提供的 98 個公開 YouTube 直播頻道整理到 `sources/youtube-live-channels.csv`，依照網路第四台常見邏輯分成新聞、購物、綜合娛樂、國際新聞、亞洲新聞、兒童動畫、文化紀實、音樂體育風景等群組，頻道名稱前方保留三位數序號，方便在直播列表中掃描。

YouTube 真實播放 URL 是短效網址，不能永久固定。此 repo 已加入 GitHub Actions，每 2 小時執行一次 `tools/update-youtube-live.ps1`，用 `yt-dlp` 擷取可播放 URL，優先選擇 720p HLS 以降低卡頓，再合併到 APK 已使用的 `sources/live-stable.txt`。

手動更新指令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\update-youtube-live.ps1 -DownloadYtDlp -IncludeOriginalOnFailure
```

本次解析結果會寫到：

- `sources/live-youtube-stable.txt`
- `sources/live-youtube-report.json`
- `sources/live-stable.txt`

若要新增或調整 YouTube 頻道，只要修改 `sources/youtube-live-channels.csv` 的 `Order`、`Group`、`Name`、`Url`，再執行上方指令即可。地區限制、影片下架、非公開或 DRM 內容無法被腳本強制播放，會保留原 YouTube 頁面 URL 並記錄在報告檔。
