// @vitest-environment jsdom
// DOMPurify does not sanitise under happy-dom (it passes <script> through even with its
// defaults), so this runs in jsdom, which behaves like a browser here.
import { sanitizeDescription } from '../../../src/plugins/poiPreviewPlugin.tsx';

describe('sanitizeDescription', () => {
  it('keeps the editor tags and drops scripts, handlers, styles and classes', () => {
    const html = sanitizeDescription(
      '<p class="x" style="color:red" onclick="alert(1)">A <i>title</i> <a href="/w">link</a></p><script>alert(1)</script><img src=x onerror=alert(1)>',
    );

    expect(html).toBe('<p>A <i>title</i> <a href="/w">link</a></p>');
  });

  it('drops javascript: links', () => {
    expect(sanitizeDescription('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('returns an empty string for no input', () => {
    expect(sanitizeDescription('')).toBe('');
  });
});
