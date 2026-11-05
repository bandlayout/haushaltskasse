# Haushaltskasse

Gemeinsame Ausgaben für zwei Personen erfassen, sehen wer wem was schuldet, und eine geteilte Einkaufsliste zum Abhaken.

- Eine einzige Datei: `index.html` (läuft z. B. auf GitHub Pages)
- Daten liegen in Supabase (Projekt `haushaltskasse`, Region Frankfurt), Tabellen `settings`, `expenses`, `shopping`
- Anmeldung mit einem gemeinsamen Passwort (Supabase-Konto `haushalt@example.com`). Nur dieses Konto darf die Tabellen lesen und schreiben (Row Level Security).
- Änderungen erscheinen bei beiden live (Supabase Realtime).

Der Schlüssel in `index.html` ist der öffentliche „publishable key“ und darf im Code stehen. Das Passwort steht nicht im Code.

Passwort ändern: Supabase-Dashboard → Authentication → Users → `haushalt@example.com` → Reset password / Update.
