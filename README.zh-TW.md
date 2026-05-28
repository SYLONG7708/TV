# OKTV 5.1.6 內置來源修改包

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
| 修改腳本 | `tools/update-oktv-sources.ps1` |
| 網頁教學 | `docs/index.html` |
| 修改後 smali 備份 | `patches/Config.modified.smali` |

## 驗證紀錄

這版 APK 已確認：

- `apksigner verify` 通過 v1 / v2 / v3。
- `aapt dump badging` 可讀取，版本為 `5.1.6`。
- `zipalign -c` 通過。
- `classes.dex` 內已包含點播與直播 URL。

## 安裝提醒

此 APK 已重新簽名，不能直接覆蓋原簽名版本。若裝置已安裝原版，請先卸載原版再安裝。

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
