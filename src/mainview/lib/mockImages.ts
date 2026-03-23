import { type ImageEntry, type ClassDef } from "./annotationTypes";
import { CLASS_COLORS } from "./constants";

function svg(label: string, bg: string): string {
  const encoded = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
      <defs>
        <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="640" height="480" fill="${bg}"/>
      <rect width="640" height="480" fill="url(#g)"/>
      <text x="320" y="248" fill="rgba(255,255,255,0.15)" font-size="16"
        text-anchor="middle" font-family="sans-serif">${label}</text>
    </svg>`
  );
  return `data:image/svg+xml,${encoded}`;
}

export const MOCK_CLASSES: ClassDef[] = [
  { name: "CAR_SEDAN",   color: CLASS_COLORS[0] },
  { name: "TRAFFIC_CONE", color: CLASS_COLORS[1] },
  { name: "PEDESTRIAN",  color: CLASS_COLORS[2] },
  { name: "CYCLIST",     color: CLASS_COLORS[3] },
];

export const MOCK_IMAGES: ImageEntry[] = [
  {
    id: "1", filename: "IMG_0011.JPG",
    src: svg("IMG_0011.JPG", "#1a2535"),
    annotations: [
      { id: "a1", classIndex: 0, cx: 0.48, cy: 0.55, w: 0.30, h: 0.38 },
      { id: "a2", classIndex: 1, cx: 0.75, cy: 0.62, w: 0.08, h: 0.14 },
    ],
  },
  {
    id: "2", filename: "IMG_0012.JPG",
    src: svg("IMG_0012.JPG", "#1e1a2d"),
    annotations: [
      { id: "b1", classIndex: 2, cx: 0.30, cy: 0.45, w: 0.12, h: 0.25 },
    ],
  },
  {
    id: "3", filename: "IMG_0013.JPG",
    src: svg("IMG_0013.JPG", "#1a2d1e"),
    annotations: [],
  },
  {
    id: "4", filename: "IMG_0014.JPG",
    src: svg("IMG_0014.JPG", "#2d1a1a"),
    annotations: [],
  },
  {
    id: "5", filename: "IMG_0015.JPG",
    src: svg("IMG_0015.JPG", "#2d2a1a"),
    annotations: [
      { id: "e1", classIndex: 0, cx: 0.55, cy: 0.50, w: 0.35, h: 0.42 },
      { id: "e2", classIndex: 3, cx: 0.20, cy: 0.60, w: 0.12, h: 0.22 },
    ],
  },
];
