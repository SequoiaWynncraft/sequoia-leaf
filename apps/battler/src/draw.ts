/**
 * How everyone looks, as a grey-box: a plain shape, a colour and a simple face for each spirit and
 * each piece of trouble, and a small picture for each snack. Each is drawn facing right in a box
 * forty units across around the middle, standing on the ground at y = 20; whoever calls sets the
 * place, the size and the way it faces.
 */
import type { Kind, SnackKind } from "./cast.ts";

type G = CanvasRenderingContext2D;
export type Mood = "calm" | "hurt" | "out";
export const INK = "#1a0f1e";
const PALE = "#fff3cf";
const TAU = Math.PI * 2;

/** The colour each one is known by, on its picture and wherever it is named. */
export const HUE: Record<Kind, string> = {
  leafling: "#62a658",
  mossmote: "#4b8c4a",
  glorp: "#4aa3df",
  glorplet: "#4aa3df",
  slug: "#d9c24e",
  chickaree: "#a35d3b",
  worm: "#e58fa5",
  emberkit: "#f08a3c",
  rock: "#888788",
  moth: "#d8c7a0",
  owl: "#8fa3b8",
  greg: "#8e4bc0",
  fox: "#f3efe6",
  gnat: "#5a536b",
  bramble: "#3b7340",
  wasp: "#f0c93c",
  puddle: "#5b7fa6",
  toadstool: "#c8463c",
  gust: "#bfd3d9",
  magpie: "#34343f",
  crab: "#e2643c",
  mud: "#79553a",
  bigcrab: "#c23b3b",
};

function shape(g: G, fill: string, path: () => void): void {
  g.beginPath();
  path();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = 1.6;
  g.strokeStyle = INK;
  g.stroke();
}
const oval = (g: G, x: number, y: number, rx: number, ry: number, fill: string, turn = 0): void =>
  shape(g, fill, () => g.ellipse(x, y, rx, ry, turn, 0, TAU));
function poly(g: G, fill: string, pts: readonly number[]): void {
  shape(g, fill, () => {
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i] ?? 0, pts[i + 1] ?? 0);
    g.closePath();
  });
}
/** A line with a dark edge under it, so it reads on any ground. */
function cord(g: G, colour: string, width: number, path: () => void): void {
  g.lineCap = "round";
  g.lineJoin = "round";
  for (const [w, c] of [
    [width + 2.4, INK],
    [width, colour],
  ] as const) {
    g.beginPath();
    path();
    g.lineWidth = w;
    g.strokeStyle = c;
    g.stroke();
  }
}
function dot(g: G, x: number, y: number, r: number, fill: string): void {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = fill;
  g.fill();
}

type Eyes = "dot" | "sleep" | "big" | "cross" | "far";
/** Two eyes, which say how it is doing: wincing when hurt, crossed out when off. */
function face(g: G, x: number, y: number, gap: number, mood: Mood, eyes: Eyes = "dot", ink = INK): void {
  g.lineWidth = 1.5;
  g.lineCap = "round";
  g.strokeStyle = ink;
  for (const s of [-1, 1]) {
    const ex = x + s * gap;
    if (mood === "out") {
      g.beginPath();
      g.moveTo(ex - 2, y - 2);
      g.lineTo(ex + 2, y + 2);
      g.moveTo(ex + 2, y - 2);
      g.lineTo(ex - 2, y + 2);
      g.stroke();
    } else if (mood === "hurt") {
      g.beginPath();
      g.moveTo(ex - s * 2.2, y - 2.2);
      g.lineTo(ex + s * 1.4, y);
      g.lineTo(ex - s * 2.2, y + 2.2);
      g.stroke();
    } else if (eyes === "sleep") {
      g.beginPath();
      g.arc(ex, y - 0.5, 2.2, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
    } else if (eyes === "big") {
      dot(g, ex, y, 5.2, INK);
      dot(g, ex, y, 4.2, "#fdfbf2");
      dot(g, ex + 0.8, y, 2.2, INK);
    } else {
      dot(g, ex + 0.5, y, eyes === "far" ? 1.4 : 1.9, ink);
      if (eyes === "cross") {
        g.beginPath();
        g.moveTo(ex - s * 3.4, y - 4.6);
        g.lineTo(ex + s * 1.6, y - 2.8);
        g.stroke();
      }
    }
  }
}
function mouth(g: G, x: number, y: number, w: number, kind: "smile" | "flat" | "frown", ink = INK): void {
  g.lineWidth = 1.4;
  g.strokeStyle = ink;
  g.beginPath();
  if (kind === "flat") {
    g.moveTo(x - w, y);
    g.lineTo(x + w, y);
  } else if (kind === "smile") g.arc(x, y - w, w * 1.4, 0.25 * Math.PI, 0.75 * Math.PI);
  else g.arc(x, y + w * 1.4, w * 1.4, 1.25 * Math.PI, 1.75 * Math.PI);
  g.stroke();
}
function crab(g: G, mood: Mood, fill: string, tag: string, flip: number, cross: boolean): void {
  g.lineCap = "round";
  for (const s of [-1, 1]) {
    cord(g, fill, 1.6, () => {
      for (const k of [0, 1, 2]) {
        g.moveTo(s * (8 + k * 2.5), 13 + k);
        g.lineTo(s * (13 + k * 2.5), 19);
      }
    });
    cord(g, fill, 2.4, () => {
      g.moveTo(s * 11, 7);
      g.lineTo(s * 15, 0);
    });
    oval(g, s * 15.5, -3, 5, 4.2, fill, s * 0.5);
    g.beginPath();
    g.moveTo(s * 15.5, -3);
    g.lineTo(s * 19.5, -6.5);
    g.lineWidth = 1.4;
    g.strokeStyle = INK;
    g.stroke();
    cord(g, fill, 1.6, () => {
      g.moveTo(s * 4.5, 3);
      g.lineTo(s * 4.5, -3);
    });
  }
  oval(g, 0, 10, 14, 8.5, fill);
  for (const s of [-1, 1]) {
    dot(g, s * 4.5, -4, 3.2, INK);
    dot(g, s * 4.5, -4, 2.3, "#fdfbf2");
  }
  face(g, 0, -4, 4.5, mood, cross ? "cross" : "far");
  if (tag) {
    g.save();
    g.scale(flip, 1);
    g.fillStyle = PALE;
    g.font = "700 8px ui-monospace, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(tag, 0, 11);
    g.restore();
  }
}

/** Draws one of the cast around the middle of its forty-unit box. `flip` is -1 when the caller has mirrored it. */
export function sketch(g: G, kind: Kind, mood: Mood, tag = "", flip = 1): void {
  g.lineJoin = "round";
  switch (kind) {
    case "leafling":
      cord(g, "#3b7340", 1.6, () => {
        g.moveTo(0, -6);
        g.lineTo(0, -13);
      });
      oval(g, -5.5, -14, 6, 3, "#8bd06a", 0.5);
      oval(g, 5.5, -15, 6, 3, "#8bd06a", -0.5);
      oval(g, 0, 7, 13, 13, HUE.leafling);
      face(g, 1, 5, 5, mood);
      if (mood === "calm") {
        g.beginPath();
        g.moveTo(3, -1.5);
        g.lineTo(9, -0.5);
        g.stroke();
      }
      mouth(g, 1, 12, 2.6, "flat");
      break;
    case "mossmote":
      cord(g, "#62a658", 1.6, () => {
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU + 0.2;
          g.moveTo(Math.cos(a) * 12, 6 + Math.sin(a) * 12);
          g.lineTo(Math.cos(a) * 16.5, 6 + Math.sin(a) * 16.5);
        }
      });
      oval(g, 0, 6, 13.5, 13.5, HUE.mossmote);
      dot(g, -5, 0, 2.6, "#62a658");
      dot(g, 6, 11, 2.2, "#62a658");
      face(g, 1, 5, 5, mood);
      mouth(g, 1, 10, 2.4, "smile");
      break;
    case "glorp":
    case "glorplet": {
      const s = kind === "glorp" ? 1 : 0.62;
      g.save();
      g.translate(0, 20 * (1 - s));
      g.scale(s, s);
      shape(g, HUE.glorp, () => {
        g.moveTo(-16, 19);
        g.bezierCurveTo(-19, 2, -10, -9, 0, -9);
        g.bezierCurveTo(10, -9, 19, 2, 16, 19);
        g.closePath();
      });
      oval(g, -7, -1, 3.4, 2.2, "#bfe3fa", -0.5);
      face(g, 1, 7, 5.5, mood);
      mouth(g, 1, 12, 3, "smile");
      g.restore();
      break;
    }
    case "slug":
      cord(g, HUE.slug, 1.8, () => {
        g.moveTo(7, 3);
        g.lineTo(6, -6);
        g.moveTo(12, 3);
        g.lineTo(14, -6);
      });
      dot(g, 6, -7, 2, INK);
      dot(g, 14, -7, 2, INK);
      shape(g, HUE.slug, () => {
        g.moveTo(-18, 19);
        g.bezierCurveTo(-14, 9, -2, 8, 3, 10);
        g.bezierCurveTo(3, -1, 17, -1, 17, 10);
        g.lineTo(17, 19);
        g.closePath();
      });
      face(g, 10, 9, 3.2, mood);
      mouth(g, 10.5, 14, 2, "smile");
      break;
    case "chickaree":
      cord(g, "#c9773f", 6.5, () => g.arc(-9, 2, 9, 0.5 * Math.PI, 1.9 * Math.PI));
      poly(g, HUE.chickaree, [-7, -2, -6, -10, -1, -5]);
      poly(g, HUE.chickaree, [4, -5, 9, -10, 10, -2]);
      oval(g, 2, 7, 12, 12.5, HUE.chickaree);
      oval(g, 3, 11, 6.5, 7.5, "#e8cfa6");
      face(g, 3, 3, 4.6, mood);
      dot(g, 3.5, 7, 1.3, INK);
      break;
    case "worm":
      cord(g, HUE.worm, 8, () => g.arc(-2, 16, 10, Math.PI, TAU));
      cord(g, "#c9738b", 1.2, () => {
        g.moveTo(-9, 6);
        g.lineTo(-7, 11);
        g.moveTo(-2, 3);
        g.lineTo(-2, 9);
      });
      oval(g, 9, 13, 7, 7, HUE.worm);
      face(g, 9.5, 11.5, 2.8, mood);
      mouth(g, 9.5, 16, 1.8, "smile");
      break;
    case "emberkit":
      poly(g, "#e67967", [-14, 20, -10, 9, -6, 16, -1, 7, 4, 16, 9, 8, 14, 20]);
      poly(g, "#ffd98a", [-7, 20, -3, 14, 1, 18, 5, 13, 8, 20]);
      poly(g, HUE.emberkit, [-11, -1, -9, -11, -2, -5]);
      poly(g, HUE.emberkit, [2, -5, 9, -11, 11, -1]);
      oval(g, 0, 4, 12, 11, HUE.emberkit);
      face(g, 0, 4, 5, mood, "sleep");
      mouth(g, 0, 8.5, 1.6, "smile");
      if (mood === "calm") {
        g.save();
        g.scale(flip, 1);
        g.fillStyle = PALE;
        g.font = "700 7px ui-monospace, monospace";
        g.textAlign = "center";
        g.fillText("z", flip * 14, -10);
        g.restore();
      }
      break;
    case "rock":
      poly(g, HUE.rock, [-15, 19, -17, 4, -8, -9, 7, -11, 16, 0, 15, 19]);
      g.beginPath();
      g.moveTo(-8, -9);
      g.lineTo(7, -11);
      g.lineTo(3, -2);
      g.lineTo(-10, 1);
      g.closePath();
      g.fillStyle = "#a6a6a6";
      g.fill();
      face(g, 0, 8, 6.5, mood === "out" ? "out" : "calm", "far");
      break;
    case "moth":
      cord(g, "#8f7f60", 1.2, () => {
        g.moveTo(-2, -5);
        g.quadraticCurveTo(-4, -12, -8, -13);
        g.moveTo(2, -5);
        g.quadraticCurveTo(4, -12, 8, -13);
      });
      poly(g, "#b9a783", [-3, 0, -18, -8, -16, 9, -4, 12]);
      poly(g, "#b9a783", [3, 0, 18, -8, 16, 9, 4, 12]);
      dot(g, -12, 1, 2.4, "#8f7f60");
      dot(g, 12, 1, 2.4, "#8f7f60");
      oval(g, 0, 6, 6.5, 12, HUE.moth);
      face(g, 0.5, 2, 2.8, mood);
      break;
    case "owl":
      poly(g, HUE.owl, [-12, -3, -11, -13, -4, -8]);
      poly(g, HUE.owl, [4, -8, 11, -13, 12, -3]);
      oval(g, 0, 5, 14, 14.5, HUE.owl);
      oval(g, 0, 11, 8.5, 7.5, "#c5d2de");
      face(g, 0.5, 1, 6, mood, "big");
      poly(g, "#f5b95e", [0.5, 4, -2, 7.5, 3, 7.5]);
      break;
    case "greg":
      oval(g, 0, 5, 17, 14.5, HUE.greg);
      face(g, 0.5, -2, 6, mood);
      oval(g, 0.5, 9.5, 9.5, 6, "#2a1733");
      g.fillStyle = "#fdfbf2";
      g.fillRect(-4, 4.4, 3, 3);
      g.fillRect(2, 4.4, 3, 3);
      dot(g, 1, 12.5, 3.4, "#e67fb0");
      break;
    case "fox":
      for (const s of [-1, 1])
        cord(g, "#f5b95e", 1.7, () => {
          g.moveTo(s * 4, -4);
          g.lineTo(s * 7, -17);
          g.moveTo(s * 5.4, -10);
          g.lineTo(s * 12, -14);
          g.moveTo(s * 6.3, -14);
          g.lineTo(s * 2.5, -18);
        });
      poly(g, HUE.fox, [-12, 2, -11, -9, -3, -4]);
      poly(g, HUE.fox, [3, -4, 11, -9, 12, 2]);
      oval(g, 0, 7, 12.5, 12, HUE.fox);
      face(g, 0.5, 5, 5, mood);
      oval(g, 0.5, 12, 4, 3, "#ffffff");
      dot(g, 0.5, 10.8, 1.5, INK);
      break;
    case "gnat":
      oval(g, -5, 0, 6, 3, "#cfd8e6", 0.6);
      oval(g, 5, 0, 6, 3, "#cfd8e6", -0.6);
      oval(g, 0, 8, 7, 7, HUE.gnat);
      face(g, 0.5, 7, 2.8, mood, "cross", PALE);
      break;
    case "bramble":
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU - 1.2;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        poly(g, "#2f5c34", [
          c * 9 - s * 3.5,
          7 + s * 9 + c * 3.5,
          c * 17,
          7 + s * 17,
          c * 9 + s * 3.5,
          7 + s * 9 - c * 3.5,
        ]);
      }
      oval(g, 0, 7, 11, 11, HUE.bramble);
      face(g, 0.5, 6, 4.4, mood, "cross", PALE);
      mouth(g, 0.5, 11, 2.2, "frown", PALE);
      break;
    case "wasp":
      oval(g, -3, -3, 7, 3.5, "#e9eef5", 0.5);
      oval(g, 4, -4, 7, 3.5, "#e9eef5", -0.4);
      poly(g, INK, [-12, 5, -20, 8, -12, 10]);
      oval(g, 0, 7, 13, 8.5, HUE.wasp);
      g.save();
      g.beginPath();
      g.ellipse(0, 7, 12.4, 7.9, 0, 0, TAU);
      g.clip();
      g.fillStyle = INK;
      g.fillRect(-9, -3, 4, 20);
      g.fillRect(-2, -3, 4, 20);
      g.restore();
      face(g, 8, 6, 2.6, mood, "cross");
      break;
    case "puddle":
      oval(g, 0, 14, 18, 6, HUE.puddle);
      cord(g, "#9dbbd9", 1.1, () => g.ellipse(-2, 15, 9, 2.2, 0, 0.1 * Math.PI, 0.9 * Math.PI));
      for (const s of [-1, 1]) {
        dot(g, s * 5 + 1, 9, 4.3, INK);
        dot(g, s * 5 + 1, 9, 3.4, "#fdfbf2");
      }
      face(g, 1, 9, 5, mood, "far");
      break;
    case "toadstool":
      shape(g, "#f0e6d2", () => g.roundRect(-6.5, 3, 13, 16, 3));
      shape(g, HUE.toadstool, () => {
        g.ellipse(0, 5, 17, 15, 0, Math.PI, TAU);
        g.closePath();
      });
      dot(g, -8, -2, 2.6, "#fdfbf2");
      dot(g, 2, -6, 3, "#fdfbf2");
      dot(g, 10, -1, 2, "#fdfbf2");
      face(g, 0.5, 10, 3, mood, "cross");
      mouth(g, 0.5, 14.5, 1.8, "frown");
      break;
    case "gust":
      cord(g, HUE.gust, 3.6, () => {
        g.arc(1, 5, 13, 0.3 * Math.PI, 1.95 * Math.PI);
        g.moveTo(-17, 14);
        g.lineTo(-8, 16);
        g.moveTo(-19, 8);
        g.lineTo(-14, 9);
      });
      cord(g, HUE.gust, 3, () => g.arc(1, 6, 6.5, 0.9 * Math.PI, 2.4 * Math.PI));
      face(g, 2, 5, 3, mood, "cross");
      break;
    case "magpie":
      poly(g, "#3d6f9e", [-9, 8, -21, 3, -19, 13]);
      oval(g, 0, 7, 12, 12, HUE.magpie);
      oval(g, 2, 12, 7.5, 6.5, "#f3efe6");
      poly(g, "#f5b95e", [10, 2, 18, 5, 10, 8]);
      face(g, 4, 1, 3.6, mood, "cross", PALE);
      break;
    case "crab":
      crab(g, mood, HUE.crab, tag, flip, false);
      break;
    case "bigcrab":
      g.save();
      g.translate(0, -6);
      g.scale(1.3, 1.3);
      crab(g, mood, HUE.bigcrab, tag, flip, true);
      g.restore();
      break;
    case "mud":
      shape(g, HUE.mud, () => {
        g.moveTo(-18, 19);
        g.bezierCurveTo(-19, 6, -12, -3, -6, -2);
        g.bezierCurveTo(-2, -9, 8, -8, 9, -1);
        g.bezierCurveTo(16, 0, 19, 9, 18, 19);
        g.closePath();
      });
      dot(g, -9, 3, 2, "#966c4a");
      dot(g, 10, 12, 2.4, "#966c4a");
      face(g, 0.5, 7, 5.5, mood, "cross", PALE);
      mouth(g, 0.5, 12, 2.6, "frown", PALE);
      break;
  }
}

/** A snack, in a box about twenty-four units across around the middle. */
export function nibble(g: G, kind: SnackKind): void {
  g.lineJoin = "round";
  switch (kind) {
    case "berry":
      oval(g, -3, 3, 6, 6, "#7a348a");
      oval(g, 4, 1, 5, 5, "#b84d84");
      oval(g, 1, -6, 5, 2.4, "#62a658", -0.5);
      break;
    case "peppernut":
      oval(g, 0, 1, 9, 7, "#8a4a30");
      dot(g, -3, -1, 1.6, "#e67967");
      dot(g, 3, 2, 1.6, "#e67967");
      dot(g, 1, -3, 1.2, "#e67967");
      break;
    case "honeycake":
      shape(g, "#d49045", () => g.roundRect(-10, -2, 20, 10, 2));
      shape(g, "#ffd98a", () => g.roundRect(-10, -6, 20, 6, 3));
      break;
    case "marshmallow":
      cord(g, "#966c4a", 1.6, () => {
        g.moveTo(-11, 10);
        g.lineTo(2, -2);
      });
      shape(g, "#fdfbf2", () => g.roundRect(-3, -10, 12, 12, 3.5));
      break;
    case "stew":
      cord(g, PALE, 1.2, () => {
        g.moveTo(-4, -4);
        g.quadraticCurveTo(-7, -8, -4, -11);
        g.moveTo(4, -4);
        g.quadraticCurveTo(1, -8, 4, -11);
      });
      shape(g, "#a35d3b", () => {
        g.arc(0, 0, 11, 0, Math.PI);
        g.closePath();
      });
      oval(g, 0, 0, 11, 3, "#79553a");
      break;
  }
}

/** An acorn, about ten units tall around the middle. */
export function acorn(g: G): void {
  oval(g, 0, 1.5, 3.6, 4.4, "#d49045");
  shape(g, "#79553a", () => {
    g.ellipse(0, -1, 4.4, 3, 0, Math.PI, TAU);
    g.closePath();
  });
}
