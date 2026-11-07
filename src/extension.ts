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
      await panel.webview.postMessage({
        type: "init",
        payload: { document: loaded.doc, path: loaded.uri?.fsPath ?? "(unsaved)" }
      });
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

  context.subscriptions.push(openDisposable);
}

export function deactivate(): void {}
