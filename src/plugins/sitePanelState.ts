import { useSyncExternalStore } from 'react';

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
