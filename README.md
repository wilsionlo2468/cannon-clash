# CANNON CLASH 砲台對轟

雙人對戰的砲台對轟網頁小遊戲（綫下活動用試驗項目）。純 HTML5 Canvas + 原生 JavaScript，無建置步驟、無外部依賴、完全離綫可玩。

## 執行

直接用瀏覽器雙擊打開 `index.html`（`file://` 即可，所有資產皆為本地相對路徑文件，斷網可玩），或以任意靜態伺服器指向倉庫根目錄，例如：

```
python -m http.server 8080   # 然後瀏覽器打開 http://localhost:8080/index.html
```

- 畫面邏輯解析度 1600×900（16:9），窗口非 16:9 時等比縮放置中、黑邊填充，1080p 全屏可放大鋪滿。
- 按 `F` 進出全屏（活動大屏建議 1920×1080 全屏）。

## 鍵位表

| 按鍵 | P1 | P2 |
| --- | --- | --- |
| 仰角 | `A` / `D`（40°/秒，0–85°） | `←` / `→` |
| 切換武器 | `W` | `↑` |
| 蓄力發射（按住蓄力，鬆開發射） | `S`（按住） | `↓`（按住） |

全局按鍵：`M` 靜音開關、`F` 全屏、`ESC` 返回標題。標題畫面 `Tab` 切換輸入格、`Backspace` 刪字、上下鍵 + `Enter` 選單；結算畫面 `Enter` 立即再來一局、`ESC` 回標題。名字輸入為 A–Z/0–9（≤6 字），**不含 `M`/`F`**——這兩鍵在標題畫面仍是全域靜音/全屏鍵。

武器：普通彈（∞）、重錘彈 ×2、穿甲彈 ×3、集束彈 ×1（炸裂 3 發子彈）。

## 素材替換

美術全部位於 `assets/art/`，清單集中在 `src/view/loader.js` 的 `CC.Loader.MANIFEST`。替換方法：用**同名文件**直接覆蓋 `assets/art/` 對應 PNG 即可，無需改代碼。注意保持去背（透明背景）PNG 與相近尺寸。

## 排行榜重置

排行榜（連勝榜、地獄通關榜）與靜音標記存在瀏覽器 `localStorage`。重置方法：打開瀏覽器開發者工具控制枱執行

```js
localStorage.removeItem('cc_leaderboards_v1');   // 清空排行榜
localStorage.removeItem('cc_muted_v1');          // （可選）恢復默認音效設置
```

然後刷新頁面即歸零。注意：`file://` 與 `http://localhost` 兩種打開方式的 localStorage 相互獨立，分別重置。

## 開發

- 固定步長模擬（60 Hz），以 `requestAnimationFrame` 渲染。
- 在倉庫根目錄執行 `node --test` 跑測試；測試文件放在 `tests/`。
- 瀏覽器全域命名空間為 `CC`；view 模塊同時提供 CommonJS 導出供 Node 測試使用。

## 目錄結構

- `index.html` — 頁面外殼：canvas、letterbox 縮放與 `<script>` 加載順序（core → view → main）
- `src/main.js` — 入口：資產載入 + 固定步長主循環
- `src/core/` — 遊戲核心邏輯（彈道、地形、武器、砲台、對局、AI、排行榜、補給）
- `src/view/` — 渲染與交互（loader、layers、sprites、effects、hud、input、scenes、audio）
- `assets/art/` — 遊戲美術（去背 PNG，同名覆蓋即替換）
- `tests/` — Node 測試
- `art-raw/` — 本地美術工作目錄（git 忽略）
