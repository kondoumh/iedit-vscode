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
  const openDisposable = vscode.commands.registerCommand("iedit.openPrototype", async () => {
    const panel = vscode.window.createWebviewPanel("ieditPrototype", "iEdit Prototype", vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true
    });

    panel.webview.html = getHtml(panel.webview, context.extensionUri);

    let loaded: { uri: vscode.Uri | undefined; doc: IEditDocument };
    try {
      loaded = await loadDocument();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Failed to load iEdit document: ${message}`);
      loaded = { uri: getDocumentUri(), doc: defaultDocument() };
    }

    panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (typeof message !== "object" || message === null || !("type" in message)) {
        return;
      }
      const typed = message as { type: string; payload?: unknown };
      if (typed.type === "requestInit") {
        await panel.webview.postMessage({
          type: "init",
          payload: { document: loaded.doc, path: loaded.uri?.fsPath ?? "(unsaved)" }
        });
        return;
      }
      if (typed.type === "saveDocument") {
        try {
          const payload = typed.payload as IEditDocument;
          await saveDocument(loaded.uri, payload);
          loaded.doc = payload;
          await panel.webview.postMessage({ type: "saved" });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await panel.webview.postMessage({ type: "saveFailed", payload: message });
          vscode.window.showErrorMessage(`Failed to save iEdit document: ${message}`);
        }
      }
    });
  });

  context.subscriptions.push(openDisposable);
}

export function deactivate(): void {}
