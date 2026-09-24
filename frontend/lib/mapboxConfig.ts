export const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";
export const MAPBOX_STYLE = "mapbox://styles/mapbox/dark-v11";

// Matches the old Leaflet setup's practical range: never zoom out past the
// initial "fit all NTAs" view (computed at runtime per map, see
// InteractiveMap's fitBounds-on-load), and cap zoom-in at 16, the same
// ceiling the old Esri raster basemap enforced. Per project owner
// instruction, 2026-09-27.
export const MAPBOX_MAX_ZOOM = 16;

export const NTA_SOURCE_ID = "ntas";
export const NTA_FILL_LAYER_ID = "ntas-fill";
export const NTA_LINE_LAYER_ID = "ntas-line";

export const ROUTE_COLOR = "#ff7f00";
export const HOVER_SELECTED_LINE_WIDTH = 3;
export const DEFAULT_LINE_WIDTH = 0.5;
export const LINE_WIDTH_TRANSITION_MS = 200;

// While an NTA is selected (magnified), every other NTA dims down to this
// opacity and the selected one goes fully opaque; deselecting instantly
// resets all of them back to DEFAULT_FILL_OPACITY. Per project owner
// instruction, 2026-09-27.
export const DEFAULT_FILL_OPACITY = 0.85;
export const SELECTED_FILL_OPACITY = 1;
export const DIMMED_FILL_OPACITY = 0.15;
