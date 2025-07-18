from datetime import datetime
from flask import render_template, send_from_directory, jsonify, request, current_app
from grpproj import app
import os
import json
import requests
import asyncio
import aiohttp
from shapely.geometry import shape, Polygon, mapping, MultiPolygon
from geopandas import gpd
from flask_caching import Cache
from shapely.ops import unary_union

# Global dictionary to hold missions data
missions_Dictionary = {}

# Serve the Svelte index.html
@app.route("/")
def serve_svelte():
    # Serve the main Svelte app's index.html
    return send_from_directory(app.static_folder, "index.html")

# Serve other static files (JS, CSS, etc.)
@app.route("/<path:path>")
def serve_static_files(path):
    # Serve static files like JavaScript, CSS, etc.
    return send_from_directory(app.static_folder, path)

# Example route for API or additional pages
@app.route("/hello")
def hello():
    """Renders a Hello, World! message."""
    return "Hello, World!"

@app.route('/home')
def home():
    """Renders the home page."""
    return render_template(
        'index.html',
        title='Home Page',
        year=datetime.now().year,
    )

@app.route('/contact')
def contact():
    """Renders the contact page."""
    return render_template(
        'contact.html',
        title='Contact',
        year=datetime.now().year,
        message='Your contact page.'
    )

@app.route('/about')
def about():
    """Renders the about page."""
    return render_template(
        'about.html',
        title='About',
        year=datetime.now().year,
        message='Your application description page.'
    )

# API Details
API_BASE_URL = "..."
USERNAME = "..."
PASSWORD = "..."
CLIENT_ID = "..."
CLIENT_SECRET = "..."

encoded_password = requests.compat.quote_plus(PASSWORD)

# Function to get API token
def get_access_token():
    payload = f"grant_type=password&username={USERNAME}&password={encoded_password}"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "*/*",
        "Host": "hallam.sci-toolset.com"
    }
    response = requests.post(
        f"{API_BASE_URL}/api/v1/token",
        auth=(CLIENT_ID, CLIENT_SECRET),
        data=payload,
        headers=headers,
        verify=False
    )
    if response.status_code == 200:
        return response.json().get("access_token")
    return None

def get_headers():
    headers = {
        "Authorization": f"Bearer {get_access_token()}",
        "Content-Type": "application/json",
        "Accept": "*/*",
    }
    return headers

async def async_fetch(session, url, headers):
    """Helper function to fetch API data asynchronously."""
    async with session.get(url, headers=headers, ssl=False) as response:
        return await response.json()

async def fetch_scenes_from_mission_async(session, mission_id, headers):
    """Asynchronously fetches scene data for a mission."""
    url = f"{API_BASE_URL}/discover/api/v1/missionfeed/missions/{mission_id}"
    return await async_fetch(session, url, headers)

async def fetch_product_metadata_async(session, scene_id, headers):
    """Asynchronously fetches product metadata for a scene."""
    url = f"{API_BASE_URL}/discover/api/v1/products/{scene_id}"
    return await async_fetch(session, url, headers)

def calculate_scene_area(coordinates):
    if not isinstance(coordinates, list):
        raise ValueError("Coordinates must be a list of (longitude, latitude) points.")
    
    # Create Polygon and check validity
    polygon = Polygon(coordinates)
    if not polygon.is_valid:
        polygon = polygon.buffer(0)
    
    # Create GeoDataFrame with WGS 84 (EPSG:4326)
    gdf = gpd.GeoDataFrame({'geometry': [polygon]}, crs="EPSG:4326")
    
    # Determine UTM zone based on centroid
    lon, lat = polygon.centroid.x, polygon.centroid.y
    utm_zone = int((lon + 180) / 6) + 1
    utm_crs = f"EPSG:{32600 + utm_zone}" if lat >= 0 else f"EPSG:{32700 + utm_zone}"
    
    # Convert to UTM projection
    gdf = gdf.to_crs(utm_crs)
    
    # Calculate area in square kilometers
    area_km2 = gdf.geometry.area.iloc[0] / 1_000_000
    
    return area_km2

def calculate_region_area(coordinates):
    if not isinstance(coordinates, list):
        raise ValueError("Coordinates must be a list.")
    
    # Check if it's a Polygon or MultiPolygon
    if isinstance(coordinates[0][0][0], (int, float)):  # Polygon case
        polygon = Polygon(coordinates[0])
    else:  # MultiPolygon case
        polygons = [Polygon(ring[0]) for ring in coordinates]
        polygon = MultiPolygon(polygons)
    
    # Ensure the geometry is valid
    if not polygon.is_valid:
        polygon = polygon.buffer(0)  # Fix invalid geometry
    
    # Create a GeoDataFrame
    gdf = gpd.GeoDataFrame({'geometry': [polygon]}, crs="EPSG:4326")
    
    # Determine the best UTM zone for projection
    centroid = polygon.centroid
    utm_zone = int((centroid.x + 180) / 6) + 1  # UTM Zone formula
    utm_crs = f"EPSG:{32600 + utm_zone}" if centroid.y >= 0 else f"EPSG:{32700 + utm_zone}"  # 326XX for northern, 327XX for southern

    # Reproject to UTM and calculate area
    gdf = gdf.to_crs(utm_crs)
    area_km2 = gdf.geometry.area.iloc[0] / 1_000_000  # Convert m² to km²

    return area_km2

@app.route('/updateRegion')
def update_region_area():
    base_dir = os.path.abspath(os.path.dirname(__file__))
    project_root = os.path.abspath(os.path.join(base_dir, "..", "..", ".."))

    file_path = os.path.join(project_root, "frontend", "public", "assets", "uk-counties.geojson")
    print(file_path)
    try:
        # Load the GeoJSON file
        with open(file_path, "r") as file:
            countyDict = json.load(file)

        # Calculate area and add it to each feature's properties
        for feature in countyDict["features"]:
            # Ensure geometry and coordinates exist
            geometry = feature.get("geometry", {})
            coordinates = geometry.get("coordinates")

            if coordinates:
                geom_type = geometry.get("type")
                if geom_type == "Polygon":
                    area = calculate_region_area(coordinates)
                elif geom_type == "MultiPolygon":
                    # For MultiPolygon, sum areas of each polygon
                    area = sum(calculate_region_area(polygon) for polygon in coordinates)
                else:
                    print(f"Unsupported geometry type: {geom_type}")
                    continue

                feature["properties"]["area"] = area
            else:
                return(f"Missing geometry or coordinates for feature: {feature.get('properties', {}).get('name', 'Unknown')}")

        # Save the updated GeoJSON back to the file
        with open(file_path, "w") as file:
            json.dump(countyDict, file, indent=4)
        
        # Return success response
        return("Region areas updated successfully.", 200)

    except Exception as e:
        # Return error response if something goes wrong
        print(f"An error occurred: {str(e)}", 500)

# Modified asynchronous function to update the global variable
async def create_dictionary_async():
    global missions_Dictionary  # Use the global variable
    headers = get_headers()
    async with aiohttp.ClientSession() as session:
        mission_url = f"{API_BASE_URL}/discover/api/v1/missionfeed/missions"
        async with session.get(mission_url, headers=headers, ssl=False) as response:
            if response.status != 200:
                return {"error": "Failed to fetch missions"}
            
            mission_list = await response.json()

        mission_dict = {}

        missions_tasks = [fetch_scenes_from_mission_async(session, mission["id"], headers) for mission in mission_list.get("missions", [])]
        missions_results = await asyncio.gather(*missions_tasks)

        for mission, scenes_data in zip(mission_list.get("missions", []), missions_results):
            mission_id = mission.get("id", "Unknown")
            scenes = scenes_data.get("scenes", [])
            aircraft_takeoff_epoch = mission.get("aircraftTakeOffTime", "Unknown")

            if aircraft_takeoff_epoch:
                dtx = datetime.utcfromtimestamp(aircraft_takeoff_epoch / 1000)
                aircraft_takeoff_epoch = dtx.isoformat()
            else:
                aircraft_takeoff_epoch = None

                
            scene_ids = [scene.get("id") for scene in scenes]

            scene_tasks = [fetch_product_metadata_async(session, scene_id, headers) for scene_id in scene_ids]
            scene_results = await asyncio.gather(*scene_tasks)

            if mission_id not in mission_dict:
                mission_dict[mission_id] = {}

            for scene_id, scene_data in zip(scene_ids, scene_results):
                coordinates = scene_data.get("product", {}).get("result", {}).get("footprint", {}).get("coordinates", [])
                mission_name = scene_data.get("product", {}).get("result", {}).get("imagery", {}).get("missionname", [])
                # Ensure coordinates are in the expected format
                coordinates = coordinates[0]
                centre_point = scene_data.get("product", {}).get("result", {}).get("centre", {})
                object_start_date_epoch = scene_data.get("product", {}) \
                                            .get("result", {}) \
                                            .get("objectstartdate")
                if object_start_date_epoch:
                    dtx = datetime.utcfromtimestamp(object_start_date_epoch / 1000)
                    object_start_date_epoch = dtx.isoformat()
                else:
                    object_start_date_epoch = None

                if centre_point:
                    lat, lon = map(float, centre_point.split(","))
                    centre_point = (lon, lat)

                if scene_id not in mission_dict[mission_id]:
                    mission_dict[mission_id][scene_id] = {}
                    
                mission_dict[mission_id]["aircraftTakeOffTime"] = aircraft_takeoff_epoch
                mission_dict[mission_id][scene_id]["coordinates"] = coordinates
                mission_dict[mission_id][scene_id]["area"] = calculate_scene_area(coordinates)
                mission_dict[mission_id][scene_id]["mission_name"] = mission_name
                mission_dict[mission_id][scene_id]["centre_point"] = centre_point
                mission_dict[mission_id][scene_id]["scene_id"] = scene_id
                mission_dict[mission_id][scene_id]["aircraftTakeOffTime"] = aircraft_takeoff_epoch
                mission_dict[mission_id][scene_id]["objectstartdate"] = object_start_date_epoch

    # Update the global variable
    missions_Dictionary = mission_dict
    return mission_dict

cache = Cache(app, config={'CACHE_TYPE': 'simple'})  # Use 'redis' for production

@app.route("/coverage", methods=["GET"])
@cache.cached(timeout=3600)  # Cache for 1 hour
def create_dictionary():
    """Flask route to return mission coverage asynchronously with caching."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    result = loop.run_until_complete(create_dictionary_async())
    return jsonify(result)

async def get_heatmap_data_async():
    headers = get_headers()

    async with aiohttp.ClientSession() as session:
        mission_url = f"{API_BASE_URL}/discover/api/v1/missionfeed/missions"
        async with session.get(mission_url, headers=headers, ssl=False) as response:
            if response.status != 200:
                return {"error": "Failed to fetch missions"}
            
            mission_list = await response.json()

        heatmap_data = []

        missions_tasks = [fetch_scenes_from_mission_async(session, mission["id"], headers) for mission in mission_list.get("missions", [])]
        missions_results = await asyncio.gather(*missions_tasks)

        # Extract coordinates for the heatmap data
        for mission, scenes_data in zip(mission_list.get("missions", []), missions_results):
            scenes = scenes_data.get("scenes", [])
            scene_ids = [scene.get("id") for scene in scenes]

            scene_tasks = [fetch_product_metadata_async(session, scene_id, headers) for scene_id in scene_ids]
            scene_results = await asyncio.gather(*scene_tasks)

            for scene_id, scene_data in zip(scene_ids, scene_results):
                coordinates = scene_data.get("product", {}).get("result", {}).get("footprint", {}).get("coordinates", [])
                coordinates = coordinates[0]  # We assume this is a list of [lat, lon] pairs

                # Add coordinates for the heatmap
                for coord in coordinates:
                    heatmap_data.append([coord[1], coord[0]])  # Convert (lat, lon) to (lon, lat)

    return {"heatmap_data": heatmap_data}

@app.route("/heatmap", methods=["GET"])
def get_heatmap_data():
    """Flask route to return mission coordinates for heatmap asynchronously."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    result = loop.run_until_complete(get_heatmap_data_async())
    return jsonify(result)

async def get_scenes_data_async():
    headers = get_headers()

    async with aiohttp.ClientSession() as session:
        mission_url = f"{API_BASE_URL}/discover/api/v1/missionfeed/missions"
        async with session.get(mission_url, headers=headers, ssl=False) as response:
            if response.status != 200:
                return {"error": "Failed to fetch missions"}
            
            mission_list = await response.json()

        scenes_data = []

        missions_tasks = [fetch_scenes_from_mission_async(session, mission["id"], headers) for mission in mission_list.get("missions", [])]
        missions_results = await asyncio.gather(*missions_tasks)

        for mission, scenes_data_raw in zip(mission_list.get("missions", []), missions_results):
            scenes = scenes_data_raw.get("scenes", [])
            scene_ids = [scene.get("id") for scene in scenes]

            scene_tasks = [fetch_product_metadata_async(session, scene_id, headers) for scene_id in scene_ids]
            scene_results = await asyncio.gather(*scene_tasks)

            for scene_id, scene_data in zip(scene_ids, scene_results):
                coordinates = scene_data.get("product", {}).get("result", {}).get("footprint", {}).get("coordinates", [])

                if coordinates:
                    # Ensure coordinates are in the right structure
                    bounding_box = coordinates[0]
                    
                    scenes_data.append({
                        "scene_id": scene_id,
                        "mission_name": scene_data.get("product", {}).get("result", {}).get("imagery", {}).get("missionname", "Unknown"),
                        "coordinates": bounding_box  # List of (lon, lat) pairs
                    })

    return {"scenes": scenes_data}

@app.route("/scenes", methods=["GET"])
def get_scenes_data():
    """Flask route to return scene bounding boxes asynchronously."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    result = loop.run_until_complete(get_scenes_data_async())
    return jsonify(result)

@app.route("/framesearch", methods=["GET"])
def get_frame_search():
    product_uri = request.args.get("producturi")
    if not product_uri:
        return jsonify({"error": "Product URI is required"}), 400

    token = get_access_token()
    if not token:
        return jsonify({"error": "Failed to authenticate"}), 500

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    url = f"https://hallam.sci-toolset.com/api/v1/missionfeed/missions/framesearch?producturi={product_uri}"

    try:
        response = requests.get(url, headers=headers, verify=False)

        if response.status_code == 200:
            return jsonify(response.json())
        elif response.status_code == 404:
            return jsonify({"error": "Frame data not found"}), 404
        else:
            return jsonify({"error": f"Unexpected error: {response.status_code}"}), response.status_code

    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

@app.route("/clipped-scenes", methods=["GET"])
def get_clipped_scenes():
    base_dir = os.path.abspath(os.path.dirname(__file__))
    project_root = os.path.abspath(os.path.join(base_dir, "..", "..", ".."))
    land_path = os.path.join(project_root, "frontend", "public", "assets", "gb_land.geojson.json")

    try:
        land = gpd.read_file(land_path)
        land = land.to_crs("EPSG:4326")

        global missions_Dictionary
        # Use global data if available; otherwise, fetch it
        if not missions_Dictionary:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            missions_dict = loop.run_until_complete(create_dictionary_async())
        else:
            missions_dict = missions_Dictionary

        scene_features = []
        for mission in missions_dict.values():
            for scene_id, scene in mission.items():
                if scene_id in ["aircraftTakeOffTime"]:
                    continue

                coords = scene["coordinates"]
                if not coords or len(coords) < 3:
                    continue  # Skip invalid geometries

                try:
                    polygon = Polygon(coords)
                    if not polygon.is_valid:
                        polygon = polygon.buffer(0)

                    scene_features.append({
                        "scene_id": scene["scene_id"],
                        "mission_name": scene["mission_name"],
                        "objectstartdate": scene["objectstartdate"],
                        "aircrafttakeofftime": scene["aircraftTakeOffTime"],
                        "geometry": polygon
                    })
                except Exception as e:
                    print("⚠️ Skipping invalid scene:", scene.get("scene_id"), e)

        if not scene_features:
            return jsonify({"features": []})

        scenes_gdf = gpd.GeoDataFrame(scene_features, geometry="geometry", crs="EPSG:4326")

        # Clip to land
        clipped = gpd.overlay(scenes_gdf, land, how="intersection")

        return jsonify(clipped.__geo_interface__)

    except Exception as e:
        return jsonify({"error": str(e)}), 500
