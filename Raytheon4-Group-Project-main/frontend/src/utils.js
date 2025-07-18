import L from "leaflet";
import Chart from "chart.js/auto"; // Import Chart.js
import * as turf from "@turf/turf";
import "leaflet-polylinedecorator";
import "leaflet.markercluster";


export let missionsDictionary;
let countiesDictionary;
let regionsIndex = {};
let regionLayers = {};
let sceneLayers = [];
let heatMapLayer;
let missionToPolygons = {};
let activeMissionSegments = [];
let activeMissionArrows = [];
let regionMapLayer = {};
let regionCache = {};

// This will store the frequency of missions by region and year.
// Structure: regionYearData[regionName][year] = Set of mission IDs
export let regionYearData = {};

// Marker for city search
let searchMarker = null;

/* ===========================================================
   getRegionFromLatLng
   Fetches region data (locality, sublocality, etc.) from Google Geocoding API.
   Caches the data in memory and in localStorage.
=========================================================== */
export async function getRegionFromLatLng(coordinates) {
  console.log("Getting region for:", coordinates);
  let [lng, lat] = coordinates;
  const cacheKey = `${lat},${lng}`;

  // Check in-memory cache first
  if (regionCache[cacheKey]) {
    console.log("Using cached region:", regionCache[cacheKey]);
    return regionCache[cacheKey];
  }

  // Check localStorage if available
  const cachedData = localStorage.getItem(cacheKey);
  if (cachedData) {
    const parsedData = JSON.parse(cachedData);
    regionCache[cacheKey] = parsedData;
    console.log("Using localStorage cached region:", parsedData);
    return parsedData;
  }

  // If not cached, fetch from Google API
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=AIzaSyBSPwz9M-Xe6cNrgG4PWtR3MxKjK0LgJT8`;
  console.log("Fetching from Google API:", url);

  try {
    const response = await fetch(url);
    const data = await response.json();

    let locality = null;
    let administrative_area_level_2 = null;
    let sublocality = null;

    data.results.forEach((result) => {
      result.address_components.forEach((component) => {
        if (!sublocality && component.types.includes("sublocality")) {
          sublocality = component.long_name;
        }
        if (!locality && component.types.includes("locality")) {
          locality = component.long_name;
        }
        if (
          !administrative_area_level_2 &&
          component.types.includes("administrative_area_level_2")
        ) {
          administrative_area_level_2 = component.long_name;
        }
      });
    });

    const region =
      sublocality || locality || administrative_area_level_2
        ? [sublocality || null, locality || null, administrative_area_level_2 || null]
        : "Offshore";

    // Store results in cache and localStorage
    regionCache[cacheKey] = region;
    localStorage.setItem(cacheKey, JSON.stringify(region));

    return region;
  } catch (error) {
    console.error("Error fetching region data:", error);
    return null;
  }
}

/* ===========================================================
   clearRegionCache
   Clears both in-memory region cache and localStorage.
=========================================================== */
export function clearRegionCache() {
  regionCache = {};
  localStorage.clear();
  console.log("Cache cleared!");
}

/* ===========================================================
   showScenes
   Fetch a geoJSON for "clipped-scenes", then draws them.
=========================================================== */
export function showScenes(map) {
  fetch(window.location.origin + "/clipped-scenes")
    .then((res) => res.json())
    .then((clippedGeojson) => {
      console.log(
        "✅ Loaded",
        clippedGeojson.features?.length,
        "clipped land scenes."
      );
      drawSceneRectangles(clippedGeojson, map);
    })
    .catch((err) => {
      console.error("❌ Failed to load clipped scenes:", err);
    });
}

/* ===========================================================
   isOnShore
   Checks if scenes are within the GB polygon.
=========================================================== */
export async function isOnShore(coordinates) {
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
    console.warn("⚠️ Invalid coordinates passed to isOnShore:", coordinates);
    return false;
  }

  try {
    const response = await fetch("assets/gb.json");
    const layer = await response.json();

    const layerCoordinates = layer.features[0]?.geometry?.coordinates;
    if (!layerCoordinates) {
      console.error("❌ GB polygon data is malformed or missing.");
      return false;
    }

    const layerPolygon = turf.multiPolygon(layerCoordinates);
    const polygon = turf.polygon([coordinates]);

    return (
      turf.booleanWithin(polygon, layerPolygon) ||
      turf.booleanOverlap(polygon, layerPolygon)
    );
  } catch (error) {
    console.error("❌ Error in isOnShore():", error);
    return false;
  }
}

/* ===========================================================
   addRegionsToScenes
   For each scene, fetches and assigns the "region" property
   using getRegionFromLatLng.
=========================================================== */
export async function addRegionsToScenes() {
  for (const mission of Object.values(missionsDictionary)) {
    for (const scene of Object.values(mission)) {
      // Skip fields that are not scene objects
      if (!scene || typeof scene !== "object" || !scene.centre_point) {
        continue;
      }
      try {
        scene.region = await getRegionFromLatLng(scene.centre_point);
      } catch (error) {
        // console.error("Failed to fetch region for scene:", error);
      }
    }
  }
}

/* ===========================================================
   buildRegionYearData
   For each region, we tally how many unique missions happened each year.
=========================================================== */
export function buildRegionYearData() {
  regionYearData = {}; // reset or initialize

  // missionsDictionary is structured like:
  // {
  //   "mission_id": {
  //       "aircraftTakeOffTime": <ISO string>,
  //       "scene_id_1": { region, ... },
  //       "scene_id_2": { region, ... }
  //   },
  //   ...
  // }

  for (const [missionId, missionContent] of Object.entries(missionsDictionary)) {
    const takeOffTime = missionContent.aircraftTakeOffTime;
    if (!takeOffTime) {
      continue;
    }
    const year = new Date(takeOffTime).getFullYear();

    // Now gather all scenes in that mission
    for (const [sceneId, sceneData] of Object.entries(missionContent)) {
      // Skip the "aircraftTakeOffTime" property
      if (sceneId === "aircraftTakeOffTime") {
        continue;
      }

      const region = sceneData.region;
      if (!region) {
        continue;
      }

      // Initialize nested objects/sets if needed
      if (!regionYearData[region]) {
        regionYearData[region] = {};
      }
      if (!regionYearData[region][year]) {
        regionYearData[region][year] = new Set();
      }

      // Add the mission ID to that set so we count each mission only once
      regionYearData[region][year].add(missionId);
    }
  }
}

/* ===========================================================
   setColour
   Returns a colour based on coverage ratio (placeholder logic).
=========================================================== */
export function setColour(layer) {
  if (!missionsDictionary) {
    console.log("Error: Dictionary not found");
    return "#FFFFFF"; // Default colour
  }

  let regionArea = layer.feature.properties.area; // region's area
  let totalSceneArea = 0;

  // If you wanted to compute coverage, you'd do it here
  let coverageRatio = totalSceneArea / regionArea;
  coverageRatio = Math.min(1, coverageRatio); // Cap at 100%

  // Generate a colour (darker for higher coverage)
  let basecolour = [52, 152, 219]; // Light blue
  let darkFactor = 1 - coverageRatio * 0.8;
  let colour = basecolour.map((channel) => Math.floor(channel * darkFactor));

  return `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
}

/* ===========================================================
   getRandomColour
   Example function returning a random hex colour.
=========================================================== */
export function getRandomColour() {
  const letters = "0123456789ABCDEF";
  let colour = "#";
  for (let i = 0; i < 6; i++) {
    colour += letters[Math.floor(Math.random() * 16)];
  }
  return colour;
}

/* ===========================================================
   loadGeoJsonDictionary
   Fetches the UK counties/regions GeoJSON from 
   /assets/uk-counties-transformed.geojson.
=========================================================== */
export async function loadGeoJsonDictionary() {
  let dict;
  try {
    const response = await fetch("/assets/uk-counties-transformed.geojson");
    dict = await response.json();
  } catch (error) {
    console.log("Error fetching or parsing JSON:", error);
  }
  return dict;
}

/* ===========================================================
   initializeData
   Fetches mission and counties dictionaries, adds region property,
   then builds the dictionary for histogram data.
=========================================================== */
export async function initializeData() {
  missionsDictionary = await getMissionDictionary();
  countiesDictionary = await loadGeoJsonDictionary();
  await addRegionsToScenes();
  getRegionMapLayer();
  addTotalCoverage();

  console.log(missionsDictionary);
  console.log(countiesDictionary);
  console.log("DONE INITIALIZING");
}

/* ===========================================================
   getMissionDictionary
   Fetches JSON from the /coverage endpoint and copies the
   mission-level aircraftTakeOffTime down into each scene.
=========================================================== */
export async function getMissionDictionary() {
  let dict;
  try {
    const response = await fetch(window.location.origin + "/coverage");
    dict = await response.json();
  } catch (error) {
    console.log("Error fetching or parsing JSON:", error);
    dict = {};
  }

  // ----- FIX: Copy mission-level aircraftTakeOffTime to each scene -----
  for (const [missionId, content] of Object.entries(dict)) {
    const missionTakeOffTime = content.aircraftTakeOffTime;
    for (const [sceneId, sceneData] of Object.entries(content)) {
      if (sceneId === "aircraftTakeOffTime") continue;
      if (sceneData && typeof sceneData === "object") {
        sceneData.aircraftTakeOffTime = missionTakeOffTime;
      }
    }
  }

  return dict;
}

/* ===========================================================
   fetchScenesData
   Fetch clipped scenes from server
=========================================================== */
export async function fetchScenesData() {
  console.log("📡 Fetching pre-clipped scenes from server...");

  try {
    const response = await fetch("/clipped-scenes"); // Flask route
    if (!response.ok) {
      throw new Error("Server error: " + response.statusText);
    }

    const geojson = await response.json();

    if (!geojson.features || geojson.features.length === 0) {
      console.warn("⚠️ No clipped features returned.");
      return [];
    }

    const scenes = geojson.features.map((feature) => {
      return {
        ...feature.properties,
        coordinates: feature.geometry.coordinates,
        geometry_type: feature.geometry.type,
      };
    });

    console.log(`✅ Loaded ${scenes.length} clipped land scenes.`);
    return scenes;
  } catch (error) {
    console.error("❌ Failed to fetch clipped scenes:", error);
    return [];
  }
}

/* ----------------------------------------------------------
   REVERTING & HIGHLIGHTING HELPERS
   ----------------------------------------------------------
*/

/** 
 * Reverts all polygons to blue and weight=2.
 * Also removes lines/arrows.
 */
function revertAllPolygons() {
  sceneLayers.forEach((polygon) => {
    polygon.setStyle({ color: "blue", weight: 2 });
  });
  removeActiveLines();
}

function removeActiveLines() {
  activeMissionSegments.forEach((line) => line.remove());
  activeMissionArrows.forEach((arrow) => arrow.remove());
  activeMissionSegments = [];
  activeMissionArrows = [];
}

/**
 * Called on polygon click to highlight its mission:
 * - Turn mission polygons (except the clicked one) blue
 * - Turn the clicked polygon green
 * - Turn polygons from other missions gray
 * - Connect them with lines & arrows
 */
function highlightMission(missionName, map, clickedPolygon) {
  // 1) Color polygons in same mission = blue, except the clicked one = green
  //    Polygons in other missions = gray
  sceneLayers.forEach((polygon) => {
    if (polygon.missionName === missionName) {
      // Is this the clicked one?
      if (polygon === clickedPolygon) {
        polygon.setStyle({ color: "green", weight: 3 });
      } else {
        polygon.setStyle({ color: "blue", weight: 3 });
      }
    } else {
      polygon.setStyle({ color: "gray", weight: 1 });
    }
  });

  removeActiveLines();

  // 2) Connect multiple scenes in this mission
  const polygonsForMission = missionToPolygons[missionName] || [];
  if (polygonsForMission.length < 2) {
    return;
  }

  // Sort by objectStartDate ascending
  polygonsForMission.sort((a, b) => {
    if (!a.objectStartDate && !b.objectStartDate) return 0;
    if (!a.objectStartDate) return 1;
    if (!b.objectStartDate) return -1;
    return a.objectStartDate.localeCompare(b.objectStartDate);
  });

  // Build line segments
  for (let i = 0; i < polygonsForMission.length - 1; i++) {
    const fromCenter = polygonsForMission[i].center;
    const toCenter = polygonsForMission[i + 1].center;

    const segment = L.polyline([fromCenter, toCenter], {
      color: "red",
      weight: 3,
      dashArray: "5, 10",
    }).addTo(map);

    const arrow = L.polylineDecorator(segment, {
      patterns: [
        {
          offset: "50%",
          repeat: 0,
          symbol: L.Symbol.arrowHead({
            pixelSize: 15,
            pathOptions: {
              color: "red",
              fillOpacity: 1,
              weight: 2,
            },
          }),
        },
      ],
    }).addTo(map);

    activeMissionSegments.push(segment);
    activeMissionArrows.push(arrow);
  }
}

/**
 * Called for each polygon to attach the "click" logic:
 * - Stop map click from reverting immediately
 * - highlight the mission
 * - dispatch "sceneClicked" for corner info
 */
function handleSceneClick(polygon, map) {
  polygon.on("click", (e) => {
    // Prevent the map "click" event from also firing
    // and reverting the polygons:
    e.originalEvent._stopped = true;

    // 1) Highlight
    highlightMission(polygon.missionName, map, polygon);

    // 2) Gather more details to show in corner popup
    const aircraftTakeOffTime = polygon.aircraftTakeOffTime || "N/A";
    const sceneId = polygon.sceneID || "N/A";
    const missionName = polygon.missionName || "N/A";
    const objectStartDate = polygon.objectStartDate || "N/A";

    // 3) Dispatch event to show info in corner
    window.dispatchEvent(
      new CustomEvent("sceneClicked", {
        detail: {
          missionId: missionName,
          aircraftTakeOffTime,
          sceneId,
          SceneData: objectStartDate,
        },
      })
    );
  });
}

/* ===========================================================
   drawSceneRectangles
   Replaces Leaflet popups with a custom event + highlighting.
   (Ensures each polygon has aircraftTakeOffTime/objectStartDate)
=========================================================== */
export function drawSceneRectangles(data, map) {
  console.log("Drawing Scene Rectangles...");

  // Remove old layers
  if (Array.isArray(sceneLayers)) {
    sceneLayers.forEach((layer) => map.removeLayer(layer));
  }
  sceneLayers = [];
  missionToPolygons = {};

  // Ensure we have a map-level click handler that reverts
  map.off("click", mapClickHandler); // avoid duplicates
  map.on("click", mapClickHandler);

  // If data is a GeoJSON FeatureCollection:
  if (data && data.features) {
    if (!data.features.length) {
      console.warn("⚠️ No land scenes to draw.");
      return;
    }

    data.features.forEach((feature) => {
      try {
        L.geoJSON(feature, {
          style: { color: "blue", weight: 2 },
          onEachFeature: (feat, subLayer) => {
            // Attach mission & scene info
            subLayer.missionName = feat.properties.mission_name || "N/A";
            subLayer.sceneID = feat.properties.scene_id || "N/A";

            // ----- FIX: Ensure these are attached -----
            subLayer.aircraftTakeOffTime =
              feat.properties.aircrafttakeofftime || "N/A";
            subLayer.objectStartDate =
              feat.properties.objectstartdate || "N/A";

            // center
            if (
              feat.properties.centre_point &&
              Array.isArray(feat.properties.centre_point)
            ) {
              const [lon, lat] = feat.properties.centre_point;
              subLayer.center = [lat, lon];
            } else {
              subLayer.center = subLayer.getBounds().getCenter();
            }

            sceneLayers.push(subLayer);

            if (!missionToPolygons[subLayer.missionName]) {
              missionToPolygons[subLayer.missionName] = [];
            }
            missionToPolygons[subLayer.missionName].push(subLayer);

            handleSceneClick(subLayer, map);
          },
        }).addTo(map);
      } catch (err) {
        console.error("🚨 Error drawing scene:", feature, err);
      }
    });

    return;
  }

  // If data is an array of scenes (legacy approach):
  if (Array.isArray(data)) {
    if (data.length === 0) {
      console.warn("⚠️ No land scenes to draw.");
      return;
    }

    data.forEach((scene) => {
      try {
        const bounds = scene.coordinates.map((coord) => [coord[1], coord[0]]);
        const polygon = L.polygon(bounds, { color: "blue", weight: 2 }).addTo(map);

        polygon.missionName = scene.mission_name;
        polygon.sceneID = scene.scene_id;
        polygon.objectStartDate = scene.objectstartdate || null;
        polygon.aircraftTakeOffTime = scene.aircrafttakeofftime || null;

        // center
        if (scene.centre_point && Array.isArray(scene.centre_point)) {
          const [lon, lat] = scene.centre_point;
          polygon.center = [lat, lon];
        } else {
          polygon.center = polygon.getBounds().getCenter();
        }

        sceneLayers.push(polygon);

        if (!missionToPolygons[polygon.missionName]) {
          missionToPolygons[polygon.missionName] = [];
        }
        missionToPolygons[polygon.missionName].push(polygon);

        handleSceneClick(polygon, map);
      } catch (err) {
        console.error(`🚨 Error drawing rectangle for scene ${scene.scene_id}:`, err);
      }
    });
  }
}
export function enableRectangleClustering(map, geojsonData) {
  const markerClusterGroup = L.markerClusterGroup({
    maxClusterRadius: 30, // smaller = more clusters
    showCoverageOnHover: false
  });

  // Collect scene_id -> marker for tracking
  const sceneIDToMarker = {};

  geojsonData.features.forEach((feature) => {
    try {
      const layer = L.geoJSON(feature);
      const bounds = layer.getBounds();
      const center = bounds.getCenter();

      const scene_id = feature.properties.scene_id;

      // Add invisible marker with scene_id for tracking
      const marker = L.marker(center, {
        opacity: 0,
        scene_id: scene_id,
      });

      sceneIDToMarker[scene_id] = marker;
      markerClusterGroup.addLayer(marker);
    } catch (err) {
      console.warn("⚠️ Could not cluster feature:", feature, err);
    }
  });

  map.addLayer(markerClusterGroup);

  // Handle rectangle visibility based on clustering
  function updateRectangleVisibility() {
    const visibleSceneIDs = new Set();

    markerClusterGroup.getLayers().forEach((layer) => {
      if (layer._icon && layer.options.scene_id) {
        visibleSceneIDs.add(layer.options.scene_id);
      }
    });

    // Show/hide rectangles based on marker visibility
    sceneLayers.forEach((rectangle) => {
      if (visibleSceneIDs.has(rectangle.sceneID)) {
        if (!map.hasLayer(rectangle)) map.addLayer(rectangle);
      } else {
        if (map.hasLayer(rectangle)) map.removeLayer(rectangle);
      }
    });
  }

  markerClusterGroup.on("clusteringend", updateRectangleVisibility);
  map.on("zoomend", updateRectangleVisibility);
}

/**
 * A single map-click handler that reverts polygons if the user
 * clicked on the map (not on a polygon). We do that by checking
 * e.originalEvent._stopped
 */
function mapClickHandler(e) {
  if (!e.originalEvent._stopped) {
    window.dispatchEvent(new Event("closeAll"));
  }
}


// And listen for "closeAll" to revert polygons:
window.addEventListener("closeAll", () => {
  revertAllPolygons(); // or whatever your revert function is
});

/* ===========================================================
   fetchHeatmapData
   Generate a heatmap from all scene footprints.
=========================================================== */
export async function fetchHeatmapData(map) {
  console.log("📡 Generating Heatmap Data from missionsDictionary...");

  if (!missionsDictionary) {
    console.error("❌ missionsDictionary not loaded.");
    return;
  }

  let allScenes = [];
  Object.values(missionsDictionary).forEach((mission) => {
    Object.entries(mission).forEach(([sceneKey, sceneData]) => {
      if (sceneKey === "aircraftTakeOffTime") return;
      allScenes.push(sceneData);
    });
  });

  let heatmapCoordinates = [];

  for (const scene of allScenes) {
    if (!scene.coordinates || !Array.isArray(scene.coordinates) || scene.coordinates.length === 0) {
      console.warn("⚠️ Skipping scene due to missing coordinates:", scene);
      continue;
    }

    try {
      // Handle Polygon vs. MultiPolygon
      let footprint = scene.coordinates;
      if (Array.isArray(footprint[0][0])) {
        footprint = footprint[0]; // unwrap first ring if multipolygon
      }

      footprint.forEach(([lng, lat]) => {
        heatmapCoordinates.push([lat, lng]);
      });
    } catch (error) {
      console.error("❌ Error processing scene for heatmap:", scene, error);
    }
  }

  console.log("✅ Generated heatmap coordinates:", heatmapCoordinates);
  generateHeatmapData(heatmapCoordinates, map);
}

/**
 * Creates and adds a Leaflet heat layer to the map.
 */
export function generateHeatmapData(missionCoordinates, map) {
  if (!Array.isArray(missionCoordinates) || missionCoordinates.length === 0) {
    console.error("❌ Invalid Heatmap Data received:", missionCoordinates);
    return;
  }

  // Clear existing heatmap layer if needed
  if (heatMapLayer) {
    map.removeLayer(heatMapLayer);
  }

  heatMapLayer = L.heatLayer(missionCoordinates, {
    radius: 30,
    blur: 15,
    maxZoom: 16,
  }).addTo(map);
}

/* ===========================================================
   showRegions
   Loads the countiesDictionary as a GeoJSON layer,
   adds polygons to the map with clickable popups containing
   either a Chart.js histogram (if missions exist) or a message (otherwise).
=========================================================== */
export function getRegionMapLayer() {
  if (regionMapLayer && Object.keys(regionMapLayer).length > 0) {
    return regionMapLayer;
  } else {
    try {
      const geojsonData = {
        type: "FeatureCollection",
        features: Object.entries(countiesDictionary).map(([ctyua_name, data]) => {
          regionsIndex[ctyua_name] = { ...data, ctyua_name: ctyua_name };
          return {
            type: "Feature",
            properties: { ...data.properties, ctyua_name: ctyua_name },
            geometry: data.geometry,
          };
        }),
      };

      regionMapLayer = L.geoJSON(geojsonData, {
        style: function () {
          return {
            color: "#000000",
            weight: 1.5,
            opacity: 0.8,
            fillColor: "#ffffff",
            fillOpacity: 0.5,
          };
        },
        onEachFeature: (feature, layer) => {
          regionLayers[feature.properties.ctyua_name] = layer;

          layer.on("click", function (e) {
            let regionName = feature.properties.ctyua_name || "Unknown Region";
            let lat = e.latlng.lat.toFixed(6);
            let lng = e.latlng.lng.toFixed(6);

            let popupContent =
              '<div style="width:250px; overflow:auto;">' +
              "<strong>Region:</strong> " +
              regionName +
              "<br><strong>Coordinates:</strong> " +
              lat +
              ", " +
              lng +
              '<br><canvas id="histogramCanvas" style="width:230px; height:200px;"></canvas>' +
              "</div>";

            // Binds and opens a Leaflet popup
            layer.bindPopup(popupContent).openPopup();

            // ADDED CODE FOR POPUPCLOSE REVERT:
            // When the user closes the popup with Leaflet's built-in "x",
            // revert highlights and optionally dispatch our event
            layer.on("popupclose", () => {
              revertAllPolygons();
              window.dispatchEvent(new Event("closeScenePopup"));
            });
          });

          layer.on("popupopen", function (e) {
            let regionName = feature.properties.ctyua_name || "Unknown Region";
            const aggregator = regionYearData[regionName];

            if (!aggregator || Object.keys(aggregator).length === 0) {
              e.popup.setContent(
                '<div style="width:250px; overflow:auto;">' +
                "<strong>Region:</strong> " +
                regionName +
                "<br><strong>no mission has taken place in this region</strong>" +
                "</div>"
              );
              return;
            }

            // Build Chart.js data
            const sortedYears = Object.keys(aggregator)
              .map((year) => parseInt(year))
              .sort((a, b) => a - b);
            const dataValues = sortedYears.map(
              (year) => aggregator[year].size
            );

            const canvas = e.popup._contentNode.querySelector("#histogramCanvas");
            if (canvas) {
              const ctx = canvas.getContext("2d");
              new Chart(ctx, {
                type: "bar",
                data: {
                  labels: sortedYears,
                  datasets: [
                    {
                      label: "Missions per Year",
                      data: dataValues,
                      backgroundColor: "rgba(54, 162, 235, 0.5)",
                      borderColor: "rgba(54, 162, 235, 1)",
                      borderWidth: 1,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: true,
                  scales: {
                    y: {
                      beginAtZero: true,
                      stepSize: 1,
                    },
                  },
                },
              });
            }
          });
        },
      });
    } catch (error) {
      console.log("Error creating region layer:", error);
    }
    return regionMapLayer;
  }
}

export async function addTotalCoverage() {
  Object.values(missionsDictionary).forEach((mission) => {
    Object.values(mission).forEach((scene) => {
      // skip if this is the "aircraftTakeOffTime" key
      if (!scene.coordinates) {
        return;
      }

      let regions = scene.region;  // scene.region is an array
      if (!Array.isArray(regions)) {
        regions = [regions];  // Make sure regions is an array even if it's a single region
      }

      // Iterate over each region in the scene's region array
      for (const regionName of regions) {
        // Check if this region is recognized in regionsIndex
        if (regionsIndex.hasOwnProperty(regionName)) {
          const regionData = regionsIndex[regionName];
          // Update the coverage area for that region
          if (!regionData.coverage_area) {
            regionData.coverage_area = scene.area;
          } else {
            regionData.coverage_area += scene.area;
          }

          // Update region color if we have a map layer
          const layer = regionLayers[regionName];
          if (layer) {
            const newColour = getColourForCoverage(
              regionData.coverage_area,
              regionData.properties.area
            );
            layer.setStyle({ fillColor: newColour });
          }

          // Overwrite the scene.region with the single recognized name
          scene.region = regionName;

          // Stop after the first valid region match
          break;
        }
      }
    });
    buildRegionYearData();
  });
}

/* ===========================================================
   getColourForCoverage
   Helper function to pick colour based on coverage vs. region area.
=========================================================== */
function getColourForCoverage(coverageArea, area) {
  if (area === 0) return "#FFFFFF"; // default white if no area

  let percentage = Math.min(coverageArea / area, 1) * 100; // 0-100

  percentage = percentage * 10;

  if (percentage <= 5) return "#E3F2FD";  // Light blue
  if (percentage <= 10) return "#BBDEFB";  // Lighter blue
  if (percentage <= 15) return "#90CAF9";  // Soft blue
  if (percentage <= 20) return "#64B5F6";  // Medium blue
  if (percentage <= 25) return "#42A5F5";  // Blue
  if (percentage <= 30) return "#2196F3";  // Strong blue
  if (percentage <= 35) return "#1E88E5";  // Standard blue
  if (percentage <= 40) return "#1976D2";  // Deeper blue
  if (percentage <= 45) return "#1565C0";  // Darker blue
  if (percentage <= 50) return "#0D47A1";  // Very dark blue
  if (percentage <= 55) return "#0D3B6E";  // Navy blue
  if (percentage <= 60) return "#283593";  // Indigo blue
  if (percentage <= 65) return "#3F51B5";  // Deep indigo
  if (percentage <= 70) return "#5C6BC0";  // Strong indigo
  if (percentage <= 75) return "#7986CB";  // Medium indigo
  if (percentage <= 80) return "#9FA8DA";  // Standard indigo
  if (percentage <= 85) return "#B3C7F9";  // Soft indigo
  if (percentage <= 90) return "#C5CAE9";  // Lighter indigo
  if (percentage <= 95) return "#D1C4E9";  // Lavender
  if (percentage <= 100) return "#B39DDB";  // Light purple
  return "#ffffff";  // Very light teal
}

/* ===========================================================
   searchCity
   Geocode a city name and move map there.
=========================================================== */
export async function searchCity(city, map) {
  if (!city) return;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      city
    )}`;
    const response = await fetch(url);
    const results = await response.json();

    if (results && results.length > 0) {
      const { lat, lon } = results[0];
      map.setView([parseFloat(lat), parseFloat(lon)], 10);

      // If there's already a searchMarker, remove it
      if (searchMarker) {
        map.removeLayer(searchMarker);
      }

      // Create a new marker
      searchMarker = L.marker([parseFloat(lat), parseFloat(lon)]).addTo(map);
      searchMarker.bindPopup(`Search: ${city}`).openPopup();
    } else {
      alert("Location not found");
    }
  } catch (err) {
    console.error("Error searching city:", err);
  }
}
