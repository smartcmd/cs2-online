# Project rules

## Competitive integrity

Consider competitive integrity before every change. Keep the map's source geometry, dimensions, elevation, cover, openings, collision, and line-of-sight / bullet occlusion unchanged when optimizing download size or rendering. Do not decimate the mesh, quantize positions, or weld nearby vertices for size savings. Lightweight replacement textures are allowed. Prefer lossless encoding, caching, spatial culling, and other optimizations that preserve geometry and gameplay decisions. Verify any change affecting collision or visibility against the source data.

<!-- astrlink-debug:begin -->
## AstrLink local data

- Inspect AstrLink only through the read-only CLI described by the astrlink-debug skill.
- Do not read, copy, search, or open /Users/daodaoneko/Library/Application Support/com.astrlink.desktop, any astrlink.db* file, or ~/.astrlink/control-session.json. Do not run sqlite3 on them.
- The control socket and session token only carry observer access. Do not use them to change AstrLink settings.

<!-- astrlink-debug:end -->
