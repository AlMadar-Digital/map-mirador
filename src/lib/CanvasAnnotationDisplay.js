/**
 * CanvasAnnotationDisplay - class used to display a SVG and fragment based
 * annotations.
 */
import { buildPath2D } from '../lib/svgShapesToPath';

/**
 * The POI marker icon's path data and viewBox, copied from src/assets/icons/poi-marker.svg -
 * inlined as a Path2D (rather than loaded as an image via drawImage) so it renders as a crisp
 * vector at any zoom with no async image-load step to coordinate with the render loop. Update
 * this constant (and the asset file, for reference) together if the icon changes.
 */
const POI_ICON_PATH_D =
  'M50.002 0C30.763 0 15 15.718 15 34.902c0 7.432 2.374 14.34 6.392 20.019L45.73 96.994c3.409 4.453 5.675 3.607 8.51-.235l26.843-45.683c.542-.981.967-2.026 1.338-3.092A34.446 34.446 0 0 0 85 34.902C85 15.718 69.24 0 50.002 0zm0 16.354c10.359 0 18.597 8.218 18.597 18.548c0 10.33-8.238 18.544-18.597 18.544c-10.36 0-18.601-8.215-18.601-18.544c0-10.33 8.241-18.548 18.6-18.548z';
const POI_ICON_VIEWBOX_SIZE = 100;
/** The icon's own point (its pin tip), in viewBox units - this is what gets placed exactly on the annotated coordinate, not the icon's bounding-box center. Derived from the path's actual lowest point (~50, 100), not just its nearby `L` command endpoint. */
const POI_ICON_TIP = { x: 50, y: 100 };
/** Center/radius of the icon's circular head, in viewBox units - where a journey-order badge is drawn, overlapping the icon like a numbered pin. */
const POI_ICON_HEAD = { x: 50, y: 34.9, radius: 18.6 };
/** Font size of the journey-order number, relative to POI_ICON_HEAD.radius, so it's bigger than the badge circle would otherwise imply while the circle itself stays the same size. */
const POI_ICON_HEAD_FONT_SCALE = 1.6;
const POI_ICON_DEFAULT_FILL = '#1e88e5';
/** Constant on-screen height (CSS px) for the POI icon, regardless of zoom - counter-scaled the same way this class already counter-scales stroke width (see `lineWidth /= zoomRatio` in svgContext). */
export const POI_ICON_HEIGHT_PX = 44;

export default class CanvasAnnotationDisplay {
  /** */
  constructor({ resource, palette, zoomRatio, offset, selected, hovered }) {
    this.resource = resource;
    this.palette = palette;
    this.zoomRatio = zoomRatio;
    this.offset = offset;
    this.selected = selected;
    this.hovered = hovered;
  }

  /** */
  toContext(context) {
    this.context = context;
    if (this.resource.svgSelector) {
      this.svgContext();
    } else if (this.resource.pointSelector) {
      this.pointContext();
    } else if (this.resource.fragmentSelector) {
      this.fragmentContext();
    }
  }

  /** */
  currentPalette() {
    if (this.hovered) return this.palette.hovered;
    if (this.selected) return this.palette.selected;
    return this.palette.default;
  }

  /**
   * Draws a POI marker (IIIF PointSelector) as the SVG pin icon, at a constant on-screen size,
   * with the icon's own tip placed exactly on the annotated point. When the annotation carries
   * journey-order metadata (`dbf:journey.order`), also draws a numbered badge over the icon's
   * head, so a POI's position within its journey is visible directly on the map.
   */
  pointContext() {
    const { x, y } = this.resource.pointSelector;
    const currentPalette = this.currentPalette();
    if (currentPalette.globalAlpha === 0) return;

    const iconHeight = POI_ICON_HEIGHT_PX / this.zoomRatio;
    const iconScale = iconHeight / POI_ICON_VIEWBOX_SIZE;

    this.context.save();
    this.context.translate(this.offset.x + x, this.offset.y + y);
    this.context.scale(iconScale, iconScale);
    this.context.translate(-POI_ICON_TIP.x, -POI_ICON_TIP.y);

    this.context.globalAlpha = currentPalette.globalAlpha ?? 1;
    this.context.fillStyle = currentPalette.fillStyle || POI_ICON_DEFAULT_FILL;
    this.context.fill(new Path2D(POI_ICON_PATH_D));

    const { journeyOrder } = this.resource;
    if (journeyOrder != null) {
      this.journeyOrderBadgeContext(journeyOrder);
    }

    this.context.restore();
  }

  /**
   * Draws a small numbered circle over the POI icon's head, in the icon's own (viewBox-unit,
   * already-scaled/translated) coordinate space - called from within pointContext's transform,
   * before it restores the context.
   * @param {number} order
   */
  journeyOrderBadgeContext(order) {
    this.context.beginPath();
    this.context.arc(POI_ICON_HEAD.x, POI_ICON_HEAD.y, POI_ICON_HEAD.radius, 0, Math.PI * 2);
    this.context.fillStyle = '#ffffff';
    this.context.fill();

    this.context.fillStyle = this.currentPalette().fillStyle || POI_ICON_DEFAULT_FILL;
    this.context.font = `bold ${POI_ICON_HEAD.radius * POI_ICON_HEAD_FONT_SCALE}px sans-serif`;
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';
    this.context.fillText(String(order), POI_ICON_HEAD.x, POI_ICON_HEAD.y);
  }

  /** */
  get svgString() {
    return this.resource.svgSelector.value;
  }

  parseOpacity(value) {
    if (typeof value === 'string' && value.trim().endsWith('%')) {
      return parseFloat(value) / 100;
    }
    return parseFloat(value);
  }

  /** */
  svgContext() {
    let currentPalette;
    if (this.hovered) {
      currentPalette = this.palette.hovered;
    } else if (this.selected) {
      currentPalette = this.palette.selected;
    } else {
      currentPalette = this.palette.default;
    }

    if (currentPalette.globalAlpha === 0) return;

    [...this.svgPaths].forEach((element) => {
      /**
       *  Note: Path2D is not supported in IE11.
       *  TODO: Support multi canvas offset
       *  One example: https://developer.mozilla.org/en-US/docs/Web/API/Path2D/addPath
       */
      this.context.save();
      this.context.translate(this.offset.x, this.offset.y);
      const p = buildPath2D(element);

      // Setup styling from SVG -> Canvas
      this.context.strokeStyle = this.color;
      if (element.getAttribute('stroke-dasharray')) {
        this.context.setLineDash(element.getAttribute('stroke-dasharray').split(','));
      }
      const svgToCanvasMap = {
        fill: 'fillStyle',
        stroke: 'strokeStyle',
        'stroke-dashoffset': 'lineDashOffset',
        'stroke-linecap': 'lineCap',
        'stroke-linejoin': 'lineJoin',
        'stroke-miterlimit': 'miterlimit',
        'stroke-width': 'lineWidth',
      };
      Object.keys(svgToCanvasMap).forEach((key) => {
        if (element.getAttribute(key)) {
          this.context[svgToCanvasMap[key]] = element.getAttribute(key);
        }
      });

      // Resize the stroke based off of the zoomRatio (currentZoom / maxZoom)
      this.context.lineWidth /= this.zoomRatio;

      // Reset the color if it is selected or hovered on
      if (this.selected || this.hovered) {
        this.context.strokeStyle = currentPalette.strokeStyle || currentPalette.fillStyle;
      }

      this.context.globalAlpha = currentPalette.globalAlpha;
      // Set the globalAlpha for fill, draw the fill and then update the globalAlpha for stroke
      if (element.getAttribute('fill') && element.getAttribute('fill') !== 'none') {
        if (element.getAttribute('fill-opacity')) {
          this.context.globalAlpha = currentPalette.globalAlpha * this.parseOpacity(element.getAttribute('fill-opacity'));
        }
        this.context.fill(p);
      }

      if (element.getAttribute('stroke-opacity')) {
        this.context.globalAlpha = currentPalette.globalAlpha * this.parseOpacity(element.getAttribute('stroke-opacity'));
      } else {
        this.context.globalAlpha = currentPalette.globalAlpha;
      }
      this.context.stroke(p);
      this.context.restore();
    });
  }

  /** */
  fragmentContext() {
    const fragment = this.resource.fragmentSelector;
    fragment[0] += this.offset.x;
    fragment[1] += this.offset.y;

    let currentPalette;
    if (this.selected) {
      currentPalette = this.palette.selected;
    } else if (this.hovered) {
      currentPalette = this.palette.hovered;
    } else {
      currentPalette = this.palette.default;
    }

    this.context.save();
    Object.keys(currentPalette).forEach((key) => {
      this.context[key] = currentPalette[key];
    });

    if (currentPalette.globalAlpha === 0) return;

    if (currentPalette.fillStyle) {
      this.context.fillRect(...fragment);
    } else {
      this.context.lineWidth = 1 / this.zoomRatio;
      this.context.strokeRect(...fragment);
    }

    this.context.restore();
  }

  /** */
  get svgPaths() {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(this.svgString, 'text/xml');
    return Array.from(xmlDoc.querySelectorAll('circle, ellipse, rect, line, polygon, polyline, path'));
  }
}
