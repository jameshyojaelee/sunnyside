/// <reference types="vite/client" />

declare global {
  /** Changes every build; appended to the map data request so it is never served from a stale cache. */
  const __BUILD_ID__: string;

  interface Window {
    /** Set as soon as the app's module runs; index.html uses it to detect a stale or blocked script. */
    __mapStarted?: boolean;
    /** The startup step in progress, for the same reason. */
    __mapStage?: string;
  }
}
export {};
