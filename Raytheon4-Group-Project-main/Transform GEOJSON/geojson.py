import json

def transform_geojson(input_geojson):
    transformed = {}
    
    for feature in input_geojson['features']:
        ctyua_name = feature['properties'].get('ctyua_name')
        if isinstance(ctyua_name, list):
            ctyua_name = '-'.join(ctyua_name)
        if ctyua_name:
            transformed[ctyua_name] = {
                'properties': feature['properties'],
                'geometry': feature.get('geometry')
            }
    
    return transformed

# Example usage
with open('uk-counties.geojson', 'r') as f:
    geojson_data = json.load(f)

transformed_geojson = transform_geojson(geojson_data)

# Save the transformed data
with open('transformed_geojson.geojson', 'w') as f:
    json.dump(transformed_geojson, f, indent=2)

print("Transformation complete! Check 'transformed_geojson.json'.")
