// ==========================================================
// SKYTRACER - GROUND STATION (ESP32)
// LoRa Receiver + OLED + LEDs + Buzzer + Buttons + WiFi + Backend POST
// + Backend CONTROL polling (logging + buzzer manual/auto)
// ==========================================================

#include <HardwareSerial.h>
#include <Wire.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ---------------- WIFI ----------------
const char* WIFI_SSID = "Dairo";
const char* WIFI_PASS = "Dairo2005";

// IMPORTANT: Put your PC IP here (NOT localhost)
const char* BACKEND_BASE = "http://172.20.10.9:4000"; 
const char* TELEMETRY_PATH = "/api/telemetry";
const char* CONTROL_STATE_PATH = "/api/control/state";

// ----------- LORA UART PINS -----------
#define LORA_RX_PIN 16
#define LORA_TX_PIN 17
HardwareSerial LoRaSerial(1);

// ----------- OLED 128x64 ---------------
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// ----------- LEDS ----------------------
#define LED_OK_PIN      12
#define LED_ERR_PIN     14
#define LED_LOG_PIN     27
#define LED_BUILTIN_PIN 2

// ----------- BUZZER --------------------
#define BUZZER_PIN   26    // Active buzzer (HIGH=ON)

// ----------- BUTTONS -------------------
#define BTN_PAGE_PIN 32
#define BTN_LOG_PIN  33

// ----------- Global Telemetry Cache ----
String lastDate="N/A", lastTime="N/A";
String lastLat="N/A",  lastLon="N/A";
String lastAlt="N/A";
String lastTemp="N/A", lastHum="N/A";
String lastPres="N/A", lastGasK="N/A";
String lastIAQ="N/A",  lastLevel="N/A";

unsigned long lastTelemetryMs = 0;

// ----------- Flags & State -------------
int  currentPage     = 0;
bool loggingEnabled  = false;  // synced from backend + button
bool hazardAlarm     = false;  // IAQ >= 200 logic

// Buzzer mode state (from backend)
enum BuzzerMode { BUZZ_AUTO, BUZZ_MANUAL };
BuzzerMode buzzerMode = BUZZ_AUTO;
bool buzzerManualOn = false;

// ----------- Button debounce -----------
int lastPageBtnStable = HIGH;
int lastLogBtnStable  = HIGH;

unsigned long lastPageBtnChange = 0;
unsigned long lastLogBtnChange  = 0;

const unsigned long DEBOUNCE_MS = 80;

// ----------- RX Buffer ------------------
String rxBuffer = "";

// ----------- Backend POST throttle ------
unsigned long lastPostMs = 0;
const unsigned long POST_MIN_INTERVAL_MS = 2500;

// ----------- Control polling ------------
unsigned long lastCtrlPollMs = 0;
const unsigned long CTRL_POLL_MS = 800;

// ==========================================================
// WIFI HELPERS
// ==========================================================
void wifiConnect() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.print("[WIFI] Connecting to ");
  Serial.print(WIFI_SSID);

  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) {
    delay(300);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("\n[WIFI] Connected! IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Failed to connect (will retry in loop)");
  }
}

void wifiEnsureConnected() {
  if (WiFi.status() == WL_CONNECTED) return;

  static unsigned long lastTry = 0;
  if (millis() - lastTry < 5000) return;
  lastTry = millis();

  Serial.println("[WIFI] Reconnecting...");
  WiFi.disconnect(true);
  delay(200);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

// ==========================================================
// UTILS
// ==========================================================
String getValue(const String &line, const String &key) {
  int start = line.indexOf(key);
  if (start == -1) return "";
  start += key.length();
  int end = line.indexOf(',', start);
  if (end == -1) end = line.length();
  return line.substring(start, end);
}

String cropTimeNoSeconds(const String &t) {
  int firstColon = t.indexOf(':');
  if (firstColon == -1) return t;
  int secondColon = t.indexOf(':', firstColon + 1);
  if (secondColon == -1) return t;
  int spacePos = t.indexOf(' ', secondColon);
  if (spacePos == -1) return t;
  String hm = t.substring(0, secondColon);
  String ampm = t.substring(spacePos + 1);
  return hm + " " + ampm;
}

String jsonString(const String& s) {
  String out = s;
  out.replace("\\", "\\\\");
  out.replace("\"", "\\\"");
  return out;
}

bool isFiniteNumberStr(const String& s) {
  if (s.length() == 0) return false;
  String t = s; t.trim(); t.toLowerCase();
  if (t == "nan" || t == "inf" || t == "+inf" || t == "-inf") return false;
  bool dotSeen = false;
  int start = (t[0] == '-' || t[0] == '+') ? 1 : 0;
  if (start >= (int)t.length()) return false;
  for (int i = start; i < (int)t.length(); i++) {
    char c = t[i];
    if (c == '.') { if (dotSeen) return false; dotSeen = true; continue; }
    if (c < '0' || c > '9') return false;
  }
  return true;
}

String jsonNumberOrNull(const String& s) {
  return isFiniteNumberStr(s) ? s : "null";
}

// ==========================================================
// SYNC HELPERS
// ==========================================================
void applyLogging(bool enabled, bool notifyPayload) {
  if (loggingEnabled == enabled) return;
  loggingEnabled = enabled;

  Serial.print("[GROUND] loggingEnabled = ");
  Serial.println(loggingEnabled ? "ON" : "OFF");

  // Sync payload SD logging + payload LED
  if (notifyPayload) {
    LoRaSerial.println(loggingEnabled ? "CMD_LOG=1" : "CMD_LOG=0");
  }

  // push status to backend immediately
  lastPostMs = 0; // allow immediate post
}

void applyBuzzerMode(BuzzerMode mode) {
  buzzerMode = mode;
  Serial.print("[GROUND] buzzerMode = ");
  Serial.println(buzzerMode == BUZZ_AUTO ? "AUTO" : "MANUAL");
  lastPostMs = 0;
}

void applyBuzzerManual(bool on) {
  buzzerManualOn = on;
  Serial.print("[GROUND] buzzerManualOn = ");
  Serial.println(buzzerManualOn ? "ON" : "OFF");
  lastPostMs = 0;
}

// ==========================================================
// POLL CONTROL STATE FROM BACKEND
// ==========================================================
void pollControlState() {
  if (WiFi.status() != WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastCtrlPollMs < CTRL_POLL_MS) return;
  lastCtrlPollMs = now;

  String url = String(BACKEND_BASE) + CONTROL_STATE_PATH;

  HTTPClient http;
  http.setTimeout(2000);
  http.begin(url);

  int code = http.GET();
  if (code != 200) {
    http.end();
    return;
  }

  String body = http.getString();
  http.end();

  StaticJsonDocument<512> doc;
  DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.print("[CTRL] JSON parse fail: ");
    Serial.println(err.c_str());
    return;
  }

  bool logging = doc["loggingEnabled"] | false;
  const char* modeStr = doc["buzzerMode"] | "AUTO";
  bool manOn = doc["buzzerManualOn"] | false;

  // Apply changes
  applyLogging(logging, true);

  if (String(modeStr) == "MANUAL") applyBuzzerMode(BUZZ_MANUAL);
  else applyBuzzerMode(BUZZ_AUTO);

  applyBuzzerManual(manOn);
}

// ==========================================================
// SEND TO BACKEND (POST JSON)
// ==========================================================
void postTelemetryToBackend() {
  if (WiFi.status() != WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastPostMs < POST_MIN_INTERVAL_MS) return;
  lastPostMs = now;

  String json = "{";
  json += "\"date\":\"" + jsonString(lastDate) + "\",";
  json += "\"time\":\"" + jsonString(lastTime) + "\",";
  json += "\"lat\":"  + jsonNumberOrNull(lastLat)  + ",";
  json += "\"lon\":"  + jsonNumberOrNull(lastLon)  + ",";
  json += "\"alt\":"  + jsonNumberOrNull(lastAlt)  + ",";
  json += "\"temp\":" + jsonNumberOrNull(lastTemp) + ",";
  json += "\"hum\":"  + jsonNumberOrNull(lastHum)  + ",";
  json += "\"pres\":" + jsonNumberOrNull(lastPres) + ",";
  json += "\"gasK\":" + jsonNumberOrNull(lastGasK) + ",";
  json += "\"iaq\":"  + jsonNumberOrNull(lastIAQ)  + ",";
  json += "\"level\":\"" + jsonString(lastLevel) + "\",";
  json += "\"loggingEnabled\":" + String(loggingEnabled ? "true" : "false") + ",";
  json += "\"hazardAlarm\":" + String(hazardAlarm ? "true" : "false") + ",";
  json += "\"buzzerMode\":\"" + String(buzzerMode == BUZZ_AUTO ? "AUTO" : "MANUAL") + "\",";
  json += "\"buzzerManualOn\":" + String(buzzerManualOn ? "true" : "false");
  json += "}";

  String url = String(BACKEND_BASE) + TELEMETRY_PATH;

  HTTPClient http;
  http.setTimeout(2500);
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST((uint8_t*)json.c_str(), json.length());
  if (code <= 0) {
    Serial.print("[HTTP] POST failed: ");
    Serial.println(code);
  }
  http.end();
}

// ==========================================================
// PARSE TELEMETRY LINE
// ==========================================================
void processLine(const String &line) {
  String date  = getValue(line, "Date=");
  String time  = getValue(line, "Time=");
  String lat   = getValue(line, "Lat=");
  String lon   = getValue(line, "Lon=");
  String alt   = getValue(line, "Alt=");
  String temp  = getValue(line, "Temp=");
  String hum   = getValue(line, "Hum=");
  String pres  = getValue(line, "Pres=");
  String gasK  = getValue(line, "GasK=");
  String iaq   = getValue(line, "IAQ=");
  String level = getValue(line, "Level=");

  if (date.length())  lastDate = date;
  if (time.length())  lastTime = time;
  if (lat.length())   lastLat  = lat;
  if (lon.length())   lastLon  = lon;
  if (alt.length())   lastAlt  = alt;
  if (temp.length())  lastTemp = temp;
  if (hum.length())   lastHum  = hum;
  if (pres.length())  lastPres = pres;
  if (gasK.length())  lastGasK = gasK;
  if (iaq.length())   lastIAQ  = iaq;
  if (level.length()) lastLevel = level;

  lastTelemetryMs = millis();

  // IAQ hazard threshold = 200
  float iaqVal = lastIAQ.toFloat();
  hazardAlarm = (!isnan(iaqVal) && iaqVal >= 200.0f);

  postTelemetryToBackend();
}

// ==========================================================
// STATUS LEDS
// ==========================================================
void updateStatusLEDs() {
  bool alive = (millis() - lastTelemetryMs < 15000);
  digitalWrite(LED_OK_PIN,  alive);
  digitalWrite(LED_ERR_PIN, !alive);

  // both blue leds tied to loggingEnabled
  digitalWrite(LED_LOG_PIN,     loggingEnabled);
  digitalWrite(LED_BUILTIN_PIN, loggingEnabled);
}

// ==========================================================
// BUZZER CONTROL
// ==========================================================
void updateBuzzer() {
  if (buzzerMode == BUZZ_MANUAL) {
    digitalWrite(BUZZER_PIN, buzzerManualOn ? HIGH : LOW);
  } else {
    digitalWrite(BUZZER_PIN, hazardAlarm ? HIGH : LOW);
  }
}

// ==========================================================
// BUTTON HANDLING
// ==========================================================
void updateButtons() {
  unsigned long now = millis();

  // PAGE
  int rawPage = digitalRead(BTN_PAGE_PIN);
  if (rawPage != lastPageBtnStable) {
    if (now - lastPageBtnChange > DEBOUNCE_MS) {
      if (rawPage == LOW && lastPageBtnStable == HIGH) {
        currentPage = 1 - currentPage;
      }
      lastPageBtnStable = rawPage;
      lastPageBtnChange = now;
    }
  }

  // LOG button toggles logging AND syncs payload AND backend
  int rawLog = digitalRead(BTN_LOG_PIN);
  if (rawLog != lastLogBtnStable) {
    if (now - lastLogBtnChange > DEBOUNCE_MS) {
      if (rawLog == LOW && lastLogBtnStable == HIGH) {
        applyLogging(!loggingEnabled, true);
        postTelemetryToBackend();
      }
      lastLogBtnStable = rawLog;
      lastLogBtnChange = now;
    }
  }
}

// ==========================================================
// OLED PAGES
// ==========================================================
void drawMainPage() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(18, 0);
  display.print("SkyTracer");

  display.setTextSize(1);
  int y = 18;
  const int step = 9;

  display.setCursor(0, y);
  display.print("Temp: "); display.print(lastTemp); display.print(" C");

  y += step;
  display.setCursor(0, y);
  display.print("Hum : "); display.print(lastHum); display.print(" %");

  y += step;
  display.setCursor(0, y);
  display.print("Pres: "); display.print(lastPres); display.print(" hPa");

  y += step;
  display.setCursor(0, y);
  display.print("Gas : "); display.print(lastGasK); display.print(" k");

  y += step;
  display.setCursor(0, y);
  display.print("IAQ: ");
  String iaqShort = lastIAQ;
  int dotPos = iaqShort.indexOf('.');
  if (dotPos != -1 && dotPos + 2 < iaqShort.length()) iaqShort = iaqShort.substring(0, dotPos + 2);
  display.print(iaqShort);

  display.display();
}

void drawGPSPage() {
  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);

  display.setTextSize(2);
  display.setCursor(18, 0);
  display.print("SkyTracer");

  display.setTextSize(1);
  int y = 18;
  const int step = 9;

  display.setCursor(0, y);
  display.print("Lat: "); display.print(lastLat);

  y += step;
  display.setCursor(0, y);
  display.print("Lon: "); display.print(lastLon);

  y += step;
  display.setCursor(0, y);
  display.print("Alt: "); display.print(lastAlt); display.print(" m");

  y += step;
  display.setCursor(0, y);
  display.print("Date: "); display.print(lastDate);

  y += step;
  display.setCursor(0, y);
  display.print("Time: "); display.print(cropTimeNoSeconds(lastTime));

  display.display();
}

// ==========================================================
// SETUP / LOOP
// ==========================================================
void setup() {
  Serial.begin(115200);
  delay(300);

  wifiConnect();

  LoRaSerial.begin(9600, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);

  pinMode(LED_OK_PIN, OUTPUT);
  pinMode(LED_ERR_PIN, OUTPUT);
  pinMode(LED_LOG_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_BUILTIN_PIN, OUTPUT);

  pinMode(BTN_PAGE_PIN, INPUT_PULLUP);
  pinMode(BTN_LOG_PIN,  INPUT_PULLUP);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    while (true) delay(100);
  }

  display.clearDisplay();
  display.setTextSize(2);
  display.setCursor(10, 20);
  display.print("SkyTracer");
  display.display();
  delay(800);

  // First control pull so we sync on boot
  pollControlState();
  postTelemetryToBackend();
}

void loop() {
  wifiEnsureConnected();

  pollControlState();

  // LoRa receive frames from payload
  while (LoRaSerial.available()) {
    char c = LoRaSerial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      if (rxBuffer.length() > 0) { processLine(rxBuffer); rxBuffer = ""; }
    } else {
      rxBuffer += c;
      if (rxBuffer.length() > 400) rxBuffer = "";
    }
  }

  updateButtons();
  updateStatusLEDs();
  updateBuzzer();

  if (currentPage == 0) drawMainPage();
  else drawGPSPage();
}