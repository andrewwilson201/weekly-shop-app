#!/bin/sh
# Empties the Firestore and Auth emulators between test runs.
curl -s -X DELETE "http://localhost:8081/emulator/v1/projects/music-app-d0f3f/databases/(default)/documents" > /dev/null
curl -s -X DELETE "http://localhost:9099/emulator/v1/projects/music-app-d0f3f/accounts" > /dev/null
echo "emulators reset"
