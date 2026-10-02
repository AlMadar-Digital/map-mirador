import { straightSegmentPoints } from '../../../src/lib/smoothPath';

/** An SVG element parsed from markup */
const svgElement = (markup) =>
  new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement
    .firstElementChild;

describe('straightSegmentPoints', () => {
  it('reads a journey path of absolute M/L commands', () => {
    expect(straightSegmentPoints(svgElement("<path d='M 675,324 L 405,756 L 918,1080'/>"))).toEqual([
      { x: 675, y: 324 },
      { x: 405, y: 756 },
      { x: 918, y: 1080 },
    ]);
  });

  it('reads a polyline', () => {
    expect(straightSegmentPoints(svgElement("<polyline points='0,0 10,20'/>"))).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ]);
  });

  it('leaves curved or relative paths and other shapes as authored', () => {
    expect(straightSegmentPoints(svgElement("<path d='M 0,0 C 1,1 2,2 3,3'/>"))).toBeNull();
    expect(straightSegmentPoints(svgElement("<path d='m 0,0 l 10,10'/>"))).toBeNull();
    expect(straightSegmentPoints(svgElement("<circle cx='1' cy='1' r='1'/>"))).toBeNull();
  });
});
