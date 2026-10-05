import { useEffect, useRef, useState, type CSSProperties } from 'react';

// The site preset's audio player (`.dbf-map-audio*` class contract, Figma 1:3875 / 1:4484): a
// POI's recording - an uploaded audio file, or a Media Item's - in place of its image. Repeat,
// back and forward 10 seconds, play/pause and back to the start; then the playback speed, the
// position and mute; then the recording's title and time. The host draws the icons and the
// layout; this renders native buttons and a range input, labelled, so it works with a keyboard
// and a screen reader whatever the styling.

export type PlayableMedia = {
  source?: string;
  mediaType?: string | null;
  url?: string | null;
  mime?: string | null;
  duration?: number | null;
  title?: string | null;
};

export type AudioLabels = {
  audio: string;
  forward: string;
  mute: string;
  pause: string;
  play: string;
  repeat: string;
  restart: string;
  rewind: string;
  seek: string;
  speed: string;
};

// How far back and forward buttons move (seconds).
export const SKIP_SECONDS = 10;
// The speeds the speed button steps through, back to the first.
export const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75];

const AUDIO_FILE = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i;

/** A playable URL: http(s) or root-relative, nothing else. */
const safeUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return url;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
};

/** The URL of a media's recording, when it is audio the browser can be asked to play. */
export const audioUrl = (media: PlayableMedia | null | undefined): string | null => {
  const url = safeUrl(media?.url);
  if (!url || !media) return null;
  if (media.mime) return media.mime.startsWith('audio/') ? url : null;
  if (media.mediaType === 'audio') return url;
  try {
    return AUDIO_FILE.test(new URL(url, 'http://localhost').pathname) ? url : null;
  } catch {
    return null;
  }
};

/** m:ss (h:mm:ss from an hour), for a time in seconds. */
export const formatTime = (seconds: number | null | undefined): string => {
  const total = Number.isFinite(seconds) && (seconds as number) > 0 ? Math.floor(seconds as number) : 0;
  const s = String(total % 60).padStart(2, '0');
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
};

// One recording at a time, across every player on the page.
let playingNow: HTMLAudioElement | null = null;

interface AudioPlayerProps {
  // Its length, until the file's own metadata has loaded.
  duration?: number | null;
  labels: AudioLabels;
  mime?: string | null;
  src: string;
  title: string;
}

export const AudioPlayer = ({ duration: knownDuration = null, labels, mime = null, src, title }: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number>(knownDuration && knownDuration > 0 ? knownDuration : 0);
  const [repeat, setRepeat] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(PLAYBACK_RATES[0]);

  // Set on the element itself: React doesn't keep `muted` in step on a mounted element.
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.playbackRate = rate;
    element.loop = repeat;
    element.muted = muted;
  }, [muted, rate, repeat]);

  // A player taken off the page (its card closed) stops.
  useEffect(
    () => () => {
      const audio = audioRef.current;
      if (playingNow === audio) playingNow = null;
      audio?.pause();
    },
    []
  );

  const audio = () => audioRef.current;
  const seekTo = (time: number) => {
    const element = audio();
    if (!element) return;
    const end = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : duration;
    const next = Math.max(0, end > 0 ? Math.min(end, time) : time);
    element.currentTime = next;
    setCurrent(next);
  };

  const togglePlay = () => {
    const element = audio();
    if (!element) return;
    if (element.paused) {
      element.play()?.catch(() => setPlaying(false));
    } else {
      element.pause();
    }
  };

  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const timeShown = formatTime(current > 0 ? current : duration);
  const rateLabel = `${rate}×`;

  return (
    // A press on the player isn't a press on its card (which would move the map).
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only stops the click reaching the card
    <div
      aria-label={`${labels.audio}: ${title}`}
      className="dbf-map-audio"
      data-playing={playing ? 'true' : undefined}
      onClick={(event) => event.stopPropagation()}
      role="group"
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- an audio-only recording; a transcript is the Media Item's */}
      <audio
        onDurationChange={(event) => {
          const { duration: length } = event.currentTarget;
          if (Number.isFinite(length) && length > 0) setDuration(length);
        }}
        onEnded={() => setPlaying(false)}
        onPause={() => {
          setPlaying(false);
          if (playingNow === audioRef.current) playingNow = null;
        }}
        onPlay={() => {
          if (playingNow && playingNow !== audioRef.current) playingNow.pause();
          playingNow = audioRef.current;
          setPlaying(true);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        preload="metadata"
        ref={audioRef}
      >
        <source src={src} type={mime ?? undefined} />
      </audio>
      <div className="dbf-map-audio__controls">
        <button
          aria-label={labels.repeat}
          aria-pressed={repeat}
          className="dbf-map-audio__button"
          data-action="repeat"
          onClick={() => setRepeat((value) => !value)}
          type="button"
        />
        <button
          aria-label={labels.rewind}
          className="dbf-map-audio__button"
          data-action="rewind"
          onClick={() => seekTo((audio()?.currentTime ?? current) - SKIP_SECONDS)}
          type="button"
        />
        <button
          aria-label={playing ? labels.pause : labels.play}
          className="dbf-map-audio__button"
          data-action={playing ? 'pause' : 'play'}
          onClick={togglePlay}
          type="button"
        />
        <button
          aria-label={labels.forward}
          className="dbf-map-audio__button"
          data-action="forward"
          onClick={() => seekTo((audio()?.currentTime ?? current) + SKIP_SECONDS)}
          type="button"
        />
        <button
          aria-label={labels.restart}
          className="dbf-map-audio__button"
          data-action="restart"
          onClick={() => seekTo(0)}
          type="button"
        />
      </div>
      <div className="dbf-map-audio__timeline">
        <button
          aria-label={`${labels.speed}: ${rateLabel}`}
          className="dbf-map-audio__button"
          data-action="speed"
          data-rate={rate === 1 ? undefined : rateLabel}
          onClick={() => setRate((value) => PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(value) + 1) % PLAYBACK_RATES.length])}
          type="button"
        />
        <input
          aria-label={labels.seek}
          aria-valuetext={`${formatTime(current)} / ${formatTime(duration)}`}
          className="dbf-map-audio__seek"
          disabled={duration <= 0}
          max={duration > 0 ? duration : 0}
          min={0}
          onChange={(event) => seekTo(Number(event.currentTarget.value))}
          step="any"
          style={{ '--dbf-map-audio-progress': `${progress}%` } as CSSProperties}
          type="range"
          value={Math.min(current, duration > 0 ? duration : 0)}
        />
        <button
          aria-label={labels.mute}
          aria-pressed={muted}
          className="dbf-map-audio__button"
          data-action="mute"
          onClick={() => setMuted((value) => !value)}
          type="button"
        />
      </div>
      <p className="dbf-map-audio__meta">
        <span className="dbf-map-audio__title">{title}</span>
        <span className="dbf-map-audio__time">{timeShown}</span>
      </p>
    </div>
  );
};
