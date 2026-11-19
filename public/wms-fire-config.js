/**
 * @file wms-fire-config.js — ตั้งค่าระบบใหม่ (Firebase) ของเว็บที่ deploy
 *
 * on        สวิตช์ระบบใหม่ของหน้าสมุดสต๊อก
 *             true  = หน้าสมุดสต๊อกใช้ระบบใหม่ เข้าด้วย Google ของบริษัท
 *             false = หน้าสมุดสต๊อกใช้ Apps Script เดิม (ก่อนวันขึ้นระบบ และแผนถอยกลับ)
 *           แก้แล้ว commit ขึ้น main → GitHub Pages อัปเดตเองในไม่กี่นาที แล้วทุกเครื่องกดรีเฟรช
 *           ข้อมูลในระบบใหม่ไม่หายเมื่อปิด เปิดกลับได้ (ขั้นตอนใน docs/firebase-golive.md)
 * domain    โดเมนอีเมลบริษัท ต้องตรงกับ signedIn() ใน firebase/firestore.rules
 * firebase  web config จาก Firebase console › ⚙️ Project settings › Your apps › แอปเว็บ (</>)
 *           ไม่ใช่รหัสลับ ใครเปิดเว็บก็เห็น ความปลอดภัยอยู่ที่ Rules + ล็อกอินด้วยอีเมลบริษัทที่หัวหน้าเพิ่มชื่อไว้
 *           ห้ามใส่ service account / private key / รหัสผ่านใด ๆ ในไฟล์นี้
 *           ยังว่าง = ยังไม่สร้างโปรเจกต์ หน้าสมุดสต๊อกใช้ระบบเดิมแม้ on เป็น true
 *
 * เฉพาะเครื่องเดียว ไม่ต้องแก้ไฟล์นี้ (ต่อท้ายลิงก์หน้าสมุดสต๊อก)
 *   ?fire=off    เครื่องนี้ใช้ระบบเดิม จนกว่าจะเปิด ?fire=on
 *   ?fire=live   แท็บนี้เปิดระบบใหม่แม้สวิตช์ปิด เฉพาะหัวหน้า (ถอยกลับ: คัดลอกแถวไปชีตเดิม · ก่อนเปิดกลับ: ลงแถวที่ขาด)
 *   ?fire=demo   โหมดซ้อม ข้อมูลสมมติเก็บในเครื่องนี้ ไม่แตะฐานจริง
 * dev server (localhost) ไม่ต่อ Firebase จริงเด็ดขาด ใช้ ?fire=dev หรือ ?fire=demo
 */
window.WMS_FIRE_CONFIG = {
  on: false,
  domain: 'lunio.co.th',
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    appId: '',
  },
};
