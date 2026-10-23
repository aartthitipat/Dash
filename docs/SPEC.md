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
| `--accent` (รายรับ/ปุ่มหลัก) | `#0F7A5C` | `#3FB68B` |
| `--expense` (สื่อความหมายเท่านั้น) | `#B24A5E` | `#D8758A` |
ห้าม: ม่วง/น้ำเงินนีออน, `#000`, gradient ตัวอักษร, glow, cream+terracotta

**Layout (desktop ≥1024, กริด 12 คอลัมน์ ไม่สมมาตร)**
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
