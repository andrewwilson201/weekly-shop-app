#!/bin/sh
# Empties the Firestore and Auth emulators between test runs.
curl -s -X DELETE "http://localhost:8081/emulator/v1/projects/weekly-shop-177b1/databases/(default)/documents" > /dev/null
curl -s -X DELETE "http://localhost:9099/emulator/v1/projects/weekly-shop-177b1/accounts" > /dev/null
echo "emulators reset"
