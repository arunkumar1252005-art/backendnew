#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <Audio.h>
#include <ArduinoJson.h>

// ================== WIFI CONFIG ==================
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ================== AUDIO CONFIG =================
#define I2S_DOUT  18
#define I2S_BCLK  19
#define I2S_LRC   21

// MAX98357A Shutdown Pin
#define SD_PIN    5   // Speaker ON/OFF

// ================== GLOBAL OBJECTS =================
AsyncWebServer server(80);
Audio audio;

// ================== STATE ==================
bool isPlaying = false;
String currentURL = "";

// ================== AUDIO CALLBACKS =================
void audio_info(const char *info) {
  Serial.print("INFO: ");
  Serial.println(info);
}

void audio_eof_mp3(const char *info) {
  Serial.println("Audio Finished");
  audio.stopSong();
  digitalWrite(SD_PIN, LOW);   // 🔇 Speaker OFF
  isPlaying = false;
}

// ================== SETUP ==================
void setup() {
  Serial.begin(115200);
  delay(500);

  // Speaker OFF at boot ✅
  pinMode(SD_PIN, OUTPUT);
  digitalWrite(SD_PIN, LOW);

  // Audio setup
  audio.setPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  audio.setVolume(10); // Safe volume (0–21)

  // WiFi connect
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi Connected!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());

  // ================== API: PLAY ==================
  server.on(
    "/api/play",
    HTTP_POST,
    [](AsyncWebServerRequest *request) {},
    nullptr,
    [](AsyncWebServerRequest *request, uint8_t *data, size_t len, size_t, size_t) {

      DynamicJsonDocument doc(512);
      if (deserializeJson(doc, data, len)) {
        request->send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
        return;
      }

      String url = doc["url"].as<String>();
      if (url == "") {
        request->send(400, "application/json", "{\"error\":\"URL missing\"}");
        return;
      }

      // Stop previous audio safely
      if (isPlaying) {
        audio.stopSong();
        delay(100);
      }

      currentURL = url;
      digitalWrite(SD_PIN, HIGH);   // 🔊 Speaker ON
      bool ok = audio.connecttohost(currentURL.c_str());

      if (ok) {
        isPlaying = true;
        Serial.println("Streaming: " + currentURL);
        request->send(200, "application/json", "{\"status\":\"playing\"}");
      } else {
        digitalWrite(SD_PIN, LOW);
        request->send(500, "application/json", "{\"error\":\"Stream failed\"}");
      }
    }
  );

  // ================== API: STOP ==================
  server.on("/api/stop", HTTP_POST, [](AsyncWebServerRequest *request) {
    audio.stopSong();
    digitalWrite(SD_PIN, LOW);
    isPlaying = false;
    request->send(200, "application/json", "{\"status\":\"stopped\"}");
  });

  server.begin();
  Serial.println("ESP32 Audio Server Started");
}

// ================== LOOP ==================
void loop() {
  audio.loop();  // REQUIRED for streaming
}
