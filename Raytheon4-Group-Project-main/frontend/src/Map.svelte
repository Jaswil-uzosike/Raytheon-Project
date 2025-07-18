<script>
  import { onMount } from "svelte";
  import L from "leaflet";
  import "leaflet/dist/leaflet.css"; // Leaflet CSS
  import "leaflet-draw/dist/leaflet.draw.css"; // Leaflet.draw CSS
  import "leaflet-draw"; // Leaflet.draw JS

  import "./style.css"; // Your custom CSS
  import * as utils from "./utils.js"; // Your utility functions
  import { initLeafletDraw } from "./my-leaflet-draw.js"; // Import our draw initializer
  import "leaflet.heat";

  let map;
  let baseLayers = {};
  let heatmapLayer;
  let regionLayer = null; // ✅ Store region layer

  // ====================================
  // Function: Retrieve URL Parameters
  // ====================================
  function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      lat: params.get("lat") ? parseFloat(params.get("lat")) : null,
      lng: params.get("lng") ? parseFloat(params.get("lng")) : null,
    };
  }
  
   function showLoader() {
    const el = document.getElementById("loadingOverlay");
    if (el) el.style.display = "flex";
  }

  function hideLoader() {
    const el = document.getElementById("loadingOverlay");
    if (el) el.style.display = "none";
  }

  /* ====================================
    Lifecycle: onMount - Initialize Map
  ==================================== */
  onMount(() => {
    document.title = "Raytheon4 Group Project";

    // Listen for the universal "closeAll" event:
    //   => hides scene pop-up (we rely on utils.js to revert highlights).
    window.addEventListener("closeAll", hideSceneInfo);

    // Initialize Map
    map = L.map("map").setView([55.3781, -3.436], 6);
    window.map = map;
    map.zoomControl.setPosition("bottomright");

    // Define base map layers
    baseLayers = {
      Default: L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        {
          attribution: "&copy; OpenStreetMap contributors, &copy; CartoDB",
        },
      ),
      Region: L.tileLayer(
        "https://stamen-tiles.a.ssl.fastly.net/toner-lite/{z}/{x}/{y}.png",
        {
          attribution: "&copy; Stamen Design",
        },
      ),
      Satellite: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Tiles &copy; Esri &mdash; Source: Esri" },
      ),
      Dark: L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        {
          attribution: "&copy; OpenStreetMap contributors, &copy; CartoDB",
	},
	),
	};

	// Add default map layer
	switchMapStyle({ target: { value: "scenemap" } });


	// Handle URL-based lat/lng query parameters
	const { lat, lng } = getQueryParams();
	if (lat !== null && lng !== null) {
      console.log(`Centering map to: ${lat}, ${lng}`);
      map.setView([lat, lng], 12);
      L.marker([lat, lng]).addTo(map).bindPopup("Selected Mission").openPopup();
    }

    document
      .getElementById("searchBox")
      .addEventListener("keypress", async (event) => {
        if (event.key === "Enter") {
          const city = event.target.value.trim();
          if (city) {
            utils.searchCity(city, map);
          }
        }
      });

    // Listen for dropdown changes
    document
      .getElementById("mapStyle")
      .addEventListener("change", switchMapStyle);

    setTimeout(() => {
      const toggleCheckbox = document.getElementById("switch");
      if (toggleCheckbox) {
        toggleCheckbox.addEventListener("change", toggleSidebar);
      } else {
        console.error("Toggle button (#switch) not found!");
      }

      const closeSidebarButton = document.getElementById("closeSidebar");
      if (closeSidebarButton) {
        closeSidebarButton.addEventListener("click", toggleSidebar);
      } else {
        console.error("Close button (#closeSidebar) not found!");
      }
    }, 500);

    // Dark mode toggle logic
    const toggleSwitch = document.getElementById("checkbox");

    // Function to set dark mode
    function enableDarkMode() {
      document.body.classList.add("dark-mode");
      if (map.hasLayer(baseLayers["Default"])) {
        map.removeLayer(baseLayers["Default"]);
      }
      if (!map.hasLayer(baseLayers["Dark"])) {
        map.addLayer(baseLayers["Dark"]);
      }
      localStorage.setItem("darkMode", "enabled");
    }

    // Function to disable dark mode
    function disableDarkMode() {
      document.body.classList.remove("dark-mode");
      if (map.hasLayer(baseLayers["Dark"])) {
        map.removeLayer(baseLayers["Dark"]);
      }
      if (!map.hasLayer(baseLayers["Default"])) {
        map.addLayer(baseLayers["Default"]);
      }
      localStorage.setItem("darkMode", "disabled");
    }

    // Ensure dark mode is applied correctly on page load
    document.addEventListener("DOMContentLoaded", () => {
      const darkModeEnabled = localStorage.getItem("darkMode") === "enabled";
      // Set the checkbox to the opposite of dark mode
      toggleSwitch.checked = !darkModeEnabled;

      if (darkModeEnabled) {
        enableDarkMode();
      } else {
        disableDarkMode();
      }
    });

    // Event listener for toggle switch
    toggleSwitch.addEventListener("change", function () {
      if (this.checked) {
        disableDarkMode(); // Switch is ON = light mode
      } else {
        enableDarkMode(); // Switch is OFF = dark mode
      }
    });

    utils.initializeData();
    initLeafletDraw(map);

    // Listen for "sceneClicked" events from utils.js
    window.addEventListener("sceneClicked", (e) => {
      showSceneInfo(e.detail);
    });
  });

  // Universal close: hides pop-up, reverts highlights (in utils.js).
  function closeAll() {
    window.dispatchEvent(new Event("closeAll"));
  }

  // Function: Toggle Sidebar Visibility
  function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    const toggleCheckbox = document.getElementById("switch");

    sidebar.classList.toggle("show");

    if (sidebar.classList.contains("show")) {
      toggleCheckbox.checked = true;
      loadMissionList();
    } else {
      toggleCheckbox.checked = false;
    }
  }

  // Function: Fetch & Display Mission List (with caching)
  async function loadMissionList() {
    const missionTableBody = document.getElementById("missionTableBody");
    if (!missionTableBody) {
      console.error("Mission table body not found!");
      return;
    }

    const cacheKey = "missionData";

    try {
      let dictionary;
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        console.log("Using cached mission data for sidebar.");
        dictionary = JSON.parse(cachedData);
      } else {
        console.log("Fetching mission data from server for sidebar.");
        dictionary = await utils.getMissionDictionary();
        localStorage.setItem(cacheKey, JSON.stringify(dictionary));
      }

      missionTableBody.innerHTML = "";
      for (const [missionID, scenes] of Object.entries(dictionary)) {
        for (const [sceneID, sceneData] of Object.entries(scenes)) {
          if (sceneID === "aircraftTakeOffTime") {
            continue; // skip the time property
          }
          const lat = sceneData.centre_point ? sceneData.centre_point[0] : 0;
          const lon = sceneData.centre_point ? sceneData.centre_point[1] : 0;
          const newRow = document.createElement("tr");
          newRow.innerHTML = `
            <td>${missionID}</td>
            <td>${sceneID}</td>
            <td>${lat.toFixed(6)}</td>
            <td>${lon.toFixed(6)}</td>
            <td>
              <button class="viewOnMap" data-lat="${lat}" data-lon="${lon}">
                View on Map
              </button>
            </td>
          `;
          missionTableBody.appendChild(newRow);
        }
      }

      document.querySelectorAll(".viewOnMap").forEach((button) => {
        button.addEventListener("click", (e) => {
          const lon = parseFloat(e.target.getAttribute("data-lat"));
          const lat = parseFloat(e.target.getAttribute("data-lon"));
          map.setView([lat, lon], 10);
          L.marker([lat, lon])
            .addTo(map)
            .bindPopup("Mission Location")
            .openPopup();
        });
      });
    } catch (error) {
      console.error("Failed to load mission data:", error);
    }
  }

  /* ====================================
    Switch Map Style Based on Dropdown Selection
  ==================================== */
  function switchMapStyle(event) {
  const selectedStyle = event.target.value;
  console.log("🗺️ Selected Map Style:", selectedStyle);

  // Remove all layers before switching
  map.eachLayer((layer) => {
    map.removeLayer(layer);
  });

  const isDarkMode = localStorage.getItem("darkMode") === "enabled";
  const defaultBase = isDarkMode ? baseLayers["Dark"] : baseLayers["Default"];

  if (selectedStyle === "heatmap") {
    defaultBase.addTo(map);
    showLoader();

    // Make sure fetchHeatmapData is async/returns a promise
    Promise.resolve(utils.fetchHeatmapData(map))
      .finally(() => {
        hideLoader();
      });

  } else if (selectedStyle === "scenemap") {
    defaultBase.addTo(map);
    showLoader();

    fetch("/clipped-scenes")
      .then((res) => res.json())
      .then((clippedGeojson) => {
        console.log("✅ Loaded", clippedGeojson.features?.length, "clipped land scenes.");
        utils.drawSceneRectangles(clippedGeojson, map);
        utils.enableRectangleClustering(map, clippedGeojson);
      })
      .catch((err) => {
        console.error("❌ Failed to load clipped scenes:", err);
      })
      .finally(() => {
        hideLoader();
      });

  } else if (selectedStyle === "region") {
    defaultBase.addTo(map);
    showLoader();

    setTimeout(() => {
      regionLayer = utils.getRegionMapLayer(); // Assume it's quick
      if (regionLayer) regionLayer.addTo(map);
      hideLoader();
    }, 300); // Simulate loading delay (optional)

  } else {
    baseLayers[
      selectedStyle.charAt(0).toUpperCase() + selectedStyle.slice(1)
    ].addTo(map);
  }
}


  // =====================================
  //  CORNER SCENE INFO BOX HANDLERS
  // =====================================
  function showSceneInfo(props) {
    const infoBox = document.getElementById("sceneInfoBox");
    const details = document.getElementById("sceneInfoDetails");
    if (!infoBox || !details) return;

    details.innerHTML = `
      <h3>Scene Info</h3>
      <p><strong>Mission Name:</strong> ${props.missionId || "(No mission)"}</p>
      <p><strong>Aircraft Take-off Time:</strong> ${
        props.aircraftTakeOffTime || "(No data)"
      }</p>
      <p><strong>Scene ID:</strong> ${props.sceneId || "(No ID)"}</p>
      <p><strong>Object Start Date:</strong> ${
        props.SceneData || "(No data)"
      }</p>
    `;
    infoBox.style.display = "block";
  }

  // Hides only the pop-up (map revert is handled by “closeAll” event).
  function hideSceneInfo() {
    const infoBox = document.getElementById("sceneInfoBox");
    if (infoBox) {
      infoBox.style.display = "none";
    }
  }
</script>

<!-- ====================================
     Header Section
==================================== -->
<header>
  <div class="left-container">
    <div class="logo">
      <img src="assets/raytheon-logo.png" alt="Raytheon UK" />
    </div>
    <nav class="nav-links">
      <a id="mapLink">Map</a>

      <script>
        document.getElementById("mapLink").href = window.location.origin;
      </script>
      <a href="missionList.html">Mission List</a>
    </nav>
  </div>

  <!-- ====================================
       Sidebar Toggle Switch
  ==================================== -->
  <div class="checkbox-wrapper-35">
    <input
      value="private"
      name="switch"
      id="switch"
      type="checkbox"
      class="switch"
    />
    <label for="switch">
      <span class="switch-x-text">Sidebar</span>
      <span class="switch-x-toggletext">
        <span class="switch-x-unchecked">
          <span class="switch-x-hiddenlabel">Unchecked: </span>Off
        </span>
        <span class="switch-x-checked">
          <span class="switch-x-hiddenlabel">Checked: </span>On
        </span>
      </span>
    </label>
  </div>

  <!-- ====================================
       Light Mode Toggle Switch
  ==================================== -->
  <label class="switch">
    <input id="checkbox" type="checkbox" />
    <span class="slider">
      <div class="star star_1"></div>
      <div class="star star_2"></div>
      <div class="star star_3"></div>
      <svg viewBox="0 0 16 16" class="cloud_1 cloud">
        <path
          transform="matrix(.77976 0 0 .78395-299.99-418.63)"
          fill="#fff"
          d="m391.84 540.91c-.421-.329-.949-.524-1.523-.524-1.351 0-2.451 1.084-2.485 2.435-1.395.526-2.388 1.88-2.388 3.466 0 1.874 1.385 3.423 3.182 3.667v.034h12.73v-.006c1.775-.104 3.182-1.584 3.182-3.395 0-1.747-1.309-3.186-2.994-3.379.007-.106.011-.214.011-.322 0-2.707-2.271-4.901-5.072-4.901-2.073 0-3.856 1.202-4.643 2.925"
        ></path>
      </svg>
    </span>
  </label>

  <!-- ====================================
       Search Bar & Map Style Selector
  ==================================== -->
  <div class="search-container">
    <input type="text" id="searchBox" placeholder="Search" />
	  <select id="mapStyle">
		  <option value="scenemap" selected="">Scene Map</option>
		  <option value="region">Region</option>
		  <option value="heatmap">Heatmap</option>
		  <option value="satellite">Satellite</option>
	  </select>

  </div>
</header>

<!-- ====================================
     Map Container
==================================== -->
<div id="map" style="height: 100vh;"></div>

<!-- ====================================
     Sidebar for Mission List
==================================== -->
<div id="sidebar">
  <button id="closeSidebar" class="close-sidebar">x</button>
  <h2>Mission List</h2>
  <table>
    <thead>
      <tr>
        <th>Mission ID</th>
        <th>Scene ID</th>
        <th>Latitude</th>
        <th>Longitude</th>
        <th>Show on Map</th>
      </tr>
    </thead>
    <tbody id="missionTableBody"></tbody>
  </table>
</div>

<!-- ====================================
     Corner Info Box for Scenes
==================================== -->
<div
  id="sceneInfoBox"
  class="scene-info-box"
  style="
    position: fixed;
    top: 80px;
    right: 20px;
    min-width: 200px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    border-radius: 8px;
    z-index: 9999;
    display: none;
  "
>
  <!-- Clicking this 'x' triggers closeAll(), which hides the pop-up AND reverts highlights. -->
  <button
    id="closeSceneInfoBox"
    class="close-info-box"
    on:click={closeAll}
    style="
      float: right;
      background: transparent;
      border: none;
      color: #fff;
      font-size: 16px;
      cursor: pointer;
    "
  >
    x
  </button>
  <div id="sceneInfoDetails"></div>
</div>

<div id="loadingOverlay">
	<div class="spinner"></div>
</div>
