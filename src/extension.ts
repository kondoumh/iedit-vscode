import * as vscode from "vscode";

const IEDIT_VIEW_TYPE = "iedit.editor";

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

interface ParseResult {
  document: IEditDocument;
  warnings: string[];
}

interface InputRequestPayload {
  requestId: string;
  title: string;
  value: string;
  placeHolder?: string;
}

class IEditOutlineProvider implements vscode.TreeDataProvider<IEditNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<IEditNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly getDocument: () => IEditDocument) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: IEditNode): vscode.TreeItem {
    const hasChildren = this.getDocument().nodes.some((node) => node.parentId === element.id);
    const item = new vscode.TreeItem(
      element.label,
      hasChildren ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    item.id = element.id;
    item.description = element.id === this.getDocument().selectedNodeId ? "selected" : undefined;
    return item;
  }

  getChildren(element?: IEditNode): IEditNode[] {
    const document = this.getDocument();
    if (!element) {
      return document.nodes.filter((node) => node.parentId === null);
    }
    return document.nodes.filter((node) => node.parentId === element.id);
  }

  findNode(id: string): IEditNode | undefined {
    return this.getDocument().nodes.find((node) => node.id === id);
  }
}

function defaultDocument(): IEditDocument {
  return {
    version: 1,
    selectedNodeId: "root",
    nodes: [{ id: "root", parentId: null, label: "Root", text: "" }],
    links: []
  };
}

function serializeDocument(document: IEditDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function shapeFromLegacy(value: unknown): NodeShape | undefined {
  if (value === "rectangle") {
    return "box";
  }
  if (value === "rounded-rectangle") {
    return "roundbox";
  }
  if (value === "elipse" || value === "ellipse") {
    return "ellipse";
  }
  return undefined;
}

function parseLegacyDocument(parsed: unknown): ParseResult | undefined {
  if (typeof parsed !== "object" || parsed === null || !("ieditDoc" in parsed)) {
    return undefined;
  }
  const legacyRoot = (parsed as { ieditDoc?: unknown }).ieditDoc;
  if (typeof legacyRoot !== "object" || legacyRoot === null) {
    throw new Error("Invalid legacy iEdit document");
  }
  const legacyNodes = (legacyRoot as { nodes?: unknown }).nodes;
  const legacyLinks = (legacyRoot as { links?: unknown }).links;
  if (!Array.isArray(legacyNodes) || !Array.isArray(legacyLinks)) {
    throw new Error("Invalid legacy iEdit document");
  }

  const nodes: IEditNode[] = [];
  const idSet = new Set<string>();
  const parentById = new Map<string, string | null>();
  let fallbackNodeCounter = 1;

  for (const legacyNode of legacyNodes) {
    if (typeof legacyNode !== "object" || legacyNode === null) {
      continue;
    }
    const key = (legacyNode as { key?: unknown }).key;
    const rawId = typeof key === "number" || typeof key === "string" ? String(key) : `legacy-${fallbackNodeCounter++}`;
    const id = idSet.has(rawId) ? `legacy-${fallbackNodeCounter++}` : rawId;
    idSet.add(id);

    const parentKey = (legacyNode as { parent?: unknown }).parent;
    const parentId = typeof parentKey === "number" || typeof parentKey === "string" ? String(parentKey) : null;
    parentById.set(id, parentId);

    const labelValue = (legacyNode as { label?: unknown }).label;
    const textValue = (legacyNode as { text?: unknown }).text;
    const fill = (legacyNode as { fill?: unknown }).fill;
    const fillColor = (legacyNode as { fillColor?: unknown }).fillColor;
    const bound = (legacyNode as { bound?: unknown }).bound;

    let x: number | undefined;
    let y: number | undefined;
    if (typeof bound === "object" && bound !== null) {
      const left = (bound as { left?: unknown }).left;
      const right = (bound as { right?: unknown }).right;
      const top = (bound as { top?: unknown }).top;
      const bottom = (bound as { bottom?: unknown }).bottom;
      if (typeof left === "number" && typeof right === "number") {
        x = (left + right) / 2;
      }
      if (typeof top === "number" && typeof bottom === "number") {
        y = (top + bottom) / 2;
      }
    }

    nodes.push({
      id,
      parentId: null,
      label: typeof labelValue === "string" ? labelValue : "",
      text: typeof textValue === "string" ? textValue : "",
      x,
      y,
      shape: shapeFromLegacy((legacyNode as { shape?: unknown }).shape),
      nodeColor: fill === true && typeof fillColor === "string" && fillColor.trim().length > 0 ? fillColor : undefined
    });
  }

  for (const node of nodes) {
    const originalParentId = parentById.get(node.id);
    node.parentId = originalParentId && originalParentId !== node.id && idSet.has(originalParentId) ? originalParentId : null;
  }

  const warnings: string[] = [];
  const links: IEditLink[] = [];
  let droppedExternalLinkCount = 0;
  let droppedInvalidLinkCount = 0;

  for (let index = 0; index < legacyLinks.length; index += 1) {
    const legacyLink = legacyLinks[index];
    if (typeof legacyLink !== "object" || legacyLink === null) {
      droppedInvalidLinkCount += 1;
      continue;
    }
    const from = (legacyLink as { from?: unknown }).from;
    const to = (legacyLink as { to?: unknown }).to;
    const sourceId = typeof from === "number" || typeof from === "string" ? String(from) : undefined;
    const targetId = typeof to === "number" || typeof to === "string" ? String(to) : undefined;
    if (!sourceId || !targetId) {
      droppedExternalLinkCount += 1;
      continue;
    }
    if (!idSet.has(sourceId) || !idSet.has(targetId)) {
      droppedInvalidLinkCount += 1;
      continue;
    }
    const caption = (legacyLink as { caption?: unknown }).caption;
    links.push({
      id: `link-${index + 1}`,
      source: sourceId,
      target: targetId,
      label: typeof caption === "string" && caption.length > 0 ? caption : undefined
    });
  }

  const selectedNodeId = nodes.find((node) => node.parentId === null)?.id ?? nodes[0]?.id ?? "root";
  if (droppedExternalLinkCount > 0) {
    warnings.push(`Legacy external links were skipped: ${droppedExternalLinkCount}`);
  }
  if (droppedInvalidLinkCount > 0) {
    warnings.push(`Invalid legacy links were skipped: ${droppedInvalidLinkCount}`);
  }

  return {
    document: {
      version: 1,
      selectedNodeId,
      nodes: nodes.length > 0 ? nodes : defaultDocument().nodes,
      links
    },
    warnings
  };
}

function parseDocumentText(text: string): ParseResult {
  const normalizedText = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const parsed = JSON.parse(normalizedText) as unknown;
  const legacy = parseLegacyDocument(parsed);
  if (legacy) {
    return legacy;
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid iEdit document");
  }
  const nodes = (parsed as { nodes?: unknown }).nodes;
  const links = (parsed as { links?: unknown }).links;
  const selectedNodeId = (parsed as { selectedNodeId?: unknown }).selectedNodeId;
  if (!Array.isArray(nodes) || !Array.isArray(links) || typeof selectedNodeId !== "string") {
    throw new Error("Invalid iEdit document");
  }
  return { document: parsed as IEditDocument, warnings: [] };
}

function getDocumentUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return vscode.Uri.joinPath(folder.uri, ".iedit.json");
}

function getHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const nonce = crypto.randomUUID().replace(/-/g, "");
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>iEdit Prototype</title>
  </head>
  <body>
    <div id="app"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  const lastLine = document.lineAt(document.lineCount - 1);
  return new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length);
}

export function activate(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  let activeTextDocument: vscode.TextDocument | undefined;
  let loaded = { uri: getDocumentUri(), doc: defaultDocument() };
  const outlineProvider = new IEditOutlineProvider(() => loaded.doc);
  const outlineView = vscode.window.createTreeView("iedit.outlineView", {
    treeDataProvider: outlineProvider,
    showCollapseAll: true
  });

  const postDocumentToWebview = async (): Promise<void> => {
    if (!panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "init",
      payload: { document: loaded.doc, path: loaded.uri?.fsPath ?? "(unsaved)" }
    });
  };

  const postSelectionToWebview = async (): Promise<void> => {
    if (!panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "externalSelectNode",
      payload: { nodeId: loaded.doc.selectedNodeId }
    });
  };

  const applyDocumentToTextDocument = async (
    document: vscode.TextDocument,
    nextDocument: IEditDocument
  ): Promise<void> => {
    const nextText = serializeDocument(nextDocument);
    if (document.getText() === nextText) {
      return;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullDocumentRange(document), nextText);
    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
      throw new Error("Failed to apply iEdit document change");
    }
  };

  const persistOutlineChange = async (): Promise<void> => {
    const document = activeTextDocument ?? (loaded.uri ? await vscode.workspace.openTextDocument(loaded.uri) : undefined);
    if (!document) {
      return;
    }
    activeTextDocument = document;
    await applyDocumentToTextDocument(document, loaded.doc);
    outlineProvider.refresh();
    await postDocumentToWebview();
  };

  const findNodeById = (nodeId: string): IEditNode | undefined => {
    return loaded.doc.nodes.find((node) => node.id === nodeId);
  };

  const getSelectedNode = (): IEditNode | undefined => {
    return findNodeById(loaded.doc.selectedNodeId);
  };

  const collectSubtreeIds = (rootId: string): Set<string> => {
    const ids = new Set<string>();
    const walk = (nodeId: string): void => {
      ids.add(nodeId);
      for (const node of loaded.doc.nodes) {
        if (node.parentId === nodeId) {
          walk(node.id);
        }
      }
    };
    walk(rootId);
    return ids;
  };

  const moveSubtreeBlock = (sourceId: string, insertIndexInRemaining: number): void => {
    const sourceSubtreeIds = collectSubtreeIds(sourceId);
    const sourceBlock = loaded.doc.nodes.filter((node) => sourceSubtreeIds.has(node.id));
    const remaining = loaded.doc.nodes.filter((node) => !sourceSubtreeIds.has(node.id));
    const boundedIndex = Math.min(Math.max(insertIndexInRemaining, 0), remaining.length);
    loaded.doc.nodes = [
      ...remaining.slice(0, boundedIndex),
      ...sourceBlock,
      ...remaining.slice(boundedIndex)
    ];
  };

  const getSiblingNodes = (node: IEditNode): IEditNode[] => {
    return loaded.doc.nodes.filter((candidate) => candidate.parentId === node.parentId);
  };

  const resolveTargetNode = (target?: IEditNode): IEditNode | undefined => {
    if (target) {
      loaded.doc.selectedNodeId = target.id;
      return target;
    }
    return getSelectedNode();
  };

  const moveSelectedNode = async (direction: -1 | 1, target?: IEditNode): Promise<void> => {
    const sourceNode = resolveTargetNode(target);
    if (!sourceNode || sourceNode.id === "root") {
      return;
    }
    const siblings = getSiblingNodes(sourceNode);
    const currentIndex = siblings.findIndex((node) => node.id === sourceNode.id);
    const swapIndex = currentIndex + direction;
    if (currentIndex < 0 || swapIndex < 0 || swapIndex >= siblings.length) {
      return;
    }
    const swapNode = siblings[swapIndex];
    const swapSubtreeIds = collectSubtreeIds(swapNode.id);
    const sourceSubtreeIds = collectSubtreeIds(sourceNode.id);
    const remaining = loaded.doc.nodes.filter((node) => !sourceSubtreeIds.has(node.id));
    const targetIndexes = remaining
      .map((node, index) => ({ node, index }))
      .filter((entry) => swapSubtreeIds.has(entry.node.id))
      .map((entry) => entry.index);
    if (targetIndexes.length === 0) {
      return;
    }
    const insertIndex = direction < 0 ? targetIndexes[0] : targetIndexes[targetIndexes.length - 1] + 1;
    moveSubtreeBlock(sourceNode.id, insertIndex);
    loaded.doc.selectedNodeId = sourceNode.id;
    await persistOutlineChange();
  };

  const indentSelectedNode = async (target?: IEditNode): Promise<void> => {
    const sourceNode = resolveTargetNode(target);
    if (!sourceNode || sourceNode.id === "root") {
      return;
    }
    const siblings = getSiblingNodes(sourceNode);
    const currentIndex = siblings.findIndex((node) => node.id === sourceNode.id);
    if (currentIndex <= 0) {
      return;
    }
    const newParent = siblings[currentIndex - 1];
    sourceNode.parentId = newParent.id;

    const sourceSubtreeIds = collectSubtreeIds(sourceNode.id);
    const newParentSubtreeIds = collectSubtreeIds(newParent.id);
    const remaining = loaded.doc.nodes.filter((node) => !sourceSubtreeIds.has(node.id));
    const targetIndexes = remaining
      .map((node, index) => ({ node, index }))
      .filter((entry) => newParentSubtreeIds.has(entry.node.id))
      .map((entry) => entry.index);
    if (targetIndexes.length === 0) {
      return;
    }
    moveSubtreeBlock(sourceNode.id, targetIndexes[targetIndexes.length - 1] + 1);
    loaded.doc.selectedNodeId = sourceNode.id;
    await persistOutlineChange();
  };

  const outdentSelectedNode = async (target?: IEditNode): Promise<void> => {
    const sourceNode = resolveTargetNode(target);
    if (!sourceNode || sourceNode.id === "root" || sourceNode.parentId === null) {
      return;
    }
    const parent = findNodeById(sourceNode.parentId);
    if (!parent) {
      return;
    }
    const sourceSubtreeIds = collectSubtreeIds(sourceNode.id);
    const parentSubtreeIds = collectSubtreeIds(parent.id);
    for (const nodeId of sourceSubtreeIds) {
      parentSubtreeIds.delete(nodeId);
    }

    sourceNode.parentId = parent.parentId;
    const remaining = loaded.doc.nodes.filter((node) => !sourceSubtreeIds.has(node.id));
    const targetIndexes = remaining
      .map((node, index) => ({ node, index }))
      .filter((entry) => parentSubtreeIds.has(entry.node.id))
      .map((entry) => entry.index);
    if (targetIndexes.length === 0) {
      return;
    }
    moveSubtreeBlock(sourceNode.id, targetIndexes[targetIndexes.length - 1] + 1);
    loaded.doc.selectedNodeId = sourceNode.id;
    await persistOutlineChange();
  };

  context.subscriptions.push(
    outlineView,
    outlineView.onDidChangeSelection(async (event) => {
      const selected = event.selection[0];
      if (!selected || loaded.doc.selectedNodeId === selected.id) {
        return;
      }
      loaded.doc.selectedNodeId = selected.id;
      outlineProvider.refresh();
      await postSelectionToWebview();
    })
  );

  const customEditorProvider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, webviewPanel): void {
      panel = webviewPanel;
      activeTextDocument = document;
      loaded.uri = document.uri;
      let pendingWebviewDocumentUpdates = 0;

      try {
        const parsed = parseDocumentText(document.getText());
        loaded.doc = parsed.document;
        for (const warning of parsed.warnings) {
          void vscode.window.showWarningMessage(warning);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to parse iEdit document: ${message}`);
        loaded.doc = defaultDocument();
      }

      webviewPanel.webview.options = { enableScripts: true };
      webviewPanel.webview.html = getHtml(webviewPanel.webview, context.extensionUri);
      outlineProvider.refresh();
      void postDocumentToWebview();

      const textChangeDisposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
        if (event.document.uri.toString() !== document.uri.toString()) {
          return;
        }
        activeTextDocument = event.document;
        if (pendingWebviewDocumentUpdates > 0) {
          return;
        }
        try {
          const parsed = parseDocumentText(event.document.getText());
          loaded.doc = parsed.document;
          for (const warning of parsed.warnings) {
            void vscode.window.showWarningMessage(warning);
          }
          outlineProvider.refresh();
          await postDocumentToWebview();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Failed to parse iEdit document update: ${message}`);
        }
      });

      const messageDisposable = webviewPanel.webview.onDidReceiveMessage(async (message: unknown) => {
        if (typeof message !== "object" || message === null || !("type" in message)) {
          return;
        }
        const typed = message as { type: string; payload?: unknown };
        if (typed.type === "requestInit") {
          await postDocumentToWebview();
          return;
        }
        if (typed.type === "selectionChanged") {
          const payload = typed.payload as { nodeId: string };
          if (loaded.doc.selectedNodeId === payload.nodeId) {
            return;
          }
          loaded.doc.selectedNodeId = payload.nodeId;
          outlineProvider.refresh();
          const node = outlineProvider.findNode(payload.nodeId);
          if (node) {
            await outlineView.reveal(node, { select: true, focus: false, expand: true });
          }
          return;
        }
        if (typed.type === "updateDocument") {
          const payload = typed.payload as IEditDocument;
          loaded.doc = payload;
          try {
            pendingWebviewDocumentUpdates += 1;
            await applyDocumentToTextDocument(document, payload);
            outlineProvider.refresh();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to update iEdit document: ${message}`);
          } finally {
            pendingWebviewDocumentUpdates = Math.max(0, pendingWebviewDocumentUpdates - 1);
          }
          return;
        }
        if (typed.type === "requestSave") {
          const saved = await document.save();
          if (saved) {
            await webviewPanel.webview.postMessage({ type: "saved" });
          } else {
            await webviewPanel.webview.postMessage({ type: "saveFailed", payload: "Save was cancelled or failed" });
          }
          return;
        }
        if (typed.type === "requestInput") {
          const payload = typed.payload as InputRequestPayload;
          const input = await vscode.window.showInputBox({
            title: payload.title,
            value: payload.value,
            placeHolder: payload.placeHolder
          });
          await webviewPanel.webview.postMessage({
            type: "promptResult",
            payload: {
              requestId: payload.requestId,
              cancelled: input === undefined,
              value: input ?? ""
            }
          });
        }
      });

      const disposeDisposable = webviewPanel.onDidDispose(() => {
        if (panel === webviewPanel) {
          panel = undefined;
        }
      });

      context.subscriptions.push(textChangeDisposable, messageDisposable, disposeDisposable);
    }
  };

  const customEditorDisposable = vscode.window.registerCustomEditorProvider(IEDIT_VIEW_TYPE, customEditorProvider, {
    webviewOptions: { retainContextWhenHidden: true }
  });

  const openDisposable = vscode.commands.registerCommand("iedit.openPrototype", async () => {
    const uri = getDocumentUri();
    if (!uri) {
      vscode.window.showErrorMessage("Open a workspace folder before opening iEdit.");
      return;
    }
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeDocument(defaultDocument()), "utf8"));
    }
    await vscode.commands.executeCommand("vscode.openWith", uri, IEDIT_VIEW_TYPE, vscode.ViewColumn.One);
  });

  const moveUpDisposable = vscode.commands.registerCommand("iedit.outline.moveUp", async (target?: IEditNode) => {
    await moveSelectedNode(-1, target);
  });
  const moveDownDisposable = vscode.commands.registerCommand(
    "iedit.outline.moveDown",
    async (target?: IEditNode) => {
      await moveSelectedNode(1, target);
    }
  );
  const indentDisposable = vscode.commands.registerCommand("iedit.outline.indent", async (target?: IEditNode) => {
    await indentSelectedNode(target);
  });
  const outdentDisposable = vscode.commands.registerCommand(
    "iedit.outline.outdent",
    async (target?: IEditNode) => {
      await outdentSelectedNode(target);
    }
  );

  context.subscriptions.push(
    customEditorDisposable,
    openDisposable,
    moveUpDisposable,
    moveDownDisposable,
    indentDisposable,
    outdentDisposable
  );
}

export function deactivate(): void {}
