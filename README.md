GeoRoute — README essenziale

Descrizione

MondoConfini è una web-app 3D (Three.js) che mostra un mappamondo con confini reali e un semplice gioco: partire da uno stato e raggiungerne un altro inserendo i nomi di stati confinanti.

Requisiti

- Browser moderno (Chrome/Edge/Firefox)
- Node.js (opzionale, per avviare un server con http-server)
- Python (opzionale, per avviare un server con http.server)

Struttura principale

- web/            → codice della web-app
  - index.html
  - style.css
  - app.js
  - vendor/       → librerie minificate (three, topojson, ...)
  - data/         → countries-110m.json, countries.json (TopoJSON e metadata)

Avvio rapido (sviluppo)

1) Usando Node (consigliato se installato)
   - Apri PowerShell nella cartella del progetto e avvia il server statico:
     cd C:\Users\l.neve\www\personal\LJAVA\Confini\web
     npx http-server -p 8080
   - Apri nel browser: http://localhost:8080

2) Usando Python (alternativa)
   - Dal folder web:
     cd C:\Users\l.neve\www\personal\LJAVA\Confini\web
     python -m http.server 8080
   - Apri nel browser: http://localhost:8080

Consigli utili

- Durante lo sviluppo: apri DevTools (F12) → Network → spunta "Disable cache" e fai un hard reload (Ctrl+F5) dopo le modifiche ai file JS/CSS.
- Se avvii il server in background, salva il PID (Start-Process con -PassThru) e termina con Stop-Process -Id <PID>.

Comandi PowerShell utili (one-liner)

- Avvio rapido (foreground con Node):
  cd C:\Users\l.neve\www\personal\LJAVA\Confini\web; npx http-server -p 8080

- Avvio background (salva PID):
  cd C:\Users\l.neve\www\personal\LJAVA\Confini; $p = Start-Process -FilePath $env:ComSpec -ArgumentList '/c','npx http-server web -p 8080' -PassThru; $p.Id | Out-File .\server.pid

- Fermare il server (usando server.pid):
  $pid = Get-Content .\server.pid; Stop-Process -Id $pid; Remove-Item .\server.pid

Modifiche comuni

- UI/behaviour: modifica web/app.js e web/style.css
- Dati geografici: web/data/*.json (TopoJSON / metadata)
- Rigenera la texture: renderTexture() in app.js — la texture è un canvas mappato sulla sfera

Problemi noti e debug

- Artefatti sui confini (es. Russia): possono dipendere da poligoni multipli e dall'antimeridiano. Se persistono, posso integrare d3-geo/turf per pre-processare/spezzare i ring.
- Texture molto grande (4096×2048) può essere lenta su macchine poco potenti.
- Se vedi errori in console: copia/incolla le prime righe della Console (DevTools → Console) e inviamele; includi il browser e la versione.

Contribuire / estendere

- Aggiungere centri più accurati: integrare d3-geo o turf.js per centroidi area-weighted e proiezioni più accurate.
- Rendere la linea USA–RUS opzionale: logica in app.js dove viene aggiunto il bordo.

Licenza & note

Questo repository è un progetto personale/prototipo. Non contiene credenziali o dati sensibili.
