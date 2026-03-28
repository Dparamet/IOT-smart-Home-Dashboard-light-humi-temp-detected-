#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <esp_task_wdt.h>
#include <time.h>
#include "config.h"

// อัญเชิญผู้ช่วยจัดการ Token
#include "addons/TokenHelper.h"
#include "addons/RTDBHelper.h"

// ================= ⚙️ CONFIGURATION =================

// ================= 📌 PIN DEFINITIONS =================
#define RELAY1_PIN 18 
#define RELAY2_PIN 19 
#define DHTPIN 13     
#define DHTTYPE DHT22 
#define LDR_PIN 34    
#define LED_STATUS 2  

// ================= 📦 OBJECTS & VARIABLES =================
DHT dht(DHTPIN, DHTTYPE);

FirebaseData fbdoStream;
FirebaseData fbdoUpload;
FirebaseAuth auth;
FirebaseConfig config;

unsigned long previousSensorMillis = 0;
const long sensorInterval = 5000; 

unsigned long previousSettingMillis = 0;
const long settingInterval = 10000; 

float temp = 0.0, hum = 0.0;
int light_percent = 0;
bool auto_mode = false;
float auto_fan_temp = 30.0;
bool isRelay1On = false;
bool isRelay2On = false;

// ================= 🛠️ FUNCTION PROTOTYPES =================
void connectWiFi();
void streamCallback(FirebaseStream data);
void streamTimeoutCallback(bool timeout);
void readSensors();
void handleSmartAuto();

// ================= 🚀 SETUP =================
void setup() {
  Serial.begin(115200);
  
  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(LED_STATUS, OUTPUT);
  
  digitalWrite(RELAY1_PIN, HIGH);
  digitalWrite(RELAY2_PIN, HIGH);

  dht.begin();

  #if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    esp_task_wdt_config_t twdt_config = {
      .timeout_ms = 30000,
      .idle_core_mask = (1 << portNUM_PROCESSORS) - 1,
      .trigger_panic = true
    };
    esp_task_wdt_init(&twdt_config);
  #else
    esp_task_wdt_init(30, true);
  #endif
  esp_task_wdt_add(NULL);

  connectWiFi();

  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;
  
  config.token_status_callback = tokenStatusCallback;

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  if (!Firebase.RTDB.beginStream(&fbdoStream, "/iot_system/controls")) {
    Serial.printf("Stream begin error, %s\n\n", fbdoStream.errorReason().c_str());
  }
  Firebase.RTDB.setStreamCallback(&fbdoStream, streamCallback, streamTimeoutCallback);
}

// ================= 🔄 MAIN LOOP =================
void loop() {
  esp_task_wdt_reset();
  unsigned long currentMillis = millis();

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (currentMillis - previousSensorMillis >= sensorInterval) {
    previousSensorMillis = currentMillis;
    readSensors();
  }

  if (currentMillis - previousSettingMillis >= settingInterval) {
    previousSettingMillis = currentMillis;
    handleSmartAuto();
  }
}

// ================= 🧰 HELPER FUNCTIONS =================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  if(WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    digitalWrite(LED_STATUS, HIGH);
  } else {
    digitalWrite(LED_STATUS, LOW);
  }
}

void streamCallback(FirebaseStream data) {
  if (data.dataType() == "json") {
    FirebaseJson *json = data.jsonObjectPtr();
    FirebaseJsonData jsonData;

    if (json->get(jsonData, "relay_1")) {
      isRelay1On = jsonData.boolValue;
      digitalWrite(RELAY1_PIN, isRelay1On ? LOW : HIGH);
    }
    if (json->get(jsonData, "relay_2")) {
      isRelay2On = jsonData.boolValue;
      if (!auto_mode) {
        digitalWrite(RELAY2_PIN, isRelay2On ? LOW : HIGH);
      }
    }
  } else if (data.dataType() == "boolean") {
    String path = data.dataPath();
    bool value = data.boolData();
    if (path == "/relay_1") {
      isRelay1On = value;
      digitalWrite(RELAY1_PIN, isRelay1On ? LOW : HIGH);
    } else if (path == "/relay_2" && !auto_mode) {
      isRelay2On = value;
      digitalWrite(RELAY2_PIN, isRelay2On ? LOW : HIGH);
    }
  }
}

void streamTimeoutCallback(bool timeout) {}

void readSensors() {
  float newHum = dht.readHumidity();
  float newTemp = dht.readTemperature();
  int ldrRaw = analogRead(LDR_PIN);
  
  if (!isnan(newTemp) && !isnan(newHum)) {
    temp = newTemp;
    hum = newHum;
  }
  
  light_percent = map(ldrRaw, 4095, 0, 0, 100);
  if(light_percent < 0) light_percent = 0;
  if(light_percent > 100) light_percent = 100;

  // 🕵️‍♂️ ปริ้นท์ค่าเซ็นเซอร์ออกจอคอม เพื่อดูว่าฮาร์ดแวร์อ่านค่าได้จริงไหม
  Serial.printf("Temp: %.1f | Hum: %.1f | Light: %d%%\n", temp, hum, light_percent);

  FirebaseJson json;
  json.set("temperature", temp);
  json.set("humidity", hum);
  json.set("light_percent", light_percent);
  json.set("timestamp", ".sv/timestamp");
  Firebase.RTDB.pushJSONAsync(&fbdoUpload, "/iot_system/history", &json);
  // 🕵️‍♂️ ปริ้นท์สถานะการอัปโหลดขึ้น Firebase
  if (Firebase.RTDB.updateNodeAsync(&fbdoUpload, "/iot_system/sensors", &json)) {
    Serial.println("✅ Uploaded Sensors to Firebase!");
  } else {
    Serial.println("❌ Firebase Upload Failed: " + fbdoUpload.errorReason());
  }
}

void handleSmartAuto() {
  if (Firebase.RTDB.getBool(&fbdoUpload, "/iot_system/settings/auto_mode")) {
    auto_mode = fbdoUpload.boolData();
  }
  if (Firebase.RTDB.getFloat(&fbdoUpload, "/iot_system/settings/auto_fan_temp")) {
    auto_fan_temp = fbdoUpload.floatData();
  }

  if (auto_mode) {
    if (temp >= auto_fan_temp && !isRelay2On) {
      isRelay2On = true;
      digitalWrite(RELAY2_PIN, LOW);
      Firebase.RTDB.setBoolAsync(&fbdoUpload, "/iot_system/controls/relay_2", true);
    } else if (temp < (auto_fan_temp - 1.0) && isRelay2On) {
      isRelay2On = false;
      digitalWrite(RELAY2_PIN, HIGH);
      Firebase.RTDB.setBoolAsync(&fbdoUpload, "/iot_system/controls/relay_2", false);
    }
  }
}