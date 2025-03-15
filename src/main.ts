import "./style.css";
import "../node_modules/@xterm/xterm/css/xterm.css";
import { WebContainer } from "@webcontainer/api";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import * as monaco from "monaco-editor";

let webcontainerInstance: WebContainer;
let editor: monaco.editor.IStandaloneCodeEditor;
let currentFilePath: string | null = null;
const terminal = new Terminal({});
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.loadAddon(new WebLinksAddon());

const files = {
	"index.js": {
		file: {
			contents: `
import express from 'express';

console.log('Hello from WebContainers!');

// A simple Express server
const app = express();
const port = 3000;

app.get('/', (req, res) => {
  res.send('Hello World!');
});

app.listen(port, () => {
  console.log(\`Server running at http://localhost:\${port}/\`);
});
`,
		},
	},
	"package.json": {
		file: {
			contents: `
{
  "name": "browser-ide-project",
  "version": "1.0.0",
  "description": "A project running in the browser",
  "main": "index.js",
  "type": "module",
  "scripts": {
    "start": "node --watch index.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}`,
		},
	},
};

function initMonaco() {
	const terminalNode = document.getElementById("terminal");
	if (!terminalNode) throw new Error("Terminal element not found");
	terminal.open(terminalNode);

	const node = document.getElementById("editor-container");
	if (!node) throw new Error("Editor container element not found");

	editor = monaco.editor.create(node, {
		value: files["index.js"].file.contents,
		language: "javascript",
		theme: "vs-dark",
	});

	currentFilePath = "index.js";

	editor.onDidChangeModelContent(async () => {
		if (currentFilePath && webcontainerInstance) {
			const content = editor.getValue();
			await webcontainerInstance.fs.writeFile(currentFilePath, content);
			console.log(`File ${currentFilePath} saved`);
		}
	});
}

async function initWebContainer() {
	try {
		webcontainerInstance = await WebContainer.boot({
			workdirName: "my-workdir",
		});
		const shellProcess = await webcontainerInstance.spawn("jsh", {
			terminal: {
				cols: terminal.cols,
				rows: terminal.rows,
			},
		});
		fitAddon.fit();
		// Wire up the terminal to the shell process
		shellProcess.output.pipeTo(
			new WritableStream({
				write(data) {
					terminal.write(data);
				},
			}),
		);

		const writer = shellProcess.input.getWriter();
		terminal.onData((data) => {
			writer.write(data);
		});

		// Make sure to release the writer when done (if the terminal is closed)
		const cleanup = () => writer.releaseLock();
		window.addEventListener("beforeunload", cleanup);

		// Listen to terminal resize events
		terminal.onResize(({ cols, rows }) => {
			if (shellProcess?.resize) {
				shellProcess.resize({
					cols,
					rows,
				});
			}
		});

		await webcontainerInstance.mount(files);

		const preview = document.getElementById("preview");
		if (!(preview instanceof HTMLIFrameElement))
			throw new Error("Preview element not found");

		webcontainerInstance.on("server-ready", (_port, url) => {
			console.log(`Server running at ${url}`);
			preview.src = url.toString();
		});

		await updateFileExplorer();
	} catch (error) {
		if (error instanceof Error) {
			console.error("WebContainer initialization error:", error);
			console.log(`Error initializing WebContainer: ${error.message}`);
		}
	}
}

async function updateFileExplorer() {
	const explorer = document.getElementById("file-explorer");
	if (!explorer) throw new Error("File explorer element not found");

	explorer.innerHTML = "";

	const fileList = await webcontainerInstance.fs.readdir("/", {
		withFileTypes: true,
	});

	for (const file of fileList) {
		const fileElement = document.createElement("div");
		fileElement.textContent = file.name;
		fileElement.style.padding = "5px";
		fileElement.style.cursor = "pointer";

		if (file.name === currentFilePath) {
			fileElement.style.backgroundColor = "#3c3c3c";
		}

		fileElement.addEventListener("click", async () => {
			try {
				const content = await webcontainerInstance.fs.readFile(
					file.name,
					"utf-8",
				);

				let language = "text";
				if (file.name.endsWith(".js")) language = "javascript";
				else if (file.name.endsWith(".json")) language = "json";
				else if (file.name.endsWith(".html")) language = "html";
				else if (file.name.endsWith(".css")) language = "css";

				editor.setValue(content);
				const model = editor.getModel();
				if (!model) throw new Error("Editor model not found");
				monaco.editor.setModelLanguage(model, language);

				currentFilePath = file.name;
				await updateFileExplorer();
			} catch (error) {
				if (error instanceof Error) {
					console.log(`Error opening file: ${error.message}`);
				} else {
					console.log(`Error opening file: ${error}`);
				}
			}
		});

		explorer.appendChild(fileElement);
	}
}

window.addEventListener("load", async () => {
	initMonaco();
	await initWebContainer();
});
