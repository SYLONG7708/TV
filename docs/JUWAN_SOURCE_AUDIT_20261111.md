# 聚玩盒子來源檢查與影視接入

2026-11-11 檢查 https://www.juwanhezi.com/jsonlist 的所有載入頁，包含 78 條點播接口及直播頁 25 條。相同地址會去重，不能把接口數當成獨立片庫數。

- 首輪 GitHub 網路實測：71 個不同點播配置中 35 個可解析，包含 2,574 筆站點設定、111 個不同的一般 CMS API；37 個已設定，74 個候選中 33 個目錄回應成功。
- 補上官方播放器使用的自帶金鑰 CBC 配置封裝與 Base64 解碼；本機及 GitHub 兩次檢查合計 41 個配置至少一次解析成功。不同主機與時點的成功率不能直接相加。
- JAR／Python／JS Spider 類設定保留相容性報告，不執行上游程式；失效、登入、私網與非資料回應保留原因。
- 配置及直播頁共找出 109 個不同直播清單地址；本次 71 個可讀，42 個至少一份 HLS 清單可讀。這不是全部頻道實播通過，未直接批量替換既有直播。

## 實際接入

`sources/juwan-approved-sources.json` 是已審閱的來源清單：

|顯示名稱|API|用途|
|---|---|---|
|OK資源｜追劇|https://api.okzyw.net/api.php/provide/vod|最新資料仍更新，一般電影、劇集、動漫、短劇及綜藝|
|淘片資源｜備用片庫|https://taopianapi.com/cjapi/mc/vod/json.html|抽樣最新資料停 2026-09-18，作舊片備用|

每個來源抽樣 3 部作品、6 組 HLS 清單與影片分段，12 組皆回傳有效 HLS 與 TS 資料。這是有限串流檢查，不是全部作品、全片解碼或車機實播保證。建安抽樣只有平台網頁；都司抽樣未提供直接影片，未加入。

首批每源 200 筆，共 400 筆可搜尋／具播放 URL 的資料。這不是兩個上游片庫的全量作品匯入；既有每日更新會刷新最新內容並逐步補明細。保留既有來源索引與總量保護。一般來源的指定排除類別不會匯入新索引。

TVBOX 建置、全來源重建及網頁 catalog 建置都會讀取上述清單，避免之後更新遺失。淘片頂層 `pageindex`、`recordcount`、`pagesize` 已正規化，分頁不會只停在首頁。新發現地址留在報告，不會未經播放與相容性確認自動上線。

## 排程與檢查範圍

- `Audit Juwan public sources`：每天 01:17（UTC+8，cron `17 17 * * *`），重新抓完整接口及配置、比對既有 API，報告 artifact 保留 90 天。
- 原 `Update LunaTV VOD sources` 每日 02:00 更新時間與 6 小時重試觸發維持，兩個接入來源沿用其內容更新、保留舊資料與發布保護。GitHub 排程可能延遲，來源更新不需重裝 APK。
- 網站地圖含 3,097 個不同公開網址。本次快速逐頁掃描在 31 頁成功後遇到持續連線逾時，**文章內文尚未全部完成**。完整接口清單已完成，不能用它代表 3,097 頁內文都已完成。
- `fullSite=true` 與每小時 03／13／23／33／43／53 分的背景續掃，會自動讀取上次 checkpoint，以至少 2.4 秒的間隔每輪檢查最多 24 頁；這是為了避開實測連續約 30 次存取後的持續逾時。未讀頁面不標成已檢查，全部完成後相同網站地圖只檢查索引，停止重複讀文章。GitHub 排程可能延遲，不能保證逐分鐘執行。

## 維護命令

```sh
node --test tests/*.test.mjs
node tools/audit-juwan-sources.mjs
node tools/build-tvbox-config.mjs --repoRoot .
node tools/seed-approved-vod.mjs --repoRoot .
gh workflow run audit-juwan-sources.yml --repo SYLONG7708/TV -f fullSite=true
```

配置封裝格式參照播放器本身的 [Decoder.java](https://github.com/FongMi/TV/blob/fongmi/catvod/src/main/java/com/github/catvod/utils/Decoder.java)。相關維護線索另見 [TVBox 聚合器](https://github.com/riowang88/tvbox-source-aggregator)、[qist 配置](https://github.com/qist/tvbox)、[淘片配置引用](https://github.com/yw88075/tvbox/blob/main/yw.json)。公開收錄與技術可讀性不代表來源長期可用或內容權利已核實。
