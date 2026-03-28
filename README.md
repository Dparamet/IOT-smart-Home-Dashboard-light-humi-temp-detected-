# Smart IoT Dashboard 🌐

แดชบอร์ด IoT สำหรับแสดงผลข้อมูลเซนเซอร์และควบคุมรีเลย์แบบ real-time ด้วย Firebase Realtime Database พร้อม UI สมัยใหม่, ระบบ log, และสถานะการเชื่อมต่อที่ชัดเจน

---

## ✨ ฟีเจอร์หลัก

- 🔐 Login ด้วย Firebase Authentication (Email/Password)
- 📊 กราฟหลักแสดง 3 ค่า: อุณหภูมิ / ความชื้น / ความสว่าง (dual-axis)
- 📈 Dashboard แยกรายค่า (mini trend + min/avg/max)
- 🎛️ ควบคุม Relay เสถียรขึ้น (delay 1 วินาที + retry + timeout)
- 🟢 สถานะการเชื่อมต่อชัดเจน: `online / connecting / stale / offline`
- 🧾 System Log แบบแยกระดับ `info / warn / error`
- ⚙️ Smart Auto Mode พร้อมตั้งค่าอุณหภูมิพัดลม
- 🕒 แสดงเวลาปัจจุบันบนหน้า dashboard แบบ real-time
- 📱 Responsive UI รองรับ Desktop/Tablet/Mobile

---

## 🧱 Tech Stack

### Frontend
- **HTML5**
- **CSS3** (Custom Properties, Animations, Grid/Flex)
- **Vanilla JavaScript (ES Module)**

### Services
- **Firebase App** `10.8.1`
- **Firebase Authentication** `10.8.1`
- **Firebase Realtime Database** `10.8.1`

### Visualization
- **Chart.js** (CDN)

---

## 📁 โครงสร้างไฟล์ (เวอร์ชันล่าสุด)

```text
DAY1/
├── index.html      # โครง HTML
├── styles.css      # สไตล์ทั้งหมด
├── app.js          # Logic ทั้งหมด (Firebase + UI + Chart)
├── README.md
└── sketch_mar28a/
```

---

## 🧭 การทำงานโดยย่อ

1. หน้าเว็บตรวจว่าเคยตั้งค่า Firebase หรือยัง (`localStorage: iot_firebase_config`)
2. ถ้ายังไม่ตั้งค่า → แสดงหน้า Setup ให้กรอก `apiKey` และ `databaseURL`
3. Login สำเร็จ → เริ่ม listeners ของเซนเซอร์/รีเลย์/ตั้งค่า/ประวัติ
4. อัปเดตค่าหน้าจอ + กราฟหลัก + mini dashboard รายค่าแบบ real-time
5. ตรวจสถานะการเชื่อมต่อทุกช่วงเวลา (heartbeat) และแสดงสถานะแบบชัดเจน

---

## 🔌 สถานะการเชื่อมต่อ

ระบบแยกสถานะเป็น 4 แบบ:

- **Online (Live)**: เชื่อมต่อและมีข้อมูลเข้า
- **Connecting**: เชื่อมต่อฐานข้อมูลแล้ว แต่ยังรอข้อมูลจากอุปกรณ์
- **Stale Data**: มีการเชื่อมต่อ แต่ข้อมูลไม่อัปเดตเกินช่วงที่กำหนด
- **Offline**: Firebase disconnected

มีข้อความสถานะย่อย (status meta) แสดงเหตุผลเพิ่มเติมใต้ badge

---

## 🎛️ Relay Control (Stability)

เมื่อสั่งรีเลย์จะมี:

- **ดีเลย์ 1 วินาที** ก่อนส่งคำสั่ง
- **Retry อัตโนมัติ** เมื่อส่งไม่สำเร็จ
- **Timeout protection** ต่อคำสั่ง
- **Disable สวิตช์ชั่วคราว** ขณะประมวลผล
- **Revert state** หากส่งคำสั่งไม่สำเร็จหลังลองครบ

---

## 🚀 วิธีติดตั้งและรัน

### 1) เตรียม Firebase

- สร้าง Firebase Project
- เปิดใช้งาน **Authentication (Email/Password)**
- เปิดใช้งาน **Realtime Database**

### 2) เตรียม Database Structure

ตัวอย่างโครงสร้างข้อมูลที่ใช้:

```json
{
  "iot_system": {
    "sensors": {
      "temperature": 25.5,
      "humidity": 65,
      "light_percent": 80,
      "timestamp": 1711612800000
    },
    "controls": {
      "relay_1": false,
      "relay_2": false
    },
    "settings": {
      "auto_mode": false,
      "auto_fan_temp": 30.0
    },
    "history": {
      "entry_1": {
        "temperature": 25.5,
        "humidity": 65,
        "light_percent": 80,
        "timestamp": 1711612800000
      }
    }
  }
}
```

### 3) เปิดเว็บ

แนะนำให้เปิดผ่าน local server (เช่น Live Server ใน VS Code)

### 4) ตั้งค่า Firebase ในหน้า Setup

เมื่อเข้าเว็บครั้งแรก จะมีฟอร์มให้กรอก:
- `Firebase API Key`
- `Firebase Database URL`

แล้วกด Save ระบบจะเก็บลง `localStorage` และ reload อัตโนมัติ

---

## 🔐 ตัวอย่าง Security Rules (เริ่มต้น)

```json
{
  "rules": {
    "iot_system": {
      ".read": "auth != null",
      ".write": "auth != null"
    }
  }
}
```

> ปรับกฎให้เหมาะกับ production ตามสิทธิ์ผู้ใช้จริง

---

## 🧪 Troubleshooting

### เข้าสู่ระบบไม่ได้
- ตรวจว่าเปิด Email/Password ใน Firebase Auth แล้ว
- เช็ก email/password ให้ถูกต้อง

### กราฟไม่ขึ้น
- ตรวจว่ามีข้อมูลใน `iot_system/history`
- ตรวจว่าโหลด Chart.js สำเร็จ

### สถานะค้างที่ Connecting
- ตรวจว่ามีข้อมูลใน `iot_system/sensors`
- ตรวจเวลา `timestamp` หรือการส่งข้อมูลจากบอร์ด

### Relay กดแล้วไม่เปลี่ยน
- เช็ก rules ว่าอนุญาต write ที่ `iot_system/controls`
- ดูข้อความใน System Log เพื่อหา error ที่แท้จริง

---

## 🛠️ Notes

- โปรเจกต์นี้เป็น **frontend + Firebase direct integration**
- ไม่มี backend server แยก
- โค้ดแยกไฟล์เรียบร้อยเพื่อดูแลง่าย (`index.html`, `styles.css`, `app.js`)

---

## 🙌 Credits

- Firebase
- Chart.js
- Google Fonts (Sarabun)

---

Updated: March 28, 2026
