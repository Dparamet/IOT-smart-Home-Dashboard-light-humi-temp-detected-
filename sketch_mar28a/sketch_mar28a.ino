#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_task_wdt.h>
#include "config.h" 

#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ================= 📌 PIN DEFINITIONS =================
#define RELAY1_PIN 18 
#define RELAY2_PIN 19 
#define DHTPIN 13     
#define DHTTYPE DHT22 
#define LDR_PIN 34    
#define LED_STATUS 2  

// ================= 📦 OBJECTS & VARIABLES =================
DHT dht(DHTPIN, DHTTYPE);
FirebaseData fbdoStream, fbdoUpload;
FirebaseAuth auth;
FirebaseConfig fbConfig;

unsigned long prevMillis = 0;
const long interval = 500; // แก้เป็น 5 วินาที ให้เซนเซอร์และบอร์ดได้พักหายใจ
unsigned long lastReconnectAttempt = 0;

float temp = 0.0, hum = 0.0;
bool isRelay1On = false, isRelay2On = false;

// ระบบจัดการข้อมูลย้อนหลัง
int dataCount = 0;
const int maxDataLimit = 50; 

// สถานะการเชื่อมต่อ
bool firebaseConnected = false;
unsigned long lastFirebaseCheck = 0;

// ================= 🧰 HELPER FUNCTIONS =================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  
  Serial.print("📡 Connecting to WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // ดึงจาก config.h
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
    esp_task_wdt_reset(); 
  }
  
  if(WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✅ WiFi Connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    digitalWrite(LED_STATUS, HIGH);
  } else {
    Serial.println("\n❌ WiFi Failed!");
    digitalWrite(LED_STATUS, LOW);
    WiFi.disconnect();
  }
}

// ฟังก์ชันนี้แหละที่จะปรินต์ลง Serial สวยๆ
void setRelay(int relayPin, bool state, const char* name) {
  // สมมติว่า Relay เป็นแบบ Active Low (ถ้าเป็น Active High ให้สลับ LOW/HIGH ตรงนี้)
  digitalWrite(relayPin, state ? LOW : HIGH);
  Serial.printf("🔌 %s: %s\n", name, state ? "ON" : "OFF");
}

void streamCallback(FirebaseStream data) {
  String path = data.dataPath();
  
  if (data.dataType() == "boolean") {
    bool val = data.boolData();
    
    // จัดการ Relay 1
    if (path == "/relay_1") {
      if (isRelay1On != val) {
        isRelay1On = val;
        setRelay(RELAY1_PIN, isRelay1On, "Relay 1 (Firebase)");
      }
    } 
    // จัดการ Relay 2 (ลบเงื่อนไข Auto ออกไปเลย กดได้อิสระ)
    else if (path == "/relay_2") {
      if (isRelay2On != val) {
        isRelay2On = val;
        setRelay(RELAY2_PIN, isRelay2On, "Relay 2 (Firebase)");
      }
    }
  }
  esp_task_wdt_reset(); 
}

void streamTimeoutCallback(bool timeout) {
  if(timeout) {
    Serial.println("⚠️ Stream timeout");
  }
}

bool readDHTSensor(float &t, float &h) {
  unsigned long startTime = millis();
  h = dht.readHumidity();
  t = dht.readTemperature();
  
  if (isnan(h) || isnan(t)) {
    delay(100);
    h = dht.readHumidity();
    t = dht.readTemperature();
    if (isnan(h) || isnan(t)) {
      Serial.println("⚠️ Failed to read DHT sensor");
      return false;
    }
  }
  
  if (millis() - startTime > 500) {
    Serial.println("⚠️ DHT read timeout");
    return false;
  }
  return true;
}

void readAndSync() {
  esp_task_wdt_reset(); 
  
  float h, t;
  if (readDHTSensor(t, h)) {
    temp = t;
    hum = h;
    Serial.printf("🌡️ Temp: %.1f°C, Humidity: %.1f%%\n", temp, hum);
  }

  int light = 0;
  for(int i = 0; i < 5; i++) { 
    light += analogRead(LDR_PIN);
    delay(1);
  }
  light = light / 5;
  light = map(light, 0, 4095, 0, 100);
  light = constrain(light, 0, 100);
  Serial.printf("💡 Light: %d%%\n", light);

  FirebaseJson json;
  json.set("temperature", temp);
  json.set("humidity", hum);
  json.set("light_percent", light);
  json.set("timestamp", ".sv/timestamp");

  if (!Firebase.RTDB.updateNode(&fbdoUpload, "/iot_system/sensors", &json)) {
    Serial.printf("❌ Update failed: %s\n", fbdoUpload.errorReason().c_str());
  }

  if (Firebase.RTDB.pushJSON(&fbdoUpload, "/iot_system/history", &json)) {
    dataCount++;
    if (dataCount >= maxDataLimit) {
      Serial.println("🧹 Cleanup: Refreshing history data...");
      Firebase.RTDB.deleteNode(&fbdoUpload, "/iot_system/history");
      dataCount = 0;
    }
  }
  esp_task_wdt_reset(); 
}

bool checkFirebaseConnection() {
  unsigned long now = millis();
  if (now - lastFirebaseCheck < 10000) return firebaseConnected;
  lastFirebaseCheck = now;
  
  if (Firebase.ready()) {
    if (!firebaseConnected) {
      firebaseConnected = true;
      Serial.println("✅ Firebase connected");
    }
    return true;
  } else {
    if (firebaseConnected) {
      firebaseConnected = false;
      Serial.println("❌ Firebase disconnected");
    }
    return false;
  }
}

void loadSettings() {
  if (!checkFirebaseConnection()) return;
  esp_task_wdt_reset();
  
  unsigned long startTime = millis();
  
  // Get current relay states (ลบการดึง Auto ออกหมด)
  if (Firebase.RTDB.getBool(&fbdoUpload, "/iot_system/controls/relay_1")) {
    isRelay1On = fbdoUpload.boolData();
    setRelay(RELAY1_PIN, isRelay1On, "Initial Relay 1");
  }
  
  if (Firebase.RTDB.getBool(&fbdoUpload, "/iot_system/controls/relay_2")) {
    isRelay2On = fbdoUpload.boolData();
    setRelay(RELAY2_PIN, isRelay2On, "Initial Relay 2");
  }
  
  if (millis() - startTime > 5000) {
    Serial.println("⚠️ loadSettings timeout!");
  }
  esp_task_wdt_reset();
}

void setupFirebase() {
  fbConfig.api_key = API_KEY;
  fbConfig.database_url = DATABASE_URL;
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;
  fbConfig.token_status_callback = tokenStatusCallback;
  
  fbConfig.timeout.serverResponse = 10000;
  
  Firebase.begin(&fbConfig, &auth);
  Firebase.reconnectWiFi(true);
  delay(1000);
}

// ================= 🚀 SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n🚀 System Starting...");
  
  #if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    esp_task_wdt_config_t twdt_config = {
        .timeout_ms = 60000, 
        .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
        .trigger_panic = true
    };
    esp_task_wdt_init(&twdt_config);
  #else
    esp_task_wdt_init(60, true); 
  #endif
  esp_task_wdt_add(NULL);

  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);
  pinMode(LED_STATUS, OUTPUT);
  digitalWrite(LED_STATUS, LOW);
  
  dht.begin();
  delay(2000);

  connectWiFi();
  
  if (WiFi.status() == WL_CONNECTED) {
    setupFirebase();
    loadSettings();
    
    if (Firebase.RTDB.beginStream(&fbdoStream, "/iot_system/controls")) {
      Firebase.RTDB.setStreamCallback(&fbdoStream, streamCallback, streamTimeoutCallback);
      Serial.println("✅ Stream started");
    } else {
      Serial.printf("❌ Stream failed: %s\n", fbdoStream.errorReason().c_str());
    }
  }
  
  Serial.println("✅ Setup completed!");
  esp_task_wdt_reset();
}

// ================= 🔄 LOOP =================
void loop() {
  esp_task_wdt_reset();
  
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now = millis();
    if (now - lastReconnectAttempt > 30000) { 
      lastReconnectAttempt = now;
      connectWiFi();
      
      if (WiFi.status() == WL_CONNECTED) {
        setupFirebase();
        if (Firebase.RTDB.beginStream(&fbdoStream, "/iot_system/controls")) {
          Firebase.RTDB.setStreamCallback(&fbdoStream, streamCallback, streamTimeoutCallback);
        }
        loadSettings();
      }
    }
    delay(100);
    return; 
  }

  unsigned long now = millis();
  
  // อัปเดตข้อมูลเซนเซอร์ตาม interval (5 วินาที)
  if (now - prevMillis >= interval) {
    prevMillis = now;
    readAndSync();
  }
  
  // โหลด settings ทุก 60 วินาที (แก้จาก 100ms เป็น 60000ms ป้องกันบอร์ดค้าง)
  static unsigned long lastSettingsLoad = 0;
  if (now - lastSettingsLoad >= 500) { 
    lastSettingsLoad = now;
    loadSettings();
  }
  
  delay(50);
}