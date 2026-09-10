# 影視雲端自動更新與修復

2026-09-10 修正：舊版直播資料更新成功後，仍會因 GitHub Pages 約 3.56 GB 的部署包超過 1 GB 上限而逾時。新版 Pages 只发布網頁、必要目錄和清單，設 100 MiB 硬上限；大型索引完整保留在 `gh-pages` 資料分支，瀏覽器按需讀取固定 commit 的原始檔案。網址與已安裝 APK 的來源設定維持相容。

- `update-youtube-live.yml`：每 3 小時更新直播；無 cookies 時維持公開頁面／嵌入播放備援；更新後共用輕量部署與線上驗證。
- `update-lunatv-vod.yml`：每 6 小時檢查每日更新窗口；失敗時自修可直接觸發重建，不受每日窗口阻擋；保留完整目錄覆蓋保護與最後有效資料。
- `deploy-oktv-pages.yml`：只下載必要檔案；目錄及大型索引鎖定同一資料 commit；檢查總量、直播陣列、CSP 與包大小；部署第一次失敗後等待 30 秒重試，完成後檢查實際上線版本及每個来源索引。
- `oktv-self-heal.yml`：每小時與相關工作失敗後執行；區分來源重建、部署與程式完整性驗證，重新執行主分支最新版。首次失敗立即可重試，多次失敗依次延後 15／60／360 分鐘，之後持續自動檢查；已解決的歷史錯誤不會永久封鎖更新。
- `check-public-freshness.yml`：每 3 小時呼叫同一自修流程，共用防重複機制，不另行無條件派送工作。

已在執行／排隊的更新不重複啟動；只有部署失敗時優先重新部署。恢復通知寫在 Actions summary 與保留 14 天的 `oktv-recovery-*`／`pages-verification-*` artifacts。`repair-dispatched` 代表已派送修復，不代表服務已恢復；須以後續部署驗證與公開健康報告確認。

外部來源關站、登入失效、YouTube 地區或存取限制會保留最後有效資料及可用備援，後續排程再重試；不會將外站無法回應寫成已成功更新。系統不會自行產生未知問題的程式修補，也不會關閉 GitHub 的失敗通知來掩蓋錯誤。

第一次啟用需將倉庫 Pages 的 publishing source 改為 GitHub Actions，並允許 `main` 分支部署到 `github-pages` environment；這是一次性設定，後續更新由雲端完成。本次實施者會完成並驗證此設定。

開發驗證：`node --test tests/*.test.mjs`、`actionlint`、兩個 `tests/*.integration.ps1`，以及部署後手機瀏覽器搜尋與資料讀取檢查。`docs/data/deployment-state.json` 記錄實際網站資料／程式版本與部署包位元組數。
