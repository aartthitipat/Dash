# SPEC — Dashboard การเงินและกิจวัตรประจำวัน

Status: DRAFT รออนุมัติจากผู้ใช้

## 1. เป้าหมาย / Non-goals
**เป้าหมาย:** หน้าเดียว (single page) ใช้ดูยอดเงิน, รายรับ-รายจ่าย, อ่านสลิปธนาคาร และจัดการงานประจำวัน ข้อมูลทั้งหมดอยู่ในเบราว์เซอร์ (localStorage)
**Non-goals:** ไม่มี backend/บัญชีผู้ใช้/ซิงก์ข้ามเครื่อง, ไม่มี build step, ไม่ใช้ framework, ไม่ใช้ Tailwind (ผู้ใช้กำหนด HTML+CSS+Vanilla JS เท่านั้น)

## 2. Stack
- HTML5, CSS (custom properties), Vanilla JS (classic `<script>`, ไม่ใช้ ES modules เพราะเปิดผ่าน `file://` แล้ว module ถูกบล็อก)
- Chart.js `4.4.1` ผ่าน jsDelivr CDN
- Tesseract.js `5.0.5` ผ่าน jsDelivr CDN, ภาษา `tha+eng` (โหลดโมเดลครั้งแรกจากเน็ต)
- ฟอนต์ (Google Fonts): `Outfit` (หัวข้อ/UI ละติน), `Noto Sans Thai` (ข้อความไทย), `Geist Mono` (ตัวเลขทุกตัว)
- ไอคอน: inline SVG stroke 1.5 เท่านั้น — ห้ามอีโมจิ

## 3. สถาปัตยกรรม (ไฟล์ = โมดูล, namespace กลาง `window.FM`)
| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | โครง DOM, โหลด CDN/สคริปต์ตามลำดับ |
| `css/tokens.css` | design tokens (สี/ระยะ/เงา/motion) ทั้งโหมดสว่างและมืด |
| `css/style.css` | layout + component |
| `js/store.js` | อ่าน/เขียน localStorage ปลอดภัย (try/catch), pub/sub `FM.on/emit` |
| `js/theme.js` | สลับ light/dark, จำค่า, เคารพ `prefers-color-scheme` |
| `js/balance.js` | การ์ดยอดเงิน, ตั้งยอดใหม่, บวกเพิ่ม, count-up |
| `js/chart.js` | กราฟรายรับ vs รายจ่าย 7 วัน (Chart.js), อัปเดตตามสีธีม |
| `js/slip.js` | อัปโหลดสลิป → OCR → แก้ตัวเลข → เลือกรายรับ/รายจ่าย |
| `js/tasks.js` | เพิ่ม/ติ๊ก/ลบงาน |
| `js/main.js` | เริ่มระบบ ต่อโมดูลเข้าด้วยกัน |

## 4. Data model (localStorage, prefix `fm.`)
- `fm.balance`: number (ทศนิยม ≤ 2 ตำแหน่ง, ปัดด้วย `Math.round(x*100)/100`)
- `fm.tx`: `[{id, type:"income"|"expense", amount, ts, source:"slip"|"manual"}]`
- `fm.tasks`: `[{id, text, done, ts}]`
- `fm.theme`: `"light"|"dark"` (ไม่มี = ตามระบบ)
- Event: `balance:changed`, `tx:changed`, `tasks:changed`, `theme:changed`

## 5. Flow สำคัญ
1. **ตั้งยอดใหม่**: แทนที่ `fm.balance` ด้วยค่าที่กรอก
2. **บวกเพิ่ม**: `balance += ค่าที่กรอก` (รับค่าติดลบไม่ได้ — ใช้สลิปรายจ่ายแทน) และบันทึก tx `income` `source:"manual"` (นับในกราฟ — ผู้ใช้ยืนยันแล้ว). "ตั้งยอดใหม่" ไม่สร้าง tx
2b. **ประวัติ**: แสดง tx ล่าสุด 5 รายการ (ประเภท +/−, จำนวน, เวลา, แหล่งที่มา) พร้อมปุ่มลบ; ลบ = ย้อนยอด (income ลบแล้ว `balance -= amount`, expense `+= amount`) และอัปเดตกราฟ มี empty state
3. **สลิป**: เลือกไฟล์ภาพ → พรีวิว → OCR (skeleton + progress) → แสดงยอดที่เดาได้ในช่องแก้ไขได้ → กด "รายรับ" (+balance) หรือ "รายจ่าย" (−balance) → บันทึก tx → กราฟอัปเดต
4. **Tasks**: พิมพ์ → Enter/ปุ่มเพิ่ม → ติ๊กเสร็จ (ขีดฆ่า) → ลบ (ปุ่มถังขยะ)
5. **OCR parser**: หาตัวเลขรูปแบบเงิน (`1,234.50`) ใกล้คำว่า จำนวน/จำนวนเงิน/Amount/THB/บาท; ไม่เจอ → ช่องว่างให้กรอกเอง ไม่เดาค่า

## 6. Design contract (ใช้ skills: design-taste-frontend-v1, frontend-ui-engineering, frontend-design, improve-animations)
> **แทนที่แล้ว:** design contract ปัจจุบันคือ `docs/REDESIGN-PLAN.md` §9 "DESIGN CONTRACT v2" (หลายหน้า hash routing, rail/แถบแท็บล่าง, กริดภาพรวม 4 คอลัมน์, ลิ้นชักสลิป, สีน้ำเงินเข้ม+ฟ้าอ่อน). เนื้อหาข้อ 6 ด้านล่างเป็นของรุ่นแรก (หน้าเดียว) เก็บไว้อ้างอิงเท่านั้น — ค่าสีจริงอยู่ใน `css/tokens.css`
ปรับ dials: VARIANCE 8, MOTION 6, DENSITY 4 — แปลงกฎ React/Tailwind ของ skill เป็น vanilla CSS

**แนวคิด:** "สมุดบัญชีดิจิทัล" — ตัวเลขเป็นพระเอก (Geist Mono ขนาดใหญ่) ที่เหลือเงียบ วางเป็น asymmetric 2 คอลัมน์ ไม่ใช่แถวการ์ด 3 ใบเท่ากัน

**สี (โหมดสว่าง / มืด) — accent เดียว + สีสื่อความหมายรายจ่าย**
| token | สว่าง | มืด |
|---|---|---|
| `--bg` | `#EEF1F0` (cool gray) | `#121514` |
| `--surface` | `#FAFBFA` | `#1A1E1C` |
| `--ink` | `#17201D` | `#E6ECE9` |
| `--muted` | `#5E6B66` | `#8E9A95` |
| `--line` | `#D7DEDB` | `#2A312E` |
| `--line-strong` (ขอบช่องกรอก/dropzone ≥3:1)  | `#818C87` | `#66726D` |
| `--accent` (รายรับ/ปุ่มหลัก) | `#0F7A5C` | `#3FB68B` |
| `--expense` (สื่อความหมายเท่านั้น) | `#B24A5E` | `#D8758A` |
ห้าม: ม่วง/น้ำเงินนีออน, `#000`, gradient ตัวอักษร, glow, cream+terracotta

**Layout (desktop ≥1024: สองคอลัมน์อิสระ 7/5 ไม่แชร์ความสูงแถว — ซ้าย: ยอดเงิน+กราฟ, ขวา: สลิป+งาน; มือถือใช้ `display:contents` + `order`)**
```
┌ ชื่อ + วันที่ ─────────────────────────── [สลับธีม] ┐
│ ยอดเงินปัจจุบัน                      │ อ่านสลิป          │
│ ฿ 48,260.50  (ตัวเลขใหญ่ ไม่มีกล่อง) │ [dropzone]        │
│ [ ช่องกรอก ] [ตั้งยอดใหม่] [บวกเพิ่ม] │ ผล OCR + [รับ][จ่าย]│
│──────────────── (7 คอลัมน์) ─────────│───── (5 คอลัมน์) ───│
│ กราฟ รายรับ vs รายจ่าย 7 วัน (panel)  │ งานวันนี้  3/5 ▬▬  │
│                                      │ [พิมพ์งาน][เพิ่ม]  │
│                                      │ ☐ … ☑ …  [ลบ]     │
└──────────────────────────────────────┴───────────────────┘
```
มือถือ (<768): คอลัมน์เดียว ลำดับ ยอดเงิน → สลิป → กราฟ → งาน, gutter 16px, ไม่มี horizontal scroll, ใช้ `min-height:100dvh`
Panel: รัศมี 20px, เส้น 1px `--line`, เงาบางย้อมสีพื้น — ยอดเงินหลักไม่ใส่กล่อง

**Typography:** หัวข้อ Outfit 600 + Noto Sans Thai, ตัวเลขทุกตัว Geist Mono (tabular), ตัวเลขยอดเงิน `clamp(2.5rem,6vw,4.5rem)`; ไม่ใช้ตัวพิมพ์ใหญ่ทั้งหมด/eyebrow ประดับ

**Motion (CSS transform/opacity เท่านั้น, ease `cubic-bezier(0.16,1,0.3,1)`, 150–300ms)**
- โหลดหน้า: stagger ครั้งเดียว (panel เลื่อนขึ้นเล็กน้อย + fade) — จุด "orchestrated moment" เดียว
- ยอดเงินเปลี่ยน: count-up 500ms
- ปุ่ม `:active` → `scale(0.98)`; งานใหม่ slide-in / งานที่ลบ collapse+fade; ติ๊กเสร็จ: เส้นขีดฆ่าวาด
- OCR ทำงาน: skeleton shimmer + จุดสถานะ pulse (ลูปเดียวที่ไม่ใช่ user-triggered และหยุดเมื่อเสร็จ)
- `prefers-reduced-motion`: ปิดทุกอย่างยกเว้นการเปลี่ยนสี

**States:** ทุกส่วนมี empty / loading / error (ไฟล์ไม่ใช่ภาพ, OCR ล้มเหลว/ออฟไลน์, ยอดไม่ถูกต้อง, localStorage ใช้ไม่ได้) พร้อมข้อความไทยบอกวิธีแก้
**Form:** label อยู่เหนือ input, error อยู่ใต้ input, `gap` 8px; ปุ่ม/ช่องสูง ≥44px
**A11y:** WCAG AA, focus ring ชัด, `aria-live` ที่ยอดเงินและผล OCR, ทุกปุ่มไอคอนมี `aria-label`, ไม่ใช้สีอย่างเดียวบอกรับ/จ่าย (มี +/− และคำกำกับ)

## 7. Definition of Done (MVP)
- ฟีเจอร์ทั้ง 4 ตามข้อ 5 ใช้งานได้ รีโหลดแล้วข้อมูลยังอยู่
- ธีมสว่าง/มืดสลับได้ กราฟเปลี่ยนสีตาม
- ไม่มี console error; ใช้ได้ที่ 320 / 768 / 1024 / 1440 px
- Self-check รายงานผล + สรุป Obsidian ต่อทุกส่วนที่เสร็จ

## 8. Cloud sync (Supabase, local-first)
> ส่วนนี้แทนที่ "ไม่มี backend/บัญชีผู้ใช้/ซิงก์ข้ามเครื่อง" ใน Non-goals ข้อ 1
- **ไฟล์:** `js/config.js` (`window.FM_CONFIG = {SUPABASE_URL, SUPABASE_KEY}` — คีย์ publishable สาธารณะเท่านั้น ห้าม service_role), `js/cloud.js`, `css/cloud.css`; ไลบรารี `@supabase/supabase-js@2.58.0` UMD จาก jsDelivr (SRI). ลำดับสคริปต์: โมดูลเดิม → `config.js` → supabase → `cloud.js` → `main.js` (เรียก `FM.cloud.init()` หลังโมดูลอื่น)
- **บัญชี:** Supabase Auth แบบ magic link ทางอีเมล (ไม่มีรหัสผ่าน, flow `implicit`, session เก็บที่ `fm.auth`) — ต้องเปิดผ่าน http(s); `file://` แสดงข้อความให้เปิดผ่านเว็บเซิร์ฟเวอร์. URL ที่กลับมา (`origin+pathname`) ต้องอยู่ใน Redirect URLs ของโปรเจกต์ Supabase. token ใน URL ถูกลบด้วย `history.replaceState`
- **ตาราง (RLS: เห็น/แก้ได้เฉพาะแถวของตัวเอง):** `balances(user_id pk, amount, updated_at)`, `transactions(user_id,id pk, type, amount>0, ts, source)`, `tasks(user_id,id pk, text 1..120, done, ts)`; `ts` = epoch ms เหมือนในเครื่อง
- **แหล่งข้อมูล:** Supabase = ข้อมูลจริง, localStorage = แคชออฟไลน์. โมดูลเดิมไม่ถูกแก้ ยังเขียน localStorage ตามเดิม; `cloud.js` ฟัง `balance:changed`/`tx:changed`/`tasks:changed` แล้ว push แบบ debounce 600ms และข้าม event ที่ตัวเอง emit (flag) กันวน
- **สถานะในเครื่อง:** `fm.sync = {uid, tx:[id], tasks:[id], pendingTx:[id], pendingTasks:[id], balanceDirty}` (snapshot id ที่อยู่บนคลาวด์ + การแก้ที่ยังไม่ขึ้น), `fm.balance_ts` = เวลาแก้ยอดเงินล่าสุดในเครื่อง
- **Push:** upsert เฉพาะแถวที่ pending หรือยังไม่เคยขึ้น (≤500 แถว/คำขอ), ลบแถวบนคลาวด์ที่อยู่ใน snapshot แต่หายจากเครื่อง (≤200 id/คำขอ), upsert ยอดเงินเมื่อแก้ในเครื่อง (`updated_at` = `fm.balance_ts`). แถวไม่ถูกต้อง (type/source นอก enum, amount ≤0 หรือ ≥1e12, text ว่าง/ยาวเกิน 120) ถูกข้ามและนับ ไม่ทำให้ทั้งชุดล้ม
- **Pull + merge** (ตอนเข้าสู่ระบบ, แท็บกลับมาแสดง, `online`, ปุ่ม "ซิงก์ตอนนี้", retry): รายการเงิน/งาน = union ตาม id — id ชนกันคลาวด์ชนะ ยกเว้น id ที่มีการแก้ค้างในเครื่อง; id ที่เคยซิงก์แล้วหายจากฝั่งใดฝั่งหนึ่ง = ถูกลบ. ยอดเงิน = ฝั่งที่เวลาใหม่กว่าชนะ (เท่ากัน → คลาวด์). เขียนผลด้วย `FM.set` แล้ว emit `balance:changed`/`tx:changed` + `FM.tasks.reload()` จากนั้น push ส่วนที่คลาวด์ยังไม่มี. ฟังก์ชัน merge แบบ pure: `FM.cloud._merge(local, remote, meta?)`
- **เปลี่ยนบัญชี:** ถ้า `fm.sync.uid` เป็นบัญชีอื่น ล้าง `fm.balance/tx/tasks` ก่อนรับข้อมูลบัญชีใหม่ (ไม่รวมแคชข้ามบัญชี); เข้าสู่ระบบครั้งแรก (ไม่มี uid) = รวมข้อมูลที่ใช้แบบไม่ล็อกอินขึ้นบัญชี; ออกจากระบบ = เก็บแคชไว้ หยุดซิงก์
- **ล้มเหลว/ออฟไลน์:** ไม่ทำข้อมูลในเครื่องหาย ไม่บล็อก UI; สถานะ "ซิงก์ไม่สำเร็จ" หรือ "ออฟไลน์ — จะซิงก์เมื่อออนไลน์", retry แบบ exponential backoff (2s → สูงสุด 60s) และเมื่อ `online`; หยุดเมื่อออกจากระบบ. ไม่มีไลบรารี/config → แสดง "ซิงก์ไม่พร้อมใช้งาน" แอปทำงานตามเดิม
- **UI:** ส่วนหัวข้างปุ่มธีม — ไม่ล็อกอิน: ปุ่ม "เข้าสู่ระบบเพื่อซิงก์"; ล็อกอิน: chip สถานะ (aria-live polite: ซิงก์แล้ว / กำลังซิงก์… / ออฟไลน์ / ซิงก์ไม่สำเร็จ) + อีเมลแบบปิดบางส่วน + ปุ่ม "ซิงก์ตอนนี้" + "ออกจากระบบ"; มือถือ (<768) ส่วนบัญชีขึ้นบรรทัดใหม่. Dialog เข้าสู่ระบบเป็น `<dialog>` + `showModal()` (Esc ปิด, focus คืนปุ่มเดิม)
- **ข้อจำกัด:** last-write-wins ระดับแถว/ยอดเงิน (เวลาเครื่องต่างกันมีผล), ยอดเงินไม่คำนวณจากรายการ จึงอาจไม่ตรงกับผลรวมรายการถ้าแก้พร้อมกันหลายเครื่อง, การแก้ในเครื่องขณะไลบรารีโหลดไม่ได้จะไม่ถูกนับเป็น pending (แถวใหม่ยังขึ้นตามปกติ แต่การแก้แถวเดิมแพ้คลาวด์)
