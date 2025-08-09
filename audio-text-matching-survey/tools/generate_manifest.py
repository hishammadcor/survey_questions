#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def read_lab_text(lab_path: Path) -> str:
    try:
        text = lab_path.read_text(encoding='utf-8', errors='ignore')
        # Use first non-empty line; fallback to full content stripped
        for line in text.splitlines():
            if line.strip():
                return line.strip()
        return text.strip()
    except Exception as e:
        return ""


def main():
    parser = argparse.ArgumentParser(description="Generate manifest.json for audio-text matching survey.")
    parser.add_argument("data_dir", type=str, help="Path to folder containing .wav and .lab files")
    parser.add_argument("--out", type=str, default=None, help="Output manifest path (default: <data_dir>/manifest.json)")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists() or not data_dir.is_dir():
        raise SystemExit(f"Data dir not found: {data_dir}")

    wav_files = sorted(p for p in data_dir.iterdir() if p.suffix.lower() == ".wav")

    items = []
    for wav in wav_files:
        base = wav.stem
        lab = data_dir / f"{base}.lab"
        label_text = read_lab_text(lab) if lab.exists() else ""
        items.append({
            "id": base,
            "audio": f"{data_dir.name}/{wav.name}",
            "label": label_text,
            "filename": wav.name,
        })

    out_path = Path(args.out) if args.out else (data_dir / "manifest.json")
    out_path.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"Wrote {len(items)} items to {out_path}")


if __name__ == "__main__":
    main()