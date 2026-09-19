
declare global {
  interface Window {
    /** Set as soon as the app's module runs; index.html uses it to detect a stale or blocked script. */
    __mapStarted?: boolean;
  }
}
export {};
