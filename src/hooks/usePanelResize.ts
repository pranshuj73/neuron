import { useCallback, useEffect, useRef } from "react";

interface Options {
  cssVar: string;
  defaultPx: number;
  minPx: number;
  maxPx: number;
  side: "left" | "right";
}

export function usePanelResize({ cssVar, defaultPx, minPx, maxPx, side }: Options) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(defaultPx);

  const setWidth = useCallback((px: number) => {
    const clamped = Math.min(maxPx, Math.max(minPx, px));
    document.documentElement.style.setProperty(cssVar, `${clamped}px`);
  }, [cssVar, minPx, maxPx]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    const current = getComputedStyle(document.documentElement)
      .getPropertyValue(cssVar)
      .trim();
    startW.current = parseInt(current) || defaultPx;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  }, [cssVar, defaultPx]);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const delta = side === "left"
        ? e.clientX - startX.current
        : startX.current - e.clientX;
      setWidth(startW.current + delta);
    }

    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [side, setWidth]);

  return { onMouseDown };
}
