# GeoRoute

> Un gioco di geografia in cui si trova un percorso attraverso il mondo, un Paese confinante alla volta.

[English](README.md) · **Italiano**

GeoRoute è una web app di geografia in 3D. Ogni sfida parte da uno Stato e ha come obiettivo un altro: il percorso può avanzare solo attraverso Paesi adiacenti. Il globo interattivo rende visibile il viaggio a ogni passaggio.

## In evidenza

- **Globo 3D** interattivo realizzato con Three.js, con rotazione, zoom, etichette al passaggio del puntatore e messa a fuoco del percorso.
- Navigazione tra Paesi basata sul grafo di adiacenza geografica del progetto.
- Cronologia del viaggio con annullamento dell’ultimo passaggio; gli Stati già attraversati non possono essere riutilizzati, salvo il ritorno immediato.
- Cinque modalità: **Standard**, **Speedrun**, **Hardcore**, **Nebbia** e **Personalizzata**.
- Difficoltà, continente e suggerimenti dei nomi configurabili.

## Modalità di gioco

| Modalità | Descrizione |
| --- | --- |
| Standard | Un percorso classico generato casualmente. |
| Speedrun | La destinazione deve essere raggiunta entro 60 secondi. |
| Hardcore | Nasconde i confini e disattiva i suggerimenti. |
| Nebbia | Nasconde i confini della mappa per una sfida meno assistita. |
| Personalizzata | Consente di selezionare origine e destinazione. |

## Avvio locale

GeoRoute è una web app statica. Per l’esecuzione del server locale incluso sono necessari Node.js e un browser moderno con supporto WebGL.

```bash
node docs/server.js
```

L’applicazione è disponibile all’indirizzo [http://localhost:8080](http://localhost:8080). La porta può essere modificata tramite la variabile d’ambiente `PORT`.

```bash
cd docs
npm start
```

## Struttura del progetto

```text
docs/
├── index.html          # Struttura dell’applicazione
├── app.js              # Logica del gioco, globo e interazioni
├── style.css           # Stili dell’interfaccia
├── server.js           # Server statico minimale per lo sviluppo
├── data/               # Geometrie TopoJSON e metadati dei Paesi
└── vendor/             # Build locali di Three.js e TopoJSON client
```

## Dati e implementazione

La geometria dei Paesi proviene dal dataset TopoJSON incluso; i metadati forniscono nomi, traduzioni, regioni e confini. Il gioco usa tali confini per costruire il grafo dei percorsi. Gli Stati isolati sono collegati al Paese più vicino, così da mantenere ogni sfida giocabile.

Il globo è renderizzato con Three.js, mentre confini e stato del percorso sono disegnati su una texture canvas applicata alla sfera.
