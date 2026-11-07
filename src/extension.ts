import * as vscode from "vscode";

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

function getDocumentUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  return vscode.Uri.joinPath(folder.uri, ".iedit.json");
}

async function loadDocument(): Promise<{ uri: vscode.Uri | undefined; doc: IEditDocument }> {
  const uri = getDocumentUri();
  if (!uri) {
    return { uri: undefined, doc: defaultDocument() };
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const json = Buffer.from(bytes).toString("utf8");
    const parsed = JSON.parse(json) as IEditDocument;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.links) || typeof parsed.selectedNodeId !== "string") {
      throw new Error("Invalid iEdit document");
    }
    return { uri, doc: parsed };
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") {
      return { uri, doc: defaultDocument() };
    }
    throw error;
  }
}

async function saveDocument(uri: vscode.Uri | undefined, doc: IEditDocument): Promise<void> {
  if (!uri) {
    throw new Error("No workspace folder is open. Open a folder to save .iedit.json.");
  }
  const payload = JSON.stringify(doc, null, 2);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, "utf8"));
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

export function activate(context: vscode.ExtensionContext): void {
  let panel: vscode.WebviewPanel | undefined;
  let loaded = { uri: getDocumentUri(), doc: defaultDocument() };
  const outlineProvider = new IEditOutlineProvider(() => loaded.doc);
  const outlineView = vscode.window.createTreeView("iedit.outlineView", {
    treeDataProvider: outlineProvider,
    showCollapseAll: true
  });

  const postSelectionToWebview = async (): Promise<void> => {
    if (!panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "externalSelectNode",
      payload: { nodeId: loaded.doc.selectedNodeId }
    });
  };

  const postDocumentToWebview = async (): Promise<void> => {
    if (!panel) {
      return;
    }
    await panel.webview.postMessage({
      type: "init",
      payload: { document: loaded.doc, path: loaded.uri?.fsPath ?? "(unsaved)" }
    });
  };

  const persistOutlineChange = async (): Promise<void> => {
    await saveDocument(loaded.uri, loaded.doc);
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
    const insertIndex =
      direction < 0 ? targetIndexes[0] : targetIndexes[targetIndexes.length - 1] + 1;
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
      if (!selected) {
        return;
      }
      loaded.doc.selectedNodeId = selected.id;
      outlineProvider.refresh();
      await postSelectionToWebview();
    })
  );

  const openDisposable = vscode.commands.registerCommand("iedit.openPrototype", async () => {
    if (panel) {
      panel.reveal(vscode.ViewColumn.One);
      await postDocumentToWebview();
      return;
    }

    panel = vscode.window.createWebviewPanel("ieditPrototype", "iEdit Prototype", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    panel.webview.html = getHtml(panel.webview, context.extensionUri);

    panel.onDidDispose(() => {
      panel = undefined;
    });

    try {
      loaded = await loadDocument();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to load iEdit document: ${message}`);
      loaded = { uri: getDocumentUri(), doc: defaultDocument() };
    }
    outlineProvider.refresh();

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message)) {
        return;
      }
      const typed = message as { type: string; payload?: unknown };
      if (typed.type === "requestInit") {
        await panel?.webview.postMessage({
          type: "init",
          payload: { document: loaded.doc, path: loaded.uri?.fsPath ?? "(unsaved)" }
        });
        return;
      }
      if (typed.type === "selectionChanged") {
        const payload = typed.payload as { nodeId: string };
        loaded.doc.selectedNodeId = payload.nodeId;
        outlineProvider.refresh();
        const node = outlineProvider.findNode(payload.nodeId);
        if (node) {
          await outlineView.reveal(node, { select: true, focus: false, expand: true });
        }
        return;
      }
      if (typed.type === "saveDocument") {
        try {
          const payload = typed.payload as IEditDocument;
          await saveDocument(loaded.uri, payload);
          loaded.doc = payload;
          outlineProvider.refresh();
          await panel?.webview.postMessage({ type: "saved" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await panel?.webview.postMessage({ type: "saveFailed", payload: message });
          vscode.window.showErrorMessage(`Failed to save iEdit document: ${message}`);
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
        await panel?.webview.postMessage({
          type: "promptResult",
          payload: {
            requestId: payload.requestId,
            cancelled: input === undefined,
            value: input ?? ""
          }
        });
      }
    });
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
    openDisposable,
    moveUpDisposable,
    moveDownDisposable,
    indentDisposable,
    outdentDisposable
  );
}

export function deactivate(): void {}
