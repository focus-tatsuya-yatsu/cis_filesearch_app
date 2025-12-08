#!/bin/sh
# Health check script for CIS File Scanner

# Check if the database file exists and is accessible
if [ -f "$DB_PATH" ]; then
    # Database exists, check if it's readable
    if [ -r "$DB_PATH" ]; then
        echo "Health check: OK - Database accessible"
        exit 0
    else
        echo "Health check: ERROR - Database not readable"
        exit 1
    fi
else
    # Database doesn't exist yet (first run)
    echo "Health check: OK - First run"
    exit 0
fi