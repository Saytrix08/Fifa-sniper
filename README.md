# FC Snipe Helper

Overlay (Tampermonkey-Userscript) für die EA FC Web App, das dir beim **manuellen** Snipen die Arbeit abnimmt:

- **Snipe-Liste**: Spieler mit Verkaufspreis, Wunschgewinn, max. Kaufpreis und Anzahl („2x kaufen“).
- **Filter per Klick**: „Filter“ trägt Max. Sofortkauf und Spielernamen in die Transfermarkt-Suche ein. Die richtige Karte wählst du dann in der Vorschlagsliste.
- **Pfeiltasten**: **←** geht von den Ergebnissen zurück zur Suche, **→** startet auf der Suchseite die Suche. Ein Tastendruck ist genau eine Aktion. Gedrückt halten wiederholt nichts, und zwei Tastendrücke innerhalb von 0,3 Sekunden zählen nur einmal. In Textfeldern (z. B. beim Spielernamen) verhalten sich die Pfeiltasten normal.
- **Mindestpreis automatisch hochsetzen**: Sobald eine Suche „keine Ergebnisse“ meldet, setzt das Script den Min. Sofortkauf eine Preisstufe höher. Erkennt es die Meldung nicht, erhöht es spätestens direkt vor der nächsten Suche (per → oder Klick auf „Suchen“), wenn der Wert noch der von der letzten Suche ist. Jede Suche ist damit eine neue Abfrage. Nach einer einstellbaren Anzahl Erhöhungen fängt er wieder bei leer an. In den Einstellungen kannst du stattdessen „nach jeder Suche erhöhen“ wählen.
- **Gewinn nach 5 % EA-Steuer** als grünes/rotes Badge an jeder Karte in den Suchergebnissen.
- **Zähler und Verlauf**: „+1 Kauf“ und „Verkauft“ protokollieren Käufe und Verkäufe. Du siehst „1/2 gekauft“, Ausgaben, Einnahmen und Bilanz.
- **Suchzähler** für die letzten 60 Minuten, damit du dein Tempo im Blick behältst.

**Jede Suche und jeden Kauf löst du selbst aus**, per Klick oder Pfeiltaste. Das Script sucht nie von allein, aktualisiert nicht automatisch und kauft nichts.

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) im Browser installieren.
2. **[Hier klicken zum Installieren](https://raw.githubusercontent.com/Saytrix08/Fifa-sniper/refs/heads/claude/festive-maxwell-t8mr00/fc-snipe-helper.user.js)**. Tampermonkey öffnet eine Installationsseite → **„Installieren“** bzw. bei einem Update **„Aktualisieren“**. Kein Kopieren nötig.
3. **Nur Chrome/Edge/Brave:** `chrome://extensions` öffnen → bei Tampermonkey auf **Details** → **„Nutzerskripts zulassen“ / „Allow user scripts“** einschalten. Bei älteren Chrome-Versionen stattdessen oben rechts den **Entwicklermodus** einschalten. Ohne diesen Schalter führt Tampermonkey gar keine Scripts aus.
4. Die Web App öffnen (`https://www.ea.com/ea-sports-fc/ultimate-team/web-app/`) und die Seite einmal neu laden. Oben rechts erscheint das Overlay.

### Overlay erscheint nicht?

- **Tampermonkey-Symbol** in der Browserleiste: Auf der Web App sollte eine rote **1** daran stehen und „FC Snipe Helper“ beim Anklicken aktiviert sein. Steht keine Zahl dran, startet Tampermonkey das Script nicht. Dann den Schalter aus Schritt 3 prüfen.
- **Tampermonkey-Menü:** Auf das Tampermonkey-Symbol klicken → unter „FC Snipe Helper“ auf **„Overlay anzeigen / Status“**. Es öffnet sich ein Fenster, das sagt, ob das Script läuft, wo das Overlay liegt oder welcher Fehler beim Start kam.
- **Rote Box oben rechts:** Wenn der Start fehlschlägt, zeigt das Script die Fehlermeldung direkt auf der Seite an.
- **Konsole** (F12 → Reiter „Console“): Dort sollte `[FC Snipe Helper] geladen auf …` stehen.

## Ablauf

1. Unter **Spieler hinzufügen**: Name, Verkaufspreis und Wunschgewinn eintragen. Der Max. Kaufpreis wird automatisch berechnet (Verkaufspreis − 5 % Steuer − Wunschgewinn, abgerundet auf eine gültige Preisstufe), du kannst ihn aber auch selbst eintragen.
2. In der Web App **Transfers → Transfermarkt durchsuchen** öffnen.
3. Im Overlay beim Spieler auf **Filter** klicken und in der Vorschlagsliste die richtige Karte auswählen.
4. **→** drücken (oder „Suchen“ klicken). Nichts gefunden: **←** zurück, **→** wieder suchen. Der Min. Sofortkauf wird dabei automatisch weitergesetzt. Im Overlay steht nach jeder Suche, mit welchem Wert gesucht wurde.
5. Nach einem Kauf **+1 Kauf** klicken. Vorgeschlagen wird der günstigste Preis aus der letzten Suche.

## Wenn etwas nicht gefunden wird

Ich konnte das Script nicht gegen die echte FC-27-Web-App testen. Die Element-Selektoren basieren auf dem bisherigen Aufbau der Web App und können sich ändern.

- Im Overlay unter **Einstellungen → Diagnose** siehst du, welche Elemente gefunden werden. Am besten testest du das auf der Seite „Transfermarkt durchsuchen“.
- **Einstellungen → Seitenaufbau kopieren** kopiert den sichtbaren Aufbau der Seite (Elemente, Klassennamen, kurze Texte) in die Zwischenablage. Das einmal auf der Suchseite und einmal auf der Ergebnisseite machen und einschicken, dann lassen sich die Selektoren passend machen.
- Passe die Werte in `SELECTORS` oben im Script an. Über die Entwicklertools (Rechtsklick → „Untersuchen“) findest du die aktuellen Klassennamen.

## Hinweis

Laut EA-Nutzungsbedingungen sind auch Erweiterungen, die die Web App verändern, nicht erlaubt. Weil hier jede Suche und jeder Kauf von dir ausgelöst wird, ist das Risiko viel kleiner als bei einem Bot, aber nicht null. Behalte den Suchzähler im Blick und mach Pausen.

## Entwicklung

Die Preislogik (Preisstufen, Steuer, Mindestpreis-Zyklus) hat keine DOM-Abhängigkeiten und ist getestet:

```sh
npm test
```
