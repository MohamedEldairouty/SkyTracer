// =====================
//  SKYTRACER - PAYLOAD ESP32 CODE
//  BME680 + DS18B20 + GPS + SD + LoRa + DS3231 RTC
// =====================

#include <Wire.h>
#include <SPI.h>
#include <SD.h>
#include <math.h>

#include <Adafruit_Sensor.h>
#include <Adafruit_BME680.h>

#include <OneWire.h>
#include <DallasTemperature.h>

#include <TinyGPSPlus.h>
#include <HardwareSerial.h>

#include <RTClib.h>   // <-- DS3231 RTC

// -------- PIN DEFINITIONS --------
// I2C (BME680 + DS3231)
#define BME_SDA 21
#define BME_SCL 22

// DS18B20
#define ONE_WIRE_BUS 4

// GPS (UART2)
#define GPS_RX_PIN 27   // ESP32 RX2  <- GPS TX
#define GPS_TX_PIN 26   // ESP32 TX2  -> GPS 


// LoRa AS32 (UART1)
#define LORA_RX_PIN 16  // ESP32 RX1  <- LoRa TXD
#define LORA_TX_PIN 17  // ESP32 TX1  -> LoRa RXD

// SD Card (SPI)
#define SD_CS_PIN 5

// Built-in LED (payload board)
#define LED_BUILTIN_PIN 2

// -------- BARO ALTITUDE FALLBACK --------
#define SEALEVEL_PRESSURE_HPA 1013.25f


// -------- LOGGING CONTROL (from ground) --------
bool   logEnabled  = false;    // controlled by ground CMD_LOG=1/0
String loraCmdBuf  = "";       // buffer for LoRa commands

// -------- OBJECTS --------
Adafruit_BME680 bme;       // I2C
OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature ds18b20(&oneWire);

TinyGPSPlus gps;
HardwareSerial GPSSerial(2);   // UART2 for GPS
HardwareSerial LoRaSerial(1);  // UART1 for LoRa

File logFile;

// RTC
RTC_DS3231 rtc;
bool rtcOk = false;        // true if RTC responds

// ---------- IAQ CALC + LEVEL ----------
struct AirQuality {
  float iaq;
  const char* level;
};

AirQuality computeIAQ(float humidity, float gas_kohm) {
  float gas_ohm = gas_kohm * 1000.0;

  // --------------------------
  // 1) HUMIDITY PENALTY (0–60)
  // --------------------------
  float H = constrain(humidity, 0, 100);
  float humPenalty = 0;

  if (H < 30)
      humPenalty = (30 - H) * 1.5;
  else if (H > 50)
      humPenalty = (H - 50) * 1.2;

  if (humPenalty > 60) humPenalty = 60;

  // --------------------------
  // 2) GAS COMPONENT (0–440)
  // --------------------------
  float gasRatio = 200000.0 / gas_ohm;  // clean room ≈ 1
  if (gasRatio < 1) gasRatio = 1;

  float gasAQI = log(gasRatio) * 80.0;  // scaling
  if (gasAQI > 440) gasAQI = 440;

  // --------------------------
  // 3) FINAL IAQ (0–500)
  // --------------------------
  float iaq = humPenalty + gasAQI;

  // --------------------------
  // 4) LEVEL MAPPING
  // --------------------------
  const char* level;
  if      (iaq <=  50) level = "GOOD";
  else if (iaq <= 100) level = "MODERATE";
  else if (iaq <= 150) level = "UNHEALTHY-SENS.";
  else if (iaq <= 200) level = "UNHEALTHY";
  else if (iaq <= 300) level = "VERY UNHEALTHY";
  else                 level = "DANGEROUS";

  return {iaq, level};
}

// ========= TEMPERATURE FUSION =========
// BME = main environment temp, DS18B20 = backup only
bool isDsError(float t) {
  // Dallas library error values
  return (t == DEVICE_DISCONNECTED_C) || (t == 85.0f) || (t < -50.0f) || (t > 125.0f);
}

float computeValidatedTemp(float tBme, bool bmeValid, float tDs, bool dsValid) {
  // Primary: BME680
  if (bmeValid) {
    return tBme;
  }

  // Fallback: DS18B20
  if (dsValid && !isDsError(tDs)) {
    return tDs;
  }

  // Nothing valid
  return NAN;
}

// ========= SD LOGGING =========
void appendToSD(const String &line) {
  logFile = SD.open("/payload_log.txt", FILE_APPEND);
  if (logFile) {
    logFile.print(line);  // line already has \n
    logFile.close();
  } else {
    Serial.println("!! SD open failed (payload_log.txt)");
  }
}

// ========= GPS FEEDER =========
void feedGPS() {
  while (GPSSerial.available() > 0) {
    gps.encode(GPSSerial.read());
  }
}

// ========= LORA COMMAND PARSER (from ground) =========
// Expect lines like: CMD_LOG=1 or CMD_LOG=0
void handleLoRaCommands() {
  while (LoRaSerial.available() > 0) {
    char c = LoRaSerial.read();
    if (c == '\r') continue;

    if (c == '\n') {
      if (loraCmdBuf.length() > 0) {
        if (loraCmdBuf.startsWith("CMD_LOG=")) {
          char v = loraCmdBuf.charAt(8);
          logEnabled = (v == '1');
          LoRaSerial.println(logEnabled ? "ACK_LOG=1" : "ACK_LOG=0");
          Serial.print("[PAYLOAD] Logging flag set to ");
          Serial.println(logEnabled ? "ON" : "OFF");
        }
      }
      loraCmdBuf = "";
    } else {
      if (loraCmdBuf.length() < 50) {
        loraCmdBuf += c;
      } else {
        loraCmdBuf = "";
      }
    }
  }
}

// ========= SETUP =========
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n[SKYTRACER PAYLOAD] Booting...");

  // I2C
  Wire.begin(BME_SDA, BME_SCL);

  // LoRa
  LoRaSerial.begin(9600, SERIAL_8N1, LORA_RX_PIN, LORA_TX_PIN);
  Serial.println("[PAYLOAD] LoRa UART started");

  // GPS
  GPSSerial.begin(9600, SERIAL_8N1, GPS_RX_PIN, GPS_TX_PIN);
  Serial.println("[PAYLOAD] GPS UART started");

  // BME680
  if (!bme.begin(0x77)) {  // Use 0x76 if that's your board address
    Serial.println("!! Could not find BME680");
  } else {
    bme.setTemperatureOversampling(BME680_OS_8X);
    bme.setHumidityOversampling(BME680_OS_2X);
    bme.setPressureOversampling(BME680_OS_4X);
    bme.setGasHeater(320, 150); // 320°C for 150 ms
    Serial.println("[PAYLOAD] BME680 init OK");
  }

  // DS18B20
  ds18b20.begin();
  Serial.println("[PAYLOAD] DS18B20 init OK");

  // SD
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("!! SD init failed");
  } else {
    Serial.println("[PAYLOAD] SD init OK");
    if (!SD.exists("/payload_log.txt")) {
      logFile = SD.open("/payload_log.txt", FILE_WRITE);
      if (logFile) {
        logFile.println("==== SkyTracer Payload Log Start ====");
        logFile.close();
      }
    }
  }

  // RTC DS3231
  if (!rtc.begin()) {
    Serial.println("!! RTC DS3231 not found");
    rtcOk = false;
  } else {
    rtcOk = true;
    Serial.println("[PAYLOAD] RTC DS3231 init OK");
    // IMPORTANT: You must set the RTC time once using a separate sketch
  }

  // Built-in LED
  pinMode(LED_BUILTIN_PIN, OUTPUT);
  digitalWrite(LED_BUILTIN_PIN, LOW);

  Serial.println("[PAYLOAD] Setup done.\n");
}

float baroAltitudeMeters(float pressure_hpa) {
  if (!isfinite(pressure_hpa) || pressure_hpa <= 0) return NAN;
  return 44330.0f * (1.0f - pow(pressure_hpa / SEALEVEL_PRESSURE_HPA, 0.1903f));
}

// ========= LOOP =========
unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL_MS = 3000;

void loop() {
  // Handle commands from ground (logging ON/OFF)
  handleLoRaCommands();

  // keep feeding GPS continuously
  feedGPS();

  unsigned long now = millis();
  if (now - lastSend < SEND_INTERVAL_MS) {
    // still update LED based on latest logEnabled
    digitalWrite(LED_BUILTIN_PIN, logEnabled ? HIGH : LOW);
    return;
  }
  lastSend = now;

  // --- Read BME680 ---
  bool bmeValid = false;
  float tBme = NAN, hum = NAN, press = NAN, gas_kohm = NAN;

  if (bme.performReading()) {
    tBme = bme.temperature;
    hum  = bme.humidity;
    press = bme.pressure / 100.0f;           // Pa -> hPa
    gas_kohm = bme.gas_resistance / 1000.0f; // Ohm -> kOhm
    bmeValid = true;
  } else {
    Serial.println("!! BME680 reading failed");
  }

  // --- Read DS18B20 ---
  ds18b20.requestTemperatures();
  float tDs = ds18b20.getTempCByIndex(0);
  bool dsValid = !isDsError(tDs);

  // --- Fused temperature ---
  float tFinal = computeValidatedTemp(tBme, bmeValid, tDs, dsValid);

  // --- Air quality from gas ---
  AirQuality aq = computeIAQ(hum, gas_kohm);

  // --- GPS data ---
  double lat = gps.location.isValid() ? gps.location.lat() : NAN;
  double lon = gps.location.isValid() ? gps.location.lng() : NAN;
  // GPS altitude first
  double alt = gps.altitude.isValid() ? gps.altitude.meters() : NAN;

  // Fallback: barometric altitude from pressure if GPS altitude is NaN
  // (uses your latest pressure reading in hPa)
  if (!isfinite(alt)) {
    float baroAlt = baroAltitudeMeters(press); // press is hPa (already)
    if (isfinite(baroAlt)) alt = baroAlt;
  }


  // Decide if GPS is "good" enough to trust for time/date:
  // - location valid (lat/lon)
  // - date & time valid
  // - year >= 2020 (ignore 00/00/2000 garbage)
  bool gpsFixOK =
    gps.location.isValid() &&
    gps.date.isValid() &&
    gps.time.isValid() &&
    gps.date.year() >= 2020;

  // --- Time & Date (GPS primary, RTC fallback) ---
  String dateStr = "NO_DATE";
  String timeStr = "NO_TIME";

  if (gpsFixOK) {
    // Use GPS time (converted to Egypt local time, UTC+2)
    int day    = gps.date.day();
    int month  = gps.date.month();
    int year   = gps.date.year();

    int hour   = gps.time.hour();      // UTC
    int minute = gps.time.minute();
    int second = gps.time.second();

    // ---- convert to local (UTC+2) ----
    int localHour = hour + 2;
    if (localHour >= 24) localHour -= 24;

    char dBuf[16];
    sprintf(dBuf, "%02d/%02d/%04d", day, month, year);
    dateStr = dBuf;

    // ---------- Convert localHour to 12-hour ----------
    int displayHour = localHour;
    String ampm = "AM";

    if (displayHour == 0) {
      displayHour = 12;           
      ampm = "AM";
    } else if (displayHour == 12) {
      ampm = "PM";
    } else if (displayHour > 12) {
      displayHour -= 12;
      ampm = "PM";
    }

    char tBuf[20];
    sprintf(tBuf, "%02d:%02d:%02d %s",
            displayHour, minute, second, ampm.c_str());
    timeStr = tBuf;

  } else if (rtcOk) {
    // GPS is not trustworthy → use DS3231 time (you should have set it to local time)
    DateTime nowRtc = rtc.now();

    char dBuf[16];
    sprintf(dBuf, "%02d/%02d/%04d",
            nowRtc.day(),
            nowRtc.month(),
            nowRtc.year());
    dateStr = dBuf;

    // ---------- 12-hour format for RTC ----------
    int hourRTC   = nowRtc.hour();
    int minuteRTC = nowRtc.minute();
    int secondRTC = nowRtc.second();

    int displayHour = hourRTC;
    String ampm = "AM";

    if (displayHour == 0) {
      displayHour = 12;
      ampm = "AM";
    } else if (displayHour == 12) {
      ampm = "PM";
    } else if (displayHour > 12) {
      displayHour -= 12;
      ampm = "PM";
    }

    char tBuf[20];
    sprintf(tBuf, "%02d:%02d:%02d %s",
            displayHour, minuteRTC, secondRTC, ampm.c_str());
    timeStr = tBuf;
  }

  // -------- Build telemetry line (for LoRa + Serial) --------
  String line = "";
  line.reserve(240);

  line += "T=";      line += now;
  line += ",Date=";  line += dateStr;
  line += ",Time=";  line += timeStr;
  line += ",Lat=";   line += String(lat, 6);
  line += ",Lon=";   line += String(lon, 6);
  line += ",Alt=";   line += String(alt, 1);
  line += ",Temp=";     line += String(tFinal, 2);
  line += ",TempBME=";  line += String(tBme, 2);
  line += ",TempDS=";   line += String(tDs, 2);
  line += ",Hum=";      line += String(hum, 1);
  line += ",Pres=";     line += String(press, 1);
  line += ",GasK=";     line += String(gas_kohm, 2);
  line += ",IAQ=";      line += String(aq.iaq, 1);
  line += ",Level=";    line += aq.level;

  // -------- Debug on USB --------
  Serial.println("\n=== SKYTRACER PAYLOAD FRAME ===");
  Serial.println(line);
  Serial.print("Logging: ");
  Serial.println(logEnabled ? "ON" : "OFF");
  Serial.println("GPS fix OK: " + String(gpsFixOK ? "YES" : "NO"));
  Serial.println("RTC OK: " + String(rtcOk ? "YES" : "NO"));
  Serial.println("================================");

  // -------- Send over LoRa --------
  LoRaSerial.println(line);

  // -------- Log to SD (only if loggingEnabled) --------
  if (logEnabled) {
    String block = "";
    block.reserve(320);

    block += "----------------------------------------\n";
    block += "SkyTracer Payload Log Entry\n";
    block += "Date (LOCAL):    " + dateStr + "\n";
    block += "Time (LOCAL):    " + timeStr + "\n";
    block += "Uptime (ms):     " + String(now) + "\n";
    block += "Latitude:        " + String(lat, 6) + "\n";
    block += "Longitude:       " + String(lon, 6) + "\n";
    block += "Altitude (m):    " + String(alt, 1) + "\n";
    block += "Temp (main, C):  " + String(tFinal, 2) + "\n";
    block += "Temp BME (C):    " + String(tBme, 2) + "\n";
    block += "Temp DS18B20(C): " + String(tDs, 2) + "\n";
    block += "Humidity (%):    " + String(hum, 1) + "\n";
    block += "Pressure (hPa):  " + String(press, 1) + "\n";
    block += "Gas (kΩ):        " + String(gas_kohm, 2) + "\n";
    block += "IAQ:             " + String(aq.iaq, 1) + "\n";
    block += "IAQ Level:       " + String(aq.level) + "\n";
    block += "----------------------------------------\n";

    appendToSD(block);
  }

  // Built-in LED mirrors logging flag
  digitalWrite(LED_BUILTIN_PIN, logEnabled ? HIGH : LOW);
}