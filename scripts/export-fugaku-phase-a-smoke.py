#!/usr/bin/env python3
"""Convert Fugaku phase-a extinction (K) volumes to tenant FDS smoke web format."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

import numpy as np

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# Reuse pack/write helpers from export-fds-smoke.py (hyphenated filename).
_spec = importlib.util.spec_from_file_location(
    "export_fds_smoke",
    SCRIPT_DIR / "export-fds-smoke.py",
)
_efs = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_efs)

DEFAULT_PHASE_A = Path(r"D:\myprojects\meta\simulation\Fugaku\output\phase-a\prod01")
DEFAULT_OUTPUT = PROJECT_ROOT / "tenants" / "P-01" / "data" / "simulations" / "fugaku-prod01"
FRAME_DIR_RE = re.compile(r"^frame_(\d+)$")
DUPLICATE_TIME_EPS = 1e-4


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export Fugaku phase-a K volumes to tenant smoke.uint8.bin + manifest.json",
    )
    parser.add_argument(
        "--input",
        default=str(DEFAULT_PHASE_A),
        help="phase-a output directory (frame_XXXX subfolders)",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT),
        help="Tenant simulations output directory",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=1,
        help="Use every Nth frame (1 = all)",
    )
    parser.add_argument(
        "--chunk-interval",
        type=float,
        default=60.0,
        metavar="SECONDS",
        help="Multipart chunk size in simulation seconds (default: 60). Omit with --single-file.",
    )
    parser.add_argument(
        "--single-file",
        action="store_true",
        help="Write one smoke.uint8.bin instead of multipart parts",
    )
    parser.add_argument(
        "--zip",
        action="store_true",
        help="Create {output_dir_name}.zip for admin upload",
    )
    return parser.parse_args()


def list_frame_dirs(phase_a_dir: Path) -> list[tuple[int, Path]]:
    """Return sorted (frame_index, path) for frame_* directories."""
    entries: list[tuple[int, Path]] = []
    for child in phase_a_dir.iterdir():
        if not child.is_dir():
            continue
        match = FRAME_DIR_RE.match(child.name)
        if not match:
            continue
        frame_idx = int(match.group(1))
        entries.append((frame_idx, child))
    entries.sort(key=lambda item: item[0])
    return entries


def load_frame_meta(frame_dir: Path) -> dict:
    meta_path = frame_dir / "metadata.json"
    with meta_path.open(encoding="utf-8") as f:
        return json.load(f)


def load_frame_volume(frame_dir: Path) -> np.ndarray:
    npy_path = frame_dir / "volume_k.npy"
    if not npy_path.is_file():
        raise FileNotFoundError(f"Missing volume: {npy_path}")
    volume = np.load(npy_path)
    if volume.ndim != 3:
        raise ValueError(f"Expected 3D volume in {npy_path}, got shape {volume.shape}")
    return volume.astype(np.float32, copy=False)


def scan_frames(
    frame_dirs: list[tuple[int, Path]],
    stride: int,
) -> tuple[list[tuple[int, Path, dict]], float, dict]:
    """Scan metadata; return selected frames, global value max, bounds."""
    selected: list[tuple[int, Path, dict]] = []
    value_max = 0.0
    bounds: dict | None = None
    dims: tuple[int, int, int] | None = None

    for i, (frame_idx, frame_dir) in enumerate(frame_dirs):
        if i % stride != 0:
            continue
        meta = load_frame_meta(frame_dir)
        stats = meta.get("stats") or {}
        k_max = float(stats.get("k_max", 0.0))
        if k_max > value_max:
            value_max = k_max

        grid = meta.get("grid") or {}
        shape = tuple(grid.get("shape") or stats.get("shape") or ())
        if len(shape) == 3:
            if dims is None:
                dims = (int(shape[0]), int(shape[1]), int(shape[2]))
            elif dims != (int(shape[0]), int(shape[1]), int(shape[2])):
                raise ValueError(
                    f"Inconsistent grid shape in {frame_dir}: {shape} vs {dims}",
                )

        grid_bounds = grid.get("bounds")
        if bounds is None and grid_bounds:
            bounds = {
                "x": [float(grid_bounds["x"][0]), float(grid_bounds["x"][1])],
                "y": [float(grid_bounds["y"][0]), float(grid_bounds["y"][1])],
                "z": [float(grid_bounds["z"][0]), float(grid_bounds["z"][1])],
            }

        selected.append((frame_idx, frame_dir, meta))

    if not selected:
        raise ValueError("No frame directories found")
    if dims is None or bounds is None:
        raise ValueError("Could not determine dims/bounds from metadata")

    if value_max <= 0 or not np.isfinite(value_max):
        value_max = 1.0

    return selected, value_max, bounds


def build_frame_export_plan(
    selected: list[tuple[int, Path, dict]],
) -> tuple[list[tuple[list[tuple[int, Path, dict]], dict]], dict]:
    """
    Build export plan sorted by simulation time with duplicate-time merge groups.
    Each plan entry is (source_frames, meta) where source_frames may contain
    multiple MPI outputs at the same time_s to be merged with np.maximum.
    """
    sorted_sel = sorted(
        selected,
        key=lambda item: (float(item[2].get("time_s", 0.0)), item[0]),
    )

    plan: list[tuple[list[tuple[int, Path, dict]], dict]] = []
    warnings: list[str] = []
    reordered = any(
        sorted_sel[i][0] != selected[i][0] for i in range(min(len(sorted_sel), len(selected)))
    )

    i = 0
    while i < len(sorted_sel):
        group = [sorted_sel[i]]
        time_s = float(group[0][2].get("time_s", 0.0))
        j = i + 1
        while j < len(sorted_sel):
            next_time = float(sorted_sel[j][2].get("time_s", 0.0))
            if abs(next_time - time_s) >= DUPLICATE_TIME_EPS:
                break
            group.append(sorted_sel[j])
            j += 1

        if len(group) > 1:
            warnings.append(
                f"Duplicate time {time_s:.3f}s at frame indices "
                f"{[item[0] for item in group]} - merged with np.maximum (max_K)",
            )

        plan.append((group, group[0][2]))
        i = j

    normalization = {
        "sortedBySimulationTime": True,
        "deduplicatedDuplicateTimes": True,
        "mergeMethod": "max_K",
        "sourceFrameCount": len(selected),
        "exportFrameCount": len(plan),
        "reorderedFromFrameIndex": reordered,
        "warnings": warnings,
    }
    return plan, normalization


def load_merged_frame_group(
    group: list[tuple[int, Path, dict]],
) -> np.ndarray:
    """Load one export frame, merging duplicate-time sources with np.maximum."""
    volume = load_frame_volume(group[0][1])
    for _, frame_dir, _ in group[1:]:
        volume = np.maximum(volume, load_frame_volume(frame_dir))
    return volume


def stack_plan_chunk(
    plan_chunk: list[tuple[list[tuple[int, Path, dict]], dict]],
) -> tuple[np.ndarray, list[float]]:
    """Load a chunk of the export plan into (T, nx, ny, nz)."""
    volumes = [load_merged_frame_group(group) for group, _ in plan_chunk]
    times = [float(meta.get("time_s", idx)) for idx, (_, meta) in enumerate(plan_chunk)]
    return np.stack(volumes, axis=0), times


def coords_from_bounds(bounds: dict) -> dict:
    """Build coordinate arrays compatible with export-fds-smoke writers."""
    return {
        "x": np.array(bounds["x"], dtype=np.float64),
        "y": np.array(bounds["y"], dtype=np.float64),
        "z": np.array(bounds["z"], dtype=np.float64),
    }


def export_multipart_streaming(
    export_plan: list[tuple[list[tuple[int, Path, dict]], dict]],
    times: list[float],
    bounds: dict,
    value_max: float,
    output_dir: Path,
    input_dir: Path,
    interval_sec: float,
    normalization: dict | None = None,
) -> None:
    """Write multipart export without loading all frames into memory."""
    chunks = _efs.build_time_chunks(times, interval_sec)
    parts_dir = output_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)
    parts_manifest: list[dict] = []
    total_bytes = 0

    for part_index, (frame_start, frame_end, start_time, end_time) in enumerate(chunks):
        chunk_plan = export_plan[frame_start:frame_end]
        part_arr, _ = stack_plan_chunk(chunk_plan)
        packed = _efs.pack_volume_slice(np.nan_to_num(part_arr, nan=0.0), value_max)
        part_name = f"part-{part_index:03d}.uint8.bin"
        part_path = parts_dir / part_name
        packed.tofile(part_path)
        part_bytes = part_path.stat().st_size
        total_bytes += part_bytes

        parts_manifest.append({
            "id": f"{part_index:03d}",
            "dataFile": f"parts/{part_name}",
            "frameStart": int(frame_start),
            "frameCount": int(frame_end - frame_start),
            "startTime": start_time,
            "endTime": end_time,
        })

        print(
            f"  part-{part_index:03d}: frames {frame_start}-{frame_end - 1} "
            f"({start_time:.3f}s-{end_time:.3f}s) "
            f"-> {part_name} ({part_bytes / 1024 / 1024:.2f} MB)",
        )

    nx, ny, nz = export_plan[0][1]["grid"]["shape"]
    manifest = {
        "source": str(input_dir),
        "quantity": "extinction_coefficient_K",
        "storedQuantity": "extinction_coefficient_K",
        "unit": "1/m",
        "frameCount": len(export_plan),
        "dims": [int(nx), int(ny), int(nz)],
        "times": [float(t) for t in times],
        "valueMax": value_max,
        "bounds": bounds,
        "dataType": "uint8",
        "layout": "xi+zi*nx+yi*nx*ny (volumeResolution: nx,nz,ny)",
        "multipart": True,
        "chunkIntervalSec": float(interval_sec),
        "parts": parts_manifest,
    }
    if normalization:
        manifest["frameNormalization"] = normalization

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {len(parts_manifest)} parts ({total_bytes / 1024 / 1024:.2f} MB total)")
    print(f"Wrote {manifest_path}")
    print(f"Grid: {nx}x{ny}x{nz}, frames: {len(export_plan)}, max K={value_max:.3f}")


def main() -> None:
    args = parse_args()
    phase_a_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.stride < 1:
        print("--stride must be >= 1", file=sys.stderr)
        sys.exit(1)

    frame_dirs = list_frame_dirs(phase_a_dir)
    if not frame_dirs:
        print(f"No frame_* directories in {phase_a_dir}", file=sys.stderr)
        sys.exit(1)

    print(f"Scanning {len(frame_dirs)} frames in {phase_a_dir} (stride={args.stride})")
    selected, value_max, bounds = scan_frames(frame_dirs, args.stride)

    print("Normalizing frame order by simulation time (MPI phase-a fix)...")
    export_plan, normalization = build_frame_export_plan(selected)
    times = [float(meta.get("time_s", idx)) for idx, (_, meta) in enumerate(export_plan)]
    if normalization["warnings"]:
        for warning in normalization["warnings"]:
            print(f"  WARN: {warning}")
    if normalization["sourceFrameCount"] != normalization["exportFrameCount"]:
        print(
            f"  Deduplicated {normalization['sourceFrameCount']} source frames "
            f"-> {normalization['exportFrameCount']} export frames",
        )

    quantity = "extinction_coefficient_K"
    coords = coords_from_bounds(bounds)

    if args.single_file:
        print(f"Loading {len(export_plan)} frames into memory...")
        arr, times = stack_plan_chunk(export_plan)
        _efs.write_single_export(
            arr,
            times,
            coords,
            value_max,
            output_dir,
            phase_a_dir,
            quantity,
        )
    else:
        interval = args.chunk_interval if args.chunk_interval is not None else 60.0
        if interval <= 0:
            print("--chunk-interval must be > 0", file=sys.stderr)
            sys.exit(1)
        print(f"Multipart export: chunk interval = {interval}s")
        export_multipart_streaming(
            export_plan,
            times,
            bounds,
            value_max,
            output_dir,
            phase_a_dir,
            interval,
            normalization,
        )

    if args.zip:
        _efs.write_export_zip(output_dir)


if __name__ == "__main__":
    main()
