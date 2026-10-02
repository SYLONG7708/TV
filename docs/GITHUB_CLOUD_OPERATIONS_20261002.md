# OKTV 全雲端營運（2026-10-02）

既有 2.1.4 APK 保持不變；啟動入口是 https://sylong7708.github.io/TV/docs/iphone/ 。介面、分類、完整索引、搜尋及直播全部從 GitHub Pages 和固定版本的 GitHub 資料讀取。這次不重包、不重新安裝，也不把影片或來源打包进 APK。

## 自動更新

- 點播：既有 `update-lunatv-vod.yml` 更新來源與索引，發布防護保留完整目錄，不用少量樣本覆蓋全量資料。
- 直播：`update-youtube-live.yml` 每三小時排程。即使沒有私人 YouTube Cookie，也會重建網頁清單、排除過期短效網址、保留官方 YouTube 嵌入入口，並由 GitHub 部署。
- 私人 Cookie 是短效 HLS 擷取的選用條件，不是網頁／APK 直播目錄更新的前置條件。未擷取成功時不宣稱 HLS 已更新。
- `webCatalogBuiltAt` 表示目錄生成時間；`hlsRefreshStatus` 表示 HLS 擷取結果。兩者分開紀錄。官方嵌入仍受頻道下架、禁止嵌入及地區限制影響。
- `deploy-oktv-pages.yml` 發布輕量介面並固定大型索引的 commit，驗證 82 個來源索引，避免一半新、一半舊的目錄。
- GitHub 排程不需要這台 Windows 開機。Actions 排程可能延遲，實際執行以 Actions 與公開狀態時間為準。

## 管理入口

- 儲存庫：https://github.com/SYLONG7708/TV
- 工作排程：https://github.com/SYLONG7708/TV/actions
- 手動更新直播：`gh workflow run update-youtube-live.yml --repo SYLONG7708/TV --ref main`
- 手動重新部署：`gh workflow run deploy-oktv-pages.yml --repo SYLONG7708/TV --ref main`
- 回歸：`node --test tests/*.test.mjs`
- 公開健康：`node tools/check-oktv-system-health.mjs --probeApis false`

## 本次修復

缺少 Cookie 時舊工作直接跳過所有直播發布，卻顯示整個工作成功；新工作會繼續更新官方嵌入清單。也納入昨晚尚未合併的搜尋結果 ID 修正，避免搜尋框失焦導致點選錯誤。

## 商用範圍

GitHub 管理帳號沿用擁有者 SYLONG7708；App 沒有另外創造一組可控制 GitHub 的後台密碼。不要把 GitHub Token 或私人 Cookie 放進公開 HTML、JSON 或 APK。現有外部影片來源的商業播放及散布授權尚未逐項取得，資料筆數不等於商用授權或逐部播放保證。這次維持既有安裝識別與签章，以符合免重裝要求。
