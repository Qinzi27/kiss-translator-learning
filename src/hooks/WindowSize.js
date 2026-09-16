import { useState, useLayoutEffect, useCallback } from "react";
import { useDebouncedCallback } from "./DebouncedCallback";

export function readWindowSize() {
  const usable = (value) => Number.isFinite(value) && value > 0;
  // At document_start the root may not have a layout box yet. The layout
  // viewport is already available without waiting for a delayed effect.
  const size = (client, inner) =>
    usable(client) ? client : usable(inner) ? inner : 0;
  return {
    w: size(document.documentElement?.clientWidth, window.innerWidth),
    h: size(document.documentElement?.clientHeight, window.innerHeight),
  };
}

/**
 * 视口大小（宽/高）变化监听的自定义 Hook，内置了防抖功能以提升缩放性能
 * @returns {object} { w: number, h: number }
 */
function useWindowSize() {
  // 维护视口大小的局部 React 状态
  const [windowSize, setWindowSize] = useState(readWindowSize);

  const updateWindowSize = useCallback(() => {
    const next = readWindowSize();
    setWindowSize((previous) =>
      previous.w === next.w && previous.h === next.h ? previous : next
    );
  }, []);

  // 定义带去抖（200ms）的窗口大小变更处理函数，避免频繁触发重排与重绘
  const debounceWindowResize = useDebouncedCallback(updateWindowSize, 200);

  // 绑定与解绑 resize 事件监听器
  useLayoutEffect(() => {
    updateWindowSize(); // Catch a render-to-commit resize before the first paint.

    window.addEventListener("resize", debounceWindowResize);
    return () => {
      window.removeEventListener("resize", debounceWindowResize);
    };
  }, [debounceWindowResize, updateWindowSize]);

  return windowSize;
}

export default useWindowSize;
