const { app, BrowserWindow } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const url = require("url");
const fs = require("fs");

let mainWindow;
let p2pProcess;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(__dirname, "./dist/index.html"),
      protocol: "file:",
      slashes: true,
    });

  mainWindow.loadURL(startUrl);
  mainWindow.on("closed", function () {
    mainWindow = null;
    if (p2pProcess) {
      p2pProcess.kill();
    }
  });
}

// Start the p2pConection backend
function startP2PBackend() {
  // Use the p2pConection executable in the same directory
  let p2pBinaryPath = path.join(__dirname, "p2pConection.exe");
  let args = [];

  // Check if binary exists
  if (!fs.existsSync(p2pBinaryPath)) {
    console.error(`P2P binary not found at: ${p2pBinaryPath}`);
    console.error(
      "Please make sure p2pConection.exe is in the frontend directory"
    );
    return;
  }

  console.log(`Starting p2pConection backend from: ${p2pBinaryPath}`);
  p2pProcess = spawn(p2pBinaryPath, args, {
    stdio: "inherit",
  });

  p2pProcess.on("close", (code) => {
    console.log(`p2pConection process exited with code ${code}`);
  });

  p2pProcess.on("error", (err) => {
    console.error("Failed to start p2pConection process:", err);
  });
}

app.on("ready", () => {
  startP2PBackend();
  setTimeout(createWindow, 2000); // Give the backend some time to start
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    if (p2pProcess) {
      p2pProcess.kill();
    }
    app.quit();
  }
});

app.on("activate", function () {
  if (mainWindow === null) {
    createWindow();
  }
});
