# Zackboing 🎮

Ein Live-Quizspiel für die Schule im Stil von Kahoot: Lehrkräfte erstellen Quizze,
Schüler treten mit ihren Geräten live gegeneinander an – mit Musik, Soundeffekten,
Punkteserien, Bestenliste und Siegerehrung mit Konfetti.

## Starten

```bash
npm install
npm start
```

Der Server läuft dann auf **http://localhost:3000**.

## Ablauf im Unterricht

1. **Lehrkraft:** `http://<server>/teacher.html` öffnen, Konto anlegen, Quiz erstellen.
2. Im Dashboard auf **▶ Starten** klicken – die Host-Ansicht öffnet sich in einem
   neuen Tab. Dieses Fenster auf den Beamer/das Klassendisplay spiegeln.
3. **Schüler:** scannen den QR-Code auf dem Bildschirm oder öffnen die Seite und
   geben die 6-stellige **Spiel-PIN** und einen Spitznamen ein.
4. Lehrkraft startet das Spiel – der Server steuert den Ablauf synchron auf allen
   Geräten.

## Fragetypen

**Mit Punkten (Wissensfragen):**

| Typ | Beschreibung |
|---|---|
| 🎯 Quiz | 2–4 Antworten (Text und/oder Bild), eine richtig |
| ⚖️ Wahr oder Falsch | Behauptung prüfen |
| ⌨️ Freitext | Antwort eintippen (mehrere richtige Schreibweisen möglich, Groß-/Kleinschreibung egal) |
| 🎚️ Schätzfrage | Zahl mit Schieberegler schätzen; volle Punkte innerhalb der Toleranz, danach linear abfallend |
| 🧩 Puzzle | Antworten in die richtige Reihenfolge bringen (nur die perfekte Reihenfolge zählt) |

**Ohne Punkte (Meinungsbilder):**

| Typ | Beschreibung |
|---|---|
| 📊 Umfrage | Abstimmung, Ergebnis als Diagramm |
| 📏 Skala | Einschätzung z. B. 1–5 mit eigenen Beschriftungen, Durchschnitt auf dem Beamer |
| ☁️ Wortwolke | Jede Person schickt einen Begriff, Anzeige als Wolke (häufigere Wörter größer) |
| 💡 Brainstorming | Bis zu 3 Ideen pro Person, erscheinen **live** auf dem Beamer; Runde per „Frage beenden“ schließen |

## Kopfrechenmodus (Grundschule)

Über **🧮 Neue Kopfrechenrunde** im Dashboard entsteht statt eines Quiz eine
Kopfrechenrunde. Sie speichert nur Einstellungen, die Aufgaben werden bei jedem
Spielstart neu gewürfelt:

- **Anzahl Aufgaben** per Schieberegler (3–50). Vor dem Start lässt sich die Zahl
  in der Lobby auf dem Beamer noch für diese Runde anpassen.
- **Zahlenraum:** bis 10, 20, 100 oder 1000.
- **Rechenarten:** Plus, Minus, Mal, Geteilt (beliebig kombinierbar, gleichmäßig
  gemischt). Minus-Ergebnisse sind nie negativ, Geteilt-Aufgaben gehen ohne Rest
  auf. Mal/Geteilt: bis 100 kleines Einmaleins, bis 1000 auch mit Zehnerzahlen (7 · 80).
- **Zeit pro Aufgabe:** 5 bis 60 Sekunden.
- Im Editor zeigt eine Vorschau Beispielaufgaben.

Im Spiel erscheint die Aufgabe erst mit dem Startsignal (keine Bedenkzeit), die
Kinder tippen das Ergebnis auf einer großen Zahlentastatur ein. Nach jeder Aufgabe
zeigt der Beamer Lösung, Trefferzahl und häufige Fehlantworten und geht nach
6 Sekunden automatisch weiter. Mit **⏸ Anhalten** bleibt die Auflösung stehen,
z. B. zum Besprechen. Punkte, Serien und Podium funktionieren wie beim Quiz.

## Medien

- Zu jeder Frage: **Bild, Audio oder Video** (Upload, max. 25 MB) – wird auf dem
  Beamer angezeigt/abgespielt.
- Bei Quiz-/Umfrage-Antworten: zusätzlich **Bilder pro Antwort**.
- **Bildarchiv-Anbindung** (Standard: pix.foerster.rocks): direkt im Editor
  durchsuchen; ausgewählte Bilder werden **lokal importiert**, damit das Quiz
  auch ohne Internet läuft. Die Archiv-URL ist im Adminbereich einstellbar.

## Spielprinzip

- **Geschwindigkeit zählt:** Richtige Antworten geben 500–1000 Punkte (bei
  „Doppelte Punkte“-Fragen bis 2000) – je schneller, desto mehr.
- **Serien-Bonus:** Wer mehrmals hintereinander richtig liegt, bekommt bis zu
  600 Bonuspunkte pro Frage (🔥-Anzeige).
- Nach jeder Frage: typgerechte Auswertung auf dem Beamer (Diagramm, Wortwolke,
  Zahlenstrahl mit allen Schätzungen, …) + Top-5-Zwischenstand.
- Am Ende: animiertes Podium mit Fanfare und Konfetti; jeder Schüler sieht sein
  persönliches Ergebnis auf dem eigenen Gerät.

## Fächer & Quiz-Bibliothek

- Jedes Quiz kann einem **Fach** zugeordnet werden (Fächerliste im Adminbereich
  anpassbar).
- Mit „**Für andere Lehrkräfte freigeben**“ landet ein Quiz in der gemeinsamen
  **Bibliothek** (Tab „📚 Bibliothek“ im Dashboard): dort nach Fach gruppiert,
  per Fach-Filter und Titelsuche durchsuchbar.
- Freigegebene Quizze können Kollegen **direkt starten** oder **in die eigene
  Sammlung kopieren** (zum Anpassen; die Kopie heißt „… (von Name)“).

## Import & Export (auch für Chatbots)

- **⬇️ Export** bei jedem Quiz (eigene und Bibliothek) lädt es als JSON-Datei
  herunter, **📦 Alle exportieren** sichert alle eigenen Quizze in einer Datei.
- **📥 Importieren** nimmt eine oder mehrere solcher Dateien an (auch
  Sammeldateien). Importierte Quizze landen als neue, nicht freigegebene Quizze
  in der eigenen Sammlung. Fehler werden mit Quiz- und Fragenummer gemeldet;
  bei einem Fehler wird nichts angelegt.
- Das Format ist unter `/import-format.md` dokumentiert (Quelle:
  `docs/import-format.md`). Die Seite ist als Anleitung für Chatbots gedacht:
  Text kopieren, an ChatGPT/Claude o. ä. geben („Erstelle nach dieser
  Beschreibung ein Quiz zu …“), das JSON als Datei speichern, importieren.
  Der Import ist tolerant (Typ-Aliasse, Standardwerte, Antworttext statt Index).
- Medien werden per URL referenziert; `/media/…`-Pfade funktionieren nur auf
  demselben Server, fehlende Dateien werden beim Import mit Hinweis weggelassen.

## Adminbereich

Das **erste registrierte Konto** wird automatisch Admin (Zugang über den
⚙️-Button im Lehrer-Dashboard oder `/admin.html`):

- Lehrerkonten anlegen, löschen, Passwörter zurücksetzen, Admin-Rechte vergeben
- Selbstregistrierung erlauben/sperren (bei gesperrter Registrierung legt der
  Admin die Konten an)
- Bildarchiv-URL konfigurieren
- Fächerliste pflegen (kommagetrennt)

## Einsatz im Schulnetz

Die Schülergeräte müssen den Server erreichen können. Am einfachsten:

```bash
PORT=3000 npm start
```

und die Host-Seite über die **LAN-IP** des Rechners öffnen (z. B.
`http://192.168.1.20:3000/teacher.html`) – QR-Code und Beitritts-URL übernehmen
dann automatisch diese Adresse.

Musik und Soundeffekte werden komplett im Browser synthetisiert (WebAudio) –
es wird keine Internetverbindung benötigt.

### Wackliges WLAN? Kein Problem

- Bricht die Verbindung eines Schülergeräts kurz ab, verbindet sich der Browser
  automatisch neu und der Server erkennt das Kind wieder – **Name, Avatar,
  Punkte und Serie bleiben erhalten**, sogar nach einem Neuladen der Seite.
  Solange zeigt das Gerät „📶 Kurz kein Empfang …“.
- In der Lobby bleiben kurz getrennte Kinder ausgegraut sichtbar; ihr Platz und
  Name sind 60 Sekunden reserviert.
- Verliert das **Lehrergerät** die Verbindung, läuft das Spiel serverseitig
  weiter: Der Beamer holt sich nach dem Reconnect (oder Neuladen) automatisch
  den aktuellen Stand zurück. Erst nach 90 Sekunden ohne Lehrergerät wird das
  Spiel abgebrochen.

## Technik

- **Server:** Node.js, Express, Socket.IO, SQLite (better-sqlite3)
- **Client:** Vanilla JS, kein Build-Schritt
- **Daten:** `data/zackboing.db` + Uploads in `data/uploads/` (werden automatisch angelegt)
- Der Spielablauf (Timing, Punkte) läuft komplett serverseitig – Schummeln über
  den Client ist nicht möglich; Spieler erhalten die Lösung nie vorab.

## Installation auf einem Server

Im Ordner `deploy/` liegen alles Nötige: systemd-Dienst, nginx-/Caddy-Beispiel und
zwei Skripte. Der Server braucht nur Node.js ≥ 18, rsync und Build-Werkzeuge für
`better-sqlite3` (Debian/Ubuntu: `apt install build-essential python3`).

```bash
./deploy/deploy.sh root@mein-server    # kopiert den Code und führt dort deploy/install.sh aus
```

Das Skript legt den Systemnutzer `zackboing` an, installiert nach `/opt/zackboing`,
speichert Datenbank und Uploads in `/var/lib/zackboing` und startet den Dienst
`zackboing.service` auf **Port 3100** (nur intern). Davor gehört ein Reverse-Proxy:

- **nginx:** `deploy/nginx-zackboing.conf` nach `/etc/nginx/sites-available/` kopieren,
  Domain anpassen, verlinken, `certbot --nginx -d …`
- **Caddy:** `deploy/Caddyfile-snippet` in die Caddyfile übernehmen (TLS automatisch)

Nützliche Befehle: `systemctl status zackboing`, `journalctl -u zackboing -f`.
Update: einfach `deploy.sh` erneut ausführen – die Daten in `/var/lib/zackboing` bleiben.

## Tests

Der Test erwartet eine **leere** Datenbank (erstes Konto = Admin). Damit die
echten Daten unangetastet bleiben, den Testserver mit eigenem Datenverzeichnis
und Port starten:

```bash
# Terminal 1: Testserver
PORT=3999 ZACKBOING_DATA=/tmp/zackboing-test node server/index.js

# Terminal 2: Testlauf (Admin, Medien, alle Fragetypen, komplettes Spiel, Reconnect)
BASE_URL=http://localhost:3999 npm test

rm -rf /tmp/zackboing-test   # danach aufräumen
```
