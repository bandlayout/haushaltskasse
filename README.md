# Haushaltskasse

Gemeinsame Ausgaben für zwei Personen erfassen, sehen wer wem was schuldet, und eine geteilte Einkaufsliste zum Abhaken.

- Eine einzige Datei: `index.html` (läuft z. B. auf GitHub Pages)
- Daten liegen in Supabase (Projekt `haushaltskasse`, Region Frankfurt), Tabellen `settings`, `pockets`, `expenses`, `shopping`, `members`
- Pockets: jedes Pocket (z. B. Lebensmittel, Camper, Urlaub) hat einen eigenen Saldo
- Anmeldung mit E-Mail und Passwort. Nur Adressen in der Tabelle `members` dürfen lesen und schreiben (Row Level Security); dort steht auch, wer Person A und B ist.
- Änderungen erscheinen bei beiden live (Supabase Realtime).

Der Schlüssel in `index.html` ist der öffentliche „publishable key“ und darf im Code stehen. Das Passwort steht nicht im Code.

Passwort ändern: in der App oben auf „Passwort ändern“.

Updates: In `index.html` steht `APP_VERSION`. Bei jeder Änderung hochzählen – die installierte App prüft beim Öffnen bzw. wenn sie wieder in den Vordergrund kommt, ob eine neuere Version da ist, und lädt sich dann selbst neu. Kein Neu-Hinzufügen zum Homescreen nötig.
