# CLAUDE.md

Dashboard การเงิน+กิจวัตร (Thai UI). Stack: HTML + CSS + Vanilla JS (classic scripts, ไม่มี build). CDN: Chart.js 4.4.1, Tesseract.js 5.0.5.

Run: เปิด `index.html` ในเบราว์เซอร์ (หรือ `npx serve .`). ไม่มี test/lint command.

กฎ:
- แก้เฉพาะจุดที่ได้รับมอบหมาย ห้ามเขียนไฟล์ทั้งไฟล์ใหม่ (กัน regress บั๊กที่แก้แล้ว)
- ห้ามใช้ ES modules / framework / Tailwind; โมดูลคุยกันผ่าน `window.FM` (store + events)
- ห้ามอีโมจิ, `#000`, ฟอนต์ Inter, ม่วง/นีออน, ข้อความไทยใน UI เท่านั้น
- สี/ระยะ/motion ต้องมาจาก `css/tokens.css` ห้าม hardcode; animate เฉพาะ `transform`/`opacity`; เคารพ `prefers-reduced-motion`
- ตัวเลขทุกตัวใช้ Geist Mono; ไอคอน inline SVG stroke 1.5
- localStorage ครอบ try/catch เสมอ (prefix `fm.`)

อ้างอิง: `docs/SPEC.md`, `docs/PLAN.md`, `filemap.md`
