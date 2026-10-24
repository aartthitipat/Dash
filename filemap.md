index.html — โครง DOM (shell: rail, ส่วนหัว, หน้า data-page, dialog สลิป/ปรับยอด, ช่องว่างกริดภาพรวม) + ลำดับโหลดสคริปต์/CDN
css/tokens.css — design tokens สว่าง(ฟ้า-ขาว)/มืด(navy) v2 + alias ชื่อเดิม (แก้สี/ระยะ/motion ที่นี่)
css/style.css — reset, การ์ด .panel, ปุ่ม, ช่องกรอก, focus, ปุ่มธีม
css/shell.css — rail/แถบแท็บล่าง, ส่วนหัวของหน้า, หน้า+transition, กริดภาพรวม (slot), ลิ้นชัก/กล่องโต้ตอบ, แสงพื้นหลัง
js/router.js — hash routing #/ #/tx #/tasks (FM.router) + เปิด/ปิดลิ้นชักสลิป/กล่องปรับยอด (FM.ui)
js/categories.js — หมวดหมู่รายรับ/รายจ่าย (FM.cats) ข้อมูลล้วน
js/store.js — localStorage + pub/sub (`FM.on/emit`)
js/theme.js — สลับธีม
js/balance.js — ฟอร์มกล่องปรับยอด (ตั้งยอดใหม่/บวกเพิ่ม+หมวดรายรับ, บรรทัดยอดปัจจุบัน)
js/kpi.js — การ์ด KPI 4 ใบหน้าภาพรวม (ยอดเงิน, รายรับ/รายจ่ายเดือนนี้ ▲▼%, งานวันนี้)
js/txlist.js — หน้า #/tx: รายการทั้งหมด, ตัวกรอง (fm.txFilter), ลบ=ย้อนยอด, ปุ่มบวกเพิ่ม
js/charts.js — ชุดกราฟหน้าภาพรวม (แท่ง 7/30 วัน, แท่งนอนรายจ่ายตามหมวด, โดนัทรายรับตามหมวด, พื้นที่สุทธิสะสม) + รายการล่าสุด; ช่วงเวลาเก็บใน fm.chartRange, event 'chart:range' (FM.charts)
js/slip.js — อ่านสลิป OCR
js/tasks.js — งานประจำวัน
js/main.js — จุดเริ่มระบบ
docs/SPEC.md — สเปกและ design contract
docs/PLAN.md — แผนงานแบ่ง task
css/balance.css — สไตล์ฟอร์มปรับยอดเงินในกล่องโต้ตอบ
css/kpi.css — สไตล์การ์ด KPI
css/txlist.css — สไตล์หน้ารายการ
css/charts.css — สไตล์ชุดกราฟ, segmented control ช่วงเวลา, legend, ตารางซ่อนสำหรับ screen reader, รายการล่าสุด
css/slip.css — สไตล์ระบบอ่านสลิป
css/tasks.css — สไตล์งานประจำวัน
js/config.js — ค่าเชื่อมต่อ Supabase (URL + คีย์ publishable สาธารณะ)
js/cloud.js — ซิงก์ Supabase แบบ local-first: เข้าสู่ระบบ magic link, push/pull/merge, FM.cloud
css/cloud.css — สไตล์ปุ่มบัญชี/สถานะซิงก์ในส่วนหัว + dialog เข้าสู่ระบบ
