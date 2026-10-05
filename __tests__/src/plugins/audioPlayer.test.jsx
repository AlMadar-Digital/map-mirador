import { fireEvent, render, screen } from '@testing-library/react';
import { AudioPlayer, audioUrl, formatTime, PLAYBACK_RATES, SKIP_SECONDS } from '../../../src/plugins/audioPlayer.tsx';

const LABELS = {
  audio: 'Audio',
  forward: 'Forward 10 seconds',
  mute: 'Mute',
  pause: 'Pause',
  play: 'Play',
  repeat: 'Repeat',
  restart: 'Back to the start',
  rewind: 'Back 10 seconds',
  seek: 'Playback position',
  speed: 'Playback speed',
};

// happy-dom has no media playback: play/pause just fire their events.
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(function pause() {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
    this.dispatchEvent(new Event('pause'));
  });
});
afterEach(() => vi.restoreAllMocks());

const renderPlayer = (props = {}) =>
  render(
    <AudioPlayer
      duration={155}
      labels={LABELS}
      mime="audio/mpeg"
      src="https://cdn.example/fort.mp3"
      title="Muwailih Fort"
      {...props}
    />,
  );

describe('audioUrl', () => {
  it('plays audio files only, from http(s) or the same site', () => {
    expect(audioUrl({ mime: 'audio/mpeg', url: 'https://cdn.example/a.mp3' })).toBe('https://cdn.example/a.mp3');
    expect(audioUrl({ mediaType: 'audio', url: '/uploads/a.bin' })).toBe('/uploads/a.bin');
    expect(audioUrl({ url: 'http://localhost:9000/uploads/a.m4a' })).toBe('http://localhost:9000/uploads/a.m4a');
    expect(audioUrl({ mime: 'image/jpeg', url: 'https://cdn.example/a.jpg' })).toBeNull();
    // eslint-disable-next-line no-script-url -- the URL being refused
    expect(audioUrl({ mime: 'audio/mpeg', url: 'javascript:alert(1)' })).toBeNull();
    expect(audioUrl({ mime: 'audio/mpeg', url: '//evil.example/a.mp3' })).toBeNull();
    expect(audioUrl({ thumbnailUrl: 'https://cdn.example/a.mp3' })).toBeNull();
    expect(audioUrl(null)).toBeNull();
  });
});

describe('formatTime', () => {
  it('reads m:ss, and h:mm:ss from an hour', () => {
    expect(formatTime(155)).toBe('2:35');
    expect(formatTime(5.9)).toBe('0:05');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(Number.NaN)).toBe('0:00');
  });
});

describe('AudioPlayer', () => {
  it('shows the title and length, with every control labelled', () => {
    renderPlayer();
    expect(screen.getByRole('group', { name: 'Audio: Muwailih Fort' })).toBeInTheDocument();
    expect(screen.getByText('Muwailih Fort')).toBeInTheDocument();
    expect(screen.getByText('2:35')).toBeInTheDocument();
    ['Repeat', 'Back 10 seconds', 'Play', 'Forward 10 seconds', 'Back to the start', 'Mute'].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
    expect(screen.getByRole('slider', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '0:00 / 2:35');
  });

  it('plays and pauses', () => {
    renderPlayer();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it(`skips ${SKIP_SECONDS} seconds either way, within the recording`, () => {
    renderPlayer();
    const slider = screen.getByRole('slider', { name: 'Playback position' });
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(slider).toHaveAttribute('aria-valuetext', '0:10 / 2:35');
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back 10 seconds' }));
    expect(slider).toHaveAttribute('aria-valuetext', '0:00 / 2:35');
    fireEvent.change(slider, { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(slider).toHaveAttribute('aria-valuetext', '2:35 / 2:35');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the start' }));
    expect(slider).toHaveAttribute('aria-valuetext', '0:00 / 2:35');
  });

  it('toggles repeat and mute, and steps through the speeds', () => {
    const { container } = renderPlayer();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- the element itself carries these
    const audio = container.querySelector('audio');
    fireEvent.click(screen.getByRole('button', { name: 'Repeat' }));
    expect(screen.getByRole('button', { name: 'Repeat' })).toHaveAttribute('aria-pressed', 'true');
    expect(audio.loop).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    expect(audio.muted).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Playback speed: 1×' }));
    expect(audio.playbackRate).toBe(PLAYBACK_RATES[1]);
    expect(screen.getByRole('button', { name: `Playback speed: ${PLAYBACK_RATES[1]}×` })).toHaveAttribute(
      'data-rate',
      `${PLAYBACK_RATES[1]}×`,
    );
  });

  it('plays one recording at a time', () => {
    render(
      <>
        <AudioPlayer labels={LABELS} src="https://cdn.example/a.mp3" title="A" />
        <AudioPlayer labels={LABELS} src="https://cdn.example/b.mp3" title="B" />
      </>,
    );
    const [first, second] = screen.getAllByRole('button', { name: 'Play' });
    fireEvent.click(first);
    fireEvent.click(second);
    expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
    expect(screen.getByRole('group', { name: 'Audio: B' })).toHaveAttribute('data-playing', 'true');
  });

  it("keeps its clicks from reaching the card it's in", () => {
    const onCardClick = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- a stand-in card
      <div onClick={onCardClick}>
        <AudioPlayer labels={LABELS} src="https://cdn.example/a.mp3" title="A" />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Forward 10 seconds' }));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
