import CanvasAnnotationDisplay from '../../../src/lib/CanvasAnnotationDisplay';
import AnnotationResource from '../../../src/lib/AnnotationResource';
import dualStrategyAnno from '../../fixtures/version-2/annotationMiradorDual.json';

/** */
function createSubject(args) {
  return new CanvasAnnotationDisplay({
    offset: {
      x: -100,
      y: 0,
    },
    palette: {
      default: { globalAlpha: 1, strokeStyle: 'black' },
      hovered: { globalAlpha: 1, strokeStyle: 'blue' },
      selected: { globalAlpha: 1, strokeStyle: 'yellow' },
    },
    zoomRatio: 0.5,
    ...args,
  });
}

function createMockContext(onFill = '') {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(onFill),
    fillText: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
  };
}

describe('CanvasAnnotationDisplay', () => {
  describe('toContext', () => {
    it('selects svgSelector if present in a dual anno', () => {
      const subject = createSubject({
        resource: new AnnotationResource(dualStrategyAnno),
      });
      subject.svgContext = vi.fn();
      subject.fragmentContext = vi.fn();
      subject.toContext(createMockContext());
      expect(subject.svgContext).toHaveBeenCalled();
      expect(subject.fragmentContext).not.toHaveBeenCalled();
    });

    it('draws every shape and sets all 6 svg shapes', () => {
      const context = createMockContext();
      const subject = createSubject({
        resource: new AnnotationResource({
          motivation: ['oa:commenting'],
          on: {
            selector: {
              item: {
                '@type': 'oa:SvgSelector',
                value: `<svg xmlns='http://www.w3.org/2000/svg'>
                <g>
                  <line x1='0' y1='0' x2='300' y2='200' stroke='red' />
                  <polygon points='242,633 340,552 948,1173 859,1249' />
                </g>
                <circle cx='1050' cy='250' r='90' />
                <ellipse cx='1050' cy='1650' rx='130' ry='80' />
                <rect x='50' y='1500' width='180' height='120' />
                <polyline points='60,300 200,220 340,340 480,260' />
              </svg>`,
              },
            },
          },
        }),
      });
      subject.context = context;

      const tags = [...subject.svgPaths].map((el) => el.tagName.toLowerCase());
      expect(tags).toEqual(['line', 'polygon', 'circle', 'ellipse', 'rect', 'polyline']);

      subject.svgContext = vi.fn();
      subject.fragmentContext = vi.fn();
      subject.toContext(context);
      expect(subject.svgContext).toHaveBeenCalled(6);
      expect(subject.fragmentContext).not.toHaveBeenCalled();
    });
    it('selects fragmentSelector if present and if no svg is present', () => {
      const subject = createSubject({
        resource: new AnnotationResource({ on: 'www.example.com/#xywh=10,10,100,200' }),
      });
      subject.svgContext = vi.fn();
      subject.fragmentContext = vi.fn();
      subject.toContext(createMockContext());
      expect(subject.svgContext).not.toHaveBeenCalled();
      expect(subject.fragmentContext).toHaveBeenCalled();
    });
    it('selects pointContext if present, over fragmentSelector', () => {
      const subject = createSubject({
        resource: new AnnotationResource({
          on: { selector: { '@type': 'oa:PointSelector', x: 10, y: 20 } },
        }),
      });
      subject.pointContext = vi.fn();
      subject.fragmentContext = vi.fn();
      subject.toContext(createMockContext());
      expect(subject.pointContext).toHaveBeenCalled();
      expect(subject.fragmentContext).not.toHaveBeenCalled();
    });
    it('ignores annotations without selectors', () => {
      const subject = createSubject({
        resource: new AnnotationResource({ on: 'www.example.com' }),
      });
      subject.svgContext = vi.fn();
      subject.fragmentContext = vi.fn();
      subject.toContext(createMockContext());
      expect(subject.svgContext).not.toHaveBeenCalled();
      expect(subject.fragmentContext).not.toHaveBeenCalled();
    });
  });
  describe('svgString', () => {
    it('selects the svg selector string value', () => {
      const subject = createSubject({
        resource: new AnnotationResource(dualStrategyAnno),
      });
      expect(subject.svgString).toMatch(/<svg/);
    });
  });

  describe('svgString', () => {
    it('converts percentage strings to float decimal', () => {
      const subject = createSubject({});
      expect(subject.parseOpacity('30%')).toEqual(0.3);
    });

    it('converts decimals strings to float', () => {
      const subject = createSubject({});
      expect(subject.parseOpacity('.2')).toEqual(0.2);
    });
    it('parses numeric input directly', () => {
      const subject = createSubject({});
      expect(subject.parseOpacity(0.5)).toEqual(0.5);
    });
  });
  describe('svgContext', () => {
    it('draws the paths with selected arguments', () => {
      let alphaAtFill;
      const context = createMockContext(() => {
        alphaAtFill = context.globalAlpha;
      });

      const subject = createSubject({
        resource: new AnnotationResource(dualStrategyAnno),
      });
      subject.context = context;
      subject.svgContext();
      expect(context.save).toHaveBeenCalledWith();
      expect(context.restore).toHaveBeenCalledWith();
      expect(context.translate).toHaveBeenCalledWith(-100, 0);
      expect(context.strokeStyle).toEqual('#00bfff');
      expect(context.lineWidth).toEqual(61.74334);
      expect(context.setLineDash).toHaveBeenCalledWith(['4 1 2']);
      expect(context.fill).toHaveBeenCalled();
      expect(alphaAtFill).toEqual(0.2);
      expect(context.globalAlpha).toEqual(0.3);
    });

    it('skips dasharray, fill, and opacity overrides when attributes are absent', () => {
      const context = createMockContext();
      const subject = createSubject({
        resource: new AnnotationResource({
          motivation: ['oa:commenting'],
          on: {
            selector: {
              item: {
                '@type': 'oa:SvgSelector',
                value: "<svg xmlns='http://www.w3.org/2000/svg'><path d='M0,0 L10,10' stroke='#00bfff' stroke-width='2' /></svg>",
              },
            },
          },
        }),
      });
      subject.context = context;
      subject.svgContext();
      expect(context.setLineDash).not.toHaveBeenCalled();
      expect(context.fill).not.toHaveBeenCalled();
      expect(context.globalAlpha).toEqual(1);
    });

    it('uses default globalAlpha for fill when fill-opacity is not set', () => {
      let alphaAtFill;
      const context = createMockContext(() => {
        alphaAtFill = context.globalAlpha;
      });
      const subject = createSubject({
        resource: new AnnotationResource({
          motivation: ['oa:commenting'],
          on: {
            selector: {
              item: {
                '@type': 'oa:SvgSelector',
                value:
                  "<svg xmlns='http://www.w3.org/2000/svg'><path d='M0,0 L10,10' fill='#00bfff' stroke='#00bfff' stroke-width='2' /></svg>",
              },
            },
          },
        }),
      });
      subject.context = context;
      subject.svgContext();
      expect(alphaAtFill).toEqual(1);
    });
    it('resets the color if selected rather than using the SVG color', () => {
      const subject = createSubject({
        resource: new AnnotationResource(dualStrategyAnno),
        selected: true,
      });
      subject.context = createMockContext();
      subject.svgContext();
      expect(subject.context.strokeStyle).toBe('yellow');
    });
  });
  describe('pointContext', () => {
    /** */
    function createPointResource(extra = {}) {
      return new AnnotationResource({
        on: { selector: { '@type': 'oa:PointSelector', x: 10, y: 20 } },
        ...extra,
      });
    }

    it('draws the icon fill centered on the annotated point, counter-scaled by zoomRatio', () => {
      const context = createMockContext();
      const subject = createSubject({ resource: createPointResource(), zoomRatio: 0.5 });
      subject.context = context;
      subject.pointContext();

      expect(context.save).toHaveBeenCalledWith();
      // offset.x = -100, offset.y = 0 (from createSubject); point x=10, y=20
      expect(context.translate).toHaveBeenCalledWith(-90, 20);
      // iconHeight = 44 / 0.5 = 88; iconScale = 88 / 100 = 0.88
      expect(context.scale).toHaveBeenCalledWith(0.88, 0.88);
      expect(context.fill).toHaveBeenCalled();
      expect(context.restore).toHaveBeenCalledWith();
    });

    it('does not draw when globalAlpha is 0', () => {
      const context = createMockContext();
      const subject = createSubject({ resource: createPointResource() });
      subject.context = context;
      subject.palette.default.globalAlpha = 0;
      subject.pointContext();

      expect(context.fill).not.toHaveBeenCalled();
      expect(context.save).not.toHaveBeenCalled();
    });

    it('does not draw a journey-order badge when the POI is not part of a journey', () => {
      const context = createMockContext();
      const subject = createSubject({ resource: createPointResource() });
      subject.context = context;
      subject.pointContext();

      expect(context.arc).not.toHaveBeenCalled();
      expect(context.fillText).not.toHaveBeenCalled();
    });

    it('draws a numbered badge over the icon head when the POI belongs to a journey', () => {
      const context = createMockContext();
      const subject = createSubject({
        resource: createPointResource({ 'dbf:journey': { id: 'journey1', order: 3 } }),
      });
      subject.context = context;
      subject.pointContext();

      expect(context.arc).toHaveBeenCalledWith(50, 34.9, 18.6, 0, Math.PI * 2);
      // dbf:journey.order is 0-based, stop numbers shown to users are 1-based
      expect(context.fillText).toHaveBeenCalledWith('4', 50, 34.9);
    });

    it('prefers the stop number computed by the caller over the stored order', () => {
      const context = createMockContext();
      const subject = createSubject({
        journeyStopNumber: 2,
        resource: createPointResource({ 'dbf:journey': { id: 'journey1', order: 7 } }),
      });
      subject.context = context;
      subject.pointContext();

      expect(context.fillText).toHaveBeenCalledWith('2', 50, 34.9);
    });

    it('draws an unselected pin in the POI blue, without outline', () => {
      const context = createMockContext();
      const subject = createSubject({ resource: createPointResource() });
      subject.context = context;
      subject.pointContext();

      expect(context.fillStyle).toBe('#1e88e5');
      expect(context.stroke).not.toHaveBeenCalled();
    });

    it('draws a selected pin bigger and outlined, keeping the POI blue', () => {
      const context = createMockContext();
      const subject = createSubject({ resource: createPointResource(), selected: true, zoomRatio: 0.5 });
      subject.context = context;
      subject.pointContext();

      // iconHeight = 44 * 1.3 / 0.5 = 114.4; iconScale = 1.144
      const [scaleX, scaleY] = context.scale.mock.calls[0];
      expect(scaleX).toBeCloseTo(1.144);
      expect(scaleY).toBeCloseTo(1.144);
      expect(context.fillStyle).toBe('#1e88e5');
      expect(context.stroke).toHaveBeenCalled();
    });

    it('keeps a hovered pin in the POI blue rather than the hovered palette color', () => {
      const context = createMockContext();
      const subject = createSubject({ hovered: true, resource: createPointResource() });
      subject.context = context;
      subject.pointContext();

      expect(context.fillStyle).toBe('#1e88e5');
    });
  });

  describe('fragmentContext', () => {
    it('draws the fragment with selected arguments', () => {
      let alphaAtFill;
      const context = createMockContext(() => {
        alphaAtFill = context.globalAlpha;
      });
      const subject = createSubject({
        hovered: true,
        resource: new AnnotationResource({ on: 'www.example.com/#xywh=10,10,100,200' }),
      });
      subject.context = context;
      subject.fragmentContext();
      expect(context.strokeRect).toHaveBeenCalledWith(-90, 10, 100, 200);
      expect(context.strokeStyle).toEqual('blue');
      expect(context.lineWidth).toEqual(2);
      expect(context.setLineDash).not.toHaveBeenCalled();
      expect(alphaAtFill).toEqual(undefined);
      expect(context.globalAlpha).toEqual(1);
    });
  });
});
