# GeoRoute

> A geography game about finding a route across the world, one neighbouring country at a time.

**English** · [Italiano](README.it.md)

GeoRoute is a browser-based 3D geography game. Each challenge begins in one country and ends in another: the route can advance only through adjacent countries. The interactive globe keeps the journey visible at every step.

## Highlights

- Interactive **3D globe** built with Three.js, with rotation, zoom, hover labels, and route focus.
- Country-to-country navigation based on the project's geographic adjacency graph.
- Journey history with one-step backtracking; previously visited countries cannot be reused otherwise.
- Five game modes: **Standard**, **Speedrun**, **Hardcore**, **Fog**, and **Custom**.
- Configurable difficulty and continent filters, plus optional country-name suggestions.

## Game modes

| Mode | Description |
| --- | --- |
| Standard | A classic randomly generated route. |
| Speedrun | Reach the destination within 60 seconds. |
| Hardcore | Hides borders and disables suggestions. |
| Fog | Conceals the map's borders for a less assisted challenge. |
| Custom | Select both the origin and destination. |

## Run locally

GeoRoute is served as a static web application. It requires a modern browser with WebGL and Node.js to start the included local server.

```bash
node docs/server.js
```

The application is then available at [http://localhost:8080](http://localhost:8080). A different port can be selected with the `PORT` environment variable.

```bash
cd docs
npm start
```

## Project layout

```text
docs/
├── index.html          # Application structure
├── app.js              # Game, globe, and interaction logic
├── style.css           # Interface styling
├── server.js           # Minimal static development server
├── data/               # TopoJSON geometry and country metadata
└── vendor/             # Local Three.js and TopoJSON client builds
```

## Data and implementation

Country geometry comes from the included TopoJSON dataset; country metadata supplies names, translations, regions, and borders. The game uses those borders to build its route graph. Isolated countries are connected to their nearest country so that every challenge remains playable.

The globe is rendered with Three.js, while country outlines and route states are drawn onto a canvas texture mapped to the sphere.
