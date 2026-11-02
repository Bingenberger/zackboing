# Zackboing: eigenständiger Containerbetrieb

Die lokale Anmeldung und öffentliche Spiel-PINs bleiben erhalten. Nur amd64
wurde gebaut und geprüft. Keine zentrale Sperrung, kein zentraler Logout.

## Erster Start

```sh
docker compose up -d --no-build
docker compose run --rm --no-deps app node server/migrate.js
docker compose run --rm --no-deps app node server/bootstrap.js
```

Das Runtimeimage muss zuvor mit `docker compose build` gebaut oder als geprüfte
Version bereitgestellt sein. Die erste Readiness bleibt bis zum expliziten
Migrationsjob 503. Import und Serverstart migrieren nicht. Migration ist durch
eine SQLite-IMMEDIATE-Transaktion exklusiv; neuere Schemaversionen werden abgewiesen.

Bootstrap erfordert ein kontrollierendes Terminal: Code nur dort ausgeben, weder
in Shellargumente noch in Logdateien übernehmen. Der erste Admin registriert sich
mit diesem Code im Formular. Es gibt kein Standardpasswort. Codeablauf maximal
15 Minuten, Speicherung nur als Hash, einmaliger Verbrauch in derselben
Transaktion wie der erste Account. Offene Selbstregistrierung ist standardmäßig
geschlossen; bestehende explizite Einstellungen bleiben erhalten.

Standalone veröffentlicht nur `127.0.0.1:${ZACKBOING_PORT:-3100}`.
TLS ist Aufgabe eines vorgeschalteten Proxys. Bestehende Variablen
`PORT` und `ZACKBOING_DATA` bleiben gültig.
`ZACKBOING_PUBLIC_URL` setzt zur Laufzeit eine vollständige HTTP(S)-Origin,
einschließlich eines abweichenden Ports. Sie steuert QR-Links, sichere Cookies
bei HTTPS und die WebSocket-Originprüfung.
`ZACKBOING_PROXY_IPS` akzeptiert nur explizite IP-Adressen, keine Wildcards.
Vertrauensheader müssen schon am Proxy entfernt werden. Ohne öffentliche URL
bleibt der bisherige Standalone-Hostbezug erhalten. Nichtbrowser-PIN-Clients ohne
Origin bleiben erlaubt.

## Container und Daten

Node 22.23.4, Basisdigest im Dockerfile, npm ci aus package-lock.json.
better-sqlite3 wird mit lokalen Node-Headern und beschreibbarem Cache gebaut.
Compiler bleiben in der Buildstufe. UID:GID 10001:10001, Read-only-Root,
begrenztes tmpfs und Compose-Ressourcenlimit 384 MiB/1 CPU/128 Prozesse.
Ein Initprozess übernimmt Signalweiterleitung und das Aufräumen von Kindprozessen.
Das sind gesetzte Limits, keine nachgewiesene Kapazität.

Persistenz: `/data/zackboing.db` samt SQLite-WAL und `/data/uploads`.
Verzeichnisse 0700, DB und neue Dateien 0600, Eigentümer 10001:10001.
Uploads werden als Daten über HTTP bedient, niemals als Programme ausgeführt.
`/health/live` prüft nur den Prozess; `/health/ready` prüft die eigene
Datenbank und Schemaversion. WebSockets und API bleiben vor Migration gesperrt.

## Stop, Sicherung und Wiederherstellung

Spielzustände liegen ausschließlich im Speicher. Der Pilot fragt deshalb vor
Stop oder konsistenter Sicherung den nur über rohes Container-Loopback erreichbaren
Kontrollpfad ab und blockiert neue Spiele. Solange ein Spiel nicht im Podium ist,
wird Stop verweigert und die Sperre wieder aufgehoben. Der private Kontrollpfad
ist über veröffentlichte Ports und den Proxy verboten.
Ein manuelles `docker compose stop` umgeht diese Plattformprüfung und kann ein
laufendes Spiel beenden; vorher alle Spiele abschließen.

Für ein gemeinsames DB-/Medienabbild alle Writer stoppen, SQLite-.backup-API
verwenden und Uploads mitsichern. Keine laufende DBdatei kopieren. Restore in ein
neues leeres Volume unter derselben UID, dann App ohne Migration/Bootstrap starten.
Container- und DB-Rollback sind getrennte Vorgänge; ein Image-Rollback macht eine
Datenmigration nicht rückgängig. `docker compose down` behält das Volume.

Die Plattform enthält einen generischen lokalen Snapshotbaustein und einen
synthetischen Restoreversuch. Verschlüsselter Offsitetransport, Rotation und
Alarmierung sind noch offen.

## Prüfungen

`node test/bootstrap.js` und `node test/session-expiry.js` verwenden lokale
Testdaten. Der E2E-Treiber erhält seinen kurzlebigen Bootstrapcode ausschließlich
über eine private Fixturedatei. Galerieprüfung benötigt eine lokale Fixture;
ohne Fixture wird sie ausdrücklich als nicht ausgeführt gemeldet.

Die Plattformprüfungen nutzen eine lokale CA mit Zertifikatsprüfung, einen lokalen
Galerieserver und synthetische Accounts unter example.invalid. Keine externen
SMTP-, KI- oder Galeriedienste erforderlich. Sessionablauf wird für HTTP und
jedes neue host:create geprüft, auch bei bereits offener Verbindung.
Ein bestehendes Spiel verwendet weiterhin eigene Host-/Rejoin-Capabilities bis
zum Spielende; daraus folgt keine zentrale Sessionrevokation.
