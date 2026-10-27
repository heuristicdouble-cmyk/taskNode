const NS = "http://www.w3.org/2000/svg";
const STORAGE_KEY = "nodetask-v2";
const LEGACY_STORAGE_KEY = "nodetask-v1";
const $ = (selector) => document.querySelector(selector);
const svg = $("#canvas");
const scene = $("#scene");
const nodeLayer = $("#node-layer");
const edgeLayer = $("#edge-layer");
const wrap = $("#canvas-wrap");
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dateOffset = (days) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const makeNode = (title, x, y, days, status = "todo") => ({
  id: crypto.randomUUID(),
  title,
  description: "",
  status,
  priority: "medium",
  deadline: { mode: "manual", date: dateOffset(days) },
  progress: {
    mode: "manual",
    value: status === "done" ? 100 : status === "in-progress" ? 35 : 0,
  },
  position: { x, y },
});
function seed() {
  const a = makeNode("Webサイト制作", 0, 0, 12, "in-progress"),
    b = makeNode("要件定義", -210, -110, -4, "done"),
    c = makeNode("UIデザイン", -190, 120, 5, "in-progress"),
    d = makeNode("フロントエンド実装", 200, -90, 1, "in-progress"),
    e = makeNode("動作テスト", 220, 140, 8);
  a.progress = { mode: "auto", value: 0 };
  return {
    version: 1,
    nodes: [a, b, c, d, e],
    edges: [
      {
        id: crypto.randomUUID(),
        source: a.id,
        target: b.id,
        type: "parent-child",
      },
      {
        id: crypto.randomUUID(),
        source: a.id,
        target: c.id,
        type: "parent-child",
      },
      {
        id: crypto.randomUUID(),
        source: a.id,
        target: d.id,
        type: "parent-child",
      },
      {
        id: crypto.randomUUID(),
        source: a.id,
        target: e.id,
        type: "parent-child",
      },
      {
        id: crypto.randomUUID(),
        source: c.id,
        target: d.id,
        type: "dependency",
      },
      {
        id: crypto.randomUUID(),
        source: d.id,
        target: e.id,
        type: "dependency",
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
function validPage(p) {
  return (
    p &&
    Array.isArray(p.nodes) &&
    Array.isArray(p.edges) &&
    p.viewport &&
    Number.isFinite(p.viewport.zoom)
  );
}
function loadWorkspace() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      saved &&
      Array.isArray(saved.pages) &&
      saved.pages.length &&
      saved.pages.every(validPage)
    )
      return saved;
  } catch (e) {
    console.warn(e);
  }
  let first = seed();
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY));
    if (validPage(legacy)) first = legacy;
  } catch (e) {
    console.warn(e);
  }
  return {
    version: 2,
    activePageId: "page-1",
    pages: [{ ...first, id: "page-1", name: "マイタスク" }],
  };
}
const workspace = loadWorkspace();
function activePage() {
  return (
    workspace.pages.find((p) => p.id === workspace.activePageId) ||
    workspace.pages[0]
  );
}
function persistWorkspace() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    dirty = false;
  } catch (e) {
    console.warn("保存できませんでした", e);
  }
}
let data = activePage();
let selectedId = null,
  selectedEdge = null,
  connectMode = false,
  connectStart = null,
  searchTerm = "",
  view = "map";
const motion = new Map();
const elements = new Map();
const edgeElements = new Map();
let pointer = null,
  dirty = false,
  lastFrame = 0,
  lastSave = 0;
const previewLayer = $("#preview-layer");
let previewPath = null;
const nodeById = (id) => data.nodes.find((n) => n.id === id);
const childrenOf = (id) =>
  data.edges
    .filter((e) => e.type === "parent-child" && e.source === id)
    .map((e) => nodeById(e.target))
    .filter(Boolean);
const parentsOf = (id) =>
  data.edges
    .filter((e) => e.type === "parent-child" && e.target === id)
    .map((e) => e.source);
const prerequisites = (id) =>
  data.edges
    .filter((e) => e.type === "dependency" && e.target === id)
    .map((e) => nodeById(e.source))
    .filter(Boolean);
function save() {
  persistWorkspace();
}
function markDirty() {
  dirty = true;
  updateMetrics();
}
function daysRemaining(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (!Number.isFinite(d.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}
function deadlineOf(node, seen = new Set()) {
  if (!node || seen.has(node.id)) return null;
  if (node.deadline?.mode !== "auto") return node.deadline?.date || null;
  seen.add(node.id);
  const dates = childrenOf(node.id)
    .map((n) => deadlineOf(n, new Set(seen)))
    .filter(Boolean)
    .sort();
  return dates.at(-1) || null;
}
function progressOf(node, seen = new Set()) {
  if (!node || seen.has(node.id)) return 0;
  if (node.progress?.mode !== "auto")
    return clamp(Number(node.progress?.value) || 0, 0, 100);
  seen.add(node.id);
  const kids = childrenOf(node.id);
  if (!kids.length) return clamp(Number(node.progress?.value) || 0, 0, 100);
  return Math.round(
    kids.reduce(
      (sum, k) =>
        sum + (k.status === "done" ? 100 : progressOf(k, new Set(seen))),
      0,
    ) / kids.length,
  );
}
function styleFor(node) {
  if (node.status === "done")
    return { r: 28, fill: "#086a59", stroke: "#54d9ac", glow: "#30d3a0" };
  const days = daysRemaining(deadlineOf(node));
  if (days === null)
    return { r: 32, fill: "#274c80", stroke: "#81afea", glow: "#5b94dd" };
  const u = clamp((14 - days) / 14, 0, 1);
  const r = 30 + Math.pow(u, 3) * 130;
  const hue = 215 - u * 215;
  const saturation = 72 + u * 28;
  const lightness = 32 + u * 18;
  return {
    r,
    fill: `hsl(${hue} ${saturation}% ${lightness}%)`,
    stroke: `hsl(${hue} 100% 70%)`,
    glow: `hsl(${hue} 100% 55%)`,
  };
}
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs))
    el.setAttribute(key, String(value));
  return el;
}
function textLines(text, max = 13) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
function motionFor(n) {
  if (!motion.has(n.id)) motion.set(n.id, { dx: 0, dy: 0, vx: 0, vy: 0 });
  return motion.get(n.id);
}
function worldPos(n) {
  const m = motionFor(n);
  return { x: n.position.x + m.dx, y: n.position.y + m.dy };
}
function deleteSelectedEdge() {
  if (!selectedEdge) return;
  if (!confirm("選択した接続を削除しますか？")) return;
  data.edges = data.edges.filter((e) => e.id !== selectedEdge);
  selectedEdge = null;
  buildElements();
  markDirty();
  save();
  renderDashboard();
}
function selectEdge(id) {
  selectedEdge = id;
  selectedId = null;
  $("#inspector").classList.add("hidden");
  refreshSelection();
  $("#canvas-hint").textContent =
    "接続を選択中：Deleteキーで削除。ノード詳細からも削除できます";
}
function buildElements() {
  nodeLayer.replaceChildren();
  edgeLayer.replaceChildren();
  elements.clear();
  edgeElements.clear();
  for (const edge of data.edges) {
    const group = svgEl("g", { "data-edge": edge.id });
    const hit = svgEl("path", { class: "edge-hit", "data-edge": edge.id });
    const visible = svgEl("path", {
      class: `edge ${edge.type}`,
      "data-edge": edge.id,
    });
    group.append(visible, hit);
    hit.addEventListener("pointerdown", (event) => event.stopPropagation());
    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      if (selectedEdge === edge.id) deleteSelectedEdge();
      else selectEdge(edge.id);
    });
    edgeLayer.append(group);
    edgeElements.set(edge.id, { visible, hit });
  }
  for (const n of data.nodes) {
    const g = svgEl("g", { class: "node", "data-node": n.id });
    const halo = svgEl("circle", { class: "halo", opacity: ".16" }),
      core = svgEl("circle", { class: "core", "stroke-width": 2.4 }),
      label = svgEl("text", {
        "text-anchor": "middle",
        fill: "#f6f9ff",
        "font-size": 12,
        "font-weight": 650,
        "dominant-baseline": "middle",
      }),
      sub = svgEl("text", {
        "text-anchor": "middle",
        fill: "#dce9fa",
        "font-size": 10,
        "dominant-baseline": "middle",
      });
    g.append(halo, core, label, sub);
    g.addEventListener("pointerdown", (e) => onNodePointerDown(e, n.id));
    g.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    nodeLayer.append(g);
    elements.set(n.id, { g, halo, core, label, sub });
    motionFor(n);
  }
  for (const id of motion.keys()) if (!nodeById(id)) motion.delete(id);
  refreshSelection();
}
function refreshSelection() {
  for (const [id, edge] of edgeElements)
    edge.visible.classList.toggle("selected", id === selectedEdge);
  for (const [id, el] of elements)
    el.g.style.opacity =
      searchTerm && !nodeById(id).title.toLowerCase().includes(searchTerm)
        ? ".2"
        : "1";
}
function render() {
  scene.setAttribute(
    "transform",
    `translate(${data.viewport.x} ${data.viewport.y}) scale(${data.viewport.zoom})`,
  );
  for (const n of data.nodes) {
    const e = elements.get(n.id);
    if (!e) continue;
    const p = worldPos(n),
      s = styleFor(n),
      d = daysRemaining(deadlineOf(n));
    e.g.setAttribute("transform", `translate(${p.x} ${p.y})`);
    e.halo.setAttribute("r", s.r + 9);
    e.halo.setAttribute("fill", s.glow);
    e.core.setAttribute("r", s.r);
    e.core.setAttribute("fill", s.fill);
    e.core.setAttribute("stroke", n.id === selectedId ? "#ffffff" : s.stroke);
    e.label.setAttribute("y", -5);
    e.label.textContent = textLines(n.title, s.r < 33 ? 9 : 14);
    e.sub.setAttribute("y", 12);
    e.sub.textContent =
      n.status === "done"
        ? "✓ 完了"
        : d === null
          ? "期限なし"
          : d < 0
            ? `${Math.abs(d)}日超過`
            : d === 0
              ? "本日期限"
              : `あと${d}日`;
  }
  for (const edge of data.edges) {
    const edgeView = edgeElements.get(edge.id),
      a = nodeById(edge.source),
      b = nodeById(edge.target);
    if (!edgeView || !a || !b) continue;
    const from = worldPos(a),
      to = worldPos(b),
      dx = to.x - from.x,
      dy = to.y - from.y,
      len = Math.hypot(dx, dy) || 1;
    const ra = styleFor(a).r + 3,
      rb = styleFor(b).r + (edge.type === "dependency" ? 12 : 3);
    const x1 = from.x + (dx / len) * ra,
      y1 = from.y + (dy / len) * ra,
      x2 = to.x - (dx / len) * rb,
      y2 = to.y - (dy / len) * rb;
    edgeView.visible.setAttribute("d", `M${x1},${y1} L${x2},${y2}`);
    edgeView.hit.setAttribute("d", `M${x1},${y1} L${x2},${y2}`);
  }
  $("#zoom-label").textContent = `${Math.round(data.viewport.zoom * 100)}%`;
}
// Overlap-only magnetic repulsion: no random drift. Nodes settle when separated.
function frame(now) {
  const dt = Math.min((now - lastFrame) / 16.67 || 1, 2);
  lastFrame = now;
  const forces = new Map(data.nodes.map((n) => [n.id, { x: 0, y: 0 }]));
  let moving = false;
  for (let i = 0; i < data.nodes.length; i++)
    for (let j = i + 1; j < data.nodes.length; j++) {
      const a = data.nodes[i],
        b = data.nodes[j],
        pa = worldPos(a),
        pb = worldPos(b);
      let dx = pb.x - pa.x,
        dy = pb.y - pa.y,
        dist = Math.hypot(dx, dy);
      if (dist < 0.001) {
        dx = 1;
        dy = 0;
        dist = 1;
      }
      const minimum = styleFor(a).r + styleFor(b).r + 18;
      if (dist >= minimum) continue;
      const overlap = minimum - dist,
        force = Math.min(overlap * 0.035, 5);
      const fx = (dx / dist) * force,
        fy = (dy / dist) * force;
      // Dragged node stays under the pointer; the other node is pushed away.
      const dragA = pointer?.kind === "node" && pointer.id === a.id;
      const dragB = pointer?.kind === "node" && pointer.id === b.id;
      if (!dragA) {
        forces.get(a.id).x -= fx;
        forces.get(a.id).y -= fy;
      }
      if (!dragB) {
        forces.get(b.id).x += fx;
        forces.get(b.id).y += fy;
      }
    }
  for (const n of data.nodes) {
    const m = motionFor(n),
      f = forces.get(n.id);
    if (pointer?.kind === "node" && pointer.id === n.id) {
      m.vx = 0;
      m.vy = 0;
      continue;
    }
    m.vx = (m.vx + f.x * dt) * Math.pow(0.78, dt);
    m.vy = (m.vy + f.y * dt) * Math.pow(0.78, dt);
    const stepX = clamp(m.vx * dt, -10, 10),
      stepY = clamp(m.vy * dt, -10, 10);
    if (Math.abs(stepX) + Math.abs(stepY) > 0.015) {
      n.position.x += stepX;
      n.position.y += stepY;
      moving = true;
    } else {
      m.vx = 0;
      m.vy = 0;
    }
    m.dx = 0;
    m.dy = 0;
  }
  if (moving) dirty = true;
  render();
  if (dirty && now - lastSave > 1200) {
    save();
    lastSave = now;
  }
  requestAnimationFrame(frame);
}
function clientToWorld(clientX, clientY) {
  const pt = new DOMPoint(clientX, clientY);
  const ctm = scene.getScreenCTM();
  if (ctm) return pt.matrixTransform(ctm.inverse());
  const r = svg.getBoundingClientRect();
  return {
    x: (clientX - r.left - data.viewport.x) / data.viewport.zoom,
    y: (clientY - r.top - data.viewport.y) / data.viewport.zoom,
  };
}
function onNodePointerDown(e, id) {
  if (e.button !== 0) return;
  e.stopPropagation();
  if (connectMode) {
    pointer = {
      kind: "connect",
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    connectStart = id;
    previewPath = svgEl("path", {
      class: "edge-preview",
      "marker-end": "url(#arrow)",
    });
    previewLayer.append(previewPath);
    svg.setPointerCapture(e.pointerId);
    return;
  }
  const n = nodeById(id);
  if (!n) return;
  pointer = {
    kind: "node",
    id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    originX: n.position.x,
    originY: n.position.y,
    moved: false,
  };
  svg.setPointerCapture(e.pointerId);
}
function onNodeClick(id) {
  if (connectMode) {
    if (!connectStart) {
      connectStart = id;
      $("#canvas-hint").textContent = "接続先のノードをクリックしてください";
    } else if (connectStart === id) {
      connectStart = null;
      $("#canvas-hint").textContent = "接続元のノードをクリックしてください";
    } else {
      addConnection(connectStart, id);
      connectStart = null;
      $("#canvas-hint").textContent = "接続元のノードをクリックしてください";
    }
    return;
  }
  selectNode(id);
}
function selectNode(id) {
  selectedId = id;
  selectedEdge = null;
  const n = nodeById(id);
  if (!n) return;
  $("#inspector").classList.remove("hidden");
  const f = $("#task-form");
  for (const key of ["title", "description", "status", "priority"])
    f.elements[key].value = n[key] || "";
  f.elements.deadlineMode.value = n.deadline?.mode || "manual";
  f.elements.deadline.value = n.deadline?.date || "";
  f.elements.progressMode.value = n.progress?.mode || "manual";
  f.elements.progress.value = n.progress?.value || 0;
  syncForm();
  renderNodeConnections();
  refreshSelection();
}
function renderNodeConnections() {
  const root = $("#connection-list");
  if (!root) return;
  root.replaceChildren();
  const relevant = data.edges.filter(
    (e) => e.source === selectedId || e.target === selectedId,
  );
  if (!relevant.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "接続なし";
    root.append(p);
    return;
  }
  for (const edge of relevant) {
    const row = document.createElement("div");
    row.className = "connection-row";
    const other = nodeById(
      edge.source === selectedId ? edge.target : edge.source,
    );
    const name = document.createElement("span");
    name.textContent = `${edge.type === "parent-child" ? "親子" : "依存"} ${edge.source === selectedId ? "→" : "←"} ${other?.title || "不明"}`;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "削除";
    button.className = "connection-delete";
    button.addEventListener("click", () => {
      if (!confirm(`「${other?.title || "不明"}」との接続を削除しますか？`))
        return;
      data.edges = data.edges.filter((e) => e.id !== edge.id);
      buildElements();
      markDirty();
      save();
      renderNodeConnections();
      renderDashboard();
    });
    row.append(name, button);
    root.append(row);
  }
}
function syncForm() {
  const f = $("#task-form");
  f.elements.deadline.disabled = f.elements.deadlineMode.value === "auto";
  f.elements.progress.disabled = f.elements.progressMode.value === "auto";
  $("#progress-value").textContent =
    f.elements.progressMode.value === "auto"
      ? `${progressOf(nodeById(selectedId))}% (自動)`
      : `${f.elements.progress.value}%`;
  const blocked = prerequisites(selectedId).filter((n) => n.status !== "done");
  const w = $("#dependency-warning");
  w.classList.toggle("hidden", !blocked.length);
  w.textContent = blocked.length
    ? `⚠ 未完了の先行タスク: ${blocked.map((n) => n.title).join("、")}（着手は可能です）`
    : "";
}
$("#task-form").addEventListener("input", syncForm);
$("#task-form").addEventListener("change", syncForm);
$("#task-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = nodeById(selectedId);
  if (!n) return;
  const f = e.currentTarget;
  n.title = f.elements.title.value.trim() || "New Task";
  n.description = f.elements.description.value;
  n.status = f.elements.status.value;
  n.priority = f.elements.priority.value;
  n.deadline = {
    mode: f.elements.deadlineMode.value,
    date: f.elements.deadline.value,
  };
  n.progress = {
    mode: f.elements.progressMode.value,
    value: Number(f.elements.progress.value),
  };
  markDirty();
  save();
  selectNode(n.id);
  renderDashboard();
});
$("#delete-node").addEventListener("click", () => {
  if (!selectedId || !confirm("このタスクと関連する接続を削除しますか？"))
    return;
  data.nodes = data.nodes.filter((n) => n.id !== selectedId);
  data.edges = data.edges.filter(
    (e) => e.source !== selectedId && e.target !== selectedId,
  );
  selectedId = null;
  $("#inspector").classList.add("hidden");
  buildElements();
  markDirty();
  save();
  renderDashboard();
});
$("#close-inspector").addEventListener("click", () => {
  $("#inspector").classList.add("hidden");
  selectedId = null;
});
function addNode(x = 0, y = 0) {
  const n = makeNode("New Task", x, y, 7);
  data.nodes.push(n);
  buildElements();
  markDirty();
  save();
  selectNode(n.id);
  return n;
}
function addConnection(source, target) {
  if (source === target) return;
  const type = prompt(
    "接続種類を選択してください：\n1 = 親子関係（接続元が親）\n2 = 依存関係（接続元が先行）",
    "1",
  );
  if (type === null) return;
  if (!["1", "2"].includes(type)) {
    alert("1 または 2 を入力してください");
    return;
  }
  const kind = type === "1" ? "parent-child" : "dependency";
  if (
    data.edges.some(
      (e) => e.source === source && e.target === target && e.type === kind,
    )
  ) {
    alert("同じ接続が存在します");
    return;
  }
  if (kind === "parent-child" && parentsOf(target).length) {
    alert("子ノードに設定できる親は1つです");
    return;
  }
  if (hasPath(target, source, kind)) {
    alert("循環する接続は作成できません");
    return;
  }
  data.edges.push({ id: crypto.randomUUID(), source, target, type: kind });
  buildElements();
  markDirty();
  save();
}
function hasPath(start, end, type) {
  const visited = new Set(),
    stack = [start];
  while (stack.length) {
    const id = stack.pop();
    if (id === end) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const e of data.edges)
      if (e.type === type && e.source === id) stack.push(e.target);
  }
  return false;
}
svg.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest(".node")) return;
  pointer = {
    kind: "pan",
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    originX: data.viewport.x,
    originY: data.viewport.y,
    moved: false,
  };
  svg.setPointerCapture(e.pointerId);
  svg.classList.add("panning");
});
svg.addEventListener("pointermove", (e) => {
  if (!pointer || e.pointerId !== pointer.pointerId) return;
  const dx = e.clientX - pointer.startX,
    dy = e.clientY - pointer.startY;
  if (Math.hypot(dx, dy) > 4) pointer.moved = true;
  if (pointer.kind === "connect") {
    const n = nodeById(pointer.id);
    if (n && previewPath) {
      const a = worldPos(n),
        b = clientToWorld(e.clientX, e.clientY);
      previewPath.setAttribute("d", `M${a.x},${a.y} L${b.x},${b.y}`);
    }
    return;
  }
  if (pointer.kind === "pan") {
    data.viewport.x = pointer.originX + dx;
    data.viewport.y = pointer.originY + dy;
  } else {
    const n = nodeById(pointer.id);
    if (!n) return;
    n.position.x = pointer.originX + dx / data.viewport.zoom;
    n.position.y = pointer.originY + dy / data.viewport.zoom;
    const m = motionFor(n);
    m.dx = 0;
    m.dy = 0;
    m.vx = 0;
    m.vy = 0;
  }
  markDirty();
});
svg.addEventListener("pointerup", (e) => {
  if (!pointer || pointer.pointerId !== e.pointerId) return;
  const p = pointer;
  pointer = null;
  svg.classList.remove("panning");
  if (p.kind === "connect") {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const target = hit?.closest("[data-node]")?.getAttribute("data-node");
    previewPath?.remove();
    previewPath = null;
    connectStart = null;
    if (target && target !== p.id) addConnection(p.id, target);
    return;
  }
  if (p.kind === "node" && !p.moved) onNodeClick(p.id);
  if (p.kind === "node" && p.moved) save();
});
svg.addEventListener("pointercancel", () => {
  pointer = null;
  previewPath?.remove();
  previewPath = null;
  connectStart = null;
  svg.classList.remove("panning");
});
svg.addEventListener("dblclick", (e) => {
  if (e.target.closest(".node") || connectMode) return;
  const p = clientToWorld(e.clientX, e.clientY);
  addNode(p.x, p.y);
});
svg.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = svg.getBoundingClientRect(),
      px = e.clientX - r.left,
      py = e.clientY - r.top,
      old = data.viewport.zoom,
      next = clamp(old * (e.deltaY < 0 ? 1.1 : 0.9), 0.35, 2.5);
    const wx = (px - data.viewport.x) / old,
      wy = (py - data.viewport.y) / old;
    data.viewport.zoom = next;
    data.viewport.x = px - wx * next;
    data.viewport.y = py - wy * next;
    markDirty();
  },
  { passive: false },
);
function center() {
  const r = wrap.getBoundingClientRect();
  data.viewport.x = r.width / 2;
  data.viewport.y = r.height / 2;
  data.viewport.zoom = 1;
  markDirty();
}
function zoom(factor) {
  const r = wrap.getBoundingClientRect(),
    cx = r.width / 2,
    cy = r.height / 2,
    old = data.viewport.zoom,
    next = clamp(old * factor, 0.35, 2.5);
  data.viewport.x = cx - ((cx - data.viewport.x) * next) / old;
  data.viewport.y = cy - ((cy - data.viewport.y) * next) / old;
  data.viewport.zoom = next;
  markDirty();
}
$("#zoom-in").onclick = () => zoom(1.2);
$("#zoom-out").onclick = () => zoom(1 / 1.2);
$("#zoom-reset").onclick = center;
$("#fit-btn").onclick = center;
$("#side-fit").onclick = () => {
  switchView("map");
  center();
};
function addAtCenter() {
  switchView("map");
  const r = wrap.getBoundingClientRect();
  const x = (r.width / 2 - data.viewport.x) / data.viewport.zoom,
    y = (r.height / 2 - data.viewport.y) / data.viewport.zoom;
  addNode(x, y);
}
$("#add-btn").onclick = addAtCenter;
$("#side-add").onclick = addAtCenter;

$("#connect-toggle").onclick = () => {
  connectMode = !connectMode;
  connectStart = null;
  previewPath?.remove();
  previewPath = null;
  svg.classList.toggle("connect-mode", connectMode);
  $("#connect-toggle").classList.toggle("active", connectMode);
  $("#canvas-hint").textContent = connectMode
    ? "接続元のノードから接続先までドラッグしてください"
    : "ノードが重なると磁石のように反発します。";
};
$("#search").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  refreshSelection();
});
function updateMetrics() {
  const urgent = data.nodes.filter(
    (n) =>
      n.status !== "done" &&
      daysRemaining(deadlineOf(n)) !== null &&
      daysRemaining(deadlineOf(n)) <= 3,
  ).length;
  $("#metric-total").textContent = data.nodes.length;
  $("#metric-done").textContent = data.nodes.filter(
    (n) => n.status === "done",
  ).length;
  $("#metric-progress").textContent = data.nodes.filter(
    (n) => n.status === "in-progress",
  ).length;
  $("#metric-urgent").textContent = urgent;
}
function renderDashboard() {
  const done = data.nodes.filter((n) => n.status === "done").length,
    pct = data.nodes.length ? Math.round((done / data.nodes.length) * 100) : 0;
  $("#progress-summary").replaceChildren();
  const summary = $("#progress-summary");
  const line = document.createElement("div");
  line.className = "dashboard-row";
  const l = document.createElement("span");
  l.textContent = "全体の完了率";
  const v = document.createElement("strong");
  v.textContent = `${pct}%`;
  line.append(l, v);
  const track = document.createElement("div");
  track.className = "progress-track";
  const fill = document.createElement("div");
  fill.style.width = `${pct}%`;
  track.append(fill);
  const caption = document.createElement("p");
  caption.className = "muted";
  caption.textContent = `${done} / ${data.nodes.length} 件完了`;
  summary.append(line, track, caption);
  const upcoming = $("#upcoming");
  upcoming.replaceChildren();
  const sorted = [...data.nodes]
    .filter((n) => n.status !== "done" && deadlineOf(n))
    .sort((a, b) => deadlineOf(a).localeCompare(deadlineOf(b)));
  for (const n of sorted.slice(0, 7)) upcoming.append(taskRow(n, true));
  if (!sorted.length)
    upcoming.textContent = "期限のある未完了タスクはありません";
  const table = $("#task-table");
  table.replaceChildren();
  for (const n of data.nodes) table.append(taskRow(n, false));
}
function taskRow(n, short) {
  const row = document.createElement("div");
  row.className = "dashboard-row clickable";
  const a = document.createElement("span");
  a.textContent = n.title;
  const b = document.createElement("strong");
  const d = daysRemaining(deadlineOf(n));
  b.textContent = short
    ? d < 0
      ? `${-d}日超過`
      : d === 0
        ? "今日"
        : `あと${d}日`
    : `${n.status === "done" ? "完了" : n.status === "in-progress" ? "進行中" : "未着手"} · ${progressOf(n)}%`;
  row.append(a, b);
  row.onclick = () => {
    switchView("map");
    selectNode(n.id);
  };
  return row;
}
function switchView(target) {
  view = target;
  $("#map-view").classList.toggle("hidden", target !== "map");
  $("#dashboard-view").classList.toggle("hidden", target !== "dashboard");
  $("#nav-map").classList.toggle("active", target === "map");
  $("#nav-dashboard").classList.toggle("active", target === "dashboard");
  $("#view-title").innerHTML =
    target === "map"
      ? 'タスクマップ <span class="live-pill">● LIVE</span>'
      : "ダッシュボード";
  if (target === "dashboard") renderDashboard();
}
$("#nav-map").onclick = () => switchView("map");
$("#nav-dashboard").onclick = () => switchView("dashboard");
$("#export-btn").onclick = () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nodetask-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    connectStart = null;
    $("#inspector").classList.add("hidden");
  }
  if (
    (e.key === "Delete" || e.key === "Backspace") &&
    selectedEdge &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  ) {
    e.preventDefault();
    deleteSelectedEdge();
    return;
  }
  if (
    (e.key === "Delete" || e.key === "Backspace") &&
    selectedId &&
    !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)
  ) {
    e.preventDefault();
    $("#delete-node").click();
  }
});
window.addEventListener("beforeunload", () => {
  if (dirty) save();
});
function renderPages() {
  const list = $("#page-list");
  list.replaceChildren();
  for (const page of workspace.pages) {
    const btn = document.createElement("button");
    btn.className =
      "page-entry" + (page.id === workspace.activePageId ? " active" : "");
    btn.textContent = "◉ " + page.name;
    btn.title = page.name;
    btn.onclick = () => switchPage(page.id);
    list.append(btn);
  }
}
function switchPage(id) {
  if (id === workspace.activePageId) return;
  if (dirty) save();
  workspace.activePageId = id;
  data = activePage();
  selectedId = null;
  selectedEdge = null;
  pointer = null;
  connectStart = null;
  previewPath?.remove();
  previewPath = null;
  motion.clear();
  $("#inspector").classList.add("hidden");
  buildElements();
  updateMetrics();
  renderDashboard();
  renderPages();
  save();
}
$("#page-add").onclick = () => {
  const name = prompt("新しいページの名前", "新しいページ");
  if (name === null) return;
  const id = crypto.randomUUID();
  workspace.pages.push({
    id,
    name: name.trim() || "新しいページ",
    version: 1,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  switchPage(id);
  center();
  save();
};
$("#page-copy").onclick = () => {
  const source = activePage();
  const id = crypto.randomUUID();
  const ids = new Map(source.nodes.map((n) => [n.id, crypto.randomUUID()]));
  const copy = {
    id,
    name: source.name + "（コピー）",
    version: 1,
    nodes: source.nodes.map((n) => ({
      ...structuredClone(n),
      id: ids.get(n.id),
    })),
    edges: source.edges.map((e) => ({
      ...e,
      id: crypto.randomUUID(),
      source: ids.get(e.source),
      target: ids.get(e.target),
    })),
    viewport: { ...source.viewport },
  };
  workspace.pages.push(copy);
  switchPage(id);
};
$("#page-rename").onclick = () => {
  const page = activePage();
  const name = prompt("ページ名を変更", page.name);
  if (name === null || !name.trim()) return;
  page.name = name.trim();
  renderPages();
  markDirty();
  save();
};
$("#page-delete").onclick = () => {
  if (workspace.pages.length === 1) {
    alert("最後のページは削除できません");
    return;
  }
  if (!confirm(`「${activePage().name}」を削除しますか？`)) return;
  const old = workspace.activePageId;
  workspace.pages = workspace.pages.filter((p) => p.id !== old);
  workspace.activePageId = old;
  switchPage(workspace.pages[0].id);
};
renderPages();
// Initial viewport is centered only on first visit. Persisted view is respected.
if (
  !localStorage.getItem(STORAGE_KEY) &&
  !localStorage.getItem(LEGACY_STORAGE_KEY)
)
  center();
buildElements();
updateMetrics();
renderDashboard();
requestAnimationFrame(frame);
