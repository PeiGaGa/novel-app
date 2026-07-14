/// <reference types="vite/client" />

import type { NovelApi } from "./shared/types";

declare global {
  interface Window {
    novelAPI: NovelApi;
  }
}

export {};
