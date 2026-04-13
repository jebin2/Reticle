import { useEffect } from "react";
import { type AnnotateTool } from "./annotationTypes";

interface CanvasActions {
  fitImage: () => void;
  zoomIn:   () => void;
  zoomOut:  () => void;
}

export function useAnnotationKeys(
  imageCount: number,
  setTool: (t: AnnotateTool) => void,
  navigate: (delta: number) => void,
  canvas: React.RefObject<CanvasActions | null>,
) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowLeft")            navigate(-1);
      if (e.key === "ArrowRight")           navigate(1);
      if (e.key === "h" || e.key === "H")   setTool("hand");
      if (e.key === "b" || e.key === "B")   setTool("box");
      if (e.key === "p" || e.key === "P")   setTool("polygon");
      if (e.key === "f" || e.key === "F")   canvas.current?.fitImage();
      if (e.key === "+" || e.key === "=")   canvas.current?.zoomIn();
      if (e.key === "-")                    canvas.current?.zoomOut();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageCount]);
}
