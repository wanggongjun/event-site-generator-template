#!/usr/bin/env python3
"""Read-only canonical XLSX validation; creates no output."""
from generate import main
import sys
if __name__ == '__main__':
    raise SystemExit(main([*sys.argv[1:], '--validate-only']))
