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

// On a phone the panel is a bottom sheet with three heights (Figma 2843:43867 and its
// "Overview" variants): minimised to its header ("collapsed", as above), half, and full.
export type SheetSnap = 'collapsed' | 'half' | 'full';
export const SHEET_SNAPS: SheetSnap[] = ['collapsed', 'half', 'full'];

const fullByWindow = new Map<string, boolean>();

export const getSheetSnap = (windowId: string): SheetSnap => {
  if (collapsedByWindow.get(windowId) === true) return 'collapsed';
  return fullByWindow.get(windowId) === true ? 'full' : 'half';
};

export const setSheetSnap = (windowId: string, snap: SheetSnap) => {
  if (getSheetSnap(windowId) === snap) return;
  collapsedByWindow.set(windowId, snap === 'collapsed');
  // Minimising keeps the open height, so reopening goes back to it.
  if (snap !== 'collapsed') fullByWindow.set(windowId, snap === 'full');
  listeners.forEach((listener) => listener());
};

// Windows whose next panel opens minimised (a phone's "Discover the map", back after a close).
const openMinimised = new Set<string>();

/** Opens the window's next panel minimised rather than at its open height. */
export const openNextMinimised = (windowId: string) => {
  openMinimised.add(windowId);
};

/** True, once, when the window's panel was asked to open minimised. */
export const consumeOpenMinimised = (windowId: string): boolean => openMinimised.delete(windowId);

/** Back to the default height, for a panel opened afresh. */
export const resetSheet = (windowId: string) => {
  fullByWindow.delete(windowId);
  setPanelCollapsed(windowId, false);
  listeners.forEach((listener) => listener());
};

export const useSheetSnap = (windowId: string): SheetSnap =>
  useSyncExternalStore(
    subscribe,
    () => getSheetSnap(windowId),
    () => 'half'
  );

// The map tour's step, registered by the tour controller (mapInteractionPlugin.tsx) so the
// sheet can step it too: a horizontal swipe on the sheet turns to the next or previous POI.
const tourSteppers = new Map<string, (direction: 1 | -1) => void>();

export const registerTourStepper = (windowId: string, step: (direction: 1 | -1) => void) => {
  tourSteppers.set(windowId, step);
  return () => {
    if (tourSteppers.get(windowId) === step) tourSteppers.delete(windowId);
  };
};

export const stepTour = (windowId: string, direction: 1 | -1) => tourSteppers.get(windowId)?.(direction);

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

// A pin pressed from the keyboard moves focus into the panel it opens (T-37); a mouse click
// leaves focus where it is.
const panelFocusRequests = new Map<string, number>();

/**
 * Whether a key press happened inside the map `element` is part of (its Mirador window), so the
 * site preset's Escape handling leaves the rest of the host page - and any other map on it - alone.
 */
export const isInsideMap = (event: Event, element: Element | null | undefined): boolean => {
  const mapWindow = element?.closest('.mirador-window');
  return !!mapWindow && event.target instanceof Node && mapWindow.contains(event.target);
};

export const requestPanelFocus = (windowId: string) => {
  panelFocusRequests.set(windowId, (panelFocusRequests.get(windowId) ?? 0) + 1);
  listeners.forEach((listener) => listener());
};

/** Changes on every request, so a panel already showing the POI takes focus too. */
export const usePanelFocusRequest = (windowId: string): number =>
  useSyncExternalStore(
    subscribe,
    () => panelFocusRequests.get(windowId) ?? 0,
    () => 0
  );

const consumedRequests = new Map<string, number>();

/** True, once per request, when the panel should take focus. */
export const consumePanelFocus = (windowId: string): boolean => {
  const request = panelFocusRequests.get(windowId) ?? 0;
  if (request === 0 || consumedRequests.get(windowId) === request) return false;
  consumedRequests.set(windowId, request);
  return true;
};
