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

function serializeDocument(document: IEditDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function parseDocumentText(text: string): IEditDocument {
  const parsed = JSON.parse(text) as IEditDocument;
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.links) || typeof parsed.selectedNodeId !== "string") {
    throw new Error("Invalid iEdit document");
  }
  return parsed;
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

      try {
        loaded.doc = parseDocumentText(document.getText());
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
        try {
          loaded.doc = parseDocumentText(event.document.getText());
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
            await applyDocumentToTextDocument(document, payload);
            outlineProvider.refresh();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to update iEdit document: ${message}`);
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
