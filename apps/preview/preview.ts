import { drawWorker, SPECS } from "../screen/avatar/drawWorker.ts";
import { makeFaceThumb } from "../screen/avatar/textures.ts";

const grid = document.getElementById("grid") as HTMLElement;

SPECS.forEach((s, i) => {
  const card = document.createElement("div");
  card.className = "card";

  const body = document.createElement("canvas");
  body.className = "body";
  body.width = 512;
  body.height = 768;
  drawWorker(body.getContext("2d")!, s);
  card.appendChild(body);

  const row = document.createElement("div");
  row.className = "row2";
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  thumb.style.backgroundImage = `url(${makeFaceThumb(i)})`;
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = `#${i} · ${s.pose}${s.cap !== "none" ? " · " + s.cap : ""}${s.glasses ? " · 眼镜" : ""}`;
  row.appendChild(thumb);
  row.appendChild(label);
  card.appendChild(row);

  grid.appendChild(card);
});

// transparent background toggle (checkerboard) to inspect cut-out edges
let checker = false;
(document.getElementById("bg") as HTMLElement).addEventListener("click", () => {
  checker = !checker;
  document.querySelectorAll<HTMLCanvasElement>("canvas.body").forEach((c) => c.classList.toggle("chk", checker));
});
