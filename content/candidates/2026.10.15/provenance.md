# Candidate binary provenance

These hashes describe the exact bytes copied into the local dry-run candidate's hash-named assets. The helper verifies the Intel hashes before it writes the overlays; the publisher hashes the staged bytes again. `source-provenance.json` in the local candidate output records the same hashes and sizes.

| Candidate path | Component | Version / source | SHA-256 | Verification |
| --- | --- | --- | --- | --- |
| `OptiScaler/amd_fidelityfx_framegeneration_dx12.dll` | AMD FidelityFX Frame Generation | DLL file version `4.0.1.2740`, FidelityFX SDK [v2.3.0](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/tree/v2.3.0) | `02297beedd285e822d3a64f314cf00faf378dcec0edc47ff0c4dd71b3a8c2f18` | Hash recorded from the supplied tested binary; version metadata matches the pinned SDK family. |
| `OptiScaler/amd_fidelityfx_loader_dx12.dll` | AMD FidelityFX Frame Generation | DLL file version `2.3.0.2740`, FidelityFX SDK [v2.3.0](https://github.com/GPUOpen-LibrariesAndSDKs/FidelityFX-SDK/tree/v2.3.0) | `e2d85aa05a9bd9ed8b38935fdf5199372cca6f74c12015143bb6f945ee1608aa` | Hash recorded from the supplied tested binary; version metadata matches the pinned SDK family. |
| `licenses/FidelityFX_v2_LICENSE.md` | AMD FidelityFX Frame Generation | FidelityFX SDK v2.3.0 | `f0da09d71ad5c82759a179e774535d4a829e5c96c49294167c1152402b2cb400` | Included with the component; includes the required redistribution notice. |
| `OptiScaler/libxess_fg.dll` | Intel XeSS Frame Generation | Product version `1.3.1.78`, XeSS SDK [v3.0.2](https://github.com/intel/xess/tree/v3.0.2) ([official release](https://github.com/intel/xess/releases/tag/v3.0.2)) | `ec5e0c65e075570c6ede72618bb666d0be0c2e10b2ea9762c0fe8cb8e375ab27` | Byte-for-byte match with `bin/libxess_fg.dll` in the official v3.0.2 archive. |
| `OptiScaler/libxell.dll` | Intel XeSS Frame Generation | Product version `1.3.2.10`, XeSS SDK v3.0.2 | `d2030dcd694fda8f2ec7e044b13e6db8f0b56d4ba9113a5efad334e3f3ded8c7` | Byte-for-byte match with `bin/libxell.dll` in the official v3.0.2 archive. |
| `licenses/XeSS_LICENSE.txt` | Intel XeSS Frame Generation | Intel Simplified Software License (October 2022), included in XeSS SDK v3.0.2 | `784be42c39a4a4d03cf85d88e15e59d75828fca773ce45b8dbfffbd7eaf208df` | Byte-for-byte match with `LICENSE.txt` in the official v3.0.2 archive. |

The AMD and Intel licence files are copied to the same deployment paths as the binaries and the generated manifest attributes those files to the corresponding vendor components. The manifest source URLs are pinned to the versions above; the OptiScaler source component separately remains pinned to the fork's tested GPL tag.

Intel's notice permits binary redistribution without modification when its notice and terms are reproduced, and prohibits modification or alteration of the software or its operation, including during execution. The hashes establish source identity and an unchanged copy; they do not settle whether the proposed use complies with that runtime-operation clause. The candidate keeps Intel's binaries unmodified and leaves XeFG MFG unlocks out. Public Intel-backed publication remains pending license clearance.
