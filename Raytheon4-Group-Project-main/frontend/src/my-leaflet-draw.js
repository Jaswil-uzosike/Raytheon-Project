import L from "leaflet";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import * as turf from "@turf/turf";
import { missionsDictionary } from "./utils";

/**
 * Initialize Leaflet.draw and show total area of scenes within drawn polygon.
 * @param {L.Map} map - A Leaflet map instance.
 */
export function initLeafletDraw(map) {
  // Create a custom pane for drawn items.
  // (tilePane is 200, overlayPane is 400, markerPane is 600, popupPane is 700)
  if (!map.getPane("drawPane")) {
    map.createPane("drawPane");
    // Set zIndex so that drawings sit above tile layers and overlays.
    map.getPane("drawPane").style.zIndex = 650;
  }

  // Create a FeatureGroup for drawn items.
  // Override onAdd so that its container gets moved into the custom pane.
  const drawnItems = new L.FeatureGroup();
  drawnItems.onAdd = function (map) {
    // Call the original onAdd
    L.FeatureGroup.prototype.onAdd.call(this, map);
    // Move the container into our custom pane
    if (this._container) {
      map.getPane("drawPane").appendChild(this._container);
    }
  };

  map.addLayer(drawnItems);

  // Set up the Leaflet.draw control with only the polygon tool.
  const drawControl = new L.Control.Draw({
    position: "bottomright",
    edit: {
      featureGroup: drawnItems,
    },
    draw: {
      polygon: {
        shapeOptions: {
          color: "#3388ff",
          weight: 2,
          pane: "drawPane", // force drawn shapes into our custom pane
        },
      },
      polyline: false,
      rectangle: false,
      circle: false,
      marker: false,
    },
  });

  map.addControl(drawControl);

  map.on("draw:created", (e) => {
    const { layer, layerType } = e;
    if (layerType !== "polygon") return;

    // Force the drawn layer into the custom pane
    layer.options.pane = "drawPane";
    drawnItems.addLayer(layer);
    layer.bringToFront();

    // Get the polygon coordinates and ensure the ring is closed
    const latlngs = layer.getLatLngs()[0];
    let coords = latlngs.map((latlng) => [latlng.lng, latlng.lat]);
    if (
      coords.length > 0 &&
      (coords[0][0] !== coords[coords.length - 1][0] ||
        coords[0][1] !== coords[coords.length - 1][1])
    ) {
      coords.push(coords[0]);
    }

    const turfPolygon = turf.polygon([coords]);
    const includedScenes = new Set();
    let totalArea = 0;

    // Check which scenes intersect with the drawn polygon
    for (const missionId in missionsDictionary) {
      const scenes = missionsDictionary[missionId];
      for (const sceneId in scenes) {
        const scene = scenes[sceneId];
        const points = scene?.coordinates;
        if (!Array.isArray(points)) continue;

        const intersects = points.some((coord) => {
          if (!Array.isArray(coord) || coord.length !== 2) return false;
          const point = turf.point(coord); // coord is [lng, lat]
          return turf.booleanPointInPolygon(point, turfPolygon);
        });

        if (intersects) {
          const key = `${missionId}_${sceneId}`;
          if (!includedScenes.has(key)) {
            includedScenes.add(key);
            totalArea += scene?.area || 0;
          }
        }
      }
    }

    // Calculate polygon area (km²) and percentage coverage
    const polygonAreaSqMeters = turf.area(turfPolygon);
    const polygonAreaKm2 = polygonAreaSqMeters / 1_000_000;
    const percentCovered =
      polygonAreaKm2 > 0 ? (totalArea / polygonAreaKm2) * 100 : 0;

    const center = layer.getBounds().getCenter();
    const popupContent = `
      <div>
        🟩 <strong>Polygon area:</strong> ${polygonAreaKm2.toFixed(2)} km²<br>
        ✅ <strong>Covered scene area:</strong> ${totalArea.toFixed(2)} km²<br>
        📊 <strong>Coverage:</strong> ${percentCovered.toFixed(1)}%
      </div>
    `;

    L.popup()
      .setLatLng(center)
      .setContent(popupContent)
      .openOn(map);
  });
}
