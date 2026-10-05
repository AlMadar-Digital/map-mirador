// Ids shared by the preview plugin and the nested-map plugin, kept apart so neither has to
// import the other for them.

/** The companion window content key of the POI/journey preview. */
export const POI_PREVIEW_CONTENT_ID = 'mapsPoiPreview';

/** A preview opened on this id shows the map itself ("Discover the map"). */
export const MAP_INFO_ID = 'dbf:map-info';

/**
 * A preview opened on this id shows the POI a nested map was opened from: it belongs to the
 * parent map, so it is carried on the window's map history rather than found among the
 * nested map's annotations.
 */
export const NESTED_ORIGIN_ID = 'dbf:nested-origin';
