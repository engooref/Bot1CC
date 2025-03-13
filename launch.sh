#!/bin/bash


cd /home/work/Bot1CC

FILE="/home/work/Bot1CC/run.lock"

if [ -f "$FILE" ]; then
    echo "??? Suppression du fichier $FILE"
    rm -f "$FILE"
else
    echo "? Aucun fichier à supprimer"
fi

sleep 5

source venv/bin/activate
pip3 install -r requirements.txt
python3 App.py

