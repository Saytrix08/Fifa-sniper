# FC Snipe Helper

Overlay (Tampermonkey-Userscript) für die EA FC Web App, das dir beim **manuellen** Snipen die Arbeit abnimmt:

- **Snipe-Liste**: Spieler mit Verkaufspreis, Wunschgewinn, max. Kaufpreis und Anzahl („2x kaufen“).
- **Filter per Klick**: „Filter“ trägt Max. Sofortkauf und Spielernamen in die Transfermarkt-Suche ein. Die richtige Karte wählst du dann in der Vorschlagsliste.
- **Mindestpreis automatisch hochsetzen**: Wenn eine Suche nichts findet und du zurück auf die Suchseite gehst, steht der Min. Sofortkauf schon eine Preisstufe höher. Der nächste Klick auf „Suchen“ ist damit eine neue Abfrage. Nach einer einstellbaren Anzahl Erhöhungen fängt er wieder bei leer an. In den Einstellungen kannst du stattdessen „nach jeder Suche erhöhen“ wählen.
- **Gewinn nach 5 % EA-Steuer** als grünes/rotes Badge an jeder Karte in den Suchergebnissen.
- **Zähler und Verlauf**: „+1 Kauf“ und „Verkauft“ protokollieren Käufe und Verkäufe. Du siehst „1/2 gekauft“, Ausgaben, Einnahmen und Bilanz.
- **Suchzähler** für die letzten 60 Minuten, damit du dein Tempo im Blick behältst.

**Suchen, Zurück und Kaufen klickst du selbst.** Das Script startet keine Suchen, aktualisiert nicht automatisch und kauft nichts. Es füllt nur Felder aus und rechnet.

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) im Browser installieren.
2. Tampermonkey → „Neues Script erstellen“ → den gesamten Inhalt von [`fc-snipe-helper.user.js`](fc-snipe-helper.user.js) einfügen → speichern.
3. Die Web App öffnen (`https://www.ea.com/…/ea-sports-fc/ultimate-team/web-app/`). Oben rechts erscheint das Overlay.

## Ablauf

1. Unter **Spieler hinzufügen**: Name, Verkaufspreis und Wunschgewinn eintragen. Der Max. Kaufpreis wird automatisch berechnet (Verkaufspreis − 5 % Steuer − Wunschgewinn, abgerundet auf eine gültige Preisstufe), du kannst ihn aber auch selbst eintragen.
2. In der Web App **Transfers → Transfermarkt durchsuchen** öffnen.
3. Im Overlay beim Spieler auf **Filter** klicken und in der Vorschlagsliste die richtige Karte auswählen.
4. **Suchen** klicken. Findest du nichts, gehst du zurück: Der Min. Sofortkauf ist bereits erhöht, also gleich wieder **Suchen**.
5. Nach einem Kauf **+1 Kauf** klicken. Vorgeschlagen wird der günstigste Preis aus der letzten Suche.

## Wenn etwas nicht gefunden wird

Ich konnte das Script nicht gegen die echte FC-27-Web-App testen. Die Element-Selektoren basieren auf dem bisherigen Aufbau der Web App und können sich ändern.

- Im Overlay unter **Einstellungen → Diagnose** siehst du, welche Elemente gefunden werden. Am besten testest du das auf der Seite „Transfermarkt durchsuchen“.
- Passe die Werte in `SELECTORS` oben im Script an. Über die Entwicklertools (Rechtsklick → „Untersuchen“) findest du die aktuellen Klassennamen.

## Hinweis

Laut EA-Nutzungsbedingungen sind auch Erweiterungen, die die Web App verändern, nicht erlaubt. Weil hier jede Suche und jeder Kauf von dir kommt, ist das Risiko viel kleiner als bei einem Bot, aber nicht null. Behalte den Suchzähler im Blick und mach Pausen.

## Entwicklung

Die Preislogik (Preisstufen, Steuer, Mindestpreis-Zyklus) hat keine DOM-Abhängigkeiten und ist getestet:

```sh
npm test
```
