import { fillViewBounds } from '../../../src/plugins/fillView.ts';

const image = { height: 1295, width: 1800, x: 0, y: 0 };
const inView = (view, container, { x, y }) => {
  const scale = container.x / view.width;
  const px = (x - view.x) * scale;
  const py = (y - view.y) * scale;
  // the pin: 50px tall above its point, 50px wide around it
  return px - 25 >= 0 && px + 25 <= container.x && py - 50 >= 0 && py <= container.y;
};

describe('fillViewBounds', () => {
  it('fills the view when the POIs allow it, cropping the image rather than banding it', () => {
    const container = { x: 1440, y: 900 };
    const view = fillViewBounds(image, container, [{ x: 900, y: 600 }]);

    expect(view.width).toBeCloseTo(1800);
    expect(view.height).toBeLessThan(image.height);
    expect(view.y).toBeGreaterThanOrEqual(0);
    expect(view.y + view.height).toBeLessThanOrEqual(image.height);
  });

  it('zooms out only as far as keeps every POI and its pin in view', () => {
    const container = { x: 390, y: 844 };
    const points = [
      { x: 396, y: 389 },
      { x: 1548, y: 492 },
    ];
    const view = fillViewBounds(image, container, points);

    points.forEach((point) => expect(inView(view, container, point)).toBe(true));
    expect(view.width).toBeLessThan(image.width);
  });

  it('never zooms out past the whole image', () => {
    const view = fillViewBounds(image, { x: 390, y: 844 }, [
      { x: 0, y: 0 },
      { x: 1800, y: 1295 },
    ]);

    expect(view.width / 390).toBeCloseTo(Math.max(1800 / 390, 1295 / 844));
  });
});
