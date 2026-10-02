import { useId, useState, type ComponentType } from 'react';
import {
  OSDReferences,
  getCompanionWindow,
  getConfig,
  getRequiredStatement,
  getRights,
  // Relative, as in poiPreviewPlugin.tsx: this file lives inside the dbf-mirador package.
} from '../index';
import { getContentLocale, getPreviewCompanionWindowId, sanitizeDescription, type ContentLocale } from './poiPreviewPlugin';
import { setPanelCollapsed, usePanelCollapsed } from './sitePanelState';

// The site preset's map tools (Figma "map sidepanel" toolbars): the tab that hides and shows the
// preview panel, and the zoom in / zoom out / image rights column. They replace Mirador's own
// canvas navigation bar (previous/next canvas, zoom, "1 of 1"), which a single-image map does
// not need. Markup only: the host page styles and places them through the `.dbf-map*` class
// contract; `data-panel` and `data-panel-position` say where the preview panel is.

const LABELS: Record<ContentLocale, Record<string, string>> = {
  ar: {
    collapse: 'إخفاء اللوحة',
    expand: 'إظهار اللوحة',
    rights: 'حقوق الصورة',
    zoomIn: 'تكبير',
    zoomOut: 'تصغير',
  },
  en: {
    collapse: 'Hide panel',
    expand: 'Show panel',
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
  locale: ContentLocale;
  panelPosition: 'right' | 'bottom' | null;
  requiredStatement: RequiredStatement;
  rights: string[];
  site: boolean;
}

const SiteMapTools = ({
  TargetComponent,
  targetProps,
  locale,
  panelPosition,
  requiredStatement,
  rights,
  site,
}: SiteMapToolsProps) => {
  const { windowId } = targetProps;
  const collapsed = usePanelCollapsed(windowId);
  const [showRights, setShowRights] = useState(false);
  const rightsId = useId();

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
      {panelPosition === 'right' && (
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? labels.expand : labels.collapse}
          className="dbf-map-panel__toggle"
          onClick={() => setPanelCollapsed(windowId, !collapsed)}
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
    const position = previewId
      ? (getCompanionWindow(state, { companionWindowId: previewId })?.position as string | undefined)
      : undefined;
    return {
      locale: getContentLocale(config.language),
      panelPosition: position === 'right' || position === 'bottom' ? position : null,
      requiredStatement: (getRequiredStatement(state, { windowId }) ?? []) as RequiredStatement,
      rights: (getRights(state, { windowId }) ?? []) as string[],
      site: config.maps?.site === true,
    };
  },
};

export const siteMapToolsPlugins = [siteMapToolsPlugin];
