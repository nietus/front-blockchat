import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Get directory name correctly in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("Starting BlockChat application...");

// First, start the p2pConection executable
let p2pBinaryPath = path.join(__dirname, "p2pConection.exe");

// Check if binary exists
if (!fs.existsSync(p2pBinaryPath)) {
  console.error(`ERROR: P2P binary not found at: ${p2pBinaryPath}`);
  process.exit(1);
}

console.log(`Starting p2pConection from: ${p2pBinaryPath}`);
const p2pProcess = spawn(p2pBinaryPath, [], {
  stdio: "inherit",
});

p2pProcess.on("error", (err) => {
  console.error("Failed to start p2pConection process:", err);
});

// Start the frontend
console.log("Starting frontend server...");
const frontendProcess = spawn("npm", ["run", "dev"], {
  stdio: "inherit",
  shell: true,
});

// Handle shutdown
const cleanup = () => {
  console.log("Shutting down...");
  if (p2pProcess) {
    p2pProcess.kill();
  }
  if (frontendProcess) {
    frontendProcess.kill();
  }
  process.exit(0);
};

// Handle termination signals
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("exit", cleanup);

console.log(
  "BlockChat startup complete! Access the application at http://localhost:5173"
);
