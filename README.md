# OKTV 5.1.6 內置點播 / 直播源版

這個 repo 保存已修改好的 APK、目前內置來源設定、可重新打包的 PowerShell 腳本，以及零基礎網頁教學。

## 下載 APK

- APK：[`releases/OKTV_5.1.6_builtin_sources.apk`](releases/OKTV_5.1.6_builtin_sources.apk)
- 版本：`5.1.6`
- 套件：`com.fongmi.android.tv`
- 簽名：debug key 重新簽名

如果手機或模擬器已經安裝原版，因為簽名不同，請先卸載原版再安裝這個 APK。

## 目前內置來源

- 點播：`https://raw.githubusercontent.com/FGBLH/GHK/refs/heads/main/%E6%B5%B7%E8%B1%9A%E5%BD%B1%E8%A7%86.json`
- 直播：`https://raw.githubusercontent.com/FGBLH/GHK/refs/heads/main/%E5%AE%89%E5%8D%9A.txt`

設定檔在 [`sources/current-sources.json`](sources/current-sources.json)。

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
  -LiveUrl "你的直播 TXT/M3U URL"
```

請只使用自己有權使用或可合法分享的來源。
