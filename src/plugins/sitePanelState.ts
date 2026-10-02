import { useEffect, useRef, useSyncExternalStore } from 'react';

// Whether the site preset's preview panel is collapsed (slid away behind its tab) per window.
// Shared by the panel and the map tools, which render in different parts of Mirador's tree; it
// is view state only, so it lives here rather than in the Redux store.
const collapsedByWindow = new Map<string, boolean>();
const listeners = new Set<() => void>();

export const setPanelCollapsed = (windowId: string, collapsed: boolean) => {
  if ((collapsedByWindow.get(windowId) === true) === collapsed) return;
  collapsedByWindow.set(windowId, collapsed);
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const usePanelCollapsed = (windowId: string): boolean =>
  useSyncExternalStore(
    subscribe,
    () => collapsedByWindow.get(windowId) === true,
    () => false
  );

type EventSource = {
  addHandler: (name: string, handler: () => void) => void;
  removeHandler: (name: string, handler: () => void) => void;
};

const INTERACTION_EVENTS = ['canvas-drag', 'canvas-scroll', 'canvas-pinch', 'canvas-click'];

/**
 * Minimises the panel on the visitor's first interaction with the map (a drag, wheel, pinch or
 * click), if it is showing "Discover the map" then (D11) - once per viewer. A tour step that
 * selects a POI reopens the panel on it.
 */
export const useMinimiseOnFirstInteraction = (
  viewer: EventSource | null | undefined,
  windowId: string,
  enabled: boolean,
  showsMapInfo: boolean
) => {
  const showsMapInfoRef = useRef(showsMapInfo);
  useEffect(() => {
    showsMapInfoRef.current = showsMapInfo;
  });
  const doneRef = useRef(false);
  useEffect(() => {
    if (!enabled || !viewer || doneRef.current) return undefined;
    const minimise = () => {
      doneRef.current = true;
      if (showsMapInfoRef.current) setPanelCollapsed(windowId, true);
      INTERACTION_EVENTS.forEach((name) => viewer.removeHandler(name, minimise));
    };
    INTERACTION_EVENTS.forEach((name) => viewer.addHandler(name, minimise));
    return () => INTERACTION_EVENTS.forEach((name) => viewer.removeHandler(name, minimise));
  }, [enabled, viewer, windowId]);
};
