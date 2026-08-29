#!/usr/bin/env python3
"""Export FDS smoke3d data to tenant simulations directory for VolumeRenderer."""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path

import numpy as np

try:
    import fdsreader as fds
except ImportError:
    print("fdsreader is required: pip install fdsreader", file=sys.stderr)
    sys.exit(1)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FDS_INPUT = Path(r"D:\myprojects\meta\simulation\lite")
DEFAULT_TENANT_OUTPUT = PROJECT_ROOT / "tenants" / "P-01" / "data" / "simulations" / "lite"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export FDS smoke3d to tenant web volume format")
    parser.add_argument(
        "--input",
        default=str(DEFAULT_FDS_INPUT),
        help="FDS simulation output directory",
    )
    parser.add_argument(
        "--output",
        default=str(DEFAULT_TENANT_OUTPUT),
        help="Output directory for manifest + binary (e.g. tenants/P-01/data/simulations/lite)",
    )
    parser.add_argument(
        "--quantity",
        default="SOOT DENSITY",
        help="Smoke3D quantity name (e.g. 'SOOT DENSITY', 'HRRPUV')",
    )
    parser.add_argument(
        "--stride",
        type=int,
        default=1,
        help="Export every Nth time frame (1 = all frames)",
    )
    parser.add_argument(
        "--chunk-interval",
        type=float,
        default=None,
        metavar="SECONDS",
        help=(
            "Split export into multiple part files by simulation time window in seconds "
            "(e.g. 1.0 = 0-1s, 1-2s, ...). Omit for a single smoke.uint8.bin file."
        ),
    )
    parser.add_argument(
        '--zip',
        action='store_true',
        help='After export, create {output_dir_name}.zip next to the output folder for admin upload',
    )
    return parser.parse_args()


def find_smoke(sim: fds.Simulation, quantity_name: str):
    for smoke in sim.smoke_3d:
        if str(smoke.quantity) == f"Quantity('{quantity_name}')":
            return smoke
    available = [str(s.quantity) for s in sim.smoke_3d]
    raise ValueError(f"Quantity '{quantity_name}' not found. Available: {available}")


def pack_volume_slice(arr: np.ndarray, value_max: float) -> np.ndarray:
    """Pack (time, x, y, z) array slice into uint8 with NIfTI-compatible index order."""
    if value_max <= 0:
        value_max = 1.0

    normalized = np.clip(arr / value_max, 0.0, 1.0)
    uint8 = (normalized * 255.0).astype(np.uint8)

    # VolumeRenderer NIfTI path uses volumeResolution (nx, nz, ny).
    # index = xi + zi * nx + yi * nx * ny
    nx, ny, nz = uint8.shape[1], uint8.shape[2], uint8.shape[3]
    packed = np.empty(uint8.shape[0] * nx * ny * nz, dtype=np.uint8)

    offset = 0
    for t in range(uint8.shape[0]):
        for yi in range(nz):
            for zi in range(ny):
                for xi in range(nx):
                    packed[offset] = uint8[t, xi, zi, yi]
                    offset += 1

    return packed


def build_time_chunks(times: list[float], interval_sec: float) -> list[tuple[int, int, float, float]]:
    """Return (frame_start, frame_end_exclusive, start_time, end_time) for each chunk."""
    if interval_sec is None or interval_sec <= 0 or len(times) == 0:
        return [(0, len(times), float(times[0]), float(times[-1]))]

    chunks: list[tuple[int, int, float, float]] = []
    t_min = float(times[0])
    t_max = float(times[-1])
    window_start = t_min
    part_idx = 0

    while window_start <= t_max + 1e-9:
        window_end = window_start + interval_sec
        is_last = window_end >= t_max - 1e-9

        frame_indices: list[int] = []
        for i, t in enumerate(times):
            if is_last:
                if t >= window_start - 1e-9:
                    frame_indices.append(i)
            elif window_start - 1e-9 <= t < window_end - 1e-9:
                frame_indices.append(i)

        if frame_indices:
            frame_start = frame_indices[0]
            frame_end = frame_indices[-1] + 1
            chunk_start_time = float(times[frame_start])
            chunk_end_time = float(times[frame_end - 1])
            chunks.append((frame_start, frame_end, chunk_start_time, chunk_end_time))
        elif is_last:
            break

        if is_last:
            break

        window_start = window_end
        part_idx += 1

        if part_idx > len(times) * 10:
            raise RuntimeError("chunk-interval produced too many iterations; check --chunk-interval value")

    if not chunks:
        chunks.append((0, len(times), float(times[0]), float(times[-1])))

    return chunks


def write_single_export(
    arr: np.ndarray,
    times: list[float],
    coords: dict,
    value_max: float,
    output_dir: Path,
    input_dir: Path,
    quantity: str,
) -> None:
    packed = pack_volume_slice(np.nan_to_num(arr, nan=0.0), value_max)
    data_path = output_dir / "smoke.uint8.bin"
    packed.tofile(data_path)

    nx, ny, nz = arr.shape[1], arr.shape[2], arr.shape[3]
    manifest = {
        "source": str(input_dir),
        "quantity": quantity,
        "frameCount": int(arr.shape[0]),
        "dims": [int(nx), int(ny), int(nz)],
        "times": [float(t) for t in times],
        "valueMax": value_max,
        "bounds": {
            "x": [float(coords["x"][0]), float(coords["x"][-1])],
            "y": [float(coords["y"][0]), float(coords["y"][-1])],
            "z": [float(coords["z"][0]), float(coords["z"][-1])],
        },
        "dataFile": "smoke.uint8.bin",
        "dataType": "uint8",
        "layout": "xi+zi*nx+yi*nx*ny (volumeResolution: nx,nz,ny)",
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {data_path} ({data_path.stat().st_size / 1024 / 1024:.2f} MB)")
    print(f"Wrote {manifest_path}")
    print(f"Grid: {nx}x{ny}x{nz}, frames: {arr.shape[0]}, max={value_max:.3f}")


def write_multipart_export(
    arr: np.ndarray,
    times: list[float],
    coords: dict,
    value_max: float,
    output_dir: Path,
    input_dir: Path,
    quantity: str,
    interval_sec: float,
) -> None:
    parts_dir = output_dir / "parts"
    parts_dir.mkdir(parents=True, exist_ok=True)

    chunks = build_time_chunks(times, interval_sec)
    parts_manifest: list[dict] = []
    total_bytes = 0

    for part_index, (frame_start, frame_end, start_time, end_time) in enumerate(chunks):
        part_arr = arr[frame_start:frame_end]
        packed = pack_volume_slice(np.nan_to_num(part_arr, nan=0.0), value_max)
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
            f"-> {part_name} ({part_bytes / 1024 / 1024:.2f} MB)"
        )

    nx, ny, nz = arr.shape[1], arr.shape[2], arr.shape[3]
    manifest = {
        "source": str(input_dir),
        "quantity": quantity,
        "frameCount": int(arr.shape[0]),
        "dims": [int(nx), int(ny), int(nz)],
        "times": [float(t) for t in times],
        "valueMax": value_max,
        "bounds": {
            "x": [float(coords["x"][0]), float(coords["x"][-1])],
            "y": [float(coords["y"][0]), float(coords["y"][-1])],
            "z": [float(coords["z"][0]), float(coords["z"][-1])],
        },
        "dataType": "uint8",
        "layout": "xi+zi*nx+yi*nx*ny (volumeResolution: nx,nz,ny)",
        "multipart": True,
        "chunkIntervalSec": float(interval_sec),
        "parts": parts_manifest,
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {len(parts_manifest)} parts ({total_bytes / 1024 / 1024:.2f} MB total)")
    print(f"Wrote {manifest_path}")
    print(f"Grid: {nx}x{ny}x{nz}, frames: {arr.shape[0]}, max={value_max:.3f}")


def write_export_zip(output_dir: Path) -> Path:
    """Zip export folder contents for admin panel upload."""
    zip_path = output_dir.with_name(f'{output_dir.name}.zip')
    with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for file_path in sorted(output_dir.rglob('*')):
            if not file_path.is_file():
                continue
            arcname = file_path.relative_to(output_dir).as_posix()
            zf.write(file_path, arcname)
    print(f'Wrote {zip_path} ({zip_path.stat().st_size / 1024:.1f} KB)')
    return zip_path


def main() -> None:
    args = parse_args()
    input_dir = Path(args.input)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.stride < 1:
        print("--stride must be >= 1", file=sys.stderr)
        sys.exit(1)
    if args.chunk_interval is not None and args.chunk_interval <= 0:
        print("--chunk-interval must be > 0 when set", file=sys.stderr)
        sys.exit(1)

    print(f"Loading simulation: {input_dir}")
    sim = fds.Simulation(str(input_dir))
    smoke = find_smoke(sim, args.quantity)

    print(f"Exporting {smoke.quantity} ({smoke.n_t} frames, stride={args.stride})")
    arr, coords = smoke.to_global(return_coordinates=True)
    arr = arr[:: args.stride]
    times = list(smoke.times[:: args.stride])

    value_max = float(np.nanmax(arr))
    if not np.isfinite(value_max) or value_max <= 0:
        value_max = 1.0

    if args.chunk_interval is not None:
        print(f"Multipart export: chunk interval = {args.chunk_interval}s")
        write_multipart_export(
            arr, times, coords, value_max, output_dir, input_dir, args.quantity, args.chunk_interval,
        )
    else:
        write_single_export(
            arr, times, coords, value_max, output_dir, input_dir, args.quantity,
        )

    if args.zip:
        write_export_zip(output_dir)


if __name__ == "__main__":
    main()
