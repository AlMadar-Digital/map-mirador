import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import DOMPurify from 'dompurify';
import Button from '@mui/material/Button';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import EditIcon from '@mui/icons-material/EditSharp';
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
  getCompanionWindowsForContent,
  getConfig,
  getManifest,
  getSelectedAnnotationId,
  getVisibleCanvases,
  removeCompanionWindow,
  selectAnnotation,
  updateCompanionWindow,
  updateViewport,
  // Relative, not `from 'dbf-mirador'`: this file lives inside the dbf-mirador package
  // itself (unlike its copy in the Strapi maps plugin, a real external consumer), and
  // there's no self-referencing node_modules link or dist build for the package name to
  // resolve against during local dev.
} from '../index';
import {
  consumeSkipNestedOpen,
  getLinkedMapManifestId,
  getNestedOrigin,
  openNestedMap,
  skipNextNestedOpen,
  useRestoreParentViewport,
  type LinkedMap,
  type NestedOrigin,
} from './nestedMapPlugin';
import { MAP_INFO_ID, NESTED_ORIGIN_ID, POI_PREVIEW_CONTENT_ID } from './previewIds';

export { MAP_INFO_ID, NESTED_ORIGIN_ID, POI_PREVIEW_CONTENT_ID };
import {
  consumeOpenMinimised,
  consumePanelFocus,
  isInsideMap,
  resetSheet,
  setPanelCollapsed,
  setSheetSnap,
  type SheetSnap,
  useMinimiseOnFirstInteraction,
  usePanelCollapsed,
  usePanelFocusRequest,
  useSheetSnap,
} from './sitePanelState';
import { useSheetGestures } from './sheetGestures';
import { isRowLayout, useScrollSelect } from './scrollSelect';
import { AudioPlayer, audioUrl } from './audioPlayer';
import { getTourPois } from './tourOrder';
import { useFillView } from './fillView';
import { requestPinFocus } from './sitePins';
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

// dbf-mirador-annotation-editor's own edit companion window (its annotationCreation plugin),
// opened by the Edit button below exactly the way that package's annotation list opens it.
const ANNOTATION_EDIT_CONTENT_ID = 'annotationCreation';

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
  // An upload's or a Media Item's playable file (the audio player's recording).
  url?: string | null;
  mime?: string | null;
  duration?: number | null;
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
  // The short line the site shows above a POI's title ("The Start"), per language.
  'dbf:eyebrowEn'?: string | null;
  'dbf:eyebrowAr'?: string | null;
  // Set by dbf-mirador-annotation-editor on the annotations it can edit.
  maeData?: unknown;
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
    contentLanguage: 'لغة المحتوى',
    edit: 'تعديل',
    noStops: 'لا توجد محطات في هذه الرحلة بعد.',
    notFound: 'تعذر العثور على هذا العنصر - ربما تم حذفه.',
    openMap: 'فتح الخريطة',
    closePanel: 'إغلاق اللوحة',
    collapse: 'إخفاء اللوحة',
    expand: 'إظهار اللوحة',
    expandSheet: 'توسيع اللوحة',
    shrinkSheet: 'تصغير اللوحة',
    discover: 'اكتشف الخريطة',
    followJourney: 'اتبع الرحلة',
    preview: 'معاينة',
    showOnMap: 'عرض على الخريطة',
    audio: 'تسجيل صوتي',
    audioForward: 'تقديم 10 ثوانٍ',
    audioMute: 'كتم الصوت',
    audioPause: 'إيقاف مؤقت',
    audioPlay: 'تشغيل',
    audioRepeat: 'تكرار',
    audioRestart: 'العودة إلى البداية',
    audioRewind: 'رجوع 10 ثوانٍ',
    audioSeek: 'موضع التشغيل',
    audioSpeed: 'سرعة التشغيل',
  },
  en: {
    Journey: 'Journey',
    POI: 'POI',
    contentLanguage: 'Content language',
    edit: 'Edit',
    noStops: 'This journey has no stops yet.',
    notFound: 'This annotation could not be found - it may have been deleted.',
    openMap: 'Open map',
    closePanel: 'Close panel',
    collapse: 'Hide panel',
    expand: 'Show panel',
    expandSheet: 'Expand panel',
    shrinkSheet: 'Shrink panel',
    discover: 'Discover the map',
    followJourney: 'Follow the journey',
    preview: 'Preview',
    showOnMap: 'Show on map',
    audio: 'Audio',
    audioForward: 'Forward 10 seconds',
    audioMute: 'Mute',
    audioPause: 'Pause',
    audioPlay: 'Play',
    audioRepeat: 'Repeat',
    audioRestart: 'Back to the start',
    audioRewind: 'Back 10 seconds',
    audioSeek: 'Playback position',
    audioSpeed: 'Playback speed',
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

export const textBody = (
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

// A POI's eyebrow in the content locale, as plain text ('' when it has none).
export const eyebrowFor = (annotation: RawAnnotation, locale: ContentLocale): string =>
  ((locale === 'en' ? annotation['dbf:eyebrowEn'] : annotation['dbf:eyebrowAr']) ?? '').trim();

const IMAGE_FILE = /\.(avif|gif|jpe?g|png|svg|webp)$/i;

// The image to show for a POI's media, if it has one. A Media Library upload's
// `thumbnailUrl` is the uploaded file itself, which may be audio, video or a PDF - only an
// image file is shown as one. IIIF Images and Media Items always carry an image thumbnail.
// A site card's media (`.dbf-map-poi__media`): the audio player for a recording, else its image.
// A recording is titled with its Media Item's title (English only on the wire), else the POI's.
const SiteMedia = ({ locale, media, poiTitle }: { locale: ContentLocale; media?: DbfMedia | null; poiTitle: string }) => {
  const labels = LABELS[locale];
  const src = audioUrl(media);
  if (media && src) {
    const title = (media.source === 'media-item' && locale === 'en' && media.title) || poiTitle || labels.audio;
    return (
      // Keyed by its file: a panel that moves on to another POI starts a fresh player, rather
      // than keeping the last one's recording, position and length.
      <Fragment key={src}>
        <AudioPlayer
          duration={media.duration}
          labels={{
            audio: labels.audio,
            forward: labels.audioForward,
            mute: labels.audioMute,
            pause: labels.audioPause,
            play: labels.audioPlay,
            repeat: labels.audioRepeat,
            restart: labels.audioRestart,
            rewind: labels.audioRewind,
            seek: labels.audioSeek,
            speed: labels.audioSpeed,
          }}
          mime={media.mime}
          src={src}
          title={title}
        />
      </Fragment>
    );
  }
  const image = mediaImageUrl(media);
  if (!image) return null;
  return (
    <div className="dbf-map-poi__media">
      <img alt={media?.title ?? ''} src={image} />
    </div>
  );
};

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

type RunningAnimation = { animationName?: string; finished: Promise<unknown>; playState: string; transitionProperty?: string };

const runningAnimations = (element: Element): RunningAnimation[] =>
  ((element as Element & { getAnimations?: (options?: { subtree: boolean }) => RunningAnimation[] }).getAnimations?.({
    subtree: true,
  }) ?? []).filter(
    (animation) => animation.playState === 'running'
  );

const overlaysOf = (viewer: OsdViewer): HTMLElement[] =>
  Array.from(viewer.element?.closest('.mirador-window')?.querySelectorAll<HTMLElement>(OVERLAY_COMPANION_WINDOW_SELECTOR) ?? []);

// Where an overlay will sit once it has slid in (T-07): mid-slide its on-screen rect is still
// partly off the map, so a panel that is opening would count as not covering anything. The
// slide-in (a CSS animation ending at no transform) is left out by taking the layout box, which
// transforms don't move. A static transform (a host's collapsed panel) still counts.
const settledRect = (overlay: HTMLElement): { bottom: number; left: number; right: number; top: number } => {
  const sliding = runningAnimations(overlay).some((animation) => 'animationName' in animation);
  const parent = overlay.offsetParent as HTMLElement | null;
  if (!sliding || !parent) return overlay.getBoundingClientRect();
  const origin = parent.getBoundingClientRect();
  const left = origin.left + parent.clientLeft + overlay.offsetLeft;
  const top = origin.top + parent.clientTop + overlay.offsetTop;
  return { bottom: top + overlay.offsetHeight, left, right: left + overlay.offsetWidth, top };
};

// Runs `move` once overlays moving by a CSS transition (a host collapsing or reopening its
// panel) have settled, so the visible area is measured where they end up (T-07).
const afterOverlayTransitions = (viewer: OsdViewer, move: () => void) => {
  const transitions = overlaysOf(viewer)
    .flatMap(runningAnimations)
    .filter((animation) => 'transitionProperty' in animation);
  if (transitions.length === 0) {
    move();
    return;
  }
  Promise.all(transitions.map((transition) => transition.finished.catch(() => undefined))).then(move);
};

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
  windowElement.querySelectorAll<HTMLElement>(OVERLAY_COMPANION_WINDOW_SELECTOR).forEach((overlay) => {
    const rect = settledRect(overlay);
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
const focusMapOnPointNow = (windowId: string, point: Point) => {
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
const ensurePointVisibleNow = (windowId: string, point: Point) => {
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
const fitMapToPointsNow = (windowId: string, points: Point[]) => {
  if (points.length === 0) return;
  if (points.length === 1) {
    focusMapOnPointNow(windowId, points[0]);
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

// The three run once a panel moving by a CSS transition has settled (T-07).
const whenOverlaysSettle =
  <Args extends unknown[]>(move: (windowId: string, ...args: Args) => void) =>
  (windowId: string, ...args: Args) => {
    const viewer = getOsdViewer(windowId);
    if (!viewer) return;
    afterOverlayTransitions(viewer, () => move(windowId, ...args));
  };

export const focusMapOnPoint = whenOverlaysSettle(focusMapOnPointNow);
export const ensurePointVisible = whenOverlaysSettle(ensurePointVisibleNow);
export const fitMapToPoints = whenOverlaysSettle(fitMapToPointsNow);

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

// Scrolls a side-by-side list (the phone carousel) so a card starts where the cards snap, and
// the panel back to its top so the card's heading shows.
const scrollCardIntoRow = (list: HTMLElement, card: HTMLElement, behavior: ScrollBehavior) => {
  const listRect = list.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const style = getComputedStyle(list);
  const delta =
    style.direction === 'rtl'
      ? cardRect.right - (listRect.right - (parseFloat(style.paddingRight) || 0))
      : cardRect.left - (listRect.left + (parseFloat(style.paddingLeft) || 0));
  if (Math.abs(delta) > 1) list.scrollBy?.({ behavior, left: delta });
  getScrollContainer(list)?.scrollTo?.({ behavior, top: 0 });
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
  // The POI whose pin takes focus back when the panel closes.
  returnFocusTo?: string | null;
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
  returnFocusTo = null,
  showing,
  windowId,
}: SitePanelProps) => {
  const labels = LABELS[locale];
  const collapsed = usePanelCollapsed(windowId);
  const snap = useSheetSnap(windowId);
  const isSheet = position === 'bottom';
  // A panel opening on something new shows it - unless it was asked to open minimised.
  useEffect(() => {
    setPanelCollapsed(windowId, consumeOpenMinimised(windowId));
  }, [showing, windowId]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  useSheetGestures({ bodyRef, enabled: isSheet, headerRef, isRtl: locale === 'ar', windowId });

  // Opened from the keyboard: focus moves to what the panel is about - the selected stop's
  // title, else the card's title, else the panel's label (T-37).
  const focusRequest = usePanelFocusRequest(windowId);
  useEffect(() => {
    if (!consumePanelFocus(windowId)) return undefined;
    const frame = requestAnimationFrame(() => {
      const body = bodyRef.current;
      const target =
        body?.querySelector<HTMLElement>('.dbf-map-poi[data-selected] .dbf-map-poi__select') ??
        body?.querySelector<HTMLElement>('.dbf-map-poi__title') ??
        body?.querySelector<HTMLElement>('.dbf-map-panel__label');
      if (!target) return;
      if (!target.matches('button')) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, showing, windowId]);

  const close = () => {
    resetSheet(windowId);
    dispatchRemoveCompanionWindow(windowId, id);
    // Focus goes back to the POI's pin, or to the tab that reopens the panel.
    if (returnFocusTo) {
      requestPinFocus(windowId, returnFocusTo);
    } else {
      const mapWindow = bodyRef.current?.closest('.mirador-window');
      requestAnimationFrame(() => mapWindow?.querySelector<HTMLElement>('.dbf-map-panel__toggle')?.focus());
    }
  };
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // Escape pressed in the map closes the open panel before it would close the whole view (the
  // host listens in the bubble phase). Inside a nested map, Escape is Back's first.
  useEffect(() => {
    if (collapsed) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !isInsideMap(event, bodyRef.current)) return;
      const mapWindow = bodyRef.current?.closest('.mirador-window');
      if (!mapWindow || mapWindow.querySelector('.dbf-map__back')) return;
      event.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [collapsed]);

  // The sheet's handle steps through its heights; arrow keys move up and down them.
  const nextSnap: Record<SheetSnap, SheetSnap> = { collapsed: 'half', full: 'half', half: 'full' };
  const handleLabel = { collapsed: labels.expand, full: labels.shrinkSheet, half: labels.expandSheet }[snap];
  const onHandleKeyDown = (event: ReactKeyboardEvent) => {
    const order: SheetSnap[] = ['collapsed', 'half', 'full'];
    const step = { ArrowDown: -1, ArrowUp: 1 }[event.key as 'ArrowDown' | 'ArrowUp'];
    if (!step) return;
    event.preventDefault();
    setSheetSnap(windowId, order[Math.min(order.length - 1, Math.max(0, order.indexOf(snap) + step))]);
  };

  return (
    <CompanionWindow header={false} id={id} resizable={false} title={label} windowId={windowId}>
      <div
        className="dbf-map-panel__body"
        data-collapsed={collapsed ? 'true' : undefined}
        data-position={position}
        data-snap={isSheet ? snap : undefined}
        dir={localeDir(locale)}
        lang={locale}
        ref={bodyRef}
      >
        <div className="dbf-map-panel__header" ref={headerRef}>
          {isSheet && (
            <button
              aria-expanded={snap !== 'collapsed'}
              aria-label={handleLabel}
              className="dbf-map-panel__handle"
              onClick={() => setSheetSnap(windowId, nextSnap[snap])}
              onKeyDown={onHandleKeyDown}
              type="button"
            />
          )}
          <h2 className="dbf-map-panel__label">{label}</h2>
          <button aria-label={labels.closePanel} className="dbf-map-panel__close" onClick={close} type="button" />
        </div>
        {children}
      </div>
    </CompanionWindow>
  );
};

// Each content locale, named in its own language so it reads the same whatever the UI's.
const LOCALE_NAMES: Record<ContentLocale, string> = { ar: 'العربية', en: 'English' };

interface EditorToolbarProps {
  canEdit: boolean;
  contentLocale: ContentLocale;
  isEditing: boolean;
  onContentLocaleChange: (locale: ContentLocale) => void;
  onEdit: () => void;
  uiLocale: ContentLocale;
}

// Issue #457: in the editor, the preview gets a toggle between the English and Arabic content
// (both are authored there, unlike the public map which only ever shows its own language) and
// an Edit button standing in for the annotation list's own.
const EditorToolbar = ({
  canEdit,
  contentLocale,
  isEditing,
  onContentLocaleChange,
  onEdit,
  uiLocale,
}: EditorToolbarProps) => {
  const labels = LABELS[uiLocale];
  return (
    <div
      dir={localeDir(uiLocale)}
      style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 8, padding: '16px 16px 0' }}
    >
      <ToggleButtonGroup
        aria-label={labels.contentLanguage}
        exclusive
        onChange={(_event, value: ContentLocale | null) => {
          // Clicking the active button would otherwise unselect both.
          if (value) onContentLocaleChange(value);
        }}
        size="small"
        value={contentLocale}
      >
        {(['en', 'ar'] as const).map((locale) => (
          <ToggleButton key={locale} lang={locale} sx={{ textTransform: 'none' }} value={locale}>
            {LOCALE_NAMES[locale]}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      {canEdit && (
        <Button
          // Like the annotation list's own Edit button: one edit window at a time.
          disabled={isEditing}
          onClick={onEdit}
          size="small"
          startIcon={<EditIcon />}
          sx={{ marginInlineStart: 'auto' }}
          variant="outlined"
        >
          {labels.edit}
        </Button>
      )}
    </div>
  );
};

interface JourneyPreviewContentProps {
  editorToolbar: ReactNode;
  id: string;
  journey: RawAnnotation;
  site?: boolean;
  locale: ContentLocale;
  pois: RawAnnotation[];
  openNestedMap?: OpenNestedMap;
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  selectAnnotation: typeof selectAnnotation;
  selectedAnnotationId?: string;
  selectedStopLinkedMapManifestId?: string | null;
  windowId: string;
}

const JourneyPreviewContent = ({
  editorToolbar,
  id,
  journey,
  locale,
  pois,
  openNestedMap: dispatchOpenNestedMap,
  position,
  removeCompanionWindow: dispatchRemoveCompanionWindow,
  selectAnnotation: dispatchSelectAnnotation,
  selectedAnnotationId,
  selectedStopLinkedMapManifestId = null,
  site = false,
  windowId,
}: JourneyPreviewContentProps) => {
  const labels = LABELS[locale];
  const journeyTitle = textBody(journey, locale, 'identifying');

  const stopsRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  // The stop the visitor last scrolled to: the panel leaves its scroll alone for it.
  const scrolledToRef = useRef<string | null>(null);
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
    const scrolledTo = scrolledToRef.current === selectedStop?.id;
    scrolledToRef.current = null;
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
    // On a phone the cards sit side by side: the carousel moves to the card (unless the visitor
    // swiped it there) and the sheet back to its heading.
    if (site && isRowLayout(stops)) {
      if (scrolledTo) getScrollContainer(stops)?.scrollTo?.({ behavior: 'smooth', top: 0 });
      else scrollCardIntoRow(stops, card, 'smooth');
      return undefined;
    }
    // A card the visitor scrolled up to stays where they left it.
    if (scrolledTo) return undefined;
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

  // Site preset: a stop with a nested map opens it when the stop is focused (T-11).
  useEffect(() => {
    if (!site || !selectedStop || !selectedStopLinkedMapManifestId || !dispatchOpenNestedMap) return;
    if (consumeSkipNestedOpen(windowId, selectedStop.id)) return;
    dispatchOpenNestedMap(windowId, selectedStopLinkedMapManifestId, {
      annotation: selectedStop,
      position,
      previewAnnotationId: journey.id,
      selectedAnnotationId: selectedStop.id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per selected stop and nested map
  }, [selectedStop?.id, selectedStopLinkedMapManifestId, site, windowId]);

  const focusPoi = (poi: RawAnnotation) => {
    const point = getPoiPoint(poi);
    if (point) focusMapOnPoint(windowId, point);
    // Selecting it also highlights the pin on the map, like clicking the pin itself would.
    dispatchSelectAnnotation(windowId, poi.id);
    // A stop already selected - scrolled to, or come back to with Back - opens its nested map
    // when it's clicked.
    if (site && poi.id === selectedAnnotationId && selectedStopLinkedMapManifestId && dispatchOpenNestedMap) {
      dispatchOpenNestedMap(windowId, selectedStopLinkedMapManifestId, {
        annotation: poi,
        position,
        previewAnnotationId: journey.id,
        selectedAnnotationId: poi.id,
      });
    }
  };

  // Site preset: scrolling the list (swiping the carousel on a phone) selects the stop it comes
  // to, and focuses the map on it like stepping the tour does. Browsing doesn't open a nested map.
  useScrollSelect({
    enabled: site,
    getColumnScroller: getScrollContainer,
    layout: position,
    listRef: stopsRef,
    onSelect: (poiId) => {
      const poi = pois.find((item) => item.id === poiId);
      if (!poi) return;
      scrolledToRef.current = poiId;
      if (poi['dbf:linkedMap']) skipNextNestedOpen(windowId, poiId);
      const point = getPoiPoint(poi);
      if (point) focusMapOnPoint(windowId, point);
      dispatchSelectAnnotation(windowId, poi.id);
    },
    selectedId: selectedAnnotationId,
  });

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
        returnFocusTo={selectedAnnotationId}
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
                    {(eyebrowFor(poi, locale) || journeyTitle) && (
                      <p className="dbf-map-poi__eyebrow">{eyebrowFor(poi, locale) || journeyTitle}</p>
                    )}
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
                <SiteMedia locale={locale} media={media} poiTitle={poiTitle} />
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
      {editorToolbar}
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

type OpenNestedMap = (windowId: string, manifestId: string, origin?: Omit<NestedOrigin, 'viewer'>) => void;

interface PoiPreviewContentProps {
  annotation: RawAnnotation | null;
  // The POI a nested map was opened from (site preset): shown, but no longer on this map.
  carried?: boolean;
  editorToolbar: ReactNode;
  // Still waiting for the map's annotations: show nothing rather than "not found".
  loading?: boolean;
  site?: boolean;
  id: string;
  linkedMapManifestId: string | null;
  locale: ContentLocale;
  openNestedMap: OpenNestedMap;
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  windowId: string;
}

const PoiPreviewContent = ({
  annotation,
  carried = false,
  editorToolbar,
  id,
  linkedMapManifestId,
  loading = false,
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

  // The preview panel floats over the map, so the pin it describes may now be behind it. A
  // carried POI's point is on the parent map, not this one.
  const point = annotation && !carried ? getPoiPoint(annotation) : null;
  useEffect(() => {
    if (point) ensurePointVisible(windowId, point);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the pin's position, `point` is a fresh object each render
  }, [annotation?.id, point?.x, point?.y, windowId]);

  // Site preset: a POI with a nested map opens it as soon as it is focused (TL-12); the panel
  // keeps showing the POI. Back restores this selection without reopening it.
  useEffect(() => {
    if (!site || carried || !annotation || !linkedMapManifestId) return;
    if (consumeSkipNestedOpen(windowId, annotation.id)) return;
    dispatchOpenNestedMap(windowId, linkedMapManifestId, {
      annotation,
      position,
      previewAnnotationId: annotation.id,
      selectedAnnotationId: annotation.id,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per POI and nested map
  }, [annotation?.id, carried, linkedMapManifestId, site, windowId]);

  if (site) {
    return (
      <SitePanel
        id={id}
        label={labels.discover}
        locale={locale}
        position={position}
        removeCompanionWindow={dispatchRemoveCompanionWindow}
        returnFocusTo={carried ? null : annotation?.id}
        showing={annotation?.id ?? ''}
        windowId={windowId}
      >
        {!annotation && !loading && <p className="dbf-map-error">{labels.notFound}</p>}
        {annotation && (
          <article className="dbf-map-poi" data-selected="true" data-variant="single">
            <div className="dbf-map-poi__header">
              <span aria-hidden className="dbf-map-poi__marker" />
              <div className="dbf-map-poi__heading">
                {eyebrowFor(annotation, locale) && (
                  <p className="dbf-map-poi__eyebrow">{eyebrowFor(annotation, locale)}</p>
                )}
                <h3 className="dbf-map-poi__title">{title || labels.POI}</h3>
              </div>
            </div>
            <SiteMedia locale={locale} media={media} poiTitle={title} />
            {description && (
              // eslint-disable-next-line react/no-danger -- sanitised above
              <div className="dbf-map-poi__text" dangerouslySetInnerHTML={{ __html: description }} />
            )}
          </article>
        )}
      </SitePanel>
    );
  }

  return (
    <CompanionWindow id={id} title={title || (kind && labels[kind]) || labels.preview} windowId={windowId}>
      {editorToolbar}
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
  addCompanionWindow?: typeof addCompanionWindow;
  annotation: RawAnnotation | null;
  canEdit?: boolean;
  carried?: boolean;
  hasAnnotationEditor?: boolean;
  loading?: boolean;
  selectedStopLinkedMapManifestId?: string | null;
  id: string;
  isEditing?: boolean;
  journeyPois: RawAnnotation[];
  linkedMapManifestId: string | null;
  locale: ContentLocale;
  mapInfo?: MapInfo | null;
  openNestedMap: OpenNestedMap;
  position: PanelPosition;
  removeCompanionWindow: typeof removeCompanionWindow;
  selectAnnotation: typeof selectAnnotation;
  selectedAnnotationId?: string;
  site?: boolean;
  windowId: string;
}

const PreviewContent = ({
  addCompanionWindow: dispatchAddCompanionWindow,
  annotation,
  canEdit = false,
  carried = false,
  hasAnnotationEditor = false,
  loading = false,
  selectedStopLinkedMapManifestId = null,
  id,
  isEditing = false,
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
  // Starts in the UI's language; kept while the same preview window moves to another annotation.
  const [contentLocale, setContentLocale] = useState<ContentLocale>(locale);
  // Without the annotation editor (the public map), the preview always speaks the UI's language.
  const shownLocale = hasAnnotationEditor ? contentLocale : locale;

  const editorToolbar = hasAnnotationEditor && (
    <EditorToolbar
      canEdit={canEdit && !!annotation}
      contentLocale={contentLocale}
      isEditing={isEditing}
      onContentLocaleChange={setContentLocale}
      onEdit={() =>
        annotation &&
        dispatchAddCompanionWindow?.(windowId, {
          annotationid: annotation.id,
          content: ANNOTATION_EDIT_CONTENT_ID,
          position: 'right',
        })
      }
      uiLocale={locale}
    />
  );

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
        editorToolbar={editorToolbar}
        id={id}
        journey={annotation}
        locale={shownLocale}
        openNestedMap={dispatchOpenNestedMap}
        pois={journeyPois}
        position={position}
        removeCompanionWindow={dispatchRemoveCompanionWindow}
        selectAnnotation={dispatchSelectAnnotation}
        selectedAnnotationId={selectedAnnotationId}
        selectedStopLinkedMapManifestId={selectedStopLinkedMapManifestId}
        site={site}
        windowId={windowId}
      />
    );
  }
  return (
    <PoiPreviewContent
      annotation={annotation}
      carried={carried}
      editorToolbar={editorToolbar}
      id={id}
      linkedMapManifestId={linkedMapManifestId}
      loading={loading}
      locale={shownLocale}
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
    const carried = annotationId === NESTED_ORIGIN_ID;
    const annotation = carried
      ? ((getNestedOrigin(state, windowId)?.annotation as RawAnnotation | undefined) ?? null)
      : (items.find((item) => item.id === annotationId) ?? null);
    const config = getConfig(state) as {
      annotation?: { adapter?: unknown; readonly?: boolean };
      language?: string;
      maps?: { site?: boolean };
    };
    const locale = getContentLocale(config.language);
    // dbf-mirador-annotation-editor is registered (as in the Strapi editor) when Mirador is
    // configured with its storage adapter.
    const hasAnnotationEditor = !!config.annotation?.adapter;
    const journeyPois =
      annotation && annotation['dbf:kind'] === 'Journey' ? getOrderedJourneyPois(items, annotation.id) : [];
    const selectedAnnotationId = getSelectedAnnotationId(state, { windowId }) as string | undefined;
    const selectedStop = journeyPois.find((poi) => poi.id === selectedAnnotationId);
    return {
      annotation,
      // Mirrors the annotation list's own Edit button: shown for the annotations the editor can
      // edit, unless it's read-only, and disabled while an edit window is already open.
      canEdit: hasAnnotationEditor && config.annotation?.readonly !== true && !!annotation?.maeData,
      carried,
      hasAnnotationEditor,
      isEditing:
        (getCompanionWindowsForContent(state, { content: ANNOTATION_EDIT_CONTENT_ID, windowId }) as unknown[])
          .length > 0,
      journeyPois,
      // Only a Nested Map point whose map the host can resolve opens it (an "Open map" button
      // in the editor; on focus in the site preset). A carried POI's nested map is the one open.
      linkedMapManifestId: carried ? null : getLinkedMapManifestId(state, annotation?.['dbf:linkedMap']),
      loading: !carried && annotationId !== MAP_INFO_ID && items.length === 0,
      selectedStopLinkedMapManifestId: getLinkedMapManifestId(state, selectedStop?.['dbf:linkedMap']),
      locale,
      mapInfo: annotationId === MAP_INFO_ID ? getMapInfo(state, windowId, locale) : null,
      position: companionWindow?.position === 'bottom' ? 'bottom' : 'right',
      selectedAnnotationId,
      // MapViewer's site preset renders the site's markup; the annotation editor never sets it.
      site: config.maps?.site === true,
    };
  },
  mapDispatchToProps: { addCompanionWindow, openNestedMap, removeCompanionWindow, selectAnnotation },
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
  canvasWorld?: { canvases?: { id: string }[]; offsetByCanvas?: (canvasId: string) => { x: number; y: number } };
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
  linkedMapResolver?: ((linkedMap: LinkedMap) => string | null | undefined) | null;
  locale?: ContentLocale;
  openNestedMap?: OpenNestedMap;
  previewShowsMapInfo?: boolean;
  site?: boolean;
  updateViewport?: (windowId: string, viewport: Record<string, unknown>) => void;
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
  linkedMapResolver = null,
  locale = 'en',
  openNestedMap: dispatchOpenNestedMap,
  previewShowsMapInfo = false,
  site = false,
  updateViewport: dispatchUpdateViewport,
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
  const tourOrder = site ? getTourPois(annotationPagesItems(annotationPages)).map((poi) => poi.id) : [];
  useSitePins({
    canvasWorld: targetProps.canvasWorld,
    enabled: site,
    labels,
    locale,
    order: tourOrder,
    onSelect: (annotationId, { browsing } = {}) => {
      // Arrowing along the pins only browses: a POI with a nested map doesn't open it.
      if (browsing) {
        const browsed = annotationPagesItems(annotationPages).find((candidate) => candidate.id === annotationId);
        if (browsed?.['dbf:linkedMap']) skipNextNestedOpen(targetProps.windowId, annotationId);
        selectAnnotationAndMaybePreview(targetProps.windowId, annotationId);
        return;
      }
      // Pressing a pin shows its panel, even one that's selected already but slid away.
      setPanelCollapsed(targetProps.windowId, false);
      // Pressing the selected pin of a POI with a nested map opens it again (after Back).
      const item = annotationId === targetProps.selectedAnnotationId
        ? annotationPagesItems(annotationPages).find((candidate) => candidate.id === annotationId)
        : undefined;
      const linkedMap = item?.['dbf:linkedMap'];
      const manifestId = linkedMap ? linkedMap.manifestId || linkedMapResolver?.(linkedMap) : null;
      if (item && manifestId && dispatchOpenNestedMap) {
        const items = annotationPagesItems(annotationPages);
        dispatchOpenNestedMap(targetProps.windowId, manifestId, {
          annotation: item,
          position: previewPosition,
          previewAnnotationId: getPreviewAnnotationId(item, (id) => items.some((candidate) => candidate.id === id)),
          selectedAnnotationId: item.id,
        });
        return;
      }
      selectAnnotationAndMaybePreview(targetProps.windowId, annotationId);
    },
    resources: pinResources,
    selectedAnnotationId: targetProps.selectedAnnotationId,
    viewer: targetProps.viewer,
    windowId: targetProps.windowId,
  });
  useMinimiseOnFirstInteraction(
    targetProps.viewer as Parameters<typeof useMinimiseOnFirstInteraction>[0],
    targetProps.windowId,
    site,
    previewShowsMapInfo
  );
  useRestoreParentViewport(
    site ? (targetProps.viewer as Parameters<typeof useRestoreParentViewport>[0]) : null,
    targetProps.windowId,
    dispatchUpdateViewport
  );
  // Fill the view with the map, keeping every POI in it.
  // Only POIs on a canvas the viewer shows: while another map loads (a nested map, Back), the
  // annotations can arrive before their canvas, which has no position yet.
  const shownCanvases = targetProps.canvasWorld?.canvases;
  const fillPoints = pinResources
    .filter(({ targetId }) => !shownCanvases || shownCanvases.some((canvas) => canvas.id === targetId))
    .map(({ pointSelector, targetId }) => {
      const offset = targetProps.canvasWorld?.offsetByCanvas?.(targetId) ?? { x: 0, y: 0 };
      return { x: pointSelector.x + offset.x, y: pointSelector.y + offset.y };
    });
  useFillView({
    enabled: site,
    points: fillPoints,
    storeViewport: dispatchUpdateViewport,
    viewer: targetProps.viewer as Parameters<typeof useFillView>[0]['viewer'],
    windowId: targetProps.windowId,
  });
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
    linkedMapResolver:
      (getConfig(state) as { maps?: { getLinkedMapManifestId?: (linkedMap: LinkedMap) => string | null } }).maps
        ?.getLinkedMapManifestId ?? null,
    previewShowsMapInfo:
      (getCompanionWindow(state, { companionWindowId: getPreviewCompanionWindowId(state, windowId) }) as
        | { annotationid?: string }
        | undefined)?.annotationid === MAP_INFO_ID,
    locale: getContentLocale((getConfig(state) as { language?: string }).language),
    site: (getConfig(state) as { maps?: { site?: boolean } }).maps?.site === true,
  }),
  mapDispatchToProps: { addCompanionWindow, openNestedMap, updateCompanionWindow, updateViewport },
};

export const poiPreviewPlugins = [poiPreviewCompanionWindowPlugin, poiPreviewClickPlugin];
