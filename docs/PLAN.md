# PLAN

อ้างอิง `docs/SPEC.md` ทุก task | แก้เฉพาะไฟล์ที่ระบุ ห้ามเขียนไฟล์อื่นใหม่ทั้งไฟล์ | อัปเดต `filemap.md` ถ้าเพิ่ม/ย้ายไฟล์

| # | Task | Tier | ขึ้นกับ | ไฟล์ | ตรวจสอบ |
|---|---|---|---|---|---|
| 1 | Scaffold: `index.html`, `css/tokens.css`, `css/style.css` (layout+panel เปล่า), `js/store.js`, `js/theme.js`, `js/main.js`, toggle ธีม | Medium | — | ทั้งหมดใน SPEC §3 (โมดูลอื่นเป็น stub) | เปิดหน้า ไม่มี console error, สลับธีมแล้วรีโหลดค่าอยู่, layout ถูกที่ 320/768/1024/1440 |
| 2 | Balance: การ์ดยอดเงิน, ตั้งยอดใหม่/บวกเพิ่ม (บวกเพิ่ม=tx income manual), validate, count-up, ประวัติ 5 รายการล่าสุด+ปุ่มลบย้อนยอด (SPEC §5 ข้อ 2, 2b), localStorage | Medium | 1 | `js/balance.js`, ส่วน balance/history ใน CSS | กรอกค่าแล้วรีโหลดยอดคงอยู่, ค่าไม่ถูกต้องขึ้น error ใต้ช่อง, ลบรายการแล้วยอดย้อนถูก |
| 3 | Tasks: เพิ่ม/ติ๊ก/ลบ, progress, empty state, localStorage | Medium | 1 | `js/tasks.js`, CSS tasks | เพิ่ม/ติ๊ก/ลบ/รีโหลดครบ, Enter เพิ่มงานได้ |
| 4 | Chart: Chart.js 7 วัน, อ่านสีจาก CSS vars, อัปเดตเมื่อ `tx:changed`/`theme:changed`, empty state | Medium | 1 (+2 สำหรับข้อมูลจริง) | `js/chart.js` | ใส่ tx ทดสอบแล้วกราฟถูก, สลับธีมสีเปลี่ยน |
| 5 | Slip OCR: dropzone/ปุ่มอัปโหลด, พรีวิว, Tesseract tha+eng, parser ยอดเงิน, ช่องแก้ไข, ปุ่มรายรับ/รายจ่าย → balance+tx, error ทุกกรณี | Careful | 2 | `js/slip.js`, CSS slip | สลิปตัวอย่าง/ภาพข้อความ→ได้ยอด, ไฟล์ผิดประเภท/ออฟไลน์→error, ยืนยันแล้วยอด+กราฟเปลี่ยน |
| 6 | Polish: motion ตาม SPEC §6, reduced-motion, a11y, responsive QA | Medium | 2–5 | CSS/JS ตามจุดที่ระบุจาก review | ผ่าน checklist; orchestrator รัน `improve-animations` audit (read-only) แล้วเลือกแก้ |

Task 2, 3 ขนานกันได้หลัง 1 (คนละไฟล์) | 4 ทำหลัง 2 | 5 หลัง 2
