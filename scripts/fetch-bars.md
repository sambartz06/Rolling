# Refreshing the bar list

The bar list in `bars.js` is a snapshot from OpenStreetMap, pulled with this Overpass query
(paste it into https://overpass-turbo.eu and press Run, then Export > raw data):

```
[out:json][timeout:60];
area["name"="Madison"]["admin_level"="8"]["boundary"="administrative"];
(nwr["amenity"~"^(bar|pub|nightclub|biergarten)$"](area););
out center tags;
```

Notes:
- The query also matches a few other towns named Madison; drop anything outside roughly
  lat 42.95–43.2, lon -89.6 to -89.2.
- Missing or wrong bars are best fixed in OpenStreetMap itself (openstreetmap.org, free account),
  then re-pulled, so the fix benefits everyone.
