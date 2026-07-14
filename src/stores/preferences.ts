import { defineStore } from "pinia";
import type { ReaderSettings } from "@/shared/types";

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontSize: 20,
  lineHeight: 1.85,
  theme: "paper",
  voiceURI: "",
  rate: 1,
  pitch: 1,
  volume: 0.9,
  autoNext: true
};

export const usePreferencesStore = defineStore("preferences", {
  state: () => ({
    settings: { ...DEFAULT_READER_SETTINGS } as ReaderSettings,
    loading: false,
    saving: false,
    error: ""
  }),
  actions: {
    async load(): Promise<void> {
      this.loading = true;
      this.error = "";

      try {
        this.settings = {
          ...DEFAULT_READER_SETTINGS,
          ...(await window.novelAPI.getSettings())
        };
      } catch (error) {
        this.error = error instanceof Error ? error.message : "读取偏好设置失败。";
      } finally {
        this.loading = false;
      }
    },
    async save(patch: Partial<ReaderSettings>): Promise<void> {
      this.saving = true;
      this.error = "";
      const next = { ...this.settings, ...patch };

      try {
        this.settings = await window.novelAPI.saveSettings(next);
      } catch (error) {
        this.error = error instanceof Error ? error.message : "保存偏好设置失败。";
      } finally {
        this.saving = false;
      }
    }
  }
});
