import { DataSet } from "vis-data";
import { Network } from "vis-network/standalone";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";

type NodeShape = "box" | "ellipse" | "roundbox";

interface IEditNode {
  id: string;
  parentId: string | null;
  label: string;
  text: string;
  x?: number;
  y?: number;
  shape?: NodeShape;
}

interface IEditLink {
  id: string;
  source: string;
  target: string;
  label?: string;
}

interface IEditDocument {
  version: number;
  selectedNodeId: string;
  nodes: IEditNode[];
  links: IEditLink[];
}

interface HostMessage {
  type: "init" | "saved" | "saveFailed" | "promptResult" | "externalSelectNode";
  payload?: unknown;
}

interface VsCodeApi {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

const appElement = document.getElementById("app");
if (!appElement) {
  throw new Error("app container not found");
}
const app = appElement as HTMLDivElement;

app.innerHTML = `
<style>
  :root {
    color-scheme: light dark;
  }
  body {
    margin: 0;
    font-family: var(--vscode-font-family);
    color: var(--vscode-editor-foreground);
    background: var(--vscode-editor-background);
  }
  #app {
    height: 100vh;
    display: grid;
    grid-template-rows: auto 1fr;
    --left-pane-width: 300px;
    --bottom-pane-height: 220px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .layout {
    display: grid;
    grid-template-columns: minmax(180px, var(--left-pane-width)) 6px minmax(320px, 1fr);
    min-height: 0;
  }
  .pane {
    min-height: 0;
  }
  .left-pane {
    border-right: 1px solid var(--vscode-panel-border);
    overflow: auto;
    padding: 8px;
  }
  .right-pane {
    display: grid;
    grid-template-rows: minmax(140px, 1fr) 6px minmax(120px, var(--bottom-pane-height));
    min-height: 0;
  }
  .splitter {
    background: var(--vscode-panel-border);
    opacity: 0.7;
    user-select: none;
    touch-action: none;
  }
  .splitter:hover {
    opacity: 1;
  }
  .splitter.vertical {
    cursor: col-resize;
  }
  .splitter.horizontal {
    cursor: row-resize;
  }
  #network {
    min-height: 0;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  #textEditor {
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .cm-editor {
    height: 100%;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    border: none;
    outline: none;
  }
  .cm-scroller {
    font-family: inherit;
  }
  .tree-node {
    cursor: pointer;
    border-radius: 4px;
    padding: 2px 6px;
    display: inline-block;
    margin: 1px 0;
  }
  .tree-node.selected {
    background: var(--vscode-list-activeSelectionBackground);
    color: var(--vscode-list-activeSelectionForeground);
  }
  ul {
    list-style: none;
    margin: 0;
    padding-left: 14px;
  }
  .meta {
    opacity: 0.8;
    font-size: 12px;
  }
  .spacer {
    flex: 1;
  }
  .network-controls {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  select, button, input {
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 6px;
  }
</style>
<div class="toolbar">
  <button id="addChildBtn">+ Child</button>
  <button id="addSiblingBtn">+ Sibling</button>
  <button id="moveUpBtn">↑</button>
  <button id="moveDownBtn">↓</button>
  <button id="indentBtn">→</button>
  <button id="outdentBtn">←</button>
  <button id="deleteBtn">Delete</button>
  <button id="renameBtn">Rename</button>
  <select id="shapeSelect">
    <option value="box">Box</option>
    <option value="roundbox">RoundBox</option>
    <option value="ellipse">Ellipse</option>
  </select>
  <div class="spacer"></div>
  <div class="network-controls">
    <select id="linkToSelect"></select>
    <button id="linkBtn">Link</button>
    <select id="linkSelect"></select>
    <button id="editLinkBtn">Link Label</button>
    <button id="deleteLinkBtn">Unlink</button>
  </div>
  <button id="saveBtn">Save</button>
  <span id="status" class="meta"></span>
</div>
<div class="layout">
  <div class="left-pane pane">
    <div class="meta" id="docPath"></div>
    <div id="tree"></div>
  </div>
  <div id="verticalSplitter" class="splitter vertical" title="Resize panes"></div>
  <div class="right-pane pane">
    <div id="network"></div>
    <div id="horizontalSplitter" class="splitter horizontal" title="Resize panes"></div>
    <div id="textEditor"></div>
  </div>
</div>
`;

const treeEl = document.getElementById("tree") as HTMLDivElement;
const docPathEl = document.getElementById("docPath") as HTMLDivElement;
const textEditor = document.getElementById("textEditor") as HTMLDivElement;
const addChildBtn = document.getElementById("addChildBtn") as HTMLButtonElement;
const addSiblingBtn = document.getElementById("addSiblingBtn") as HTMLButtonElement;
const moveUpBtn = document.getElementById("moveUpBtn") as HTMLButtonElement;
const moveDownBtn = document.getElementById("moveDownBtn") as HTMLButtonElement;
const indentBtn = document.getElementById("indentBtn") as HTMLButtonElement;
const outdentBtn = document.getElementById("outdentBtn") as HTMLButtonElement;
const deleteBtn = document.getElementById("deleteBtn") as HTMLButtonElement;
const renameBtn = document.getElementById("renameBtn") as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const linkBtn = document.getElementById("linkBtn") as HTMLButtonElement;
const linkToSelect = document.getElementById("linkToSelect") as HTMLSelectElement;
const linkSelect = document.getElementById("linkSelect") as HTMLSelectElement;
const editLinkBtn = document.getElementById("editLinkBtn") as HTMLButtonElement;
const deleteLinkBtn = document.getElementById("deleteLinkBtn") as HTMLButtonElement;
const shapeSelect = document.getElementById("shapeSelect") as HTMLSelectElement;
const networkEl = document.getElementById("network") as HTMLDivElement;
const verticalSplitter = document.getElementById("verticalSplitter") as HTMLDivElement;
const horizontalSplitter = document.getElementById("horizontalSplitter") as HTMLDivElement;

const nodesData = new DataSet<Record<string, unknown>>();
const edgesData = new DataSet<Record<string, unknown>>();
const network = new Network(
  networkEl,
  { nodes: nodesData, edges: edgesData },
  {
    interaction: { dragNodes: true },
    physics: false,
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.7 } }
    }
  }
);

let state: IEditDocument | null = null;
let autosaveTimer: number | undefined;
const pendingInputRequests = new Map<string, (value: string | null) => void>();
let textEditorView: EditorView | undefined;
let syncingEditor = false;

function uuid(): string {
  return crypto.randomUUID().slice(0, 8);
}

function requestInput(options: { title: string; value: string; placeHolder?: string }): Promise<string | null> {
  const requestId = `req-${uuid()}`;
  return new Promise((resolve) => {
    pendingInputRequests.set(requestId, resolve);
    vscode.postMessage({
      type: "requestInput",
      payload: {
        requestId,
        title: options.title,
        value: options.value,
        placeHolder: options.placeHolder
      }
    });
  });
}

function notifySelectionChanged(): void {
  if (!state) {
    return;
  }
  vscode.postMessage({
    type: "selectionChanged",
    payload: { nodeId: state.selectedNodeId }
  });
}

function setSelectedNode(nodeId: string): void {
  if (!state || state.selectedNodeId === nodeId) {
    return;
  }
  state.selectedNodeId = nodeId;
  syncSelectionUI();
  render();
  notifySelectionChanged();
}

function setupPaneResizers(): void {
  const layoutEl = app.querySelector(".layout") as HTMLDivElement | null;
  const rightPaneEl = app.querySelector(".right-pane") as HTMLDivElement | null;
  if (!layoutEl || !rightPaneEl) {
    return;
  }

  const attachDragHandler = (
    splitter: HTMLDivElement,
    onMoveValue: (event: PointerEvent) => void
  ): void => {
    let activePointerId: number | null = null;
    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== activePointerId) {
        return;
      }
      onMoveValue(moveEvent);
    };
    const cleanup = (): void => {
      splitter.removeEventListener("pointermove", onMove);
      splitter.removeEventListener("pointerup", onPointerEnd);
      splitter.removeEventListener("pointercancel", onPointerEnd);
      splitter.removeEventListener("lostpointercapture", onLostPointerCapture);
      activePointerId = null;
    };
    const onLostPointerCapture = (): void => {
      cleanup();
    };
    const onPointerEnd = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId !== activePointerId) {
        return;
      }
      if (splitter.hasPointerCapture(endEvent.pointerId)) {
        splitter.releasePointerCapture(endEvent.pointerId);
      }
      cleanup();
    };
    splitter.addEventListener("pointerdown", (downEvent) => {
      if (activePointerId !== null) {
        return;
      }
      activePointerId = downEvent.pointerId;
      downEvent.preventDefault();
      splitter.setPointerCapture(downEvent.pointerId);
      splitter.addEventListener("pointermove", onMove);
      splitter.addEventListener("pointerup", onPointerEnd);
      splitter.addEventListener("pointercancel", onPointerEnd);
      splitter.addEventListener("lostpointercapture", onLostPointerCapture);
    });
  };

  attachDragHandler(verticalSplitter, (moveEvent) => {
    const layoutRect = layoutEl.getBoundingClientRect();
    const width = Math.min(Math.max(moveEvent.clientX - layoutRect.left, 180), layoutRect.width - 320);
    app.style.setProperty("--left-pane-width", `${width}px`);
    network.redraw();
  });

  attachDragHandler(horizontalSplitter, (moveEvent) => {
    const rightPaneRect = rightPaneEl.getBoundingClientRect();
    const fromBottom = rightPaneRect.bottom - moveEvent.clientY;
    const height = Math.min(Math.max(fromBottom, 120), rightPaneRect.height - 140);
    app.style.setProperty("--bottom-pane-height", `${height}px`);
    network.redraw();
  });
}

function getSelectedNode(): IEditNode | undefined {
  if (!state) {
    return undefined;
  }
  const currentState = state;
  return currentState.nodes.find((n) => n.id === currentState.selectedNodeId);
}

function ensureTextEditor(): EditorView {
  if (textEditorView) {
    return textEditorView;
  }
  const initialState = EditorState.create({
    doc: "",
    extensions: [
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || syncingEditor) {
          return;
        }
        const selected = getSelectedNode();
        if (!selected) {
          return;
        }
        selected.text = update.state.doc.toString();
        requestAutosave();
      })
    ]
  });
  textEditorView = new EditorView({
    state: initialState,
    parent: textEditor
  });
  return textEditorView;
}

function setEditorText(value: string): void {
  const editor = ensureTextEditor();
  const current = editor.state.doc.toString();
  if (current === value) {
    return;
  }
  syncingEditor = true;
  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: value
    }
  });
  syncingEditor = false;
}

function findNode(id: string): IEditNode | undefined {
  return state?.nodes.find((n) => n.id === id);
}

function getChildren(parentId: string | null): IEditNode[] {
  if (!state) {
    return [];
  }
  return state.nodes.filter((n) => n.parentId === parentId);
}

function renderTree(): void {
  if (!state) {
    return;
  }
  const currentState = state;
  const renderBranch = (parentId: string | null): string => {
    const children = getChildren(parentId);
    if (children.length === 0) {
      return "";
    }
    return `<ul>${children
      .map((node) => {
        const selectedClass = node.id === currentState.selectedNodeId ? "selected" : "";
        return `<li>
          <span class="tree-node ${selectedClass}" data-node-id="${node.id}">${escapeHtml(node.label)}</span>
          ${renderBranch(node.id)}
        </li>`;
      })
      .join("")}</ul>`;
  };

  treeEl.innerHTML = renderBranch(null);

  for (const element of Array.from(treeEl.querySelectorAll(".tree-node"))) {
    element.addEventListener("click", () => {
      const id = (element as HTMLElement).dataset.nodeId;
      if (!id) {
        return;
      }
      setSelectedNode(id);
    });
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getLevelNodes(): IEditNode[] {
  const selected = getSelectedNode();
  if (!selected || !state) {
    return [];
  }
  if (selected.parentId === null) {
    return getChildren(null);
  }
  return getChildren(selected.parentId);
}

function syncSelectionUI(): void {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  setEditorText(selected?.text ?? "");
  shapeSelect.value = selected?.shape ?? "box";
  populateLinkTargetOptions();
  populateEditableLinkOptions();
}

function renderNetwork(): void {
  if (!state) {
    return;
  }
  const levelNodes = getLevelNodes();
  const levelIds = new Set(levelNodes.map((node) => node.id));

  const visNodes = levelNodes.map((node) => ({
    id: node.id,
    label: node.label,
    x: node.x,
    y: node.y,
    shape: node.shape ?? "box",
    color:
      node.id === state!.selectedNodeId
        ? {
            background: "rgb(38, 79, 120)",
            border: "rgb(80, 130, 190)"
          }
        : undefined
  }));

  const visEdges = state.links
    .filter((link) => levelIds.has(link.source) && levelIds.has(link.target))
    .map((link) => ({ id: link.id, from: link.source, to: link.target, label: link.label ?? "" }));

  nodesData.clear();
  edgesData.clear();
  nodesData.add(visNodes);
  edgesData.add(visEdges);
}

function render(): void {
  if (!state) {
    return;
  }
  renderTree();
  renderNetwork();
}

function populateLinkTargetOptions(): void {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  const levelNodes = getLevelNodes();
  linkToSelect.innerHTML = "";
  for (const node of levelNodes) {
    if (node.id === selected?.id) {
      continue;
    }
    const option = document.createElement("option");
    option.value = node.id;
    option.textContent = node.label;
    linkToSelect.append(option);
  }
}

function populateEditableLinkOptions(): void {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  const levelNodeIds = new Set(getLevelNodes().map((node) => node.id));
  linkSelect.innerHTML = "";
  const editable = state.links.filter((link) => {
    const sameLevel = levelNodeIds.has(link.source) && levelNodeIds.has(link.target);
    return sameLevel && (link.source === selected?.id || link.target === selected?.id);
  });
  for (const link of editable) {
    const source = findNode(link.source)?.label ?? link.source;
    const target = findNode(link.target)?.label ?? link.target;
    const option = document.createElement("option");
    option.value = link.id;
    option.textContent = `${source} -> ${target}${link.label ? ` (${link.label})` : ""}`;
    linkSelect.append(option);
  }
}

function addNode(parentId: string | null): void {
  if (!state) {
    return;
  }
  const id = `n-${uuid()}`;
  state.nodes.push({
    id,
    parentId,
    label: "New Node",
    text: "",
    shape: "box"
  });
  state.selectedNodeId = id;
  notifySelectionChanged();
  render();
  syncSelectionUI();
}

function moveSelectedSibling(offset: -1 | 1): void {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  if (!selected || selected.parentId === null) {
    return;
  }
  const siblings = getChildren(selected.parentId);
  const currentIndex = siblings.findIndex((node) => node.id === selected.id);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= siblings.length) {
    return;
  }
  const currentSibling = siblings[currentIndex];
  const nextSibling = siblings[nextIndex];
  const currentNodeIndex = state.nodes.findIndex((node) => node.id === currentSibling.id);
  const nextNodeIndex = state.nodes.findIndex((node) => node.id === nextSibling.id);
  if (currentNodeIndex < 0 || nextNodeIndex < 0) {
    return;
  }
  [state.nodes[currentNodeIndex], state.nodes[nextNodeIndex]] = [state.nodes[nextNodeIndex], state.nodes[currentNodeIndex]];
  render();
  syncSelectionUI();
}

function collectSubtreeIds(rootId: string): Set<string> {
  const ids = new Set<string>();
  const walk = (nodeId: string): void => {
    ids.add(nodeId);
    for (const node of state?.nodes ?? []) {
      if (node.parentId === nodeId) {
        walk(node.id);
      }
    }
  };
  walk(rootId);
  return ids;
}

function moveSubtreeBlock(sourceId: string, insertIndexInRemaining: number): void {
  if (!state) {
    return;
  }
  const sourceSubtreeIds = collectSubtreeIds(sourceId);
  const sourceBlock = state.nodes.filter((node) => sourceSubtreeIds.has(node.id));
  const remaining = state.nodes.filter((node) => !sourceSubtreeIds.has(node.id));
  const boundedIndex = Math.min(Math.max(insertIndexInRemaining, 0), remaining.length);
  state.nodes = [...remaining.slice(0, boundedIndex), ...sourceBlock, ...remaining.slice(boundedIndex)];
}

function indentSelectedNode(): void {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  if (!selected || selected.id === "root") {
    return;
  }
  const siblings = getChildren(selected.parentId);
  const currentIndex = siblings.findIndex((node) => node.id === selected.id);
  if (currentIndex <= 0) {
    return;
  }
  const newParent = siblings[currentIndex - 1];
  selected.parentId = newParent.id;

  const sourceSubtreeIds = collectSubtreeIds(selected.id);
  const newParentSubtreeIds = collectSubtreeIds(newParent.id);
  const remaining = state.nodes.filter((node) => !sourceSubtreeIds.has(node.id));
  const targetIndexes = remaining
    .map((node, index) => ({ node, index }))
    .filter((entry) => newParentSubtreeIds.has(entry.node.id))
    .map((entry) => entry.index);
  if (targetIndexes.length === 0) {
    return;
  }
  moveSubtreeBlock(selected.id, targetIndexes[targetIndexes.length - 1] + 1);
  render();
  syncSelectionUI();
}

function outdentSelectedNode(): void {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  if (!selected || selected.id === "root" || selected.parentId === null) {
    return;
  }
  const parent = findNode(selected.parentId);
  if (!parent) {
    return;
  }
  const sourceSubtreeIds = collectSubtreeIds(selected.id);
  const parentSubtreeIds = collectSubtreeIds(parent.id);
  for (const nodeId of sourceSubtreeIds) {
    parentSubtreeIds.delete(nodeId);
  }
  selected.parentId = parent.parentId;

  const remaining = state.nodes.filter((node) => !sourceSubtreeIds.has(node.id));
  const targetIndexes = remaining
    .map((node, index) => ({ node, index }))
    .filter((entry) => parentSubtreeIds.has(entry.node.id))
    .map((entry) => entry.index);
  if (targetIndexes.length === 0) {
    return;
  }
  moveSubtreeBlock(selected.id, targetIndexes[targetIndexes.length - 1] + 1);
  render();
  syncSelectionUI();
}

function removeNodeAndDescendants(nodeId: string): void {
  if (!state) {
    return;
  }
  const victims = new Set<string>();
  const walk = (id: string): void => {
    victims.add(id);
    for (const child of getChildren(id)) {
      walk(child.id);
    }
  };
  walk(nodeId);
  state.nodes = state.nodes.filter((node) => !victims.has(node.id));
  state.links = state.links.filter((link) => !victims.has(link.source) && !victims.has(link.target));
}

function setStatus(text: string): void {
  statusEl.textContent = text;
  if (text) {
    window.setTimeout(() => {
      if (statusEl.textContent === text) {
        statusEl.textContent = "";
      }
    }, 2000);
  }
}

function requestAutosave(): void {
  if (!state) {
    return;
  }
  if (autosaveTimer !== undefined) {
    window.clearTimeout(autosaveTimer);
  }
  autosaveTimer = window.setTimeout(() => {
    if (!state) {
      return;
    }
    vscode.postMessage({ type: "saveDocument", payload: state });
  }, 600);
}

addChildBtn.addEventListener("click", () => {
  const selected = getSelectedNode();
  if (!selected) {
    return;
  }
  addNode(selected.id);
  requestAutosave();
});

addSiblingBtn.addEventListener("click", () => {
  const selected = getSelectedNode();
  if (!selected || selected.parentId === null) {
    return;
  }
  addNode(selected.parentId);
  requestAutosave();
});

moveUpBtn.addEventListener("click", () => {
  moveSelectedSibling(-1);
  requestAutosave();
});

moveDownBtn.addEventListener("click", () => {
  moveSelectedSibling(1);
  requestAutosave();
});

indentBtn.addEventListener("click", () => {
  indentSelectedNode();
  requestAutosave();
});

outdentBtn.addEventListener("click", () => {
  outdentSelectedNode();
  requestAutosave();
});

deleteBtn.addEventListener("click", () => {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  if (!selected || selected.id === "root") {
    return;
  }
  const parentId = selected.parentId;
  removeNodeAndDescendants(selected.id);
  state.selectedNodeId = parentId ?? "root";
  notifySelectionChanged();
  render();
  syncSelectionUI();
  requestAutosave();
});

renameBtn.addEventListener("click", async () => {
  const selected = getSelectedNode();
  if (!selected) {
    return;
  }
  const next = await requestInput({ title: "Rename node", value: selected.label, placeHolder: "Node label" });
  if (next === null || !next.trim()) {
    return;
  }
  selected.label = next.trim();
  render();
  syncSelectionUI();
  requestAutosave();
});

shapeSelect.addEventListener("change", () => {
  const selected = getSelectedNode();
  if (!selected) {
    return;
  }
  selected.shape = shapeSelect.value as NodeShape;
  renderNetwork();
  requestAutosave();
});

linkBtn.addEventListener("click", () => {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  const target = linkToSelect.value;
  if (!selected || !target) {
    return;
  }
  const already = state.links.find((link) => link.source === selected.id && link.target === target);
  if (already) {
    setStatus("Link already exists");
    return;
  }
  state.links.push({
    id: `l-${uuid()}`,
    source: selected.id,
    target
  });
  renderNetwork();
  populateEditableLinkOptions();
  setStatus("Linked");
  requestAutosave();
});

editLinkBtn.addEventListener("click", async () => {
  if (!state) {
    return;
  }
  const link = state.links.find((item) => item.id === linkSelect.value);
  if (!link) {
    return;
  }
  const next = await requestInput({
    title: "Edit link label",
    value: link.label ?? "",
    placeHolder: "Leave empty to clear"
  });
  if (next === null) {
    return;
  }
  link.label = next.trim() ? next : undefined;
  renderNetwork();
  populateEditableLinkOptions();
  requestAutosave();
});

deleteLinkBtn.addEventListener("click", () => {
  if (!state) {
    return;
  }
  const id = linkSelect.value;
  if (!id) {
    return;
  }
  state.links = state.links.filter((link) => link.id !== id);
  renderNetwork();
  populateEditableLinkOptions();
  setStatus("Unlinked");
  requestAutosave();
});

saveBtn.addEventListener("click", () => {
  if (!state) {
    return;
  }
  vscode.postMessage({ type: "saveDocument", payload: state });
});

network.on("click", (event) => {
  if (!state) {
    return;
  }
  const first = event.nodes[0];
  if (!first) {
    return;
  }
  setSelectedNode(first as string);
});

network.on("dragEnd", (event) => {
  if (!state) {
    return;
  }
  const moved = event.nodes as string[];
  for (const id of moved) {
    const position = network.getPosition(id);
    const node = findNode(id);
    if (!node || !position) {
      continue;
    }
    node.x = position.x;
    node.y = position.y;
  }
  requestAutosave();
});

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  const message = event.data;
  if (message.type === "init") {
    const payload = message.payload as { document: IEditDocument; path: string };
    state = payload.document;
    docPathEl.textContent = payload.path;
    ensureTextEditor();
    syncSelectionUI();
    render();
  }
  if (message.type === "saved") {
    setStatus("Saved");
  }
  if (message.type === "saveFailed") {
    setStatus(`Save failed: ${String(message.payload)}`);
  }
  if (message.type === "promptResult") {
    const payload = message.payload as { requestId: string; cancelled: boolean; value: string };
    const resolve = pendingInputRequests.get(payload.requestId);
    if (!resolve) {
      return;
    }
    pendingInputRequests.delete(payload.requestId);
    resolve(payload.cancelled ? null : payload.value);
  }
  if (message.type === "externalSelectNode") {
    const payload = message.payload as { nodeId: string };
    setSelectedNode(payload.nodeId);
  }
});

vscode.postMessage({ type: "requestInit" });
setupPaneResizers();
