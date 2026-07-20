#!/bin/bash

# A single `pnpm install` installs both the server and client (pnpm
# workspace) and builds everything via the root "prepare" script.
echo "Installing dependencies and building (root + client, via pnpm workspace)..."
pnpm install

echo ""
echo "======================================"
echo "Installation complete!"
echo ""
echo "To start the application, run:"
echo "npm start"
echo "======================================="
