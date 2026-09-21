import { useState, type ComponentType } from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import {
  ConnectedCompanionWindow as CompanionWindow,
  addCompanionWindow,
  getAnnotations,
  getCompanionWindow,
  getCompanionWindows,
  getVisibleCanvases,
  updateCompanionWindow,
  // Relative, not `from 'dbf-mirador'`: this file lives inside the dbf-mirador package
  // itself (unlike its copy in the Strapi maps plugin, a real external consumer), and
  // there's no self-referencing node_modules link or dist build for the package name to
  // resolve against during local dev.
} from '../index';

// A "dumb" way to preview a POI/journey (issue #375): a Mirador companion window plugin,
// registered alongside dbf-mirador-annotation-editor's own (see MiradorMaeViewer.tsx) via
// Mirador's `companionWindowKey` mechanism - no core patch needed, just adding this plugin
// to the same `plugins` array. The actual "Preview" button lives per-row in
// dbf-mirador-annotation-editor's own CanvasListItem.jsx, right next to Edit/Delete
// (see that package's own PR for issue #375) - it opens this companion window passing the
// specific row's id as `annotationid`, the same convention MAE's own 'annotationCreation'
// companion window already uses for its own Edit button.
//
// Journeys (issue #378) get a richer path here: instead of the "dumb" dual-locale dump
// below, a Journey renders its ordered stops as numbered cards with a single active
// locale (toggle EN/AR), closer to how the public site will eventually present it. Two
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
  body?: TextualAnnotationBody[];
};

// Both locales, side by side - see the module comment above: the point of a "dumb" preview
// is to see everything a poi/journey holds, not to render it the way the public site
// eventually will for one active language.
const LOCALES = ['en', 'ar'] as const;

const textBody = (
  annotation: RawAnnotation,
  language: string,
  purpose: 'identifying' | 'describing'
): string =>
  annotation.body?.find(
    (item): item is TextualAnnotationBody =>
      item.type === 'TextualBody' && item.purpose === purpose && item.language === language
  )?.value ?? '';

const mediaForLocale = (annotation: RawAnnotation, locale: (typeof LOCALES)[number]): DbfMedia | null | undefined =>
  locale === 'en' ? annotation['dbf:mediaEn'] : annotation['dbf:mediaAr'];

// A journey's ordered stops, derived the same way the rest of the codebase does: every
// POI whose `dbf:journey.id` points at this journey, sorted by `dbf:journey.order`.
export const getOrderedJourneyPois = (items: RawAnnotation[], journeyId: string): RawAnnotation[] =>
  items
    .filter(
      (item): item is RawAnnotation & { 'dbf:journey': { id: string; order: number } } =>
        item['dbf:kind'] === 'POI' && item['dbf:journey']?.id === journeyId
    )
    .sort((a, b) => a['dbf:journey'].order - b['dbf:journey'].order);

const JOURNEY_PREVIEW_LOCALES = ['en', 'ar'] as const;
type JourneyPreviewLocale = (typeof JOURNEY_PREVIEW_LOCALES)[number];

// Arabic is the only RTL locale this project handles today (mirrors the same check in
// mirador-annotation-editor's POITemplate.jsx/JourneyTemplate.jsx).
const isRtlLocale = (locale: string) => locale.toLowerCase().startsWith('ar');

interface JourneyPreviewContentProps {
  id: string;
  journey: RawAnnotation;
  pois: RawAnnotation[];
  windowId: string;
}

const JourneyPreviewContent = ({ id, journey, pois, windowId }: JourneyPreviewContentProps) => {
  const [locale, setLocale] = useState<JourneyPreviewLocale>('en');
  const journeyTitle = textBody(journey, locale, 'identifying');

  return (
    <CompanionWindow id={id} title={journeyTitle || 'Journey'} windowId={windowId}>
      <div dir={isRtlLocale(locale) ? 'rtl' : 'ltr'} style={{ padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 16 }}>
          {JOURNEY_PREVIEW_LOCALES.map((code) => (
            <button
              aria-pressed={locale === code}
              key={code}
              onClick={() => setLocale(code)}
              style={{
                background: locale === code ? '#333' : 'transparent',
                border: '1px solid #333',
                borderRadius: 4,
                color: locale === code ? '#fff' : '#333',
                cursor: 'pointer',
                padding: '4px 12px',
              }}
              type="button"
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        {pois.length === 0 && <p>This journey has no stops yet.</p>}
        {pois.map((poi, index) => {
          const poiTitle = textBody(poi, locale, 'identifying');
          const description = textBody(poi, locale, 'describing');
          const media = mediaForLocale(poi, locale);
          const isLast = index === pois.length - 1;
          return (
            <div key={poi.id} style={{ display: 'flex' }}>
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
                {media?.thumbnailUrl && (
                  <img
                    alt={media.title ?? ''}
                    src={media.thumbnailUrl}
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
      </div>
    </CompanionWindow>
  );
};

interface PoiPreviewContentProps {
  annotation: RawAnnotation | null;
  id: string;
  windowId: string;
}

const PoiPreviewContent = ({ annotation, id, windowId }: PoiPreviewContentProps) => (
  <CompanionWindow id={id} title={annotation?.['dbf:kind'] ?? 'Preview'} windowId={windowId}>
    <div style={{ padding: 16 }}>
      {!annotation && <p>This annotation could not be found - it may have been deleted.</p>}
      {annotation &&
        LOCALES.map((locale) => {
          const title = textBody(annotation, locale, 'identifying');
          const description = textBody(annotation, locale, 'describing');
          const media = mediaForLocale(annotation, locale);
          return (
            <section key={locale} style={{ marginBottom: 24 }}>
              <h3 style={{ textTransform: 'uppercase' }}>{locale}</h3>
              <p>
                <strong>{title || '—'}</strong>
              </p>
              {description && (
                // eslint-disable-next-line react/no-danger -- descriptionEn/Ar is CKEditor HTML, the same content the public site will eventually render
                <div dangerouslySetInnerHTML={{ __html: description }} />
              )}
              {media &&
                (media.thumbnailUrl ? (
                  <img alt={media.title ?? ''} src={media.thumbnailUrl} style={{ maxWidth: '100%' }} />
                ) : (
                  <p>
                    {media.title}
                    {media.mediaType ? ` (${media.mediaType})` : ''}
                  </p>
                ))}
            </section>
          );
        })}
    </div>
  </CompanionWindow>
);

interface PreviewContentProps {
  annotation: RawAnnotation | null;
  id: string;
  journeyPois: RawAnnotation[];
  windowId: string;
}

const PreviewContent = ({ annotation, id, journeyPois, windowId }: PreviewContentProps) => {
  if (annotation && annotation['dbf:kind'] === 'Journey') {
    return <JourneyPreviewContent id={id} journey={annotation} pois={journeyPois} windowId={windowId} />;
  }
  return <PoiPreviewContent annotation={annotation} id={id} windowId={windowId} />;
};

const poiPreviewCompanionWindowPlugin = {
  component: PreviewContent,
  companionWindowKey: POI_PREVIEW_CONTENT_ID,
  mapStateToProps: (state: unknown, { id, windowId }: { id: string; windowId: string }) => {
    const annotationId = getCompanionWindow(state, { companionWindowId: id })?.annotationid as
      | string
      | undefined;
    const canvasId = getVisibleCanvases(state, { windowId })[0]?.id;
    const pages: Record<string, { json?: { items?: unknown[] } }> | undefined = canvasId
      ? getAnnotations(state)[canvasId]
      : undefined;
    const items = (pages ? Object.values(pages) : []).flatMap(
      (page) => (page.json?.items ?? []) as RawAnnotation[]
    );
    const annotation = items.find((item) => item.id === annotationId) ?? null;
    return {
      annotation,
      journeyPois:
        annotation && annotation['dbf:kind'] === 'Journey' ? getOrderedJourneyPois(items, annotation.id) : [],
    };
  },
};

// A canvas annotation resource, as AnnotationsOverlay's own `annotations`/`searchAnnotations`
// props carry it (see AnnotationItem#pointSelector) - a POI marker is any resource with a
// pointSelector, exactly the condition CanvasAnnotationDisplay#pointContext draws on.
type AnnotationResourceLike = { id: string; pointSelector?: unknown };
type AnnotationListItem = { resources?: AnnotationResourceLike[] };

interface AnnotationsOverlayTargetProps {
  annotations?: AnnotationListItem[];
  searchAnnotations?: AnnotationListItem[];
  selectAnnotation?: (windowId: string, annotationId: string) => void;
  windowId: string;
  [key: string]: unknown;
}

interface AnnotationsOverlayPoiClickWrapperProps {
  TargetComponent: ComponentType<Record<string, unknown>>;
  targetProps: AnnotationsOverlayTargetProps;
  addCompanionWindow: typeof addCompanionWindow;
  updateCompanionWindow: typeof updateCompanionWindow;
  existingPreviewCompanionWindowId?: string;
}

// Wraps AnnotationsOverlay (the component that owns the OSD canvas-click handler and the
// select/deselect-annotation dispatch, see AnnotationsOverlay#toggleAnnotation) so that
// clicking a POI marker on the canvas - not just a row in a list somewhere - opens this same
// preview companion window a "Preview" button would (issue #375's own follow-up: pins on the
// map itself). Re-uses an already-open preview window instead of stacking a new one per click.
const AnnotationsOverlayPoiClickWrapper = ({
  TargetComponent,
  targetProps,
  addCompanionWindow: dispatchAddCompanionWindow,
  updateCompanionWindow: dispatchUpdateCompanionWindow,
  existingPreviewCompanionWindowId,
}: AnnotationsOverlayPoiClickWrapperProps) => {
  const { annotations = [], searchAnnotations = [], selectAnnotation } = targetProps;

  const theme = useTheme();
  // Issue #410: on a phone-width viewport there's no room for a right-hand rail next to
  // the map, so the POI/journey preview opens as a bottom sheet instead.
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const previewPosition = isMobile ? 'bottom' : 'right';

  const selectAnnotationAndMaybePreview = (clickedWindowId: string, annotationId: string) => {
    selectAnnotation?.(clickedWindowId, annotationId);

    const resource = [...annotations, ...searchAnnotations]
      .flatMap((item) => item.resources ?? [])
      .find((item) => item.id === annotationId);

    if (!resource?.pointSelector) return;

    if (existingPreviewCompanionWindowId) {
      dispatchUpdateCompanionWindow(clickedWindowId, existingPreviewCompanionWindowId, {
        annotationid: annotationId,
        position: previewPosition,
      });
    } else {
      dispatchAddCompanionWindow(clickedWindowId, {
        annotationid: annotationId,
        content: POI_PREVIEW_CONTENT_ID,
        position: previewPosition,
      });
    }
  };

  return <TargetComponent {...targetProps} selectAnnotation={selectAnnotationAndMaybePreview} />;
};

const poiPreviewClickPlugin = {
  target: 'AnnotationsOverlay',
  mode: 'wrap',
  component: AnnotationsOverlayPoiClickWrapper,
  mapStateToProps: (state: unknown, { windowId }: { windowId: string }) => {
    const existing = Object.values(getCompanionWindows(state) as Record<string, { id: string; windowId: string; content: string | null }>).find(
      (cw) => cw.windowId === windowId && cw.content === POI_PREVIEW_CONTENT_ID,
    );
    return { existingPreviewCompanionWindowId: existing?.id };
  },
  mapDispatchToProps: { addCompanionWindow, updateCompanionWindow },
};

export const poiPreviewPlugins = [poiPreviewCompanionWindowPlugin, poiPreviewClickPlugin];
