# CANNON CLASH · 重砲對決 實現計劃

> **面向 AI 代理的工作者：** 必需子技能：使用 subagent-driven-development（推薦）或 executing-plans 逐任務實現此計劃。步驟使用複選框（`- [ ]`）語法來跟踪進度。

**目標：** 雙人砲台對轟網頁遊戲（綫下大屏+鍵盤），含單人 AI 與本地排行榜，file:// 離綫可玩。

**架構：** 邏輯與視圖分離。`src/core/*` 爲純邏輯模塊（彈道/地形/狀態機/AI/排行榜），雙環境導出（Node `module.exports` + 瀏覽器 `window.CC.*`），用 `node --test` 做單元測試；`src/view/*` 只消費 core 的輸出做渲染與輸入，以瀏覽器手驗。主循環固定步長模擬 + rAF 渲染。

**技術棧：** 原生 Canvas 2D、原生 JS（**禁用 ES module 與 fetch**，普通 `<script>` 順序加載 + `window.CC` 命名空間）、Node 內置 `node:test`、WebAudio 合成音效、localStorage（降級內存）。

**規格：** `docs/superpowers/specs/2026-11-01-cannon-clash-design.md`（論證依據，與本計劃一起讀）

## 全局約束

- 邏輯分辨率 1600×900，等比 letterbox 適配，禁止拉伸變形
- 必須 file:// 雙擊 index.html 可玩：無 CDN、無 module、無 fetch、無構建步驟
- UI 文案繁體中文；素材一律用 `assets/art/` 內已去背 PNG，缺失素材用 CSS/Canvas 佔位且接口可替換
- 數值照抄規格：HP 100；風力 ±5；回合限時 30 秒可關閉；名字 ≤6 字元 A-Z0-9；砲彈 普通20/重錘45/穿甲15/集束12×3；單局 1～3 分鐘（6～10 回合）
- 動畫全部代碼 tween，無幀動畫；音效 WebAudio 合成，必須有靜音開關
- 視差：遠/中景漂移、地形固定；地形不可破壞，彈坑爲貼花

## 審查重點（Review Focus）

1. file:// 直開時任何 module/fetch 語法都會白屏 → 任務 1 手驗 file:// 打開 console 無錯誤
2. 非 16:9 顯示器上畫面被拉伸 → 任務 12 手驗 letterbox
3. 蓄力中限時歸零 → 以當前蓄力值自動發射，狀態機不死鎖 → 任務 5 測試
4. localStorage 被禁用（部分 file:// 環境）→ 降級內存、遊戲不崩 → 任務 7 測試
5. 同回合雙方 HP 同時歸零 → 進入突然死亡分支而非報錯/死鎖 → 任務 5 測試

---

## 文件結構

```
index.html                  入口：canvas + <script> 順序加載，無 module
README.md                   現場運行說明（雙擊、全屏、靜音、鍵位）
assets/art/                 已去背 PNG（語義名，從 brainstorm content/ 拷入）
src/core/ballistics.js      彈道積分、落點、反解求解
src/core/terrain.js         地形高度場與碰撞
src/core/weapons.js         砲彈數值與集束分裂
src/core/cannon.js          砲台狀態：HP/角度/彈藥/結算
src/core/match.js           對局狀態機：輪換/限時/勝負/突然死亡/連勝
src/core/ai.js              三段難度 AI
src/core/leaderboard.js     本地排行榜（降級內存）
src/core/supply.js          補給箱
src/view/loader.js          資源清單與預載（<img>/Image，禁 fetch）
src/view/layers.js          分層繪製與視差
src/view/sprites.js         砲台組裝/砲管旋轉/砲彈繪製
src/view/effects.js         爆炸三件套粒子/彈坑貼花/上一發尾跡落點
src/view/hud.js             血條裁剪/儀表指針/風力/回合指示
src/view/input.js           鍵盤映射（左右側）
src/view/scenes.js          標題/對戰/結算場景流轉
src/view/audio.js           WebAudio 合成音效
src/main.js                 引導、主循環、letterbox 縮放
tests/*.test.js             core 模塊單元測試（node --test）
```

---

### 任務 1：倉庫骨架與資產入庫

**文件：** 創建 `index.html`、`src/main.js`、`src/view/loader.js`、`src/view/layers.js`、`README.md`、`assets/art/*`（拷貝）

- [ ] **步驟 1：git init + 目錄骨架**，`assets/art/` 從 `H:\trial-web-game\.superpowers\brainstorm\181-1793524748\content\` 拷入全部去背 PNG（保持語義文件名），並把 `art-raw/` 寫入 `.gitignore`
- [ ] **步驟 2：index.html**——`<canvas id="game">`；按依賴順序 `<script>` 加載 core→view→main；每個 core/view 文件用 `(function(root){ ... root.CC.X = X; })(window)` 模式（Node 測試的文件再附加 `if (typeof module!=='undefined') module.exports=...`）
- [ ] **步驟 3：loader.js**——`CC.Loader.load(manifest)` 返回 Promise，manifest 爲 `{key: 路徑}` 列表，用 `new Image()` 預載；清單鍵名固定：`backdrop, layerFar, layerMid, layerTerrain, baseRed, barrelRed, baseBlue, barrelBlue, shellNormal, shellHeavy, shellRivet, shellCluster, crate, keyart, logo, panelBlue, healthbarRed, gauge, leaderboard, vfxSpark, vfxFlash, vfxSmoke, crater`
- [ ] **步驟 4：main.js + layers.js**——固定步長主循環（模擬 60Hz，rAF 渲染）；`CC.Layers.draw(ctx, imgs, t)` 依序繪 backdrop（緩慢漂移 ±0.6%）、layerFar（±1.4%）、layerMid（±2.8% 反向）、layerTerrain（固定），漂移公式 `dx = A * sin(t / 周期 * 2π)`，週期 30/22/15 秒
- [ ] **步驟 5：手驗 file://**——瀏覽器直接打開 index.html：見到四層場景、console 無錯誤；node --test 空跑通
- [ ] **步驟 6：Commit** `feat: project skeleton with layered scene`

### 任務 2：彈道物理

**文件：** 創建 `src/core/ballistics.js`；測試 `tests/ballistics.test.js`

- [ ] **步驟 1：編寫失敗的測試**

```js
const B = require('../src/core/ballistics.js');
// 無風 45°：落點關於發射點對稱（水平射程 = v0²sin(2θ)/g 的數值積分近似）
// 風 +3：同參數落點 x 比無風遠 >0（順風）
// 軌跡採樣：points 首點=起點、y 先升後降、每點遞增 t
// simulate 每 dt=1/60 步進：x+=vx*dt; y+=vy*dt; vy+=G*dt; vx+=WIND_K*wind*dt
```
常量釘死：`G=900`，`V0 = power * 14`（power 0..100），`WIND_K = 6`
- [ ] **步驟 2：運行** `node --test tests/ballistics.test.js` → FAIL
- [ ] **步驟 3：實現** `CC.Ballistics.simulate(x0,y0,angleDeg,power,wind) -> {points:[{x,y}], impact:{x,y}|null}`（撞 y≥1500 停止）；`CC.Ballistics.solvePower(x0,y0,xTarget,angleDeg,wind)` 二分求 power 使落點 x 距目標 <2px，無解返回 null
- [ ] **步驟 4：運行** → PASS
- [ ] **步驟 5：Commit** `feat: ballistics simulation and solver`

### 任務 3：地形

**文件：** 創建 `src/core/terrain.js`；測試 `tests/terrain.test.js`

- [ ] **步驟 1：編寫失敗的測試**——折綫高度場釘死（對齊美術）：`(0,340)-(170,400)-(430,400)-(560,560)-(760,860)-(860,880)-(1000,860)-(1170,445)-(1430,445)-(1600,380)`；斷言：`heightAt(300)===400`、`heightAt(1300)===445`、`heightAt(800)===880`、砲彈段 `(x1,y1)->(x2,y2)` 穿越地表時 `hit(x1,y1,x2,y2)` 返回交點
- [ ] **步驟 2：運行** → FAIL
- [ ] **步驟 3：實現** `CC.Terrain.heightAt(x)`（折綫線性插值）、`CC.Terrain.hit(...)`（段-折綫相交，無交返回 null）
- [ ] **步驟 4：運行** → PASS
- [ ] **步驟 5：Commit** `feat: terrain heightfield and collision`

### 任務 4：武器與砲台

**文件：** 創建 `src/core/weapons.js`、`src/core/cannon.js`；測試 `tests/weapons.test.js`

- [ ] **步驟 1：編寫失敗的測試**

```js
const W = require('../src/core/weapons.js');
// W.LIST = { normal:{name:'普通彈',dmg:20,count:Infinity,radius:50},
//            heavy:{name:'重錘彈',dmg:45,count:2,radius:70},
//            pierce:{name:'穿甲彈',dmg:15,count:3,radius:40},
//            cluster:{name:'集束彈',dmg:12,count:1,radius:35,children:3} }（順序即輪換順序）
// 結算：爆炸點距砲台中心 < radius → 傷害 = dmg * (1 - dist/radius)（線性衰減，四捨五入）
// 集束：落地後 3 枚子彈分別落點 ±(60,90,120)px 隨機偏移，各自按 dmg12/radius35 結算
```
`CC.Cannon.create(side) -> {side:'P1'|'P2', x, y, hp:100, angle:45, power:0, ammo:{...庫存}, weapon:'normal'}`（P1 x=250 y=400，P2 x=1300 y=445，取地形平台值）；`spend/onHit/refill`
- [ ] **步驟 2：運行** → FAIL
- [ ] **步驟 3：實現**
- [ ] **步驟 4：運行** → PASS
- [ ] **步驟 5：Commit** `feat: weapons and cannon state`

### 任務 5：對局狀態機

**文件：** 創建 `src/core/match.js`；測試 `tests/match.test.js`

- [ ] **步驟 1：編寫失敗的測試**

```js
const M = require('../src/core/match.js');
// M.create({p1,p2}, {turnLimitSec:30}) -> 狀態機 {state:'AIM', turn:'P1', wind, round:1, ...}
// 狀態流: AIM --fire()--> FLIGHT --land(impact)--> RESOLVE --next()--> AIM(換邊, wind 重擲, round+1)
// 限時: AIM 狀態 tick(dt) 遞減 timer；歸零 → 自動以 power=50 fire（AIM/CHARGE 皆然）
// HP 歸零 → state:'OVER', winner; 同回合雙歸零 → state:'SUDDEN', HP 高者勝、仍同則下一炮定勝負
// winStreak: M.create 傳入 streakKey；OVER 時返回 {winner, rounds, streakDelta}
```
- [ ] **步驟 2：運行** → FAIL
- [ ] **步驟 3：實現**（風力 `wind = (Math.random()*10-5)|round`；RESOLVE 停 1.2s 由視圖驅動 next）
- [ ] **步驟 4：運行** → PASS
- [ ] **步驟 5：Commit** `feat: match state machine with turn timer and sudden death`

### 任務 6：AI

**文件：** 創建 `src/core/ai.js`；測試 `tests/ai.test.js`

- [ ] **步驟 1：編寫失敗的測試**——`CC.AI.pickShot(match, difficulty) -> {angle, power, weapon}`；常量釘死：`easy 誤差 angle±12 power±18`、`normal ±6/±9`、`hell ±1.5/±2.5`、思考延遲 1.2s；斷言：100 次 hell 取樣 |偏離完美解| 不超上限且 ≤10% 落點命中目標 15px 內；easy ≥60% 樣本偏離超 8°
- [ ] **步驟 2：運行** → FAIL
- [ ] **步驟 3：實現**——完美解 = 對 3 檔角度（35/45/55°）逐一 `Ballistics.solvePower`，取彈道最高點不撞地形者，全撞則取最接近的；誤差 `(Math.random()*2-1)*err`
- [ ] **步驟 4：運行** → PASS
- [ ] **步驟 5：Commit** `feat: three-difficulty AI with error injection`

### 任務 7：排行榜

**文件：** 創建 `src/core/leaderboard.js`；測試 `tests/leaderboard.test.js`

- [ ] **步驟 1：編寫失敗的測試**

```js
// 注入假 storage（get/set），不碰真 localStorage
// CC.Leaderboard.add('streaks', {name:'AB12', score:3}) → 返回名次；同分先到先得
// 名字規範: 大寫化、過濾非 A-Z0-9、截 6 字元、空名→'紅方'/'藍方' 由調用方傳默認
// 各榜取前 8；雙人榜一條記錄 = 搭檔組合
// storage 拋異常 → 降級內存，add/top 仍工作
```
- [ ] **步驟 2：運行** → FAIL
- [ ] **步驟 3：實現**（key `cc_leaderboards_v1`，boards: `streaks` / `hell`）
- [ ] **步驟 4：運行** → PASS
- [ ] **步驟 5：Commit** `feat: local leaderboards with storage fallback`

### 任務 8：補給箱

**文件：** 創建 `src/core/supply.js`；測試 `tests/supply.test.js`

- [ ] **步驟 1：編寫失敗的測試**——`CC.Supply.maybeSpawn(match, rng)`：`round>=3`、本場未出現過、`rng()<0.2` 三條件同時滿足 → 生成於 x∈[700,1000]、y=Terrain.heightAt(x)；砲彈爆炸半徑蓋住箱（<40px）→ 該玩家特殊彈補滿、箱消失；箱子不擋彈道
- [ ] **步驟 2：運行** → FAIL
- [ ] **步驟 3：實現**
- [ ] **步驟 4：運行** → PASS
- [ ] **步驟 5：Commit** `feat: supply crate spawn and pickup`

### 任務 9：渲染——砲台、砲彈、特效、瞄準輔助

**文件：** 創建 `src/view/sprites.js`、`src/view/effects.js`；測試無（瀏覽器手驗）

- [ ] **步驟 1：sprites.js**——`CC.Sprites.drawCannon(ctx, imgs, {x,y,angle,side})`：底座貼地、砲管圖以 `(14%,68%)`（P1）/`(86%,68%)`（P2）爲旋轉軸，角度=仰角；`drawShell(ctx, imgs, {x,y,type,angle})`
- [ ] **步驟 2：effects.js**——`CC.Effects.explosion(ctx, imgs, x, y, t)`：t∈[0,0.5s] vfx-flash 縮放 0.4→1.7 淡出 + vfx-smoke 上升放大淡出 + 6~10 枚 vfx-spark 粒子拋灑；`CC.Effects.crater(ctx, imgs, x, y)` 貼花（寬 11%）；`CC.Effects.lastShot(ctx, points, impact)`：上一發尾跡虛綫＋落點菱形標記（瞄準輔助 B 案）
- [ ] **步驟 3：手驗**——main.js 加臨時演示場景（鍵 F 觸發一發演示彈）：見到開炮→飛行→爆炸→彈坑→上一發標記全鏈路，60fps 無卡頓
- [ ] **步驟 4：Commit** `feat: sprites, effects, last-shot aim assist`

### 任務 10：渲染——HUD

**文件：** 創建 `src/view/hud.js`；手驗

- [ ] **步驟 1：實現**——`CC.HUD.draw(ctx, imgs, match)`：左右血條（healthbarRed 紅條；藍方暫用 hue-rotate 濾鏡 `ctx.filter='hue-rotate(150deg)'`，素材到位後換）、填充長度=HP%；底部中央儀表盤，代碼畫針（針角=當前仰角，蓄力時另畫力度弧）；風力：素材缺失，暫以文字「風 ◀◀/▶▶ n」繪於頂部中央；回合指示與當前武器名；限時 ≤5s 數字變紅閃
- [ ] **步驟 2：手驗**——模擬對局中：血條隨傷害縮短、儀表針隨 A/D 轉、限時警告可見
- [ ] **步驟 3：Commit** `feat: HUD with health, gauge, wind, timer`

### 任務 11：輸入、場景流轉、音效

**文件：** 創建 `src/view/input.js`、`src/view/scenes.js`、`src/view/audio.js`；修改 `src/main.js`；手驗

- [ ] **步驟 1：input.js**——P1：A/D 每幀 ±40°/s 調角度（限 0..85°）、W 輪換武器、S 按住蓄力（0→100 每 1.6s）鬆開發射；P2：←/→/↑/↓ 同構；M 靜音；ESC 回標題；F 全屏
- [ ] **步驟 2：scenes.js**——TITLE（keyart+logo+按鈕「雙人對戰/單人挑戰 AI/排行榜/限時:開」，鍵盤上下+Enter 選，單人再選 easy/normal/hell）→ BATTLE → SETTLE（勝者+本局回合數，3s 自動再來一局，連勝累計；ESC 回標題）→ BOARDS（金銀銅獎牌+前 8 名，Enter 返回）；AI 回合：延遲 1.2s 執行 `AI.pickShot`，砲管 0.8s 內 tween 到目標角度後發射
- [ ] **步驟 3：audio.js**——WebAudio：發射（噪聲脈衝）、爆炸（低頻轟）、蓄力（上升音）、點擊、限時警告嘀；`muted` 開關持久化
- [ ] **步驟 4：手驗**——完整流程：標題→雙人→打完一局→自動再來→標題→排行榜可見；AI 三難度都會開炮；靜音生效
- [ ] **步驟 5：Commit** `feat: input, scene flow, synthesized audio`

### 任務 12：整合驗收與 README

**文件：** 修改 `src/main.js`、創建 `README.md`；手驗

- [ ] **步驟 1：letterbox**——窗口非 16:9 時畫布等比置中、黑邊填充；F 全屏
- [ ] **步驟 2：對照規格第 9 節逐條走查**——雙擊即玩／10 秒首炮／結算 3 秒自動再來／拔網綫重啓不變；缺省素材（按鈕、風力、藍血條、紅面板）全部有佔位且替換點集中在 loader 清單
- [ ] **步驟 3：README**——運行方式、鍵位表、素材替換方法（`assets/art/` 同名覆蓋）、排行榜重置方法
- [ ] **步驟 4：node --test 全量** → 全 PASS
- [ ] **步驟 5：Commit** `feat: integration pass, letterbox, README`

---

## 自檢記錄

- 規格覆蓋：9 節全部映射（§3 非目標=不做清單、§4→任務11、§5→任務2-8、§6→任務1/9、§7→任務1/7/12、§8→任務1/9/10、§9→任務12）；無遺漏
- 類型一致性：`Ballistics.simulate/solvePower`、`Terrain.heightAt/hit`、`Cannon.create`、`Match.create/tick/fire/land`、`Leaderboard.add/top` 簽名跨任務一致
- 比例：計劃以簽名+斷言釘值，無函數體抄寫
