#!/usr/bin/env python3
import argparse
import json
from pathlib import Path
from typing import List


def read_lab_text(lab_path: Path) -> str:
    try:
        text = lab_path.read_text(encoding='utf-8', errors='ignore')
        for line in text.splitlines():
            if line.strip():
                return line.strip()
        return text.strip()
    except Exception:
        return ""


def collect_items(data_dir: Path) -> List[dict]:
    items: List[dict] = []
    for wav in sorted(data_dir.rglob("*.wav")):
        if not wav.is_file():
            continue
        rel = wav.relative_to(data_dir)
        base = wav.stem
        lab = wav.with_suffix('.lab')
        label_text = read_lab_text(lab) if lab.exists() else ""
        items.append({
            "id": base,
            # Path relative to the site root (index.html alongside data_dir.parent)
            "audio": f"{data_dir.name}/{rel.as_posix()}",
            "label": label_text,
            "filename": wav.name,
        })
    return items


def main():
    parser = argparse.ArgumentParser(description="Generate manifest.json for audio-text matching survey.")
    parser.add_argument("data_dir", type=str, help="Path to folder containing .wav and .lab files")
    parser.add_argument("--out", type=str, default=None, help="Output manifest path (default: <data_dir>/manifest.json)")
    args = parser.parse_args()

    data_dir = Path(args.data_dir).resolve()
    if not data_dir.exists() or not data_dir.is_dir():
        raise SystemExit(f"Data dir not found: {data_dir}")

    items = collect_items(data_dir)

    out_path = Path(args.out).resolve() if args.out else (data_dir / "manifest.json")
    out_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Wrote {len(items)} items to {out_path}")


if __name__ == "__main__":
    main()