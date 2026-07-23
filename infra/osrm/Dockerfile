# Self-hosted OSRM for GoRide — Telangana extract, MLD (Multi-Level Dijkstra) pipeline.
#
# Two stages:
#   1. builder — downloads the Telangana OSM extract from Geofabrik and runs
#      osrm-extract / osrm-partition / osrm-customize. Peak RAM ~1.2 GB;
#      builder container needs at least 2 GB or the partition step OOMs.
#   2. runtime — copies the preprocessed .osrm files into a minimal image
#      and runs osrm-routed. Steady-state RAM ~250 MB for Telangana.
#
# Build args:
#   REGION_URL — Geofabrik PBF URL. Defaults to Telangana; swap for
#     https://download.geofabrik.de/asia/india-latest.osm.pbf if you need
#     all-India (needs ~16 GB RAM at build time — a fly builder won't do it).

# ─────────── STAGE 1: builder ────────────
FROM osrm/osrm-backend:v5.27.1 AS builder

ARG REGION_URL=https://download.geofabrik.de/asia/india/telangana-latest.osm.pbf

WORKDIR /data
ADD https://raw.githubusercontent.com/Project-OSRM/osrm-backend/v5.27.1/profiles/car.lua /data/car.lua

RUN echo "Downloading $REGION_URL" && \
    wget -qO region.osm.pbf "$REGION_URL" && \
    osrm-extract    -p /data/car.lua region.osm.pbf && \
    osrm-partition  region.osrm && \
    osrm-customize  region.osrm && \
    # Strip source PBF — we only need the preprocessed files at runtime.
    rm -f region.osm.pbf

# ─────────── STAGE 2: runtime ────────────
FROM osrm/osrm-backend:v5.27.1

WORKDIR /data
COPY --from=builder /data/ /data/

EXPOSE 5000
# --algorithm mld matches the MLD pipeline used above.
# --max-viaroute-size protects against unbounded requests.
CMD ["osrm-routed", "--algorithm", "mld", "--max-viaroute-size", "20", "region.osrm"]
