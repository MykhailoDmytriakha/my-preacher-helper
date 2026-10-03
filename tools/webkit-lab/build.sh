#!/bin/sh
# Builds the app's real device storage module (and idb-keyval) for the lab pages: c.html runs it in Safari.
set -e
LAB="$(cd "$(dirname "$0")" && pwd)"
FRONTEND="$LAB/../../frontend"
rm -rf "$LAB/build"
(cd "$FRONTEND" && npx tsc app/utils/deviceStorage.ts --target es2020 --module es2020 --outDir "$LAB/build" --skipLibCheck --moduleResolution node)
sed "s#from 'idb-keyval'#from './idb-keyval.js'#" "$LAB/build/deviceStorage.js" > "$LAB/deviceStorage.js"
cp "$FRONTEND/node_modules/idb-keyval/dist/index.js" "$LAB/idb-keyval.js"
rm -rf "$LAB/build"
echo "built: $LAB/deviceStorage.js"
