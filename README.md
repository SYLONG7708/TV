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

- 點播：`https://raw.githubusercontent.com/FGBLH/GHK/refs/heads/main/%E6%B5%B7%E8%B1%9A%E5%BD%B1%E8%A7%86.json`
- 直播穩定版：`https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/live-stable.txt`
- 直播私密頻道密碼：`7708`

設定檔在 [`sources/current-sources.json`](sources/current-sources.json)。

## 直播穩定加強

已從原始安博直播源重新生成：

- `sources/live-stable.txt`：APK 目前使用的穩定版，開頭有 `Verified Fastest` 優先分類；腳本預設每條線路短測 2 次，短測通過線路優先，同名頻道保留備援。
- `sources/live-cleaned-backup.txt`：去重與整理後的完整備份。
- `sources/live-verified-only.txt`：本次短測通過的精簡清單。
- `sources/live-stability-report.json`：測速與驗活報告。

重新整理直播源：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\build-stable-live.ps1
```

腳本預設會把直播內的「私密頻道」輸出為密碼群組，密碼為 `7708`。

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
  -LiveUrl "https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/live-stable.txt"
```

請只使用自己有權使用或可合法分享的來源。
