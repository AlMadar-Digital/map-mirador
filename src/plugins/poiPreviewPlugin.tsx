import { useEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import DOMPurify from 'dompurify';
import Button from '@mui/material/Button';
import MapIcon from '@mui/icons-material/MapSharp';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import OpenSeadragon from 'openseadragon';
import {
  AnnotationItem,
  ConnectedCompanionWindow as CompanionWindow,
  OSDReferences,
  addCompanionWindow,
  getAnnotations,
  getCompanionWindow,
  getCompanionWindows,
  getConfig,
  getManifest,
  getSelectedAnnotationId,
  getVisibleCanvases,
  removeCompanionWindow,
  selectAnnotation,
  updateCompanionWindow,
  // Relative, not `from 'dbf-mirador'`: this file lives inside the dbf-mirador package
  // itself (unlike its copy in the Strapi maps plugin, a real external consumer), and
  // there's no self-referencing node_modules link or dist build for the package name to
  // resolve against during local dev.
} from '../index';
import { getLinkedMapManifestId, openNestedMap, type LinkedMap } from './nestedMapPlugin';
import { setPanelCollapsed, useMinimiseOnFirstInteraction, usePanelCollapsed } from './sitePanelState';
import { readLineStyle, useSitePins, type PinResource } from './sitePins';

// A "dumb" way to preview a POI/journey (issue #375): a Mirador companion window plugin,
// registered alongside dbf-mirador-annotation-editor's own (see MiradorMaeViewer.tsx) via
// Mirador's `companionWindowKey` mechanism - no core patch needed, just adding this plugin
// to the same `plugins` array. The actual "Preview" button lives per-row in
// dbf-mirador-annotation-editor's own CanvasListItem.jsx, right next to Edit/Delete
// (see that package's own PR for issue #375) - it opens this companion window passing the
// specific row's id as `annotationid`, the same convention MAE's own 'annotationCreation'
// companion window already uses for its own Edit button.
//
// Journeys (issue #378) get a richer path here: a Journey renders its ordered stops as
// numbered cards, closer to how the public site will eventually present it. Two
// pieces of the Figma design are intentionally NOT built here, per the issue author's own
// follow-up comment saying they "wait more precision": numbered pins drawn on the map
// canvas itself, and an SVG line joining those pins in journey order.

const POI_PREVIEW_CONTENT_ID = 'mapsPoiPreview';

type TextualAnnotationBody = {
  purpose: 'identifying' | 'describing';
  type: 'TextualBody';
  language: string;
  value: string;
};

// Mirrors the maps plugin's `Annotation['dbf:mediaEn']`/`Annotation['dbf:mediaAr']`
// (issue #377) - one media selection per language, unlike the single, language-agnostic
// `dbf:media` extension issue #391 briefly introduced.
type DbfMedia = {
  source: 'upload' | 'iiif-image' | 'media-item';
  id: string;
  title: string | null;
  mediaType?: string | null;
  thumbnailUrl: string | null;
};

type RawAnnotation = {
  id: string;
  'dbf:kind'?: 'POI' | 'Journey';
  'dbf:mediaEn'?: DbfMedia | null;
  'dbf:mediaAr'?: DbfMedia | null;
  // A POI's membership in a journey and its position within it - a Journey never lists
  // its own POIs, membership is always POI -> Journey (see mirador-annotation-editor's
  // annotationListGrouping.js, which this plugin can't import directly since grouping
  // isn't part of that package's public API - so the same filter+sort is redone below).
  'dbf:journey'?: { id: string; order: number } | null;
  // Set on a "Nested Map" point only: the map it opens (see nestedMapPlugin.tsx).
  'dbf:linkedMap'?: LinkedMap | null;
  body?: TextualAnnotationBody[];
  target?: unknown;
};

// Content is authored in English and Arabic only. The preview shows the one matching
// Mirador's own UI language (`config.language`, which MapViewer's `lang` prop sets), so a
// map and its previews always speak the same language - Arabic for any `ar*` language,
// English otherwise.
export type ContentLocale = 'en' | 'ar';
export const getContentLocale = (language?: string | null): ContentLocale =>
  (language ?? '').split('-')[0].toLowerCase() === 'ar' ? 'ar' : 'en';

// The preview's own UI strings - a local table rather than Mirador's i18n resources, since
// only the two content locales ever reach this plugin.
const LABELS: Record<ContentLocale, Record<string, string>> = {
  ar: {
    Journey: 'رحلة',
    POI: 'نقطة اهتمام',
    noStops: 'لا توجد محطات في هذه الرحلة بعد.',
    notFound: 'تعذر العثور على هذا العنصر - ربما تم حذفه.',
    openMap: 'فتح الخريطة',
    closePanel: 'إغلاق اللوحة',
    collapse: 'إخفاء اللوحة',
    expand: 'إظهار اللوحة',
    discover: 'اكتشف الخريطة',
    followJourney: 'اتبع الرحلة',
    preview: 'معاينة',
    showOnMap: 'عرض على الخريطة',
  },
  en: {
    Journey: 'Journey',
    POI: 'POI',
    noStops: 'This journey has no stops yet.',
    notFound: 'This annotation could not be found - it may have been deleted.',
    openMap: 'Open map',
    closePanel: 'Close panel',
    collapse: 'Hide panel',
    expand: 'Show panel',
    discover: 'Discover the map',
    followJourney: 'Follow the journey',
    preview: 'Preview',
    showOnMap: 'Show on map',
  },
};

// Tags the CMS's rich-text editors produce (CKEditor writes `<i>` for italics, which carry
// artwork titles). Everything else - scripts, event handlers, styles, classes - is removed
// before a description is injected (issue T-03).
const DESCRIPTION_HTML = {
  ALLOWED_ATTR: ['href', 'title', 'target', 'rel'],
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'sup', 'sub', 'a', 'blockquote',
    'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'hr',
  ],
};
// A private instance: Mirador's SanitizedHtml registers a global hook that forces every link
// to open in a new tab, which is the host site's call, not ours.
let purifier: ReturnType<typeof DOMPurify> | undefined;
export const sanitizeDescription = (html: string): string => {
  if (!html) return '';
  purifier ??= DOMPurify(window);
  return String(purifier.sanitize(html, DESCRIPTION_HTML));
};

const textBody = (
  annotation: RawAnnotation,
  language: string,
  purpose: 'identifying' | 'describing'
): string =>
  annotation.body?.find(
    (item): item is TextualAnnotationBody =>
      item.type === 'TextualBody' && item.purpose === purpose && item.language === language
  )?.value ?? '';

const mediaForLocale = (annotation: RawAnnotation, locale: ContentLocale): DbfMedia | null | undefined =>
  locale === 'en' ? annotation['dbf:mediaEn'] : annotation['dbf:mediaAr'];

const IMAGE_FILE = /\.(avif|gif|jpe?g|png|svg|webp)$/i;

// The image to show for a POI's media, if it has one. A Media Library upload's
// `thumbnailUrl` is the uploaded file itself, which may be audio, video or a PDF - only an
// image file is shown as one. IIIF Images and Media Items always carry an image thumbnail.
export const mediaImageUrl = (media: DbfMedia | null | undefined): string | null => {
  const url = media?.thumbnailUrl;
  if (!url) return null;
  if (media.source !== 'upload') return url;
  try {
    return IMAGE_FILE.test(new URL(url, 'http://localhost').pathname) ? url : null;
  } catch {
    return null;
  }
};

// The preview companion window shows the map itself (its title and description) when it is
// opened on this id rather than an annotation's: the site preset's "Discover the map" panel.
export const MAP_INFO_ID = 'dbf:map-info';

type LanguageMap = Record<string, string[] | string | undefined> | string | null | undefined;

// A IIIF language map's text in the content locale, falling back to `none`, then any language.
const languageMapText = (value: LanguageMap, locale: ContentLocale): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  const entry = value[locale] ?? value.none ?? Object.values(value).find(Boolean);
  return (Array.isArray(entry) ? entry.join(' ') : entry ?? '').trim();
};

export type MapInfo = { summary: string; title: string };

// The map's own title and description, from its manifest's `label` and `summary`.
export const getMapInfo = (state: unknown, windowId: string, locale: ContentLocale): MapInfo | null => {
  const json = (getManifest(state, { windowId }) as { json?: { label?: LanguageMap; summary?: LanguageMap } })?.json;
  const title = languageMapText(json?.label, locale);
  const summary = languageMapText(json?.summary, locale);
  return title || summary ? { summary, title } : null;
};

// A journey's ordered stops, derived the same way the rest of the codebase does: every
// POI whose `dbf:journey.id` points at this journey, sorted by `dbf:journey.order`.
export const getOrderedJourneyPois = (items: RawAnnotation[], journeyId: string): RawAnnotation[] =>
  items
    .filter(
      (item): item is RawAnnotation & { 'dbf:journey': { id: string; order: number } } =>
        item['dbf:kind'] === 'POI' && item['dbf:journey']?.id === journeyId
    )
    .sort((a, b) => a['dbf:journey'].order - b['dbf:journey'].order);

// A POI's pin position, in canvas coordinates - the same PointSelector AnnotationsOverlay
// draws the pin from. The map viewer shows a single canvas, so canvas coordinates are also
// OpenSeadragon's viewport coordinates (a multi-canvas layout would need CanvasWorld's offset).
type Point = { x: number; y: number };
export const getPoiPoint = (poi: RawAnnotation): Point | null => {
  // AnnotationItem#pointSelector throws on a target-less annotation (its selector is `null`)
  if (!poi.target) return null;
  const selector = new AnnotationItem(poi).pointSelector as Partial<Point> | null | undefined;
  if (typeof selector?.x !== 'number' || typeof selector?.y !== 'number') return null;
  return { x: selector.x, y: selector.y };
};

// How far "focus on this stop" zooms in, relative to the whole-map (home) zoom - a ratio
// rather than an absolute zoom, since Mirador's viewport is in canvas pixels so absolute
// zoom levels differ from one map to another.
const POI_FOCUS_ZOOM_RATIO = 4;
// Margin kept around a journey's stops when fitting them all in view, as a fraction of the
// stops' own bounding box (with a floor for journeys whose stops are almost on top of each other).
const JOURNEY_FIT_PADDING_RATIO = 0.2;

// How close (in screen pixels) a pin may get to the edge of the visible map before
// `ensurePointVisible` treats it as hidden - roughly a pin's own size, so it's never half cut off.
const VISIBLE_AREA_MARGIN = 32;
// Below this share of the map's width/height, the part left uncovered by companion windows is
// too small to frame anything in (e.g. a bottom sheet over most of a phone screen), so the
// whole map is used instead.
const MIN_VISIBLE_AREA_RATIO = 0.25;

// The companion window positions that can float over the map (see MapViewer's theme overrides).
const OVERLAY_COMPANION_WINDOW_SELECTOR = ['left', 'right', 'far-right', 'bottom', 'far-bottom']
  .map((position) => `aside.mirador-companion-window-${position}`)
  .join(', ');

type OsdViewport = OpenSeadragon.Viewport;
type OsdViewer = { element?: HTMLElement; viewport?: OsdViewport };
// A rectangle in the OpenSeadragon container's own pixel space.
type PixelRect = { x: number; y: number; width: number; height: number };

const getOsdViewer = (windowId: string): OsdViewer | null =>
  OSDReferences.get(windowId)?.current ?? null;

// The part of the map that isn't hidden behind a companion window floating over it (in
// MapViewer, the POI/journey preview slides in over the canvas rather than next to it). An
// overlay that spans the map's full height hides a strip on its side, one spanning its full
// width hides a strip at the top or bottom; companion windows laid out next to the canvas (as
// in the Strapi editor) don't intersect it at all, so they're ignored.
export const getVisibleMapArea = (viewer: OsdViewer): PixelRect | null => {
  const { element, viewport } = viewer;
  if (!viewport) return null;
  const size = viewport.getContainerSize();
  const full = { height: size.y, width: size.x, x: 0, y: 0 };
  const windowElement = element?.closest('.mirador-window');
  if (!element || !windowElement) return full;

  const container = element.getBoundingClientRect();
  let left = 0;
  let top = 0;
  let right = size.x;
  let bottom = size.y;
  windowElement.querySelectorAll(OVERLAY_COMPANION_WINDOW_SELECTOR).forEach((overlay) => {
    const rect = overlay.getBoundingClientRect();
    const x1 = Math.max(rect.left, container.left) - container.left;
    const x2 = Math.min(rect.right, container.right) - container.left;
    const y1 = Math.max(rect.top, container.top) - container.top;
    const y2 = Math.min(rect.bottom, container.bottom) - container.top;
    if (x2 - x1 <= 0 || y2 - y1 <= 0) return;

    if (y2 - y1 >= size.y * 0.9) {
      if (x1 + x2 > size.x) right = Math.min(right, x1);
      else left = Math.max(left, x2);
    } else if (x2 - x1 >= size.x * 0.9) {
      if (y1 + y2 > size.y) bottom = Math.min(bottom, y1);
      else top = Math.max(top, y2);
    }
  });

  if (right - left < size.x * MIN_VISIBLE_AREA_RATIO || bottom - top < size.y * MIN_VISIBLE_AREA_RATIO) {
    return full;
  }
  return { height: bottom - top, width: right - left, x: left, y: top };
};

// Moves the map so `center` sits in the middle of its visible area, at a scale of
// `unitsPerPixel` viewport units per screen pixel. OpenSeadragon's own pan/zoom/fit calls all
// centre on the whole container, which puts the target behind a preview panel, so this builds
// the matching whole-container bounds itself.
const showCenteredInVisibleArea = (viewer: OsdViewer, center: Point, unitsPerPixel: number) => {
  const { viewport } = viewer;
  const area = getVisibleMapArea(viewer);
  if (!viewport || !area) return;
  const size = viewport.getContainerSize();

  viewport.fitBounds(
    new OpenSeadragon.Rect(
      center.x - (area.x + area.width / 2) * unitsPerPixel,
      center.y - (area.y + area.height / 2) * unitsPerPixel,
      size.x * unitsPerPixel,
      size.y * unitsPerPixel
    )
  );
};

// OpenSeadragon's zoom is the inverse of the viewport's width in viewport units.
const unitsPerPixelAtZoom = (viewport: OsdViewport, zoom: number) =>
  1 / (zoom * viewport.getContainerSize().x);

// Pans the main map onto a point, zooming in if the map is further out than the focus zoom
// (but never zooming out a user who is already closer in).
export const focusMapOnPoint = (windowId: string, point: Point) => {
  const viewer = getOsdViewer(windowId);
  const viewport = viewer?.viewport;
  if (!viewer || !viewport) return;

  const zoom = Math.min(
    viewport.getMaxZoom(),
    Math.max(viewport.getZoom(), viewport.getHomeZoom() * POI_FOCUS_ZOOM_RATIO)
  );
  showCenteredInVisibleArea(viewer, point, unitsPerPixelAtZoom(viewport, zoom));
};

// Pans the map just enough to bring a point out from under a companion window (or back from
// off-screen), keeping the current zoom - a no-op when the point is already in view, so
// clicking a pin the user can see doesn't move the map under them.
export const ensurePointVisible = (windowId: string, point: Point) => {
  const viewer = getOsdViewer(windowId);
  const viewport = viewer?.viewport;
  const area = viewer ? getVisibleMapArea(viewer) : null;
  if (!viewer || !viewport || !area) return;

  // Against the viewport's target (not mid-animation) position, so a focus already under way counts.
  const pixel = viewport.pixelFromPoint(new OpenSeadragon.Point(point.x, point.y));
  const margin = Math.min(VISIBLE_AREA_MARGIN, area.width / 4, area.height / 4);
  if (
    pixel.x >= area.x + margin &&
    pixel.x <= area.x + area.width - margin &&
    pixel.y >= area.y + margin &&
    pixel.y <= area.y + area.height - margin
  ) {
    return;
  }
  showCenteredInVisibleArea(viewer, point, unitsPerPixelAtZoom(viewport, viewport.getZoom()));
};

// Fits every stop of a journey in view at once.
export const fitMapToPoints = (windowId: string, points: Point[]) => {
  if (points.length === 0) return;
  if (points.length === 1) {
    focusMapOnPoint(windowId, points[0]);
    return;
  }

  const viewer = getOsdViewer(windowId);
  const viewport = viewer?.viewport;
  const area = viewer ? getVisibleMapArea(viewer) : null;
  if (!viewer || !viewport || !area) return;

  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX;
  const height = Math.max(...ys) - minY;
  const home = viewport.getHomeBounds();
  const padX = Math.max(width * JOURNEY_FIT_PADDING_RATIO, home.width * 0.05);
  const padY = Math.max(height * JOURNEY_FIT_PADDING_RATIO, home.height * 0.05);

  const unitsPerPixel = Math.max(
    (width + 2 * padX) / area.width,
    (height + 2 * padY) / area.height,
    unitsPerPixelAtZoom(viewport, viewport.getMaxZoom())
  );
  showCenteredInVisibleArea(viewer, { x: minX + width / 2, y: minY + height / 2 }, unitsPerPixel);
};

// The scrolling content area of the companion window an element is in.
const getScrollContainer = (element: HTMLElement) =>
  element.closest<HTMLElement>('.mirador-scrollto-scrollable');

// Scrolls the companion window an element is in so the element starts at its top - for a stop
// card, its number and title - rather than wherever scrollIntoView's 'nearest' would leave it
// (the card's end, when it's taller than the panel). Only that panel scrolls: scrollIntoView
// could also scroll the page around the viewer. The last cards are too close to the end of the
// list to reach the top, so `spacer` (an empty element after them) grows just enough to let them.
const scrollCardToTop = (card: HTMLElement, spacer: HTMLElement | null, behavior: ScrollBehavior) => {
  const scroller = getScrollContainer(card);
  if (!scroller) return;
  // A host page can keep room above the card (for a close button, say) with `scroll-margin-top`.
  const margin = parseFloat(getComputedStyle(card).scrollMarginTop) || 0;
  const top = Math.max(
    0,
    scroller.scrollTop + card.getBoundingClientRect().top - scroller.getBoundingClientRect().top - margin
  );
  if (spacer) {
    const spacerHeight = spacer.offsetHeight;
    const missing = top + scroller.clientHeight - (scroller.scrollHeight - spacerHeight);
    // eslint-disable-next-line no-param-reassign -- sized imperatively, alongside the scroll itself
    spacer.style.height = `${Math.max(0, missing)}px`;
  }
  scroller.scrollTo?.({ behavior, top });
};

const localeDir = (locale: ContentLocale) => (locale === 'ar' ? 'rtl' : 'ltr');

type PanelPosition = 'right' | 'bottom';

interface SitePanelProps {
  children: ReactNode;
  id: string;
  label: string;
  locale: ContentLocale;
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  // What the panel shows; a change (a pin clicked, a stop scrolled to) reopens a collapsed panel.
  showing: string;
  windowId: string;
}

// The site preset's panel (`.dbf-map-panel*` class contract): its own header - the sheet handle
// and label on a phone, a round close button - in place of Mirador's title bar. The host page
// styles it; the tools in siteMapToolsPlugin.tsx collapse it.
const SitePanel = ({
  children,
  id,
  label,
  locale,
  position,
  removeCompanionWindow: dispatchRemoveCompanionWindow,
  showing,
  windowId,
}: SitePanelProps) => {
  const collapsed = usePanelCollapsed(windowId);
  useEffect(() => {
    setPanelCollapsed(windowId, false);
  }, [showing, windowId]);

  return (
    <CompanionWindow header={false} id={id} title={label} windowId={windowId}>
      <div
        className="dbf-map-panel__body"
        data-collapsed={collapsed ? 'true' : undefined}
        data-position={position}
        dir={localeDir(locale)}
        lang={locale}
      >
        <div className="dbf-map-panel__header">
          {position === 'bottom' && (
            <button
              aria-expanded={!collapsed}
              aria-label={collapsed ? LABELS[locale].expand : LABELS[locale].collapse}
              className="dbf-map-panel__handle"
              onClick={() => setPanelCollapsed(windowId, !collapsed)}
              type="button"
            />
          )}
          <h2 className="dbf-map-panel__label">{label}</h2>
          <button
            aria-label={LABELS[locale].closePanel}
            className="dbf-map-panel__close"
            onClick={() => {
              setPanelCollapsed(windowId, false);
              dispatchRemoveCompanionWindow(windowId, id);
            }}
            type="button"
          />
        </div>
        {children}
      </div>
    </CompanionWindow>
  );
};

interface JourneyPreviewContentProps {
  id: string;
  journey: RawAnnotation;
  site?: boolean;
  locale: ContentLocale;
  pois: RawAnnotation[];
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  selectAnnotation: typeof selectAnnotation;
  selectedAnnotationId?: string;
  windowId: string;
}

const JourneyPreviewContent = ({
  id,
  journey,
  locale,
  pois,
  position,
  removeCompanionWindow: dispatchRemoveCompanionWindow,
  selectAnnotation: dispatchSelectAnnotation,
  selectedAnnotationId,
  site = false,
  windowId,
}: JourneyPreviewContentProps) => {
  const labels = LABELS[locale];
  const journeyTitle = textBody(journey, locale, 'identifying');

  const stopsRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const selectedStop = pois.find((poi) => poi.id === selectedAnnotationId);
  const selectedStopPoint = selectedStop ? getPoiPoint(selectedStop) : null;

  // `pois` is a fresh array on every store update, so the fit below is keyed on the stops'
  // actual positions instead - it only re-runs when another journey is previewed or a stop moves.
  // Opened on one of its stops (its pin was clicked, or it was scrolled to), the journey keeps
  // that stop in view rather than zooming out to all of them.
  const points = pois.map(getPoiPoint).filter((point): point is Point => point !== null);
  const pointsKey = points.map(({ x, y }) => `${x},${y}`).join(';');
  useEffect(() => {
    if (selectedStopPoint) ensurePointVisible(windowId, selectedStopPoint);
    else fitMapToPoints(windowId, points);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `points` is captured by `pointsKey`; the selected stop only matters when the journey is (re)framed
  }, [journey.id, pointsKey, windowId]);

  // The selected stop (its pin clicked, or scrolled to) is brought out from under this panel,
  // and its card scrolled to the top of the panel, title first.
  useEffect(() => {
    if (!selectedStop) {
      if (spacerRef.current) spacerRef.current.style.height = '0px';
      return undefined;
    }
    if (selectedStopPoint) ensurePointVisible(windowId, selectedStopPoint);
    const stops = stopsRef.current;
    const card = Array.from(stops?.children ?? []).find(
      (child): child is HTMLElement => (child as HTMLElement).dataset.poiId === selectedStop.id
    );
    if (!stops || !card) return undefined;
    scrollCardToTop(card, spacerRef.current, 'smooth');

    // Thumbnails of the stops above it that finish loading afterwards push the card down: keep
    // it at the top until the visitor scrolls the panel themselves. (`load` doesn't bubble,
    // hence the capture listener.)
    const scroller = getScrollContainer(card);
    const realign = () => scrollCardToTop(card, spacerRef.current, 'auto');
    const userEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    const stopFollowing = () => {
      stops.removeEventListener('load', realign, true);
      userEvents.forEach((name) => scroller?.removeEventListener(name, stopFollowing));
    };
    stops.addEventListener('load', realign, true);
    userEvents.forEach((name) => scroller?.addEventListener(name, stopFollowing, { passive: true }));
    return stopFollowing;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs only when another stop is selected
  }, [selectedStop?.id, windowId]);

  const focusPoi = (poi: RawAnnotation) => {
    const point = getPoiPoint(poi);
    if (point) focusMapOnPoint(windowId, point);
    // Selecting it also highlights the pin on the map, like clicking the pin itself would.
    dispatchSelectAnnotation(windowId, poi.id);
  };

  if (site) {
    // Stops are cards separated by a divider (`.dbf-map-poi*` class contract). Each card's
    // title is its keyboard target, the card itself the pointer target; the marker carries
    // the stop's number.
    return (
      <SitePanel
        id={id}
        label={labels.followJourney}
        locale={locale}
        position={position}
        removeCompanionWindow={dispatchRemoveCompanionWindow}
        showing={`${journey.id}:${selectedAnnotationId ?? ''}`}
        windowId={windowId}
      >
        <div className="dbf-map-panel__list" ref={stopsRef}>
          {pois.length === 0 && <p>{labels.noStops}</p>}
          {pois.flatMap((poi, index) => {
            const poiTitle = textBody(poi, locale, 'identifying');
            const description = sanitizeDescription(textBody(poi, locale, 'describing'));
            const media = mediaForLocale(poi, locale);
            const isSelected = poi.id === selectedAnnotationId;
            const card = (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the title button is the keyboard target
              <article
                className="dbf-map-poi"
                data-poi-id={poi.id}
                data-selected={isSelected ? 'true' : undefined}
                data-variant="stop"
                key={poi.id}
                onClick={() => focusPoi(poi)}
              >
                <div className="dbf-map-poi__header">
                  <span className="dbf-map-poi__marker">{index + 1}</span>
                  <div className="dbf-map-poi__heading">
                    {journeyTitle && <p className="dbf-map-poi__eyebrow">{journeyTitle}</p>}
                    <h3 className="dbf-map-poi__title">
                      <button
                        aria-current={isSelected || undefined}
                        className="dbf-map-poi__select"
                        onClick={(event) => {
                          event.stopPropagation();
                          focusPoi(poi);
                        }}
                        type="button"
                      >
                        {poiTitle || '—'}
                      </button>
                    </h3>
                  </div>
                </div>
                {mediaImageUrl(media) && (
                  <div className="dbf-map-poi__media">
                    <img alt={media?.title ?? ''} src={mediaImageUrl(media) ?? undefined} />
                  </div>
                )}
                {description && (
                  // eslint-disable-next-line react/no-danger -- sanitised above
                  <div className="dbf-map-poi__text" dangerouslySetInnerHTML={{ __html: description }} />
                )}
              </article>
            );
            return index === 0
              ? [card]
              : [<span aria-hidden className="dbf-map-poi__divider" key={`divider-${poi.id}`} />, card];
          })}
          {/* Room for the last stops to scroll to the top when selected - see scrollCardToTop. */}
          <div aria-hidden ref={spacerRef} style={{ height: 0 }} />
        </div>
      </SitePanel>
    );
  }

  return (
    <CompanionWindow id={id} title={journeyTitle || labels.Journey} windowId={windowId}>
      <div dir={localeDir(locale)} lang={locale} ref={stopsRef} style={{ padding: 16 }}>
        {pois.length === 0 && <p>{labels.noStops}</p>}
        {pois.map((poi, index) => {
          const poiTitle = textBody(poi, locale, 'identifying');
          const description = sanitizeDescription(textBody(poi, locale, 'describing'));
          const media = mediaForLocale(poi, locale);
          const isLast = index === pois.length - 1;
          const isSelected = poi.id === selectedAnnotationId;
          return (
            <div
              aria-current={isSelected || undefined}
              data-poi-id={poi.id}
              key={poi.id}
              onClick={() => focusPoi(poi)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  focusPoi(poi);
                }
              }}
              role="button"
              style={{
                background: isSelected ? 'rgba(0, 0, 0, 0.06)' : undefined,
                borderRadius: 8,
                cursor: 'pointer',
                display: 'flex',
                marginInline: -8,
                paddingInline: 8,
                paddingTop: 8,
              }}
              tabIndex={0}
              title={labels.showOnMap}
            >
              <div
                style={{
                  alignItems: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  marginInlineEnd: 16,
                }}
              >
                <span
                  style={{
                    alignItems: 'center',
                    background: '#000',
                    borderRadius: '50%',
                    color: '#fff',
                    display: 'flex',
                    flexShrink: 0,
                    fontWeight: 'bold',
                    height: 28,
                    justifyContent: 'center',
                    width: 28,
                  }}
                >
                  {index + 1}
                </span>
                {/* A plain vertical stepper line standing in for the map's own dashed
                    connector line, which is out of scope here - see the module comment. */}
                {!isLast && <div style={{ background: '#ccc', flex: 1, margin: '4px 0', width: 2 }} />}
              </div>
              <div style={{ flex: 1, paddingBottom: isLast ? 0 : 24 }}>
                <h3 style={{ margin: '0 0 8px' }}>{poiTitle || '—'}</h3>
                {mediaImageUrl(media) && (
                  <img
                    alt={media?.title ?? ''}
                    src={mediaImageUrl(media) ?? undefined}
                    style={{ borderRadius: 8, marginBottom: 8, maxWidth: '100%' }}
                  />
                )}
                {description && (
                  // eslint-disable-next-line react/no-danger -- description is CKEditor HTML, the same content the public site will eventually render
                  <div dangerouslySetInnerHTML={{ __html: description }} />
                )}
              </div>
            </div>
          );
        })}
        {/* Room for the last stops to scroll to the top when selected - see scrollCardToTop. */}
        <div aria-hidden ref={spacerRef} style={{ height: 0 }} />
      </div>
    </CompanionWindow>
  );
};

interface PoiPreviewContentProps {
  annotation: RawAnnotation | null;
  site?: boolean;
  id: string;
  linkedMapManifestId: string | null;
  locale: ContentLocale;
  openNestedMap: (windowId: string, manifestId: string) => void;
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  windowId: string;
}

const PoiPreviewContent = ({
  annotation,
  id,
  linkedMapManifestId,
  locale,
  openNestedMap: dispatchOpenNestedMap,
  position,
  removeCompanionWindow: dispatchRemoveCompanionWindow,
  site = false,
  windowId,
}: PoiPreviewContentProps) => {
  const labels = LABELS[locale];
  const kind = annotation?.['dbf:kind'];
  const title = annotation ? textBody(annotation, locale, 'identifying') : '';
  const description = annotation ? sanitizeDescription(textBody(annotation, locale, 'describing')) : '';
  const media = annotation ? mediaForLocale(annotation, locale) : null;

  // The preview panel floats over the map, so the pin it describes may now be behind it.
  const point = annotation ? getPoiPoint(annotation) : null;
  useEffect(() => {
    if (point) ensurePointVisible(windowId, point);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the pin's position, `point` is a fresh object each render
  }, [annotation?.id, point?.x, point?.y, windowId]);

  if (site) {
    return (
      <SitePanel
        id={id}
        label={labels.discover}
        locale={locale}
        position={position}
        removeCompanionWindow={dispatchRemoveCompanionWindow}
        showing={annotation?.id ?? ''}
        windowId={windowId}
      >
        {!annotation && <p className="dbf-map-error">{labels.notFound}</p>}
        {annotation && (
          <article className="dbf-map-poi" data-selected="true" data-variant="single">
            <div className="dbf-map-poi__header">
              <span aria-hidden className="dbf-map-poi__marker" />
              <div className="dbf-map-poi__heading">
                <h3 className="dbf-map-poi__title">{title || labels.POI}</h3>
              </div>
            </div>
            {mediaImageUrl(media) && (
              <div className="dbf-map-poi__media">
                <img alt={media?.title ?? ''} src={mediaImageUrl(media) ?? undefined} />
              </div>
            )}
            {description && (
              // eslint-disable-next-line react/no-danger -- sanitised above
              <div className="dbf-map-poi__text" dangerouslySetInnerHTML={{ __html: description }} />
            )}
            {linkedMapManifestId && (
              <button
                className="dbf-map-poi__nested"
                onClick={() => dispatchOpenNestedMap(windowId, linkedMapManifestId)}
                type="button"
              >
                {labels.openMap}
              </button>
            )}
          </article>
        )}
      </SitePanel>
    );
  }

  return (
    <CompanionWindow id={id} title={title || (kind && labels[kind]) || labels.preview} windowId={windowId}>
      <div dir={localeDir(locale)} lang={locale} style={{ padding: 16 }}>
        {!annotation && <p>{labels.notFound}</p>}
        {description && (
          // eslint-disable-next-line react/no-danger -- descriptionEn/Ar is CKEditor HTML, the same content the public site will eventually render
          <div dangerouslySetInnerHTML={{ __html: description }} />
        )}
        {media &&
          (mediaImageUrl(media) ? (
            <img alt={media.title ?? ''} src={mediaImageUrl(media) ?? undefined} style={{ maxWidth: '100%' }} />
          ) : (
            <p>
              {media.title}
              {media.mediaType ? ` (${media.mediaType})` : ''}
            </p>
          ))}
        {linkedMapManifestId && (
          <Button
            onClick={() => dispatchOpenNestedMap(windowId, linkedMapManifestId)}
            startIcon={<MapIcon />}
            sx={{ marginTop: 2 }}
            variant="contained"
          >
            {labels.openMap}
          </Button>
        )}
      </div>
    </CompanionWindow>
  );
};

interface MapInfoContentProps {
  id: string;
  locale: ContentLocale;
  mapInfo: MapInfo;
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  windowId: string;
}

// "Discover the map": the map's own title and description, shown while no POI is selected.
const MapInfoContent = ({
  id,
  locale,
  mapInfo,
  position,
  removeCompanionWindow: dispatchRemoveCompanionWindow,
  windowId,
}: MapInfoContentProps) => {
  const summary = sanitizeDescription(mapInfo.summary);
  return (
    <SitePanel
      id={id}
      label={LABELS[locale].discover}
      locale={locale}
      position={position}
      removeCompanionWindow={dispatchRemoveCompanionWindow}
      showing={MAP_INFO_ID}
      windowId={windowId}
    >
      <article className="dbf-map-poi" data-variant="map">
        <div className="dbf-map-poi__header">
          <div className="dbf-map-poi__heading">
            <h3 className="dbf-map-poi__title">{mapInfo.title}</h3>
          </div>
        </div>
        {summary && (
          // eslint-disable-next-line react/no-danger -- sanitised above
          <div className="dbf-map-poi__text" dangerouslySetInnerHTML={{ __html: summary }} />
        )}
      </article>
    </SitePanel>
  );
};

interface PreviewContentProps {
  annotation: RawAnnotation | null;
  id: string;
  journeyPois: RawAnnotation[];
  linkedMapManifestId: string | null;
  locale: ContentLocale;
  mapInfo?: MapInfo | null;
  openNestedMap: (windowId: string, manifestId: string) => void;
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  selectAnnotation: typeof selectAnnotation;
  selectedAnnotationId?: string;
  site?: boolean;
  windowId: string;
}

const PreviewContent = ({
  annotation,
  id,
  journeyPois,
  linkedMapManifestId,
  locale,
  mapInfo = null,
  openNestedMap: dispatchOpenNestedMap,
  position,
  removeCompanionWindow: dispatchRemoveCompanionWindow,
  selectAnnotation: dispatchSelectAnnotation,
  selectedAnnotationId,
  site,
  windowId,
}: PreviewContentProps) => {
  if (site && mapInfo) {
    return (
      <MapInfoContent
        id={id}
        locale={locale}
        mapInfo={mapInfo}
        position={position}
        removeCompanionWindow={dispatchRemoveCompanionWindow}
        windowId={windowId}
      />
    );
  }
  if (annotation && annotation['dbf:kind'] === 'Journey') {
    return (
      <JourneyPreviewContent
        id={id}
        journey={annotation}
        locale={locale}
        pois={journeyPois}
        position={position}
        removeCompanionWindow={dispatchRemoveCompanionWindow}
        selectAnnotation={dispatchSelectAnnotation}
        selectedAnnotationId={selectedAnnotationId}
        site={site}
        windowId={windowId}
      />
    );
  }
  return (
    <PoiPreviewContent
      annotation={annotation}
      id={id}
      linkedMapManifestId={linkedMapManifestId}
      locale={locale}
      openNestedMap={dispatchOpenNestedMap}
      position={position}
      removeCompanionWindow={dispatchRemoveCompanionWindow}
      site={site}
      windowId={windowId}
    />
  );
};

const poiPreviewCompanionWindowPlugin = {
  component: PreviewContent,
  companionWindowKey: POI_PREVIEW_CONTENT_ID,
  mapStateToProps: (state: unknown, { id, windowId }: { id: string; windowId: string }) => {
    const companionWindow = getCompanionWindow(state, { companionWindowId: id }) as
      | { annotationid?: string; position?: string }
      | undefined;
    const annotationId = companionWindow?.annotationid;
    const items = getCanvasAnnotationItems(state, windowId);
    const annotation = items.find((item) => item.id === annotationId) ?? null;
    const locale = getContentLocale((getConfig(state) as { language?: string }).language);
    return {
      annotation,
      journeyPois:
        annotation && annotation['dbf:kind'] === 'Journey' ? getOrderedJourneyPois(items, annotation.id) : [],
      // Only a Nested Map point whose map the host can resolve gets an "Open map" button.
      linkedMapManifestId: getLinkedMapManifestId(state, annotation?.['dbf:linkedMap']),
      locale,
      mapInfo: annotationId === MAP_INFO_ID ? getMapInfo(state, windowId, locale) : null,
      position: companionWindow?.position === 'bottom' ? 'bottom' : 'right',
      selectedAnnotationId: getSelectedAnnotationId(state, { windowId }) as string | undefined,
      // MapViewer's site preset renders the site's markup; the annotation editor never sets it.
      site: (getConfig(state) as { maps?: { site?: boolean } }).maps?.site === true,
    };
  },
  mapDispatchToProps: { openNestedMap, removeCompanionWindow, selectAnnotation },
};

type AnnotationPages = Record<string, { json?: { items?: unknown[] } }>;

// The annotation pages of the window's (single) visible canvas - the store's own object, so a
// stable reference until those annotations change.
export const getCanvasAnnotationPages = (state: unknown, windowId: string): AnnotationPages | undefined => {
  const canvasId = getVisibleCanvases(state, { windowId })[0]?.id;
  return canvasId ? getAnnotations(state)[canvasId] : undefined;
};

export const annotationPagesItems = (pages: AnnotationPages | undefined): RawAnnotation[] =>
  (pages ? Object.values(pages) : []).flatMap((page) => (page.json?.items ?? []) as RawAnnotation[]);

// Every annotation on the window's (single) visible canvas, as raw JSON.
export const getCanvasAnnotationItems = (state: unknown, windowId: string): RawAnnotation[] =>
  annotationPagesItems(getCanvasAnnotationPages(state, windowId));

// The window's open preview companion window, if any - re-used rather than stacking a new one.
export const getPreviewCompanionWindowId = (state: unknown, windowId: string): string | undefined =>
  Object.values(
    getCompanionWindows(state) as Record<string, { id: string; windowId: string; content: string | null }>
  ).find((cw) => cw.windowId === windowId && cw.content === POI_PREVIEW_CONTENT_ID)?.id;

// A POI that is a journey's stop is previewed through its journey (with the stop selected), so
// the visitor sees where it sits in the tour - unless that journey isn't on this canvas.
export const getPreviewAnnotationId = (
  annotation: Pick<RawAnnotation, 'id' | 'dbf:kind' | 'dbf:journey'>,
  hasAnnotation: (id: string) => boolean
): string => {
  const journeyId = annotation['dbf:kind'] === 'POI' ? annotation['dbf:journey']?.id : undefined;
  return journeyId && hasAnnotation(journeyId) ? journeyId : annotation.id;
};

export interface PreviewDispatchers {
  addCompanionWindow: typeof addCompanionWindow;
  updateCompanionWindow: typeof updateCompanionWindow;
}

// Shows `annotationId` in the window's preview companion window, opening it if needed.
export const openPreview = (
  { addCompanionWindow: dispatchAdd, updateCompanionWindow: dispatchUpdate }: PreviewDispatchers,
  windowId: string,
  existingPreviewCompanionWindowId: string | undefined,
  annotationId: string,
  position: 'bottom' | 'right'
) => {
  if (existingPreviewCompanionWindowId) {
    dispatchUpdate(windowId, existingPreviewCompanionWindowId, { annotationid: annotationId, position });
  } else {
    dispatchAdd(windowId, { annotationid: annotationId, content: POI_PREVIEW_CONTENT_ID, position });
  }
};

// Issue #410: on a phone-width viewport there's no room for a right-hand rail next to
// the map, so the POI/journey preview opens as a bottom sheet instead.
export const usePreviewPosition = (): 'bottom' | 'right' => {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down('sm')) ? 'bottom' : 'right';
};

// A canvas annotation resource, as AnnotationsOverlay's own `annotations`/`searchAnnotations`
// props carry it (see AnnotationItem#pointSelector/#svgSelector) - a POI marker is any resource
// with a pointSelector (CanvasAnnotationDisplay#pointContext), a Journey's own canvas target is
// one with an svgSelector (AnnotationsOverlay#isAnnotationAtPoint's own svgSelector branch).
type AnnotationResourceLike = { id: string; pointSelector?: unknown; svgSelector?: unknown };
type AnnotationListItem = { id?: string; resources?: AnnotationResourceLike[] };

interface AnnotationsOverlayTargetProps {
  annotations?: AnnotationListItem[];
  canvasWorld?: { offsetByCanvas?: (canvasId: string) => { x: number; y: number } };
  searchAnnotations?: AnnotationListItem[];
  selectAnnotation?: (windowId: string, annotationId: string) => void;
  selectedAnnotationId?: string | null;
  viewer?: (Parameters<typeof useSitePins>[0]['viewer'] & { element?: HTMLElement }) | null;
  windowId: string;
  [key: string]: unknown;
}

interface AnnotationsOverlayPoiClickWrapperProps {
  TargetComponent: ComponentType<Record<string, unknown>>;
  targetProps: AnnotationsOverlayTargetProps;
  addCompanionWindow: typeof addCompanionWindow;
  updateCompanionWindow: typeof updateCompanionWindow;
  annotationPages?: AnnotationPages;
  existingPreviewCompanionWindowId?: string;
  locale?: ContentLocale;
  previewShowsMapInfo?: boolean;
  site?: boolean;
}

// Wraps AnnotationsOverlay (the component that owns the OSD canvas-click handler and the
// select/deselect-annotation dispatch, see AnnotationsOverlay#toggleAnnotation) so that
// clicking a POI marker OR a Journey's own path on the canvas - not just a row in a list
// somewhere - opens this same preview companion window a "Preview" button would (issue #375's
// own follow-up: pins on the map itself; issue #378 extends this to journeys). Re-uses an
// already-open preview window instead of stacking a new one per click. A journey stop's pin
// opens its journey's preview with that stop selected (see getPreviewAnnotationId).
const AnnotationsOverlayPoiClickWrapper = ({
  TargetComponent,
  targetProps,
  addCompanionWindow: dispatchAddCompanionWindow,
  updateCompanionWindow: dispatchUpdateCompanionWindow,
  annotationPages,
  existingPreviewCompanionWindowId,
  locale = 'en',
  previewShowsMapInfo = false,
  site = false,
}: AnnotationsOverlayPoiClickWrapperProps) => {
  const { annotations = [], searchAnnotations = [], selectAnnotation } = targetProps;
  const previewPosition = usePreviewPosition();

  const selectAnnotationAndMaybePreview = (clickedWindowId: string, annotationId: string) => {
    selectAnnotation?.(clickedWindowId, annotationId);

    const resource = [...annotations, ...searchAnnotations]
      .flatMap((item) => item.resources ?? [])
      .find((item) => item.id === annotationId);

    // pointSelector => POI pin, svgSelector => a Journey's own canvas target (its path/stops
    // line) - anything else (e.g. a fragmentSelector) has no preview content, skip it.
    if (!resource?.pointSelector && !resource?.svgSelector) return;

    const items = annotationPagesItems(annotationPages);
    const annotation = items.find((item) => item.id === annotationId);
    const previewAnnotationId = annotation
      ? getPreviewAnnotationId(annotation, (id) => items.some((item) => item.id === id))
      : annotationId;
    openPreview(
      { addCompanionWindow: dispatchAddCompanionWindow, updateCompanionWindow: dispatchUpdateCompanionWindow },
      clickedWindowId,
      existingPreviewCompanionWindowId,
      previewAnnotationId,
      previewPosition
    );
  };

  // The site preset draws POIs as buttons over the map (sitePins.ts) rather than on the canvas,
  // and the journey line in the host page's style.
  const pinResources = site
    ? (annotations.flatMap((annotation) => annotation.resources ?? []).filter(
        (resource) => resource.pointSelector
      ) as unknown as PinResource[])
    : [];
  const labels = new Map(
    site
      ? annotationPagesItems(annotationPages).map((item) => [item.id, textBody(item, locale, 'identifying')])
      : []
  );
  useSitePins({
    canvasWorld: targetProps.canvasWorld,
    enabled: site,
    labels,
    onSelect: (annotationId) => selectAnnotationAndMaybePreview(targetProps.windowId, annotationId),
    resources: pinResources,
    selectedAnnotationId: targetProps.selectedAnnotationId,
    viewer: targetProps.viewer,
  });
  useMinimiseOnFirstInteraction(
    targetProps.viewer as Parameters<typeof useMinimiseOnFirstInteraction>[0],
    targetProps.windowId,
    site,
    previewShowsMapInfo
  );
  const lineStyleKey = site ? JSON.stringify(readLineStyle(targetProps.viewer?.element)) : 'null';
  const lineStyle = useMemo(() => JSON.parse(lineStyleKey), [lineStyleKey]);

  if (site) {
    const canvasAnnotations = annotations.map((annotation) => ({
      id: annotation.id,
      resources: (annotation.resources ?? []).filter((resource) => !resource.pointSelector),
    }));
    return (
      <TargetComponent
        {...targetProps}
        annotations={canvasAnnotations}
        lineStyle={lineStyle}
        selectAnnotation={selectAnnotationAndMaybePreview}
      />
    );
  }

  return <TargetComponent {...targetProps} selectAnnotation={selectAnnotationAndMaybePreview} />;
};

const poiPreviewClickPlugin = {
  target: 'AnnotationsOverlay',
  mode: 'wrap',
  component: AnnotationsOverlayPoiClickWrapper,
  mapStateToProps: (state: unknown, { windowId }: { windowId: string }) => ({
    // The raw pages rather than their flattened items, which would be a new array (and so a
    // re-render of the whole overlay) on every store update.
    annotationPages: getCanvasAnnotationPages(state, windowId),
    existingPreviewCompanionWindowId: getPreviewCompanionWindowId(state, windowId),
    previewShowsMapInfo:
      (getCompanionWindow(state, { companionWindowId: getPreviewCompanionWindowId(state, windowId) }) as
        | { annotationid?: string }
        | undefined)?.annotationid === MAP_INFO_ID,
    locale: getContentLocale((getConfig(state) as { language?: string }).language),
    site: (getConfig(state) as { maps?: { site?: boolean } }).maps?.site === true,
  }),
  mapDispatchToProps: { addCompanionWindow, updateCompanionWindow },
};

export const poiPreviewPlugins = [poiPreviewCompanionWindowPlugin, poiPreviewClickPlugin];
