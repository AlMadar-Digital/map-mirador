// The order a map's POIs are toured in, shared by the tour (mapInteractionPlugin.tsx) and the
// site preset's pins, which sit in the page in the same order (T-37).

export type OrderedAnnotation = {
  id: string;
  'dbf:kind'?: 'POI' | 'Journey';
  'dbf:journey'?: { id: string; order: number } | null;
  'dbf:order'?: number | null;
  target?: unknown;
};

// A missing order sorts after every explicit one; ties break on id for a stable order - the
// same rule as mirador-annotation-editor's annotationListGrouping.js, so the tour follows the
// editor's list.
export const compareByOrder = (
  a: { id: string; order?: number | null },
  b: { id: string; order?: number | null }
) => {
  if (a.order === b.order) return a.id.localeCompare(b.id);
  if (a.order === null || a.order === undefined) return 1;
  if (b.order === null || b.order === undefined) return -1;
  return a.order - b.order;
};

// The map's POIs in tour order: journeys and standalone POIs by their `dbf:order`, a journey
// unrolled into its stops (by `dbf:journey.order`) where it falls. A journey isn't a step of its
// own - its first stop is.
export const getTourPois = <T extends OrderedAnnotation>(items: T[]): T[] => {
  const ids = new Set(items.map((item) => item.id));
  const pois = items.filter((item) => item['dbf:kind'] === 'POI');
  const stopsOf = (journeyId: string) =>
    pois
      .filter((poi) => poi['dbf:journey']?.id === journeyId)
      .sort((a, b) =>
        compareByOrder({ id: a.id, order: a['dbf:journey']?.order }, { id: b.id, order: b['dbf:journey']?.order })
      );

  const topLevel = items
    .filter(
      (item) =>
        item['dbf:kind'] === 'Journey' ||
        // A stop whose journey isn't on this canvas stands on its own.
        (item['dbf:kind'] === 'POI' && !(item['dbf:journey']?.id && ids.has(item['dbf:journey'].id)))
    )
    .sort((a, b) => compareByOrder({ id: a.id, order: a['dbf:order'] }, { id: b.id, order: b['dbf:order'] }));

  return topLevel.flatMap((item) => (item['dbf:kind'] === 'Journey' ? stopsOf(item.id) : [item]));
};

/**
 * Each POI's number in the tour, from 1: what every pin and journey card shows on a map that
 * numbers all its POIs (MapViewer's `numberPins`, AlMadar-Digital/platform#549), rather than each
 * journey's stops alone.
 */
export const getTourNumbers = <T extends OrderedAnnotation>(items: T[]): Map<string, number> =>
  new Map(getTourPois(items).map((poi, index) => [poi.id, index + 1]));
