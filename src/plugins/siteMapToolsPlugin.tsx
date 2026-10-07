import { useEffect, useId, useRef, useState, type ComponentType } from 'react';
import {
  OSDReferences,
  addCompanionWindow,
  getCompanionWindow,
  getConfig,
  getRequiredStatement,
  getRights,
  getSelectedAnnotationId,
  updateCompanionWindow,
  // Relative, as in poiPreviewPlugin.tsx: this file lives inside the dbf-mirador package.
} from '../index';
import {
  MAP_INFO_ID,
  getCanvasAnnotationItems,
  getContentLocale,
  getMapInfo,
  getOrderedJourneyPois,
  getPreviewCompanionWindowId,
  openPreview,
  sanitizeDescription,
  textBody,
  usePreviewPosition,
  type ContentLocale,
} from './poiPreviewPlugin';
import { openNextMinimised, PANEL_LABELS, setPanelCollapsed, usePanelCollapsed } from './sitePanelState';
import { pinLabel } from './sitePins';

// Read by screen readers only (the usual visually-hidden recipe).
const VISUALLY_HIDDEN = {
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: 1,
  margin: -1,
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: 1,
} as const;

// The site preset's map tools (Figma "map sidepanel" toolbars): the tab that hides and shows the
// preview panel, and the zoom in / zoom out / image rights column. They replace Mirador's own
// canvas navigation bar (previous/next canvas, zoom, "1 of 1"), which a single-image map does
// not need. Markup only: the host page styles and places them through the `.dbf-map*` class
// contract; `data-panel` and `data-panel-position` say where the preview panel is.

const LABELS: Record<ContentLocale, Record<string, string>> = {
  ar: {
    ...PANEL_LABELS.ar,
    rights: 'حقوق الصورة',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
  },
  en: {
    ...PANEL_LABELS.en,
    rights: 'Image rights',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
  },
};

const ZOOM_STEP = 1.5;

type RequiredStatement = { label: string | null; values: string[] }[];

interface SiteMapToolsProps {
  TargetComponent: ComponentType<Record<string, unknown>>;
  targetProps: { windowId: string; [key: string]: unknown };
  addCompanionWindow: typeof addCompanionWindow;
  // What a screen reader hears when a POI is selected: "<title>, stop n of m" (T-37).
  announcement: string;
  hasMapInfo: boolean;
  locale: ContentLocale;
  panelPosition: 'right' | 'bottom' | null;
  previewAnnotationId: string | null;
  previewId: string | null;
  updateCompanionWindow: typeof updateCompanionWindow;
  requiredStatement: RequiredStatement;
  rights: string[];
  site: boolean;
}

const SiteMapTools = ({
  TargetComponent,
  targetProps,
  addCompanionWindow: dispatchAddCompanionWindow,
  announcement,
  hasMapInfo,
  locale,
  panelPosition,
  previewAnnotationId,
  previewId,
  requiredStatement,
  rights,
  site,
  updateCompanionWindow: dispatchUpdateCompanionWindow,
}: SiteMapToolsProps) => {
  const { windowId } = targetProps;
  const collapsed = usePanelCollapsed(windowId);
  const [showRights, setShowRights] = useState(false);
  const rightsId = useId();
  const previewPosition = usePreviewPosition();

  const openMapInfo = () => {
    setPanelCollapsed(windowId, false);
    openPreview(
      { addCompanionWindow: dispatchAddCompanionWindow, updateCompanionWindow: dispatchUpdateCompanionWindow },
      windowId,
      previewId ?? undefined,
      MAP_INFO_ID,
      previewPosition
    );
  };

  // "Discover the map" opens with the view, once the manifest has a title or description to
  // show (D11).
  const openedMapInfoRef = useRef(false);
  useEffect(() => {
    if (!site || !hasMapInfo || previewId || openedMapInfoRef.current) return;
    openedMapInfoRef.current = true;
    openMapInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the map's info first arrives
  }, [site, hasMapInfo, previewId]);

  // On a phone the sheet has no tab: closing it brings "Discover the map" back minimised to its
  // header (the design's peek), so the map's title and description stay a handle away.
  const hadPanelRef = useRef(false);
  useEffect(() => {
    if (previewId) {
      hadPanelRef.current = true;
      return;
    }
    if (!site || previewPosition !== 'bottom' || !hasMapInfo || !hadPanelRef.current) return;
    hadPanelRef.current = false;
    openNextMinimised(windowId);
    openMapInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when the sheet closes
  }, [site, previewPosition, hasMapInfo, previewId]);

  if (!site) return <TargetComponent {...targetProps} />;

  const labels = LABELS[locale];
  const zoom = (factor: number) => {
    const viewport = OSDReferences.get(windowId)?.current?.viewport;
    if (!viewport) return;
    viewport.zoomBy(factor);
    viewport.applyConstraints();
  };
  const statements = requiredStatement.flatMap(({ values }) => values).filter(Boolean);
  const hasRights = statements.length > 0 || rights.length > 0;
  let panel = 'none';
  if (panelPosition) panel = collapsed ? 'collapsed' : 'open';

  return (
    <div className="dbf-map-tools" data-panel={panel} data-panel-position={panelPosition ?? undefined}>
      <div aria-atomic="true" className="dbf-map-live" role="status" style={VISUALLY_HIDDEN}>
        {announcement}
      </div>
      {panelPosition === 'right' && (
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? labels.expand : labels.collapse}
          className="dbf-map-panel__toggle"
          onClick={() => setPanelCollapsed(windowId, !collapsed)}
          type="button"
        />
      )}
      {/* With no panel open, the tab opens "Discover the map". */}
      {!panelPosition && hasMapInfo && previewPosition === 'right' && (
        <button
          aria-expanded={false}
          aria-label={labels.expand}
          className="dbf-map-panel__toggle"
          onClick={openMapInfo}
          type="button"
        />
      )}
      <div className="dbf-map-controls">
        <button
          aria-label={labels.zoomIn}
          className="dbf-map-controls__button"
          data-action="zoom-in"
          onClick={() => zoom(ZOOM_STEP)}
          type="button"
        />
        <button
          aria-label={labels.zoomOut}
          className="dbf-map-controls__button"
          data-action="zoom-out"
          onClick={() => zoom(1 / ZOOM_STEP)}
          type="button"
        />
        {hasRights && (
          <button
            aria-controls={rightsId}
            aria-expanded={showRights}
            aria-label={labels.rights}
            className="dbf-map-controls__button"
            data-action="attribution"
            onClick={() => setShowRights((shown) => !shown)}
            type="button"
          />
        )}
      </div>
      {hasRights && (
        <div className="dbf-map-attribution" dir={locale === 'ar' ? 'rtl' : 'ltr'} hidden={!showRights} id={rightsId} lang={locale}>
          {statements.map((statement) => (
            // eslint-disable-next-line react/no-danger -- sanitised; IIIF allows a little HTML here
            <p dangerouslySetInnerHTML={{ __html: sanitizeDescription(statement) }} key={statement} />
          ))}
          {rights.map((right) => (
            <p key={right}>
              {/^https?:\/\//.test(right) ? <a href={right}>{right}</a> : right}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

export const siteMapToolsPlugin = {
  target: 'WindowCanvasNavigationControls',
  mode: 'wrap',
  component: SiteMapTools,
  mapStateToProps: (state: unknown, { windowId }: { windowId: string }) => {
    const config = getConfig(state) as { language?: string; maps?: { site?: boolean } };
    const previewId = getPreviewCompanionWindowId(state, windowId);
    const preview = previewId
      ? (getCompanionWindow(state, { companionWindowId: previewId }) as
          | { annotationid?: string; position?: string }
          | undefined)
      : undefined;
    const position = preview?.position;
    const locale = getContentLocale(config.language);
    const items = getCanvasAnnotationItems(state, windowId);
    const selectedId = getSelectedAnnotationId(state, { windowId }) as string | undefined;
    const selected = items.find((item) => item.id === selectedId);
    const journeyId = selected?.['dbf:journey']?.id;
    const stops = journeyId ? getOrderedJourneyPois(items, journeyId) : [];
    const stopIndex = selected ? stops.findIndex((stop) => stop.id === selected.id) : -1;
    return {
      announcement: selected
        ? pinLabel(
            textBody(selected, locale, 'identifying'),
            stopIndex >= 0 ? { count: stops.length, number: stopIndex + 1 } : null,
            locale
          )
        : '',
      hasMapInfo: getMapInfo(state, windowId, locale) !== null,
      locale,
      panelPosition: position === 'right' || position === 'bottom' ? position : null,
      previewAnnotationId: preview?.annotationid ?? null,
      previewId: previewId ?? null,
      requiredStatement: (getRequiredStatement(state, { windowId }) ?? []) as RequiredStatement,
      rights: (getRights(state, { windowId }) ?? []) as string[],
      site: config.maps?.site === true,
    };
  },
  mapDispatchToProps: { addCompanionWindow, updateCompanionWindow },
};

export const siteMapToolsPlugins = [siteMapToolsPlugin];
