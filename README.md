# CANNON CLASH 砲台對轟

雙人對戰的砲台對轟網頁小遊戲（綫下活動用試驗項目）。純 HTML5 Canvas + 原生 JavaScript，無建置步驟、無外部依賴。

## 執行

直接用瀏覽器打開 `index.html`（`file://` 即可，所有資產皆為本地文件），或以任意靜態伺服器指向倉庫根目錄。

## 開發

- 固定步長模擬（60 Hz），以 `requestAnimationFrame` 渲染；畫布邏輯解析度 1600×900。
- 在倉庫根目錄執行 `node --test` 跑測試；測試文件放在 `tests/`。
- 瀏覽器全域命名空間為 `CC`（`CC.Loader`、`CC.Layers`）；view 模塊同時提供 CommonJS 導出供 Node 測試使用。

## 目錄結構

- `index.html` — 頁面外殼：canvas 與 `<script>` 加載順序（core → view → main）
- `src/main.js` — 入口：資產載入 + 固定步長主循環
- `src/view/loader.js` — `CC.Loader`：圖片預載，清單鍵名固定
- `src/view/layers.js` — `CC.Layers`：分層視差場景繪製
- `assets/art/` — 遊戲美術（去背 PNG）
- `tests/` — Node 測試（暫時為空）
- `art-raw/` — 本地美術工作目錄（git 忽略）
