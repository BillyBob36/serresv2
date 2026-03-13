-- Migration 007 : Ajout de surface_osm_m2 sur serres (surface calculée depuis polygones OSM)
ALTER TABLE serres
  ADD COLUMN IF NOT EXISTS surface_osm_m2 NUMERIC;
