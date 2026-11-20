import { DataSet } from "vis-data";
import { Network } from "vis-network/standalone";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";

type NodeShape = "box" | "ellipse" | "roundbox";

interface IEditNode {
  id: string;
  parentId: string | null;
  label: string;
  text: string;
  x?: number;
  y?: number;
  shape?: NodeShape;
  nodeColor?: string;
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
const ICONS = {
  addChild:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h10v2H10v4H8V8H4V6h4V2h2v4zm-4 8h14v2H6v2H4v-4a2 2 0 0 1 2-2z"/></svg>',
  addSibling:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h8v2H3V6zm10 0h8v2h-8V6zM3 11h8v2H3v-2zm14-3h2v3h3v2h-3v3h-2v-3h-3v-2h3V8zM3 16h8v2H3v-2zm10 0h8v2h-8v-2z"/></svg>',
  moveUp:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 5 6 6-1.4 1.4-3.6-3.6V19h-2V8.8l-3.6 3.6L6 11l6-6z"/></svg>',
  moveDown:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19-6-6 1.4-1.4 3.6 3.6V5h2v10.2l3.6-3.6L18 13l-6 6z"/></svg>',
  indent:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h10v2H3V6zm0 5h10v2H3v-2zm0 5h10v2H3v-2zm12-6 6 4-6 4v-3h-3v-2h3v-3z"/></svg>',
  outdent:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h10v2H3V6zm0 5h10v2H3v-2zm0 5h10v2H3v-2zm9-6V7l-6 4 6 4v-3h3v-2h-3z"/></svg>',
  delete:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h5v2H3V5h5l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM6 9h2v9H6V9z"/></svg>',
  rename:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7c.4-.4.4-1 0-1.4L18.4 3.3c-.4-.4-1-.4-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z"/></svg>',
  color:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m18.4 2.6 3 3a2 2 0 0 1 0 2.8l-9.8 9.8-4.2 1.2 1.2-4.2 9.8-9.8a2 2 0 0 1 2.8 0zM4 20h16v2H4z"/></svg>',
  apply:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 16.2-3.5-3.5L4 14.2 9 19l11-11-1.5-1.5z"/></svg>',
  clear:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m19 6.4-1.4-1.4L12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
  linkMode:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 13a3.5 3.5 0 0 1 0-7h4V4h-4a5.5 5.5 0 1 0 0 11h4v-2h-4zm3.5 0h2v-2h-2v2zm5.5-9h-4v2h4a3.5 3.5 0 1 1 0 7h-4v2h4a5.5 5.5 0 1 0 0-11z"/></svg>',
  link:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4 9.2 12l4.8-4.8a3 3 0 1 1 4.2 4.2l-2 2-1.4-1.4 2-2a1 1 0 1 0-1.4-1.4l-4.8 4.8zM13.4 10.6l1.4 1.4-4.8 4.8a3 3 0 1 1-4.2-4.2l2-2 1.4 1.4-2 2a1 1 0 1 0 1.4 1.4l4.8-4.8z"/></svg>',
  linkLabel:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18v2H3V6zm0 5h10v2H3v-2zm0 5h18v2H3v-2zm14-5 4-4 1.4 1.4-4 4z"/></svg>',
  unlink:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 7 1.4 1.4-2 2L15 9l2-2zM7 17 5.6 15.6l2-2L9 15l-2 2zm2.5-4.1L8.1 11.5l6.4-6.4 1.4 1.4-6.4 6.4zm6.4 6.4-6.4-6.4 1.4-1.4 6.4 6.4-1.4 1.4z"/></svg>',
  save:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l4 4v14H3V3h2zm0 2v14h14V7.8L16.2 5H5zm2 8h10v6H7v-6zm0-8h8v4H7V5z"/></svg>'
} as const;

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
    grid-template-rows: auto 1fr auto;
    --left-pane-width: 300px;
    --bottom-pane-height: 280px;
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
    grid-template-rows: minmax(120px, 1fr) 6px minmax(180px, var(--bottom-pane-height));
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
    caret-color: #f2f2f2;
  }
  .cm-editor .cm-content {
    caret-color: #f2f2f2;
  }
  .cm-editor.cm-focused .cm-cursorLayer .cm-cursor,
  .cm-editor .cm-cursorLayer .cm-cursor,
  .cm-editor .cm-dropCursor {
    border-left-color: #f2f2f2 !important;
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
  .tree-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .tree-toggle {
    width: 14px;
    height: 14px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none !important;
    background: transparent !important;
    color: var(--vscode-foreground);
    opacity: 0.85;
    cursor: pointer;
    padding: 0 !important;
    font-size: 11px;
    line-height: 1;
  }
  .tree-toggle:hover {
    opacity: 1;
    background: var(--vscode-list-hoverBackground);
    border-radius: 3px;
  }
  .tree-toggle-spacer {
    width: 14px;
    height: 14px;
    display: inline-block;
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
  .icon-btn {
    width: 30px;
    height: 30px;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .icon-btn svg {
    width: 16px;
    height: 16px;
    fill: currentColor;
    display: block;
  }
  .icon-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
  }
  select, button, input {
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    padding: 4px 6px;
  }
  .context-menu {
    position: fixed;
    z-index: 1000;
    border: 1px solid var(--vscode-menu-border, var(--vscode-panel-border));
    background: var(--vscode-menu-background, var(--vscode-editor-background));
    border-radius: 6px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    padding: 4px;
  }
  .context-menu.hidden {
    display: none;
  }
  .context-menu button {
    display: block;
    width: 100%;
    text-align: left;
    border: none;
    background: transparent;
    border-radius: 4px;
  }
  .context-menu button svg {
    width: 14px;
    height: 14px;
    fill: currentColor;
    vertical-align: text-bottom;
    margin-right: 4px;
  }
  .context-menu button:hover {
    background: var(--vscode-list-hoverBackground);
  }
  .color-panel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .hidden {
    display: none;
  }
  .floating-tooltip {
    position: fixed;
    z-index: 2000;
    pointer-events: none;
    padding: 4px 8px;
    border-radius: 4px;
    background: var(--vscode-editorHoverWidget-background, rgba(30, 30, 30, 0.95));
    color: var(--vscode-editorHoverWidget-foreground, #f0f0f0);
    border: 1px solid var(--vscode-editorHoverWidget-border, rgba(120, 120, 120, 0.8));
    font-size: 12px;
    white-space: nowrap;
    opacity: 0;
    transform: translateY(-2px);
    transition: opacity 80ms linear;
  }
  .floating-tooltip.visible {
    opacity: 1;
  }
  .status-bar {
    min-height: 24px;
    display: flex;
    align-items: center;
    padding: 0 8px 6px;
    border-top: 1px solid var(--vscode-panel-border);
  }
</style>
<div class="toolbar">
  <button id="addChildBtn" class="icon-btn" title="Add Child" aria-label="Add Child">${ICONS.addChild}</button>
  <button id="addSiblingBtn" class="icon-btn" title="Add Sibling" aria-label="Add Sibling">${ICONS.addSibling}</button>
  <button id="moveUpBtn" class="icon-btn" title="Move Up" aria-label="Move Up">${ICONS.moveUp}</button>
  <button id="moveDownBtn" class="icon-btn" title="Move Down" aria-label="Move Down">${ICONS.moveDown}</button>
  <button id="indentBtn" class="icon-btn" title="Indent" aria-label="Indent">${ICONS.indent}</button>
  <button id="outdentBtn" class="icon-btn" title="Outdent" aria-label="Outdent">${ICONS.outdent}</button>
  <button id="deleteBtn" class="icon-btn" title="Delete Node" aria-label="Delete Node">${ICONS.delete}</button>
  <button id="renameBtn" class="icon-btn" title="Rename Node" aria-label="Rename Node">${ICONS.rename}</button>
  <button id="nodeColorBtn" class="icon-btn" title="Node Color" aria-label="Node Color">${ICONS.color}</button>
  <div id="nodeColorPanel" class="color-panel hidden">
    <input id="nodeColorInput" type="color" />
    <button id="applyNodeColorBtn" class="icon-btn" title="Apply Color" aria-label="Apply Color">${ICONS.apply}</button>
    <button id="clearNodeColorBtn" class="icon-btn" title="Clear Color" aria-label="Clear Color">${ICONS.clear}</button>
  </div>
  <select id="shapeSelect">
    <option value="box">Box</option>
    <option value="roundbox">RoundBox</option>
    <option value="ellipse">Ellipse</option>
  </select>
  <div class="spacer"></div>
  <div class="network-controls">
    <button id="linkModeBtn" class="icon-btn" title="Link Mode: OFF" aria-label="Link Mode: OFF">${ICONS.linkMode}</button>
    <select id="linkToSelect"></select>
    <button id="linkBtn" class="icon-btn" title="Create Link" aria-label="Create Link">${ICONS.link}</button>
    <select id="linkSelect"></select>
    <button id="editLinkBtn" class="icon-btn" title="Edit Link Label" aria-label="Edit Link Label">${ICONS.linkLabel}</button>
    <button id="deleteLinkBtn" class="icon-btn" title="Unlink" aria-label="Unlink">${ICONS.unlink}</button>
  </div>
  <button id="saveBtn" class="icon-btn" title="Save" aria-label="Save">${ICONS.save}</button>
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
<div class="status-bar">
  <span id="status" class="meta"></span>
</div>
<div id="networkContextMenu" class="context-menu hidden">
  <button id="networkMenuAddSiblingBtn" title="Add Sibling" aria-label="Add Sibling">${ICONS.addSibling} Add Sibling</button>
</div>
<div id="floatingTooltip" class="floating-tooltip"></div>
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
const nodeColorBtn = document.getElementById("nodeColorBtn") as HTMLButtonElement;
const nodeColorPanel = document.getElementById("nodeColorPanel") as HTMLDivElement;
const nodeColorInput = document.getElementById("nodeColorInput") as HTMLInputElement;
const applyNodeColorBtn = document.getElementById("applyNodeColorBtn") as HTMLButtonElement;
const clearNodeColorBtn = document.getElementById("clearNodeColorBtn") as HTMLButtonElement;
const saveBtn = document.getElementById("saveBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const linkModeBtn = document.getElementById("linkModeBtn") as HTMLButtonElement;
const linkBtn = document.getElementById("linkBtn") as HTMLButtonElement;
const linkToSelect = document.getElementById("linkToSelect") as HTMLSelectElement;
const linkSelect = document.getElementById("linkSelect") as HTMLSelectElement;
const editLinkBtn = document.getElementById("editLinkBtn") as HTMLButtonElement;
const deleteLinkBtn = document.getElementById("deleteLinkBtn") as HTMLButtonElement;
const shapeSelect = document.getElementById("shapeSelect") as HTMLSelectElement;
const networkEl = document.getElementById("network") as HTMLDivElement;
const verticalSplitter = document.getElementById("verticalSplitter") as HTMLDivElement;
const horizontalSplitter = document.getElementById("horizontalSplitter") as HTMLDivElement;
const networkContextMenu = document.getElementById("networkContextMenu") as HTMLDivElement;
const networkMenuAddSiblingBtn = document.getElementById("networkMenuAddSiblingBtn") as HTMLButtonElement;
const floatingTooltip = document.getElementById("floatingTooltip") as HTMLDivElement;

const nodesData = new DataSet<Record<string, unknown>>();
const edgesData = new DataSet<Record<string, unknown>>();
const network = new Network(
  networkEl,
  { nodes: nodesData, edges: edgesData },
  {
    interaction: { dragNodes: true, multiselect: true },
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
let isLinkModeActive = false;
let linkModeSourceNodeId: string | null = null;
let imozuruDragContext: { anchorId: string; nodeIds: Set<string>; edges: Array<{ a: string; b: string; rest: number }> } | null = null;
const isMacPlatform = /Mac|iPhone|iPad/.test(navigator.platform);
let networkContextMenuCanvasPosition: { x: number; y: number } | null = null;
let selectedLinkId: string | null = null;
const collapsedTreeNodeIds = new Set<string>();
const DEFAULT_NODE_COLOR = "#97c2fc";
const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, color: "var(--vscode-textPreformat-foreground, #d7ba7d)", fontWeight: "700" },
  { tag: [tags.emphasis], fontStyle: "italic", color: "var(--vscode-editor-foreground, #d4d4d4)" },
  { tag: [tags.strong], fontWeight: "700", color: "var(--vscode-editor-foreground, #d4d4d4)" },
  { tag: [tags.strikethrough], textDecoration: "line-through" },
  { tag: [tags.link], color: "var(--vscode-textLink-foreground, #4ea1ff)", textDecoration: "underline" },
  { tag: [tags.url], color: "var(--vscode-textLink-foreground, #4ea1ff)" },
  { tag: [tags.monospace], color: "var(--vscode-terminal-ansiGreen, #6a9955)" },
  { tag: [tags.quote], color: "var(--vscode-descriptionForeground, #888888)" },
  { tag: [tags.list], color: "var(--vscode-editor-foreground, #d4d4d4)" },
  { tag: [tags.atom, tags.bool], color: "var(--vscode-terminal-ansiYellow, #dcdcaa)" },
  { tag: [tags.punctuation], color: "var(--vscode-editor-foreground, #d4d4d4)" }
]);

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

function updateLinkModeUI(): void {
  const label = isLinkModeActive ? "Link Mode: ON" : "Link Mode: OFF";
  linkModeBtn.dataset.tooltip = label;
  linkModeBtn.setAttribute("aria-label", label);
  linkModeBtn.classList.toggle("active", isLinkModeActive);
}

function showFloatingTooltip(text: string, clientX: number, clientY: number): void {
  floatingTooltip.textContent = text;
  floatingTooltip.style.left = `${clientX + 10}px`;
  floatingTooltip.style.top = `${clientY + 14}px`;
  floatingTooltip.classList.add("visible");
}

function hideFloatingTooltip(): void {
  floatingTooltip.classList.remove("visible");
}

function setupIconTooltips(): void {
  const iconButtons = Array.from(document.querySelectorAll("button.icon-btn")) as HTMLButtonElement[];
  for (const button of iconButtons) {
    const label = button.getAttribute("title");
    if (label) {
      button.dataset.tooltip = label;
      button.removeAttribute("title");
    }
    button.addEventListener("mouseenter", (event) => {
      const tooltipText = button.dataset.tooltip;
      if (!tooltipText) {
        return;
      }
      const mouseEvent = event as MouseEvent;
      showFloatingTooltip(tooltipText, mouseEvent.clientX, mouseEvent.clientY);
    });
    button.addEventListener("mousemove", (event) => {
      const tooltipText = button.dataset.tooltip;
      if (!tooltipText || !floatingTooltip.classList.contains("visible")) {
        return;
      }
      const mouseEvent = event as MouseEvent;
      showFloatingTooltip(tooltipText, mouseEvent.clientX, mouseEvent.clientY);
    });
    button.addEventListener("mouseleave", hideFloatingTooltip);
    button.addEventListener("blur", hideFloatingTooltip);
  }
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
      syntaxHighlighting(markdownHighlightStyle),
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
        requestAutosave(1200);
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
  const nodeIdSet = new Set(currentState.nodes.map((node) => node.id));
  for (const nodeId of Array.from(collapsedTreeNodeIds)) {
    if (!nodeIdSet.has(nodeId)) {
      collapsedTreeNodeIds.delete(nodeId);
    }
  }
  const renderBranch = (parentId: string | null): string => {
    const children = getChildren(parentId);
    if (children.length === 0) {
      return "";
    }
    return `<ul>${children
      .map((node) => {
        const selectedClass = node.id === currentState.selectedNodeId ? "selected" : "";
        const hasChildren = getChildren(node.id).length > 0;
        const isCollapsed = hasChildren && collapsedTreeNodeIds.has(node.id);
        return `<li>
          <div class="tree-row">
            ${
              hasChildren
                ? `<button class="tree-toggle" data-node-id="${node.id}" aria-label="${isCollapsed ? "Expand" : "Collapse"}">${isCollapsed ? "▶" : "▼"}</button>`
                : '<span class="tree-toggle-spacer"></span>'
            }
            <span class="tree-node ${selectedClass}" data-node-id="${node.id}">${escapeHtml(node.label)}</span>
          </div>
          ${isCollapsed ? "" : renderBranch(node.id)}
        </li>`;
      })
      .join("")}</ul>`;
  };

  treeEl.innerHTML = renderBranch(null);

  for (const element of Array.from(treeEl.querySelectorAll(".tree-toggle"))) {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = (element as HTMLElement).dataset.nodeId;
      if (!id) {
        return;
      }
      if (collapsedTreeNodeIds.has(id)) {
        collapsedTreeNodeIds.delete(id);
      } else {
        collapsedTreeNodeIds.add(id);
      }
      renderTree();
    });
  }

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getNetworkNodePosition(nodeId: string): { x: number; y: number } {
  const position = network.getPosition(nodeId);
  return { x: position.x, y: position.y };
}

function getVisibleLevelLinks(): IEditLink[] {
  if (!state) {
    return [];
  }
  const levelIds = new Set(getLevelNodes().map((node) => node.id));
  return state.links.filter((link) => levelIds.has(link.source) && levelIds.has(link.target));
}

function getEditableLinks(): IEditLink[] {
  return getVisibleLevelLinks();
}

function buildImozuruDragContext(anchorId: string): { anchorId: string; nodeIds: Set<string>; edges: Array<{ a: string; b: string; rest: number }> } | null {
  if (!state) {
    return null;
  }
  const levelNodeIds = new Set(getLevelNodes().map((node) => node.id));
  if (!levelNodeIds.has(anchorId)) {
    return null;
  }

  const links = getVisibleLevelLinks();
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of levelNodeIds) {
    adjacency.set(nodeId, new Set());
  }
  for (const link of links) {
    adjacency.get(link.source)?.add(link.target);
    adjacency.get(link.target)?.add(link.source);
  }

  const connectedNodeIds = new Set<string>();
  const queue: string[] = [anchorId];
  connectedNodeIds.add(anchorId);
  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adjacency.get(current) ?? new Set<string>();
    for (const neighbor of neighbors) {
      if (connectedNodeIds.has(neighbor)) {
        continue;
      }
      connectedNodeIds.add(neighbor);
      queue.push(neighbor);
    }
  }
  if (connectedNodeIds.size <= 1) {
    return null;
  }

  const edges = links
    .filter((link) => connectedNodeIds.has(link.source) && connectedNodeIds.has(link.target))
    .map((link) => {
      const source = getNetworkNodePosition(link.source);
      const target = getNetworkNodePosition(link.target);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy);
      return {
        a: link.source,
        b: link.target,
        rest: clamp(distance || 140, 80, 240)
      };
    });

  return { anchorId, nodeIds: connectedNodeIds, edges };
}

function applyImozuruSpringStep(context: { anchorId: string; nodeIds: Set<string>; edges: Array<{ a: string; b: string; rest: number }> }): void {
  if (!state) {
    return;
  }
  const positions = new Map<string, { x: number; y: number }>();
  for (const nodeId of context.nodeIds) {
    positions.set(nodeId, getNetworkNodePosition(nodeId));
  }

  const springStrength = 0.16;
  const iterations = 2;
  for (let i = 0; i < iterations; i += 1) {
    for (const edge of context.edges) {
      const a = positions.get(edge.a);
      const b = positions.get(edge.b);
      if (!a || !b) {
        continue;
      }
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.0001;
      const force = (distance - edge.rest) * springStrength;
      const ux = dx / distance;
      const uy = dy / distance;
      const moveA = edge.a === context.anchorId ? 0 : edge.b === context.anchorId ? 1 : 0.5;
      const moveB = edge.b === context.anchorId ? 0 : edge.a === context.anchorId ? 1 : 0.5;
      a.x += ux * force * moveA;
      a.y += uy * force * moveA;
      b.x -= ux * force * moveB;
      b.y -= uy * force * moveB;
    }
  }

  for (const [nodeId, position] of positions.entries()) {
    if (nodeId === context.anchorId) {
      continue;
    }
    const node = findNode(nodeId);
    if (!node) {
      continue;
    }
    node.x = position.x;
    node.y = position.y;
    network.moveNode(nodeId, position.x, position.y);
  }
}

function isImozuruModifierPressed(event: unknown): boolean {
  const srcEvent = (event as { event?: { srcEvent?: { ctrlKey?: boolean; metaKey?: boolean } } })?.event?.srcEvent;
  return isMacPlatform ? Boolean(srcEvent?.metaKey) : Boolean(srcEvent?.ctrlKey);
}

function syncSelectionUI(): void {
  if (!state) {
    return;
  }
  const selected = getSelectedNode();
  setEditorText(selected?.text ?? "");
  nodeColorInput.value = selected?.nodeColor ?? DEFAULT_NODE_COLOR;
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
    color: (() => {
      const isSelected = node.id === state!.selectedNodeId;
      const isLinkSource = isLinkModeActive && linkModeSourceNodeId === node.id;
      if (isLinkSource) {
        return {
          background: "rgb(150, 96, 34)",
          border: "rgb(222, 153, 64)"
        };
      }
      const background = node.nodeColor ?? DEFAULT_NODE_COLOR;
      if (isSelected) {
        return {
          background,
          border: "rgb(80, 130, 190)"
        };
      }
      if (node.nodeColor) {
        return {
          background: node.nodeColor,
          border: "rgb(120, 120, 120)"
        };
      }
      return { background };
    })()
  }));

  const visEdges = state.links
    .filter((link) => levelIds.has(link.source) && levelIds.has(link.target))
    .map((link) => ({ id: link.id, from: link.source, to: link.target, label: link.label ?? "" }));

  nodesData.clear();
  edgesData.clear();
  nodesData.add(visNodes);
  edgesData.add(visEdges);
  if (selectedLinkId && edgesData.get(selectedLinkId)) {
    network.selectEdges([selectedLinkId]);
  } else {
    selectedLinkId = null;
  }
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
  linkSelect.innerHTML = "";
  const editable = getEditableLinks();
  for (const link of editable) {
    const source = findNode(link.source)?.label ?? link.source;
    const target = findNode(link.target)?.label ?? link.target;
    const option = document.createElement("option");
    option.value = link.id;
    option.textContent = `${source} -> ${target}${link.label ? ` (${link.label})` : ""}`;
    linkSelect.append(option);
  }

  if (editable.length === 0) {
    selectedLinkId = null;
    return;
  }

  const selectedExists = selectedLinkId ? editable.some((link) => link.id === selectedLinkId) : false;
  if (selectedExists && selectedLinkId) {
    linkSelect.value = selectedLinkId;
    return;
  }

  const adjacent = selected ? editable.find((link) => link.source === selected.id || link.target === selected.id) : undefined;
  selectedLinkId = adjacent?.id ?? editable[0].id;
  linkSelect.value = selectedLinkId;
}

function addNode(parentId: string | null, position?: { x: number; y: number }): void {
  if (!state) {
    return;
  }
  const id = `n-${uuid()}`;
  state.nodes.push({
    id,
    parentId,
    label: "New Node",
    text: "",
    shape: "box",
    x: position?.x,
    y: position?.y
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

function resetLinkModeSource(): void {
  linkModeSourceNodeId = null;
}

function addLink(sourceId: string, targetId: string): boolean {
  if (!state) {
    return false;
  }
  if (sourceId === targetId) {
    setStatus("Cannot link to same node");
    return false;
  }
  const already = state.links.find((link) => link.source === sourceId && link.target === targetId);
  if (already) {
    setStatus("Link already exists");
    return false;
  }
  const id = `l-${uuid()}`;
  state.links.push({
    id,
    source: sourceId,
    target: targetId
  });
  selectedLinkId = id;
  renderNetwork();
  populateEditableLinkOptions();
  setStatus("Linked");
  requestAutosave();
  return true;
}

function hideNetworkContextMenu(): void {
  networkContextMenu.classList.add("hidden");
  networkContextMenuCanvasPosition = null;
}

function showNetworkContextMenu(clientX: number, clientY: number): void {
  networkContextMenu.classList.remove("hidden");
  networkContextMenu.style.left = `${clientX}px`;
  networkContextMenu.style.top = `${clientY}px`;
}

function addSiblingFromSelection(position?: { x: number; y: number }): void {
  const selected = getSelectedNode();
  if (!selected || selected.parentId === null) {
    setStatus("Select a non-root node to add sibling");
    return;
  }
  addNode(selected.parentId, position);
  requestAutosave();
}

function requestAutosave(delayMs = 600): void {
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
    vscode.postMessage({ type: "updateDocument", payload: state });
  }, delayMs);
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
  addSiblingFromSelection();
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

nodeColorBtn.addEventListener("click", () => {
  nodeColorPanel.classList.toggle("hidden");
});

applyNodeColorBtn.addEventListener("click", () => {
  const selected = getSelectedNode();
  if (!selected) {
    return;
  }
  selected.nodeColor = nodeColorInput.value;
  renderNetwork();
  requestAutosave();
  setStatus("Node color applied");
});

clearNodeColorBtn.addEventListener("click", () => {
  const selected = getSelectedNode();
  if (!selected) {
    return;
  }
  selected.nodeColor = undefined;
  nodeColorInput.value = DEFAULT_NODE_COLOR;
  renderNetwork();
  requestAutosave();
  setStatus("Node color cleared");
});

linkSelect.addEventListener("change", () => {
  selectedLinkId = linkSelect.value || null;
  if (selectedLinkId && edgesData.get(selectedLinkId)) {
    network.selectEdges([selectedLinkId]);
  }
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
  addLink(selected.id, target);
});

linkModeBtn.addEventListener("click", () => {
  isLinkModeActive = !isLinkModeActive;
  resetLinkModeSource();
  updateLinkModeUI();
  renderNetwork();
  statusEl.textContent = "";
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
  if (selectedLinkId === id) {
    selectedLinkId = null;
  }
  renderNetwork();
  populateEditableLinkOptions();
  setStatus("Unlinked");
  requestAutosave();
});

saveBtn.addEventListener("click", () => {
  vscode.postMessage({ type: "requestSave" });
});

networkEl.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const rect = networkEl.getBoundingClientRect();
  const domPoint = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
  const clickedNodeId = network.getNodeAt(domPoint);
  if (clickedNodeId) {
    hideNetworkContextMenu();
    return;
  }
  networkContextMenuCanvasPosition = network.DOMtoCanvas(domPoint);
  showNetworkContextMenu(event.clientX, event.clientY);
});

networkMenuAddSiblingBtn.addEventListener("click", () => {
  addSiblingFromSelection(networkContextMenuCanvasPosition ?? undefined);
  hideNetworkContextMenu();
});

window.addEventListener("click", (event) => {
  const target = event.target as Node | null;
  if (target && networkContextMenu.contains(target)) {
    return;
  }
  hideNetworkContextMenu();
});

network.on("click", (event) => {
  hideNetworkContextMenu();
  if (!state) {
    return;
  }
  const first = event.nodes[0];
  const clickedEdgeId = (event.edges as string[])[0];

  if (isLinkModeActive && first) {
    const clickedNodeId = first as string;
    if (!linkModeSourceNodeId) {
      linkModeSourceNodeId = clickedNodeId;
      setSelectedNode(clickedNodeId);
      const sourceLabel = findNode(clickedNodeId)?.label ?? clickedNodeId;
      setStatus(`Link mode: source = ${sourceLabel}. Click target node`);
      return;
    }

    if (linkModeSourceNodeId === clickedNodeId) {
      setStatus("Link mode: source reselected, choose different target");
      return;
    }

    const sourceNodeId = linkModeSourceNodeId;
    resetLinkModeSource();
    setSelectedNode(clickedNodeId);
    const created = addLink(sourceNodeId, clickedNodeId);
    if (created) {
      setStatus("Linked (link mode)");
    }
    return;
  }

  if (clickedEdgeId) {
    if (first) {
      const clickedNodeId = first as string;
      setSelectedNode(clickedNodeId);
      return;
    }
    selectedLinkId = clickedEdgeId;
    populateEditableLinkOptions();
    if (edgesData.get(clickedEdgeId)) {
      network.selectEdges([clickedEdgeId]);
    }
    return;
  }

  if (!first) {
    return;
  }
  const clickedNodeId = first as string;
  setSelectedNode(clickedNodeId);
});

network.on("dragEnd", (event) => {
  if (!state) {
    return;
  }
  const moved = new Set<string>(event.nodes as string[]);
  if (imozuruDragContext) {
    for (const nodeId of imozuruDragContext.nodeIds) {
      moved.add(nodeId);
    }
  }
  for (const id of moved) {
    const position = network.getPosition(id);
    const node = findNode(id);
    if (!node || !position) {
      continue;
    }
    node.x = position.x;
    node.y = position.y;
  }
  imozuruDragContext = null;
  requestAutosave();
});

network.on("dragStart", (event) => {
  hideNetworkContextMenu();
  const movedNodeId = (event.nodes as string[])[0];
  if (!movedNodeId) {
    imozuruDragContext = null;
    return;
  }
  if (!isImozuruModifierPressed(event)) {
    imozuruDragContext = null;
    return;
  }
  const nextContext = buildImozuruDragContext(movedNodeId);
  imozuruDragContext = nextContext;
  if (nextContext) {
    setStatus("Imozuru mode: spring-follow dragging");
  }
});

network.on("dragging", (event) => {
  const movedNodeId = (event.nodes as string[])[0];
  if (!movedNodeId || !imozuruDragContext || movedNodeId !== imozuruDragContext.anchorId) {
    return;
  }
  applyImozuruSpringStep(imozuruDragContext);
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
updateLinkModeUI();
setupIconTooltips();
