import ShadowDomManager from "./shadowDomManager";
import { APP_CONSTS, DEFAULT_FAB, STOKEY_FAB } from "../config";
import ContentFab from "../views/Action/ContentFab";
import { browser } from "./browser";
import { isExt } from "./client";

/**
 * 网页内悬浮球（Float Action Button）管理器
 * 负责实例化并挂载 ContentFab 组件，它被包裹在隔离的 Shadow DOM 容器中以防止外部网页 CSS 样式对其产生干扰。
 */
export class FabManager extends ShadowDomManager {
  #removeConfigListener = null;
  #configStore;
  #publishConfig;
  /**
   * 构造函数
   * @param {object} params
   * @param {Function} params.processActions - 动作执行处理器
   * @param {object} params.fabConfig - 悬浮球的配置参数
   */
  constructor({
    processActions,
    fabConfig,
    getSelectionEnabled,
    translationProgress,
  }) {
    let config = Object.freeze({ ...DEFAULT_FAB, ...fabConfig });
    const listeners = new Set();
    const configStore = {
      getSnapshot: () => config,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    super({
      id: APP_CONSTS.fabID,
      className: "notranslate",
      reactComponent: ContentFab,
      props: {
        processActions,
        fabConfig,
        getSelectionEnabled,
        translationProgress,
        configStore,
      },
    });
    this.#configStore = configStore;
    this.#publishConfig = (patch) => {
      config = Object.freeze({ ...config, ...patch });
      listeners.forEach((listener) => listener());
    };
    if (isExt && browser?.storage?.onChanged) {
      const onChanged = (changes, area) => {
        if (
          area !== "local" ||
          !Object.prototype.hasOwnProperty.call(changes, STOKEY_FAB)
        )
          return;
        let next = changes[STOKEY_FAB]?.newValue;
        try {
          if (typeof next === "string") next = JSON.parse(next);
        } catch {
          return;
        }
        if (next != null && (typeof next !== "object" || Array.isArray(next)))
          return;
        config = Object.freeze({
          ...DEFAULT_FAB,
          ...next,
          translationLocked: config.translationLocked === true,
          translationLockError: config.translationLockError || "",
        });
        listeners.forEach((listener) => listener());
        config.isHide ? this.hide() : this.show();
      };
      browser.storage.onChanged.addListener(onChanged);
      this.#removeConfigListener = () => {
        browser.storage.onChanged.removeListener(onChanged);
        listeners.clear();
      };
    }

    // 如果配置没有指明隐藏，则在初始化时自动显示悬浮球
    if (!fabConfig?.isHide) {
      this.show();
    }
  }

  setTranslationLock(enabled, error = "") {
    this.#publishConfig({
      translationLocked: enabled === true,
      translationLockError: error,
    });
  }

  getConfig() {
    return { ...this.#configStore.getSnapshot() };
  }

  destroy() {
    this.#removeConfigListener?.();
    this.#removeConfigListener = null;
    super.destroy();
  }
}
