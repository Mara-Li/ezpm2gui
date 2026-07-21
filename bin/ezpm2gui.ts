#!/usr/bin/env node
import path from 'path';
import fs from 'fs';

// Determine the path to the compiled server entry point
const serverPath = path.join(__dirname, '../dist/server/index.js');

// Check if the server file exists
if (!fs.existsSync(serverPath)) {
  console.error('Error: Server executable not found. Please make sure the package is built correctly.');
  process.exit(1);
}

// Run the server in this process rather than spawning a child. Under a
// process supervisor (systemd, PM2, ...) that tracks this CLI's PID and
// restarts it on failure, a spawned child can outlive a supervisor-triggered
// restart of this wrapper as an orphan still bound to the port, silently
// serving stale data alongside the freshly restarted instance. Calling
// startServer() directly means the supervisor's signals and restarts apply
// to the actual HTTP server, not a proxy for it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { startServer } = require(serverPath) as { startServer: () => unknown };

// Log startup message
console.log('\x1b[36m%s\x1b[0m', `
╔════════════════════════════════════╗
║         EZ PM2 GUI Started         ║
╚════════════════════════════════════╝

Web interface available at: \x1b[1mhttp://localhost:${process.env.PORT || 3101}\x1b[0m

Press Ctrl+C to stop the server.
`);

startServer();
