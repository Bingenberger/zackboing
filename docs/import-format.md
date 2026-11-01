# Zackboing – Importformat für Quizze

Diese Seite beschreibt das JSON-Format, mit dem sich Quizze in Zackboing
importieren lassen. Sie ist so geschrieben, dass man sie komplett an einen
Chatbot (ChatGPT, Claude, …) übergeben kann, zusammen mit einer Bitte wie:

> „Erstelle nach dieser Formatbeschreibung ein Quiz mit 10 Fragen zum Thema
> Photosynthese für Klasse 7, Fach Biologie. Gib nur das JSON aus.“

Das Ergebnis als Datei `name.zackboing.json` speichern und im Lehrerbereich
über **📥 Importieren** hochladen. Der Import ist tolerant: fehlende Werte
werden mit Standardwerten ergänzt, Fehler werden mit Fragenummer gemeldet.

---

## 1. Grundstruktur

```json
{
  "format": "zackboing-quiz",
  "version": 1,
  "title": "Bruchrechnung Klasse 6",
  "subject": "Mathematik",
  "questions": [
    { "...": "siehe Fragetypen unten" }
  ]
}
```

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `format` | nein | Immer `"zackboing-quiz"` |
| `version` | nein | Immer `1` |
| `title` | **ja** | Titel des Quiz, max. 80 Zeichen |
| `subject` | nein | Fach, z. B. `"Mathematik"`, `"Deutsch"`, `"Englisch"`, `"Biologie"`, `"Geschichte"`, `"Erdkunde"`, `"Sachunterricht"` … (max. 40 Zeichen) |
| `questions` | **ja** | Liste der Fragen, 1 bis 100 Stück |

Mehrere Quizze in einer Datei: entweder eine JSON-Liste `[ {…}, {…} ]` oder
`{ "quizzes": [ {…}, {…} ] }`.

## 2. Felder, die jede Frage hat

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `type` | **ja** | Fragetyp, siehe Abschnitt 3 |
| `text` | **ja** | Fragetext, max. 200 Zeichen |
| `time` | nein | Zeitlimit in Sekunden: `5`, `10`, `20`, `30`, `60`, `90` oder `120`. Standard `20`. Andere Werte werden auf den nächsten erlaubten gerundet. |
| `points` | nein | `"normal"` (Standard), `"double"` (doppelte Punkte) oder `"none"` (keine Punkte). Meinungsfragen haben nie Punkte. |
| `media` | nein | Bild, Audio oder Video zur Frage, siehe Abschnitt 4 |

## 3. Fragetypen

### Wissensfragen (mit Punkten)

Punkte gibt es für richtige Antworten, je schneller desto mehr. Bei
`"points": "double"` doppelt so viele.

#### `choice` – Quiz (Mehrfachauswahl, eine richtige Antwort)

```json
{
  "type": "choice",
  "text": "Was ist 3/4 als Dezimalzahl?",
  "answers": ["0,25", "0,5", "0,75", "0,34"],
  "correct": 2,
  "time": 20,
  "points": "normal"
}
```

- `answers`: 2 bis 4 Antworten, je max. 90 Zeichen. Statt Text ist auch ein
  Objekt `{ "text": "…", "media": "https://…/bild.jpg" }` erlaubt (Bild pro Antwort).
- `correct`: Index der richtigen Antwort, **0-basiert** (`0` = erste Antwort).
  Alternativ der exakte Antworttext, z. B. `"correct": "0,75"`.

#### `truefalse` – Wahr oder Falsch

```json
{
  "type": "truefalse",
  "text": "Ein Viertel ist größer als ein Drittel.",
  "correct": false
}
```

- `correct`: `true` (Behauptung ist wahr) oder `false`. Auch `"wahr"`/`"falsch"` erlaubt.

#### `freetext` – Freitext (Antwort eintippen)

```json
{
  "type": "freetext",
  "text": "Wie heißt die Hauptstadt von Frankreich?",
  "accepted": ["Paris"]
}
```

- `accepted`: 1 bis 10 richtige Schreibweisen, je max. 80 Zeichen.
  Groß-/Kleinschreibung ist egal. Sinnvoll: Varianten wie
  `["Fotosynthese", "Photosynthese"]` oder `["1789", "1789 n. Chr."]`.
- Kurze, eindeutige Antworten wählen (ein Wort oder eine Zahl).

#### `slider` – Schätzfrage (Zahl mit Schieberegler)

```json
{
  "type": "slider",
  "text": "Wie hoch ist der Mount Everest (in Metern)?",
  "min": 5000,
  "max": 10000,
  "step": 10,
  "correct": 8849,
  "tolerance": 200
}
```

- `min`, `max`: Bereich des Reglers (`min` < `max`).
- `step`: Schrittweite, Standard `1`. Es dürfen höchstens 2000 Schritte
  zwischen `min` und `max` liegen.
- `correct`: richtige Zahl, muss im Bereich liegen.
- `tolerance`: innerhalb dieser Abweichung gibt es volle Punkte, danach
  fallen die Punkte linear bis zum Rand ab. Standard `0`.
- **Wichtig:** `min` und `max` **nicht symmetrisch** um die richtige Zahl legen
  (also nicht `0`–`100` bei Lösung `50`), sonst lässt sich die Lösung aus der
  Mitte des Bereichs erraten. Besser z. B. `5000`–`10000` bei Lösung `8849`.

#### `order` – Puzzle (Reihenfolge herstellen)

```json
{
  "type": "order",
  "text": "Bringe die Planeten in die richtige Reihenfolge – von der Sonne aus:",
  "answers": ["Merkur", "Venus", "Erde", "Mars"]
}
```

- `answers`: 2 bis 6 Schritte **in der richtigen Reihenfolge**, je max. 90 Zeichen.
  Die App mischt sie für die Schüler. Nur die komplett richtige Reihenfolge zählt.

### Meinungsfragen (ohne Punkte)

#### `poll` – Umfrage

```json
{
  "type": "poll",
  "text": "Welches Thema wollt ihr als Nächstes?",
  "answers": ["Brüche", "Dezimalzahlen", "Prozente"]
}
```

- `answers`: 2 bis 4 Optionen. Kein `correct`.

#### `scale` – Skala (Einschätzung)

```json
{
  "type": "scale",
  "text": "Wie sicher fühlst du dich beim Kürzen von Brüchen?",
  "min": 1,
  "max": 5,
  "minLabel": "gar nicht sicher",
  "maxLabel": "sehr sicher"
}
```

- `min`: `0` oder `1` (Standard `1`), `max`: bis `10` (Standard `5`).
- `minLabel`, `maxLabel`: Beschriftung der Enden, je max. 40 Zeichen.

#### `wordcloud` – Wortwolke (ein Begriff pro Person)

```json
{ "type": "wordcloud", "text": "Ein Wort, das dir zu „Mittelalter“ einfällt:" }
```

#### `brainstorm` – Brainstorming (bis zu 3 Ideen pro Person, live sichtbar)

```json
{ "type": "brainstorm", "text": "Wie könnten wir Wasser im Schulalltag sparen?", "time": 90 }
```

## 4. Medien (optional)

```json
"media": { "url": "https://example.org/bild.jpg", "kind": "image" }
```

- `kind`: `"image"`, `"audio"` oder `"video"`. Fehlt es, wird es aus der
  Dateiendung erraten. Auch die Kurzform `"media": "https://…/bild.jpg"` geht.
- Erlaubt sind öffentliche `http(s)`-URLs sowie Pfade `/media/…` aus einem
  Zackboing-Export desselben Servers. Nicht vorhandene Dateien werden beim
  Import weggelassen (mit Hinweis), das Quiz wird trotzdem angelegt.
- Ein Chatbot sollte **keine Medien erfinden**. Bilder lassen sich später im
  Editor über das Bildarchiv oder per Upload ergänzen.

## 5. Kopfrechenrunden

Statt Fragen enthält eine Kopfrechenrunde nur Einstellungen. Die Aufgaben würfelt
Zackboing bei jedem Spielstart neu.

```json
{
  "format": "zackboing-quiz",
  "version": 1,
  "title": "Kopfrechnen bis 20",
  "subject": "Mathematik",
  "mode": "mental",
  "mental": { "count": 10, "range": 20, "ops": ["add", "sub"], "time": 20 }
}
```

| Feld | Beschreibung |
|---|---|
| `mode` | `"mental"` für eine Kopfrechenrunde (fehlt es, ist es ein normales Quiz) |
| `mental.count` | Aufgabenzahl, 3 bis 50. Standard `10`. Lässt sich vor dem Start in der Lobby ändern. |
| `mental.range` | Zahlenraum: `10`, `20`, `100` oder `1000`. Standard `20`. |
| `mental.ops` | Rechenarten, mindestens eine: `"add"` (+), `"sub"` (−), `"mul"` (·), `"div"` (:). Standard `["add", "sub"]`. |
| `mental.time` | Sekunden pro Aufgabe: `5`, `10`, `20`, `30` oder `60`. Standard `20`. |

## 6. Tipps für gute Quizze

- Mischung aus Fragetypen: überwiegend `choice`, dazu einzelne `truefalse`,
  `freetext`, `slider` und `order`; am Ende evtl. eine `scale`- oder
  `wordcloud`-Frage zur Reflexion.
- Fragetexte kurz halten (auf dem Beamer lesbar), Antworten ähnlich lang.
- Bei `choice` die richtige Antwort an wechselnde Positionen setzen.
- Zeitlimits: leichte Fragen `10`–`20` s, Rechen- und Schätzfragen `30`–`60` s.
- Sprache: Deutsch, altersgerecht für die angegebene Klassenstufe.
- Ausgabe muss gültiges JSON sein (keine Kommentare, keine abschließenden Kommas).

## 7. Vollständiges Beispiel

```json
{
  "format": "zackboing-quiz",
  "version": 1,
  "title": "Das Sonnensystem",
  "subject": "Physik",
  "questions": [
    {
      "type": "choice",
      "text": "Welcher Planet ist der Sonne am nächsten?",
      "answers": ["Venus", "Merkur", "Erde", "Mars"],
      "correct": 1,
      "time": 10
    },
    {
      "type": "truefalse",
      "text": "Der Jupiter ist der größte Planet unseres Sonnensystems.",
      "correct": true,
      "time": 10
    },
    {
      "type": "freetext",
      "text": "Wie heißt der Planet mit den auffälligen Ringen?",
      "accepted": ["Saturn"],
      "time": 20
    },
    {
      "type": "slider",
      "text": "Wie viele Monde hat der Mars?",
      "min": 0,
      "max": 20,
      "step": 1,
      "correct": 2,
      "tolerance": 0,
      "time": 20
    },
    {
      "type": "order",
      "text": "Sortiere von der Sonne aus nach außen:",
      "answers": ["Erde", "Mars", "Jupiter", "Saturn"],
      "time": 30,
      "points": "double"
    },
    {
      "type": "poll",
      "text": "Welchen Planeten würdest du am liebsten besuchen?",
      "answers": ["Mars", "Saturn", "Neptun"],
      "time": 20
    },
    {
      "type": "scale",
      "text": "Wie gut kennst du dich jetzt im Sonnensystem aus?",
      "min": 1,
      "max": 5,
      "minLabel": "noch unsicher",
      "maxLabel": "Profi",
      "time": 20
    },
    {
      "type": "wordcloud",
      "text": "Ein Wort, das dir zum Weltall einfällt:",
      "time": 30
    }
  ]
}
```
