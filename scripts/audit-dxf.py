"""Audit DXF files with ezdxf (development check; not part of the test suite).

    python3 -m pip install ezdxf
    pnpm exec tsx scripts/sample-dxf.ts /tmp/sample.dxf   # or any DXF Spoolyard exported
    python3 scripts/audit-dxf.py /tmp/sample.dxf

Reads each file the way AutoCAD's RECOVER does and reports every structural error and every fix ezdxf would
have to make. Exits 1 if any file needed one.
"""
import sys

try:
    from ezdxf import recover
except ImportError:
    sys.exit("ezdxf is not installed: python3 -m pip install ezdxf")

failed = False
for name in sys.argv[1:]:
    doc, auditor = recover.readfile(name)
    audit = doc.audit()
    problems = [("error", e) for e in auditor.errors + audit.errors] + [("fix", f) for f in auditor.fixes + audit.fixes]
    print(f"{name}: {doc.dxfversion}, {len(doc.modelspace())} entities, {len(problems)} problem(s)")
    for kind, entry in problems:
        print(f"  {kind} {entry.code}: {entry.message}")
    failed = failed or bool(problems)
sys.exit(1 if failed else 0)
