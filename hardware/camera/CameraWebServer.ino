#include "esp_camera.h"
#include "FS.h"
#include "SD_MMC.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ===========================
// Select camera model in board_config.h
// ===========================
#include "board_config.h"

// ===========================
// WiFi credentials
// ===========================
const char *ssid     = "Dairo";
const char *password = "Dairo2005";

// ===========================
// Backend (Node.js API)
// Put your laptop IP here (NOT localhost)
// ===========================
const char *BACKEND_BASE = "http://172.20.10.9:4000";   // <-- your laptop IP
const char *UPLOAD_PATH  = "/api/camera/uploadRaw";     // <-- raw endpoint

// ===========================
// Capture settings
// ===========================
const unsigned long CAPTURE_INTERVAL_MS = 10000; // 10s

// Standard ESP32-CAM webserver example functions (already in your project)
void startCameraServer();
void setupLedFlash();

// capture state
bool sd_ok = false;
unsigned long lastShot = 0;
int photoIndex = 1;

// WiFi / upload state
unsigned long lastWifiTry = 0;
const unsigned long WIFI_RETRY_MS = 5000;

unsigned long lastUploadTry = 0;
const unsigned long UPLOAD_RETRY_MS = 7000;

// ---------------------------
// Helpers for filenames
// ---------------------------
String makeUnsentName(int index) {
  char p[32];
  sprintf(p, "/u_pic_%04d.jpg", index);
  return String(p);
}

String makeSentNameFromUnsent(const String &unsentPath) {
  // "/u_pic_0001.jpg" -> "/s_pic_0001.jpg"
  if (unsentPath.startsWith("/u_")) {
    return String("/s_") + unsentPath.substring(3);
  }
  return unsentPath;
}

// ---------------------------
// SD init
// ---------------------------
void initSD() {
  Serial.println("[SD] Mounting SD_MMC...");
  if (!SD_MMC.begin("/sdcard", true)) {   // 1-bit mode (more stable with camera)
    Serial.println("[SD] SD_MMC init failed!");
    sd_ok = false;
    return;
  }

  uint8_t cardType = SD_MMC.cardType();
  if (cardType == CARD_NONE) {
    Serial.println("[SD] No SD card attached");
    sd_ok = false;
    return;
  }

  sd_ok = true;
  Serial.println("[SD] SD_MMC OK ✅");
}

// ---------------------------
// WiFi connect (non-blocking)
// ---------------------------
void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiTry < WIFI_RETRY_MS) return;
  lastWifiTry = now;

  Serial.println("[WiFi] Reconnecting...");
  WiFi.disconnect(true);
  delay(50);
  WiFi.begin(ssid, password);
}

// ---------------------------
// Save one photo to SD as UNSENT
// ---------------------------
bool savePhotoToSD_Unsent(int index) {
  if (!sd_ok) return false;

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[CAM] Capture failed");
    return false;
  }

  String path = makeUnsentName(index);
  Serial.printf("[SD] Saving: %s (len=%u)\n", path.c_str(), (unsigned)fb->len);

  File file = SD_MMC.open(path.c_str(), FILE_WRITE);
  if (!file) {
    Serial.println("[SD] Failed to open file for write");
    esp_camera_fb_return(fb);
    return false;
  }

  file.write(fb->buf, fb->len);
  file.close();
  esp_camera_fb_return(fb);

  Serial.println("[SD] Saved OK (unsent)");
  return true;
}

// ---------------------------
// Upload one JPEG file (RAW) to backend
// Sends:
//   Content-Type: image/jpeg
//   X-Filename: u_pic_0001.jpg
// Body: raw JPEG bytes
// ---------------------------
bool uploadFileToBackendRaw(const String &pathIn) {
  if (WiFi.status() != WL_CONNECTED) return false;

  // Ensure path has leading "/" for SD open
  String path = pathIn;
  if (!path.startsWith("/")) path = "/" + path;

  File f = SD_MMC.open(path.c_str(), FILE_READ);
  if (!f) {
    Serial.printf("[UPLOAD] Can't open %s\n", path.c_str());
    return false;
  }

  String url = String(BACKEND_BASE) + String(UPLOAD_PATH);

  WiFiClient client;
  HTTPClient http;

  Serial.printf("[UPLOAD] POST %s  (%s, %u bytes)\n",
                url.c_str(), path.c_str(), (unsigned)f.size());

  if (!http.begin(client, url)) {
    Serial.println("[UPLOAD] http.begin failed");
    f.close();
    return false;
  }

  http.setTimeout(15000);
  http.addHeader("Content-Type", "image/jpeg");

  // Filename header WITHOUT leading slash
  String fname = path;
  if (fname.startsWith("/")) fname = fname.substring(1);
  http.addHeader("X-Filename", fname);

  int code = http.sendRequest("POST", &f, f.size());
  f.close();

  if (code > 0) {
    Serial.printf("[UPLOAD] HTTP %d\n", code);
    String resp = http.getString();
    Serial.printf("[UPLOAD] Resp: %s\n", resp.c_str());
  } else {
    Serial.printf("[UPLOAD] Failed: %s\n", http.errorToString(code).c_str());
  }

  http.end();
  return (code == 200 || code == 201);
}

// ---------------------------
// Scan SD and upload all /u_*.jpg
// After success -> rename to /s_*.jpg
// ---------------------------
void uploadAllUnsent() {
  if (!sd_ok) {
    Serial.println("[SYNC] SD not OK -> skip upload");
    return;
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[SYNC] WiFi not connected -> skip upload");
    return;
  }

  File root = SD_MMC.open("/");
  if (!root) {
    Serial.println("[SYNC] Can't open root");
    return;
  }

  int uploaded = 0;
  File file = root.openNextFile();

  while (file) {
    String name = String(file.name()); // often "u_pic_0001.jpg" (no leading "/")
    file.close();

    bool isUnsent = (name.startsWith("u_") || name.startsWith("/u_")) && name.endsWith(".jpg");

    if (isUnsent) {
      // Ensure leading "/" for SD operations (open/rename)
      String unsentPath = name;
      if (!unsentPath.startsWith("/")) unsentPath = "/" + unsentPath;

      Serial.println("[SYNC] Found unsent: " + unsentPath);

      if (uploadFileToBackendRaw(unsentPath)) {
        // Rename to sent
        String sentPath = unsentPath;
        sentPath.replace("/u_", "/s_");

        bool ok = SD_MMC.rename(unsentPath.c_str(), sentPath.c_str());
        Serial.printf("[SYNC] Mark sent: %s -> %s (%s)\n",
                      unsentPath.c_str(), sentPath.c_str(), ok ? "OK" : "FAIL");
        uploaded++;
      } else {
        Serial.println("[SYNC] Upload failed -> stop trying for now");
        break;
      }

      delay(300);
    }

    file = root.openNextFile();
  }

  root.close();

  if (uploaded > 0) Serial.printf("[SYNC] Uploaded %d photos ✅\n", uploaded);
  else Serial.println("[SYNC] No unsent photos found.");
}

// ===========================
// SETUP
// ===========================
void setup() {
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println("\n=== ESP32-CAM SkyTracerCam Boot ===");

  // -------------------------------
  // Camera config
  // -------------------------------
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  config.frame_size   = FRAMESIZE_VGA;
  config.jpeg_quality = 12;
  config.fb_count     = 1;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location  = CAMERA_FB_IN_PSRAM;

  if (psramFound()) {
    Serial.println("[PSRAM] Found. Using 2 frame buffers.");
    config.jpeg_quality = 10;
    config.fb_count     = 2;
    config.grab_mode    = CAMERA_GRAB_LATEST;
  } else {
    Serial.println("[PSRAM] Not found. Using DRAM.");
    config.fb_location  = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[CAM] Init failed 0x%x\n", err);
    return;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s->id.PID == OV3660_PID) {
    s->set_vflip(s, 1);
    s->set_brightness(s, 1);
    s->set_saturation(s, -2);
  }
  s->set_framesize(s, FRAMESIZE_VGA);

#if defined(LED_GPIO_NUM)
  setupLedFlash();
#endif

  // -------------------------------
  // SD init (capture works even if WiFi down)
  // -------------------------------
  initSD();

  // -------------------------------
  // WiFi
  // -------------------------------
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(ssid, password);

  Serial.print("[WiFi] Connecting");
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 12000) {
    delay(300);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("[WiFi] Not connected (will retry in loop)");
  }

  // -------------------------------
  // Start streaming server (works when WiFi connected)
  // -------------------------------
  startCameraServer();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[CAM] Stream base: http://");
    Serial.print(WiFi.localIP());
    Serial.println("  (use /stream from example)");
  }
}

// ===========================
// LOOP
// ===========================
void loop() {
  unsigned long now = millis();

  // 1) Keep WiFi alive
  ensureWiFi();

  // 2) Capture photos periodically (always if SD ok)
  if (sd_ok && (now - lastShot >= CAPTURE_INTERVAL_MS)) {
    lastShot = now;
    Serial.printf("[CAPTURE] Photo #%d\n", photoIndex);
    if (savePhotoToSD_Unsent(photoIndex)) {
      photoIndex++;
    }
  }

  // 3) When WiFi is up, try to upload unsent photos sometimes
  if (WiFi.status() == WL_CONNECTED && (now - lastUploadTry >= UPLOAD_RETRY_MS)) {
    lastUploadTry = now;
    uploadAllUnsent();
  }

  delay(20);
}