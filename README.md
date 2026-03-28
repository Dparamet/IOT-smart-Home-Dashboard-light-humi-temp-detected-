# Smart IoT Dashboard 🌐📊

ระบบแดชบอร์ด IoT ที่มีการควบคุมอุปกรณ์ real-time พร้อมการแสดงผลข้อมูล sensor และการบันทึก log ทั้งหมดในเวบเพจเดียว

## ✨ Features

- 🔐 **ระบบ Authentication**: Firebase Authentication พร้อม Email/Password
- 📈 **Multi-Metric Chart**: แสดง Temperature (°C), Humidity (%), และความสว่าง (%) พร้อม Dual-axis
- 🎛️ **Stable Relay Control**: ควบคุม Relay 1 & 2 พร้อม Retry Logic และ Timeout Protection
- 📝 **System Logging**: บันทึก log ทุกการทำงาน (Auth, Control Changes, Sync Status) พร้อม Color-coded Severity
- 🟢 **Real-Time Connection Status**: หลอดไฟเชื่อมต่อแบบ real-time (Online/Offline/Connecting) อัดเฟท 300ms
- ⚙️ **Auto-Control Settings**: ตั้งค่า Temperature Threshold เพื่อให้พัดลมเปิด/ปิดอัตโนมัติ
- 📊 **Responsive Design**: ใช้งานได้บน Desktop/Tablet/Mobile
- 🎨 **Professional UI**: Minimal Design ด้วย Smooth Animations

---

## 🛠️ Tech Stack

### Frontend
| Technology | Purpose |
|-----------|---------|
| **HTML5** | Structure & Semantic Markup |
| **CSS3** | Styling + Keyframe Animations + CSS Variables |
| **Vanilla JavaScript (ES Modules)** | Logic, ไม่ใช้ Framework |

### Backend & Services
| Service | Version | Purpose |
|---------|---------|---------|
| **Firebase Realtime Database** | v10.8.1 | Real-time data sync |
| **Firebase Authentication** | v10.8.1 | User login/logout |
| **Firebase App** | v10.8.1 | Initialization |

### Charting
| Library | Version | Purpose |
|---------|---------|---------|
| **Chart.js** | Latest (CDN) | Multi-dataset line chart + Dual Y-axes |

### Fonts & UI
| Resource | Purpose |
|----------|---------|
| **Google Fonts (Sarabun)** | Thai typography - 300, 400, 500, 700 weights |
| **CSS Grid & Flexbox** | Responsive layout |

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────┐
│         BROWSER (index.html)            │
├─────────────────────────────────────────┤
│  ┌──────────────────────────────────┐   │
│  │  UI Layer (HTML + CSS)           │   │
│  │  - Header (Status Badge)         │   │
│  │  - Sensor Cards (Temp/Humid/Br)  │   │
│  │  - Chart Container               │   │
│  │  - Control Panel (Relay Switches)│   │
│  │  - System Log Panel              │   │
│  └──────────────────────────────────┘   │
│              ↓ Events ↓                  │
│  ┌──────────────────────────────────┐   │
│  │  JavaScript Logic Layer          │   │
│  │  - Auth Handler                  │   │
│  │  - Real-time Listeners           │   │
│  │  - Relay Control + Retry Logic   │   │
│  │  - Heartbeat Monitor (300ms)     │   │
│  │  - Log System (Batch Render)     │   │
│  └──────────────────────────────────┘   │
└─────────────────┬───────────────────────┘
                  │ Firebase SDK (v10.8.1)
         ┌────────▼────────┐
         │  Firebase Cloud │
         ├─────────────────┤
         │ Realtime DB:    │
         │ - iot_system/   │
         │   ├── sensors   │
         │   ├── controls  │
         │   ├── settings  │
         │   └── history   │
         │                 │
         │ Authentication: │
         │ - User Auth     │
         └─────────────────┘
```

### Data Flow

**Reading Sensors:**
```
Firebase (iot_system/sensors) 
  → Real-time Listener 
  → Update Sensor Cards + Chart 
  → Pulse Animation 
  → Update lastSyncTime 
  → Sync Status → Online
```

**Controlling Relay:**
```
User Clicks Checkbox 
  → Check relayPending Lock 
  → Disable + request user retry 
  → syncRelayWithRetry() 
      ├─ Attempt 1 (1s timeout)
      ├─ Attempt 2 (1.5s timeout)
      └─ Attempt 3 (2.25s timeout)
  → Update Firebase 
  → Log Result (confirm/error) 
  → Enable + Unlock
```

**Connection Monitoring:**
```
Heartbeat Timer (every 300ms) 
  → Check: now - lastSyncTime > 8000ms? 
  → Update Status Badge (online/offline/connecting) 
  → Only update DOM on state change
```

---

## 🚀 Installation

### Prerequisites
- **Modern web browser** (Chrome, Firefox, Safari, Edge)
- **Firebase Project** (Google Cloud)
- **Internet connection** (for Firebase + Google Fonts)

### Step 1: Firebase Setup

1. ไปที่ [Firebase Console](https://console.firebase.google.com/)
2. สร้าง Project ใหม่ หรือใช้ Project ที่มีอยู่
3. Enable **Realtime Database**:
   - Goto Realtime Database → Create Database
   - Choose Location (Bangkok recommended for Thailand)
   - Start in Test Mode (หรือ Production Mode + Custom Security Rules)

4. Enable **Authentication**:
   - Goto Authentication → Sign-in method
   - Enable Email/Password
   - (Optional) Add Admin Users

5. **Get Firebase Config**:
   - Goto Project Settings (gear icon)
   - Select Web App
   - Copy Firebase Config object

### Step 2: Update Configuration

แก้ไข `index.html` ที่ section `Firebase Initialization`:

```javascript
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### Step 3: Setup Database Structure

ใน Firebase Realtime Database สร้าง structure:

```json
{
  "iot_system": {
    "sensors": {
      "temperature": 25.5,
      "humidity": 65,
      "brightness": 80,
      "timestamp": 1711612800000
    },
    "controls": {
      "relay_1": false,
      "relay_2": false
    },
    "settings": {
      "auto_mode": false,
      "fan_temp_threshold": 30.0
    },
    "history": {
      "entry_1": { "temperature": 25.5, "humidity": 65, "brightness": 80, "timestamp": 1711612800000 },
      "entry_2": { "temperature": 26.0, "humidity": 64, "brightness": 85, "timestamp": 1711612860000 }
    }
  }
}
```

### Step 4: Security Rules (Optional)

ถ้าใช้ Production Mode เพิ่ม Security Rules:

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

### Step 5: Serve the File

**Option A: Local File**
```bash
# เปิด index.html ใน Browser ตรงๆ
# ⚠️ รับฟรอรม API ของ Firebase ต้องใช้ HTTPS หรือ localhost
```

**Option B: Live Server (Recommended)**
```bash
# ใช้ VS Code Extension: Live Server
# Right-click index.html → Open with Live Server
```

**Option C: Simple HTTP Server**
```bash
# Python 3
python -m http.server 8000

# Node.js
npx http-server

# Then open: http://localhost:8000
```

---

## 📖 Usage

### 1. **Login**
- ป้อน Email + Password
- Firebase จะ Authenticate
- หาก User ไม่มี → กดปุ่ม "Sign Up" เพื่อสมัคร

### 2. **Monitor Sensors**
- หน้าหลักแสดง Temperature, Humidity, Brightness (real-time)
- Chart อัปเดท 260ms เมื่อมีข้อมูลใหม่
- Pulse animation ปรากฏเมื่อค่าเปลี่ยน

### 3. **Control Relay**
- ปิด/เปิด **Relay 1 (หลอดไฟ)** หรือ **Relay 2 (พัดลม)**
- สวิตช์จะ disable ขณะซิงค์ → ป้องกัน double-click
- หาก Firebase ไม่ตอบ → retry อัตโนมัติ 3 ครั้ง
- ถ้ายังสูญเสีย → revert สถานะ + log error

### 4. **Auto-Control Settings**
- เปิด Auto-Mode checkbox
- ตั้ง Temperature Threshold (เช่น 30°C)
- ถ้า Temp ≥ Threshold → Relay 2 ON (พัดลม)
- ถ้า Temp < Threshold → Relay 2 OFF
- ตั้งค่าจะ save ไปยัง Firebase

### 5. **Monitor Connection & Logs**
- **Status Badge** ด้านบน:
  - 🟢 Green = Online
  - 🔴 Red = Offline (>8 วินาที)
  - 🟡 Yellow = Connecting (initializing)
- **System Log** ด้านล่าง:
  - Info (blue) = SuccessFul actions
  - Warn (gold) = Retries, Minor issues
  - Error (red) = Failed operations
  - ปุ่ม "ล้าง Log" = เคลียร์ทั้งหมด

---

## 🔧 Key Functions Reference

### Authentication
```javascript
signUp(email, password)     // สมัครสมาชิก
login(email, password)      // เข้าสู่ระบบ
logout()                    // ออกจากระบบ
```

### IoT Control
```javascript
syncRelayWithRetry(relayId, state, retries, delayMs)
// ควบคุม Relay พร้อม Retry Logic
```

### Monitoring
```javascript
enqueueLog(level, message)  // Queue log entry
flushLogs()                 // Batch render logs
formatSensorValue(val, digits) // Safe formatting
```

### Connection
```javascript
// Heartbeat Monitor (300ms interval)
// Tracks: Online / Offline / Connecting
```

---

## 📁 File Structure

```
DAY1/
├── index.html              # Main file (all-in-one)
│   ├── <head>             # Meta, Fonts, Styles
│   ├── <style>            # CSS + Animations
│   ├── <body>             # HTML Structure
│   │   ├── Setup Container (Firebase Config Form)
│   │   ├── Login Container (Auth UI)
│   │   └── App Container (Dashboard)
│   │       ├── Header (Status)
│   │       ├── Sensor Cards
│   │       ├── Chart
│   │       ├── Controls
│   │       └── Log Panel
│   └── <script>           # JavaScript Logic
│       ├── Firebase Init
│       ├── Auth Handlers
│       ├── Real-time Listeners
│       ├── UI Handlers
│       └── Utility Functions
└── README.md              # This file
```

---

## 🎨 UI/UX Highlights

### Colors
| Color | Purpose |
|-------|---------|
| `#0f141b` | Background Main |
| `#161d27` | Card Background |
| `#8cc4ff` | Accent (Blue) |
| `#4fd08f` | Success (Green) |
| `#ff7a7a` | Danger (Red) |
| `#ffd166` | Connecting (Gold) |

### Animations
- **Pulse (Dots)**: 1s - 2s infinite (Connection indicator)
- **Fade-In (Cards)**: 320ms (Page load)
- **Pulse Value**: 400ms (Sensor update)
- **Log Entry**: 220ms fade-up (New logs)
- **Relay Syncing**: 800ms pulse (During sync)
- **Chart Update**: 260ms easing (Data change)

---

## ⚡ Performance Notes

- **Log Limit**: 140 entries max (auto-scroll)
- **Batch Rendering**: `requestAnimationFrame` (smooth 60fps)
- **Heartbeat**: 300ms interval (3-4 updates/sec)
- **Offline Timeout**: 8 seconds
- **Relay Sync Timeout**: 5 seconds per attempt
- **Chart Animation**: Disabled during rapid syncs (prevent jank)

---

## 🐛 Troubleshooting

### **Chart shows NaN labels**
- ✅ Fixed with `normalizeTimestamp()` + `formatTimeLabel()`
- Check Firebase history entries have valid timestamp fields

### **Relay doesn't respond**
- Check if Firebase permissions allow write access
- Verify `iot_system/controls` structure exists
- See System Log for error details

### **Status Badge stuck on "Connecting"**
- Check network connection
- Verify Firebase Database Rules allow read/write
- Clear browser cache + reload

### **Logs not appearing**
- Check if `toggle-log-panel` button was clicked
- Verify logs haven't exceeded 140 limit (auto-old removes)
- Browser console should show errors

### **Chart not updating**
- Verify Firebase `history` path has data
- Check if sensor listener is active (see System Log)
- Ensure Chart.js CDN is loaded (browser console check)

---

## 📝 Future Enhancements

- [ ] Add data export (CSV/JSON)
- [ ] Implement user role-based access (Admin/User/View-only)
- [ ] Add SMS/Email alerts for threshold breaches
- [ ] Mobile app version (React Native)
- [ ] Sensor calibration UI
- [ ] Data history filtering (by date range)
- [ ] Dark mode toggle

---

## 📄 License

This project is for educational purposes. Use freely for learning IoT + Firebase.

---

## 🙏 Credits

- **Firebase**: Real-time database & authentication
- **Chart.js**: Data visualization
- **Google Fonts**: Sarabun Thai typography

---

## 📞 Support

For issues or questions:
1. Check System Log (panel ด้านล่าง) for error messages
2. Open browser Developer Console (F12) for detailed errors
3. Verify Firebase configuration in Setup page

---

**Happy IoTing! 🚀**

Created: March 28, 2026
Last Updated: March 28, 2026
