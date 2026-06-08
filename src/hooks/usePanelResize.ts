import { useCallback, useEffect, useRef } from "react";

interface Options {
  cssVar: string;
  defaultPx: number;
  minPx: number;
  maxPx: number;
  side: "left" | "right";
}

function readCssVar(cssVar: string, fallback: number): number {
  // Inline style set by us takes priority; otherwise walk stylesheets
  const inline = document.documentElement.style.getPropertyValue(cssVar).trim();
  if (inline) return parseInt(inline) || fallback;

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules ?? [])) {
        if (rule instanceof CSSStyleRule && rule.selectorText === ":root") {
          const v = rule.style.getPropertyValue(cssVar).trim();
          if (v) return parseInt(v) || fallback;
        }
      }
    } catch { /* cross-origin sheet */ }
  }
  return fallback;
}

export function usePanelResize({ cssVar, defaultPx, minPx, maxPx, side }: Options) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(defaultPx);

  const setWidth = useCallback((px: number) => {
    const clamped = Math.min(maxPx, Math.max(minPx, px));
    document.documentElement.style.setProperty(cssVar, `${clamped}px`);
  }, [cssVar, minPx, maxPx]);

  // Set initial width on mount
  useEffect(() => {
    setWidth(defaultPx);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = readCssVar(cssVar, defaultPx);
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
