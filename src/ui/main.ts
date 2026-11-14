/**
 * Browser application: owns the world, the frame loop and every panel.
 *
 * The simulation runs on the main thread inside a time budget per frame,
 * so the page stays responsive at any speed setting. All text that comes
 * from the simulation is inserted with `textContent`.
 */

import { CONFIG_BOUNDS, PRESETS, presetConfig, type WorldConfig } from "../core/config.js";
import type { Creature } from "../sim/creature.js";
import type { ChronicleEntry } from "../sim/history.js";
import { loadWorld, saveWorld } from "../sim/serialize.js";
import type { Species } from "../sim/species.js";
import { EVENT_INFO, World, type EventKind } from "../sim/world.js";
import { Camera } from "./camera.js";
import {
  brainDiagram,
  lineChart,
  phylogeny,
  speciesColor,
  speciesStream,
  stackedArea,
  type TreeHit,
} from "./charts.js";
import { Renderer, type ColorMode, type ViewOptions } from "./renderer.js";

type Tool = "inspect" | "feed" | "meteor";

const SPEEDS = [
  { label: "1×", steps: 1 },
  { label: "2×", steps: 2 },
  { label: "5×", steps: 5 },
  { label: "20×", steps: 20 },
  { label: "max", steps: Infinity },
] as const;

const LIVE_SETTINGS: { key: keyof WorldConfig; label: string; step: number; max?: number }[] = [
  { key: "plantGrowth", label: "Plant growth", step: 0.1, max: 12 },
  { key: "mutationScale", label: "Mutation strength", step: 0.1, max: 5 },
  { key: "seasonStrength", label: "Season strength", step: 0.05 },
  { key: "metabolism", label: "Metabolic cost", step: 0.05, max: 3 },
  { key: "sexualReproduction", label: "Sexual reproduction", step: 0.05 },
];

const WORDS = [
  "amber",
  "basalt",
  "cinder",
  "delta",
  "ember",
  "fjord",
  "glacier",
  "harbor",
  "iris",
  "juniper",
  "kelp",
  "lumen",
  "moss",
  "nebula",
  "onyx",
  "pollen",
  "quartz",
  "reef",
  "spore",
  "tundra",
  "umbra",
  "violet",
  "willow",
  "zenith",
];

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

const fmt = (n: number): string => Math.round(n).toLocaleString("en-US");

function randomSeed(): string {
  const pick = (): string => WORDS[Math.floor(Math.random() * WORDS.length)] ?? "spore";
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 900 + 100)}`;
}

class App {
  private world!: World;
  private camera!: Camera;
  private readonly renderer: Renderer;
  private readonly canvas = $<HTMLCanvasElement>("world");
  private readonly view: ViewOptions = {
    colorMode: "genome",
    halos: true,
    vision: true,
    highlightSpecies: null,
    selectedId: null,
  };
  private running = true;
  private speed = 1;
  private follow = false;
  private tool: Tool = "inspect";
  private preset = "balanced";
  private tab = "overview";
  private lastChronicleTick = 0;
  private treeHits: TreeHit[] = [];
  private frame = 0;
  private tps = 0;
  private tpsTicks = 0;
  private tpsTime = performance.now();
  private toastTimer = 0;

  constructor() {
    this.renderer = new Renderer(this.canvas);
    this.buildStaticUi();
    const params = new URLSearchParams(location.hash.slice(1));
    const preset = params.get("preset");
    if (preset && PRESETS.some((p) => p.id === preset)) this.preset = preset;
    this.newWorld(params.get("seed") || randomSeed(), this.preset);
    this.bindEvents();
    window.addEventListener("resize", () => this.resize());
    const warp = Math.min(500_000, Math.max(0, Math.floor(Number(params.get("warp")) || 0)));
    if (warp > 0) this.warp(warp);
    else requestAnimationFrame(() => this.loop());
  }

  /** Fast-forward `ticks` before the first frame (`#seed=…&warp=20000`), in slices so the page stays alive. */
  private warp(ticks: number): void {
    let done = 0;
    const slice = (): void => {
      const start = performance.now();
      while (done < ticks && performance.now() - start < 40) {
        this.world.step();
        done++;
      }
      this.toast("warp", `Fast-forwarding: tick ${fmt(done)} of ${fmt(ticks)}`);
      this.refreshReadout();
      if (done < ticks) setTimeout(slice, 0);
      else {
        this.lastChronicleTick = this.world.tick;
        this.renderChronicle(true);
        this.toast("warp", `Arrived at tick ${fmt(ticks)}.`);
        document.body.dataset["ready"] = "1";
        requestAnimationFrame(() => this.loop());
      }
    };
    slice();
  }

  // ------------------------------------------------------------- worlds
  private newWorld(seed: string, preset: string): void {
    this.preset = preset;
    this.setWorld(new World(seed, presetConfig(preset)));
    history.replaceState(null, "", `#seed=${encodeURIComponent(seed)}&preset=${encodeURIComponent(preset)}`);
    this.toast("genesis", `World "${seed}" created.`);
  }

  private setWorld(world: World): void {
    this.world = world;
    this.camera = new Camera(world.config.width, world.config.height);
    this.view.selectedId = null;
    this.view.highlightSpecies = null;
    this.follow = false;
    this.lastChronicleTick = world.tick;
    this.resize();
    this.camera.fit();
    $<HTMLInputElement>("seed").value = world.seed;
    $<HTMLSelectElement>("preset").value = this.preset;
    this.buildSliders();
    this.renderChronicle(true);
    this.refreshPanels(true);
  }

  private resize(): void {
    const { width, height } = this.renderer.resize();
    this.camera.resize(width, height);
  }

  // ---------------------------------------------------------------- loop
  private loop(): void {
    const start = performance.now();
    if (this.running) {
      const budget = this.speed === Infinity ? 13 : 10;
      const target = this.speed === Infinity ? 100000 : this.speed;
      let done = 0;
      while (done < target && (done === 0 || performance.now() - start < budget)) {
        this.world.step();
        done++;
      }
      this.tpsTicks += done;
    }
    const selected = this.selected;
    if (this.view.selectedId !== null && !selected) {
      this.select(null);
      this.toast("event", "The creature you were watching has died.");
    }
    if (this.follow && selected) this.camera.follow(selected.x, selected.y);
    this.renderer.draw(this.world, this.camera, this.view);

    this.frame++;
    const now = performance.now();
    if (now - this.tpsTime > 500) {
      this.tps = (this.tpsTicks * 1000) / (now - this.tpsTime);
      this.tpsTicks = 0;
      this.tpsTime = now;
    }
    if (this.frame % 6 === 0) this.refreshReadout();
    if (this.frame % 20 === 0) this.refreshPanels(false);
    if (this.frame % 4 === 0 && this.tab === "inspect" && selected) this.refreshInspector(selected, false);
    this.announce();
    requestAnimationFrame(() => this.loop());
  }

  private get selected(): Creature | undefined {
    return this.view.selectedId === null ? undefined : this.world.findCreature(this.view.selectedId);
  }

  // ------------------------------------------------------------ static UI
  private buildStaticUi(): void {
    const speeds = $("speeds");
    SPEEDS.forEach((s, i) => {
      const b = el("button", i === 0 ? "on" : "", s.label);
      b.type = "button";
      b.title = `Speed ${s.label} (${i + 1})`;
      b.addEventListener("click", () => this.setSpeed(i));
      speeds.append(b);
    });
    const preset = $<HTMLSelectElement>("preset");
    for (const p of PRESETS) {
      const o = el("option", undefined, p.name);
      o.value = p.id;
      preset.append(o);
    }
    preset.addEventListener("change", () => this.updatePresetHint());
    this.updatePresetHint();

    const events = $("events");
    for (const kind of Object.keys(EVENT_INFO) as EventKind[]) {
      const info = EVENT_INFO[kind];
      const b = el("button", "btn", info.label);
      b.type = "button";
      b.append(el("small", undefined, info.description));
      b.addEventListener("click", () => this.toast("event", this.world.trigger(kind)));
      events.append(b);
    }
    const tools = $("tools");
    for (const [id, label] of [
      ["inspect", "Inspect"],
      ["feed", "Feed"],
      ["meteor", "Meteor"],
    ] as [Tool, string][]) {
      const b = el("button", id === "inspect" ? "on" : "", label);
      b.type = "button";
      b.dataset["tool"] = id;
      b.addEventListener("click", () => this.setTool(id));
      tools.append(b);
    }
    this.setPlayIcon();
  }

  private updatePresetHint(): void {
    const id = $<HTMLSelectElement>("preset").value;
    $("preset-hint").textContent = PRESETS.find((p) => p.id === id)?.description ?? "";
  }

  private buildSliders(): void {
    const box = $("sliders");
    box.replaceChildren();
    for (const s of LIVE_SETTINGS) {
      const bound = CONFIG_BOUNDS[s.key];
      const wrap = el("div", "slider");
      const label = el("label");
      const value = el("b", undefined, String(this.world.config[s.key]));
      label.append(el("span", undefined, s.label), value);
      const input = el("input");
      input.type = "range";
      input.min = String(bound.min);
      input.max = String(s.max ?? bound.max);
      input.step = String(s.step);
      input.value = String(this.world.config[s.key]);
      input.setAttribute("aria-label", s.label);
      input.addEventListener("input", () => (value.textContent = input.value));
      input.addEventListener("change", () => {
        try {
          this.world.adjust(s.key, Number(input.value));
          this.world.chronicle.add({ tick: this.world.tick, kind: "event", text: `${s.label} set to ${input.value}.` });
        } catch (error) {
          this.toast("event", error instanceof Error ? error.message : "Invalid value");
          input.value = String(this.world.config[s.key]);
        }
      });
      wrap.append(label, input);
      box.append(wrap);
    }
  }

  // --------------------------------------------------------------- events
  private bindEvents(): void {
    $("play").addEventListener("click", () => this.togglePlay());
    $("fit").addEventListener("click", () => {
      this.follow = false;
      this.camera.fit();
    });
    $("share").addEventListener("click", () => void this.share());
    $("save").addEventListener("click", () => this.save());
    $("load").addEventListener("click", () => $<HTMLInputElement>("file").click());
    $<HTMLInputElement>("file").addEventListener("change", (e) => void this.load(e));
    $("reseed").addEventListener("click", () => ($<HTMLInputElement>("seed").value = randomSeed()));
    $("create").addEventListener("click", () => {
      const seed = $<HTMLInputElement>("seed").value.trim() || randomSeed();
      this.newWorld(seed, $<HTMLSelectElement>("preset").value);
    });
    $<HTMLSelectElement>("colormode").addEventListener("change", (e) => {
      this.view.colorMode = (e.target as HTMLSelectElement).value as ColorMode;
    });
    $<HTMLInputElement>("opt-halos").addEventListener(
      "change",
      (e) => (this.view.halos = (e.target as HTMLInputElement).checked),
    );
    $<HTMLInputElement>("opt-vision").addEventListener(
      "change",
      (e) => (this.view.vision = (e.target as HTMLInputElement).checked),
    );
    $("pick-random").addEventListener("click", () => this.pickRandom());
    $("i-follow").addEventListener("click", () => this.setFollow(!this.follow));
    $("i-species").addEventListener("click", () => {
      const c = this.selected;
      if (c) this.highlight(this.view.highlightSpecies === c.speciesId ? null : c.speciesId);
    });
    $("i-propagate").addEventListener("click", () => {
      const c = this.selected;
      if (c) this.toast("event", `${this.world.propagate(c, 8)} descendants spawned.`);
    });
    $("i-cull").addEventListener("click", () => {
      const c = this.selected;
      if (c) this.world.cull(c);
    });
    for (const b of $("tabs").querySelectorAll("button")) {
      b.addEventListener("click", () => this.setTab(b.dataset["tab"] ?? "overview"));
    }
    $<HTMLCanvasElement>("c-tree").addEventListener("click", (e) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = this.treeHits.find((h) => Math.abs(h.y - y) < 5 && x >= h.x0 - 3 && x <= h.x1 + 3);
      this.highlight(hit && this.view.highlightSpecies !== hit.speciesId ? hit.speciesId : null);
    });

    // pointer: drag to pan, click to use the current tool, wheel to zoom
    let drag: { x: number; y: number; moved: number } | null = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      drag = { x: e.clientX, y: e.clientY, moved: 0 };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4) {
        if (this.tool === "feed") {
          const p = this.pointerWorld(e);
          this.world.feed(p.x, p.y, 30, 3);
        } else {
          this.canvas.classList.add("dragging");
          this.follow = false;
          this.syncFollowButton();
          this.camera.pan(dx, dy);
        }
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    const end = (e: PointerEvent): void => {
      if (drag && drag.moved <= 4) this.click(e);
      drag = null;
      this.canvas.classList.remove("dragging");
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", () => {
      drag = null;
      this.canvas.classList.remove("dragging");
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        this.camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );

    window.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        this.togglePlay();
      } else if (e.key >= "1" && e.key <= "5") this.setSpeed(Number(e.key) - 1);
      else if (e.key === "0") this.camera.fit();
      else if (e.key.toLowerCase() === "f") this.setFollow(!this.follow);
      else if (e.key.toLowerCase() === "r") this.pickRandom();
      else if (e.key === "Escape") {
        this.select(null);
        this.highlight(null);
      }
    });
  }

  private pointerWorld(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  private click(e: PointerEvent): void {
    const p = this.pointerWorld(e);
    if (this.tool === "feed") this.world.feed(p.x, p.y, 45, 16);
    else if (this.tool === "meteor") {
      this.toast("event", this.world.trigger("meteor", p));
      this.setTool("inspect");
    } else {
      const c = this.world.creatureAt(p.x, p.y, 8 / this.camera.zoom);
      this.select(c?.id ?? null);
      if (c) this.setTab("inspect");
    }
  }

  // -------------------------------------------------------------- actions
  private togglePlay(): void {
    this.running = !this.running;
    this.setPlayIcon();
  }

  private setPlayIcon(): void {
    $("play").textContent = this.running ? "❚❚" : "▶";
  }

  private setSpeed(index: number): void {
    const s = SPEEDS[index];
    if (!s) return;
    this.speed = s.steps;
    [...$("speeds").children].forEach((b, i) => b.classList.toggle("on", i === index));
    if (!this.running) this.togglePlay();
  }

  private setTool(tool: Tool): void {
    this.tool = tool;
    for (const b of $("tools").querySelectorAll("button")) b.classList.toggle("on", b.dataset["tool"] === tool);
    this.canvas.classList.toggle("tool-feed", tool === "feed");
    this.canvas.classList.toggle("tool-meteor", tool === "meteor");
  }

  private setTab(tab: string): void {
    this.tab = tab;
    for (const b of $("tabs").querySelectorAll("button")) b.classList.toggle("on", b.dataset["tab"] === tab);
    for (const p of document.querySelectorAll<HTMLElement>(".panel"))
      p.classList.toggle("on", p.dataset["panel"] === tab);
    this.refreshPanels(true);
  }

  private select(id: number | null): void {
    this.view.selectedId = id;
    if (id === null) this.setFollow(false);
    const c = this.selected;
    $("inspect-empty").hidden = Boolean(c);
    $("inspect-body").hidden = !c;
    if (c) this.refreshInspector(c, true);
  }

  private setFollow(on: boolean): void {
    this.follow = on && this.selected !== undefined;
    if (this.follow && this.camera.zoom < 1.6) this.camera.zoom = 1.8;
    this.syncFollowButton();
  }

  private syncFollowButton(): void {
    $("i-follow").setAttribute("aria-pressed", String(this.follow));
  }

  private highlight(speciesId: number | null): void {
    this.view.highlightSpecies = speciesId;
    this.refreshPanels(true);
  }

  private pickRandom(): void {
    const list = this.world.creatures;
    if (list.length === 0) return;
    const c = list[Math.floor(Math.random() * list.length)];
    if (!c) return;
    this.select(c.id);
    this.setTab("inspect");
    this.setFollow(true);
  }

  private async share(): Promise<void> {
    const url = `${location.origin}${location.pathname}#seed=${encodeURIComponent(this.world.seed)}&preset=${encodeURIComponent(this.preset)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.toast("event", "Link copied. Anyone who opens it gets the same starting world.");
    } catch {
      this.toast("event", url);
    }
  }

  private save(): void {
    const blob = new Blob([JSON.stringify(saveWorld(this.world))], { type: "application/json" });
    const a = el("a");
    a.href = URL.createObjectURL(blob);
    a.download = `primordia-${this.world.seed}-t${this.world.tick}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.toast("event", `Saved at tick ${fmt(this.world.tick)}.`);
  }

  private async load(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      if (file.size > 200 * 1024 * 1024) throw new Error("file is too large");
      const world = loadWorld(JSON.parse(await file.text()));
      this.setWorld(world);
      this.toast("event", `Loaded world "${world.seed}" at tick ${fmt(world.tick)}.`);
    } catch (error) {
      this.toast("event", `Could not load: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  private toast(kind: string, text: string): void {
    const node = $("toast");
    node.replaceChildren(el("b", undefined, kind), document.createTextNode(text));
    node.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.classList.remove("show"), 5200);
  }

  /** Show new chronicle entries as toasts and append them to the chronicle panel. */
  private announce(): void {
    const fresh = this.world.chronicle.since(this.lastChronicleTick);
    if (fresh.length === 0) return;
    this.lastChronicleTick = this.world.tick;
    const last = fresh[fresh.length - 1];
    if (last && last.kind !== "event") this.toast(last.kind, last.text);
    this.renderChronicle(false, fresh);
  }

  // --------------------------------------------------------------- panels
  private refreshReadout(): void {
    const w = this.world;
    const last = w.history.last;
    $("r-tick").textContent = fmt(w.tick);
    $("r-pop").textContent = fmt(w.creatures.length);
    $("r-species").textContent = String(w.species.living.filter((s) => s.established).length);
    $("r-gen").textContent = fmt(last?.maxGeneration ?? 0);
    $("r-tps").textContent = this.running ? `${fmt(this.tps)}/s` : "paused";
    const winter = w.winter;
    $("r-season").style.width = `${(1 - winter) * 100}%`;
    const rising = Math.sin((Math.PI * 2 * w.tick) / w.config.seasonLength) < 0;
    $("r-season-label").textContent =
      winter < 0.25 ? "summer" : winter > 0.75 ? "winter" : rising ? "spring" : "autumn";
  }

  private refreshPanels(force: boolean): void {
    if (this.tab === "overview") this.refreshOverview();
    else if (this.tab === "species") this.refreshSpecies();
    else if (this.tab === "inspect" && force) {
      const c = this.selected;
      $("inspect-empty").hidden = Boolean(c);
      $("inspect-body").hidden = !c;
      if (c) this.refreshInspector(c, true);
    }
  }

  private refreshOverview(): void {
    const s = this.world.history.samples;
    lineChart($<HTMLCanvasElement>("c-pop"), [
      { label: "creatures", color: "#c4b5fd", values: s.map((x) => x.population) },
      { label: "plants", color: "#2dd4bf", values: s.map((x) => x.plants) },
      { label: "meat", color: "#f59e0b", values: s.map((x) => x.meat) },
    ]);
    stackedArea(
      $<HTMLCanvasElement>("c-roles"),
      [
        { label: "herbivores", color: "#34d399", values: s.map((x) => x.herbivores) },
        { label: "omnivores", color: "#fbbf24", values: s.map((x) => x.omnivores) },
        { label: "carnivores", color: "#fb7185", values: s.map((x) => x.carnivores) },
      ],
      true,
    );
    lineChart(
      $<HTMLCanvasElement>("c-traits"),
      [
        { label: "size", color: "#c4b5fd", values: s.map((x) => x.avgSize / 10) },
        { label: "speed", color: "#7dd3fc", values: s.map((x) => x.avgSpeed / 3.3) },
        { label: "sense", color: "#f0abfc", values: s.map((x) => x.avgSense / 158) },
        { label: "diet", color: "#fb7185", values: s.map((x) => x.avgDiet) },
      ],
      { min: 0, max: 1 },
    );

    const list = this.world.creatures;
    const best = (score: (c: Creature) => number): Creature | undefined =>
      list.reduce<Creature | undefined>((a, c) => (!a || score(c) > score(a) ? c : a), undefined);
    const fame: [string, Creature | undefined, string][] = [];
    const eldest = best((c) => c.age);
    const parent = best((c) => c.stats.children);
    const hunter = best((c) => c.stats.kills);
    const voyager = best((c) => c.stats.distance);
    if (eldest) fame.push(["Eldest", eldest, `${fmt(eldest.age)} ticks old`]);
    if (parent && parent.stats.children > 0) fame.push(["Most offspring", parent, `${parent.stats.children} children`]);
    if (hunter && hunter.stats.kills > 0) fame.push(["Apex hunter", hunter, `${hunter.stats.kills} kills`]);
    if (voyager) fame.push(["Great voyager", voyager, `${fmt(voyager.stats.distance)} units travelled`]);
    $("fame").replaceChildren(
      ...fame.map(([title, c, detail]) => {
        const sp = this.world.species.get(c?.speciesId ?? -1);
        const b = el("button");
        b.type = "button";
        const dot = el("span", "dot");
        dot.style.color = dot.style.background = sp ? speciesColor(sp) : "#888";
        const text = el("span", undefined, title);
        text.append(el("small", undefined, `${sp?.name ?? "unknown"} · ${detail}`));
        b.append(dot, text, el("b", undefined, `#${c?.id ?? ""}`));
        b.addEventListener("click", () => {
          if (!c) return;
          this.select(c.id);
          this.setTab("inspect");
          this.setFollow(true);
        });
        return b;
      }),
    );
  }

  private refreshSpecies(): void {
    const w = this.world;
    const map = new Map(w.species.all.map((s) => [s.id, s]));
    speciesStream($<HTMLCanvasElement>("c-stream"), w.history.samples, map, this.view.highlightSpecies);
    this.treeHits = phylogeny($<HTMLCanvasElement>("c-tree"), w.species.all, w.tick, this.view.highlightSpecies);
    const living = w.species.living.sort((a, b) => b.population - a.population);
    const ever = w.species.all.filter((s) => s.established).length;
    $("sp-count").textContent = `${living.filter((s) => s.established).length} established · ${ever} ever`;
    $("species-list").replaceChildren(...living.slice(0, 40).map((s) => this.speciesRow(s)));
  }

  private speciesRow(s: Species): HTMLElement {
    const b = el("button", this.view.highlightSpecies === s.id ? "on" : "");
    b.type = "button";
    const dot = el("span", "dot");
    dot.style.color = dot.style.background = speciesColor(s);
    const role = s.diet > 0.65 ? "carnivore" : s.diet > 0.35 ? "omnivore" : "herbivore";
    const name = el("span");
    name.append(el("i", undefined, s.name), el("span", `role ${role}`, role));
    name.append(
      el(
        "small",
        undefined,
        `since tick ${fmt(s.bornTick)} · peak ${s.peakPopulation} · lineage depth ${this.world.species.ancestry(s.id).length}`,
      ),
    );
    b.append(dot, name, el("b", undefined, String(s.population)));
    b.addEventListener("click", () => this.highlight(this.view.highlightSpecies === s.id ? null : s.id));
    return b;
  }

  private refreshInspector(c: Creature, full: boolean): void {
    const w = this.world;
    const sp = w.species.get(c.speciesId);
    $("i-energy").style.width = `${c.energyFraction * 100}%`;
    $("i-energy-t").textContent = `${fmt(c.energy)} / ${fmt(c.maxEnergy)}`;
    $("i-age").style.width = `${Math.min(100, (c.age / c.lifespan) * 100)}%`;
    $("i-age-t").textContent = `${fmt(c.age)} / ${fmt(c.lifespan)} ticks`;
    brainDiagram($<HTMLCanvasElement>("c-brain"), c);
    const kv = (pairs: [string, string][]): HTMLElement[] =>
      pairs.flatMap(([k, v]) => [el("span", undefined, k), el("span", undefined, v)]);
    $("i-life").replaceChildren(
      ...kv([
        ["generation", String(c.generation)],
        ["children", String(c.stats.children)],
        ["plants eaten", fmt(c.stats.plantsEaten)],
        ["meat eaten", fmt(c.stats.meatEaten)],
        ["kills", String(c.stats.kills)],
        ["distance", fmt(c.stats.distance)],
        [
          "parent",
          c.parentId === null ? "none (primordial)" : `#${c.parentId}${c.mateId !== null ? ` × #${c.mateId}` : ""}`,
        ],
      ]),
    );
    if (!full) return;
    const t = c.traits;
    const dot = $("i-dot");
    dot.style.color = dot.style.background = `hsl(${t.hue}, 72%, 60%)`;
    $("i-name").textContent = sp?.name ?? "Unknown species";
    $("i-sub").textContent = `individual #${c.id} · ${c.role} · born at tick ${fmt(c.bornTick)}`;
    $("i-traits").replaceChildren(
      ...kv([
        ["body size", t.size.toFixed(2)],
        ["top speed", t.maxSpeed.toFixed(2)],
        ["agility", `${((t.agility * 180) / Math.PI).toFixed(1)}° / tick`],
        ["sight range", t.senseRange.toFixed(0)],
        ["field of view", `${((t.fieldOfView * 180) / Math.PI).toFixed(0)}°`],
        ["diet", `${(t.diet * 100).toFixed(0)}% meat`],
        ["mutation rate", `${(t.mutationRate * 100).toFixed(1)}%`],
        ["breeds above", `${(t.breedThreshold * 100).toFixed(0)}% energy`],
        ["gives offspring", `${(t.offspringShare * 100).toFixed(0)}% energy`],
      ]),
    );
    const lineage = $("i-lineage");
    lineage.replaceChildren();
    w.species.ancestry(c.speciesId).forEach((s, i) => {
      if (i > 0) lineage.append(el("span", "arrow", "→"));
      lineage.append(el("i", undefined, s.name));
    });
    $("i-species").textContent = this.view.highlightSpecies === c.speciesId ? "Clear highlight" : "Highlight species";
    this.syncFollowButton();
  }

  private renderChronicle(reset: boolean, fresh?: ChronicleEntry[]): void {
    const box = $("chronicle");
    if (reset) box.replaceChildren();
    const entries = reset ? this.world.chronicle.entries : (fresh ?? []);
    for (const e of entries) {
      const row = el("div", `entry ${e.kind}`);
      const time = el("time", undefined, fmt(e.tick));
      row.append(time, el("span", undefined, e.text));
      if (e.speciesId !== undefined) {
        const id = e.speciesId;
        row.classList.add("clickable");
        row.title = "Highlight this species";
        row.addEventListener("click", () => {
          this.highlight(this.view.highlightSpecies === id ? null : id);
          this.setTab("species");
        });
      }
      box.prepend(row);
    }
    while (box.children.length > 300) box.lastChild?.remove();
  }
}

new App();
