# ForeFire in WebAssembly

Spike for [issue #171](https://github.com/forefireAPI/forefire/issues/171): compile
the engine to WebAssembly and run a simulation in a browser tab.

This is an experiment, not a supported build. It exists to answer the three
questions the issue left open — does it link, does it run, how big is it.

## What made it possible

`#include <netcdf>` sat in `src/DataBroker.h`, and the `using namespace netCDF`
next to it pulled the dependency into 48 of the 58 files in `src/`. A new
`FF_NO_NETCDF` guard drops that include along with every code path behind it:

| File | Guarded |
| --- | --- |
| `DataBroker.h` | the include, the two `using namespace`, six `NcVar` declarations |
| `DataBroker.cpp` | `loadFromNCFile` and the five layer constructors it calls |
| `FireDomain.cpp` | `loadArrivalTimeNC`, `saveArrivalTimeNC` |
| `Command.cpp` | `saveData`, the PGD branch of `createDomain`, the landscape branch of `loadData`, `writeNetCDF` |

Each guarded entry point keeps a stub that reports the missing support rather
than disappearing, so the command table is unchanged and a script that reaches
for NetCDF gets a message instead of a link error.

Nothing else needed touching. MPI was already behind `MPI_COUPLING`, the HTTP
server and `popen` are never reached from the WASM entry point, and `termios`
lives only in the CLI shell, which a WASM build does not compile.

## Building

Needs Emscripten. With the SDK image:

```sh
podman run --rm -v "$PWD":/w:z -w /w docker.io/emscripten/emsdk bash -lc '
  emcmake cmake -S . -B build-wasm -DCMAKE_BUILD_TYPE=Release &&
  cmake --build build-wasm -j8'
```

`emcmake` sets `EMSCRIPTEN`, which turns off NetCDF, MPI, the Python module and
the CLI shell, and turns on `forefire_wasm`. The outputs land in `bin/`:

| File | Size | gzip | brotli |
| --- | --- | --- | --- |
| `forefire.wasm` | 990 KB | 298 KB | 224 KB |
| `forefire.mjs` | 131 KB | 33 KB | — |

Roughly 257 KB over the wire with brotli, for the whole engine and all its
propagation and flux models.

## Running

Headless, under Node:

```sh
node bindings/wasm/smoke.mjs bin/forefire.mjs
```

In a browser — copy the three page files next to the build outputs and serve
the directory, since a `file://` page can neither fetch the `.wasm` nor start a
module worker:

```sh
cp bindings/wasm/{index.html,worker.mjs,landscape.mjs} bin/
python3 -m http.server -d bin
```

The page runs the solver in a worker (`worker.mjs`) and repaints as each step
lands, so the fire evolves live and the wind can be steered mid-run. Off the
main thread is not optional: a step costs 15 ms early and hundreds once the
front carries a few thousand nodes, which inline would freeze the tab.

### The fuel map comes from the imagery

`landscape.mjs` fetches satellite tiles for a 4 km square of the Ajaccio
hinterland — the site of `tests/runff/run.ff` — draws them to a canvas,
and classifies the pixels into fuel indices by excess green,
`g - (r + b) / 2`:

| Class | Cut | `vv_coeff` | Share of the site |
| --- | --- | --- | --- |
| dense vegetation | ≥ 20 | 1.0 | ~44% |
| sparse / grass | ≥ 10 | 0.45 | ~32% |
| bare, built, water | below | 0.0 | ~24% |

It is greenness, not a land-cover product, but it makes the imagery
load-bearing rather than decorative: `ROS = vv_coeff × normal wind`, so
`vv_coeff = 0` is a barrier, and the fire visibly slows on sparse ground and
stops at clearings, tracks and rooftops. Verified against a synthetic
non-burnable ring: the front reached 901 m against a barrier at 880 m, one
15.6 m fuel cell of overshoot.

This is the whole "no NetCDF, no GIS" story in one file — tiles in, an
`Int32Array` out, straight into `addIndexLayer`. If the tile host is
unreachable the page falls back to uniform fuel and says so.

## The API

`forefire.mjs` is an ES module exporting a `createForeFire()` factory. It
mirrors the pybind11 module in `bindings/python`, with typed arrays in place of
NumPy arrays — see
[Running from NumPy arrays](../../docs/source/user_guide/python_arrays.rst) for
the concepts, which carry over unchanged.

```js
import createForeFire from "./forefire.mjs";

const Module = await createForeFire();
const ff = new Module.ForeFire();

ff.setString("propagationModel", "WindDriven");
ff.execute("FireDomain[sw=(0,0,0);ne=(4000,4000,0);t=0]");
ff.addLayer("propagation", "WindDriven", "propagationModel");
ff.addIndexLayer("table", "fuel", 0, 0, 0, 4000, 4000, 0, 200, 200, 1, 1, fuelArray);
ff.execute("startFire[loc=(2000,2000,0.);t=0]");
ff.execute("step[dt=30]");
const front = ff.execute("print[]");
```

The layer methods take the four dimensions explicitly — `nx, ny, nz, nt` — where
the NumPy binding reads them off the array's shape. Otherwise the contract is
identical: pass a flat C-order `(t, z, y, x)` array, indexed
`x + nx * (y + ny * (z + nz * t))`, exactly as `numpy.ndarray.ravel()` would
give you. The binding transposes it into the x-major order the data layers
index with, the same shuffle `_pyforefire.cpp` performs.

## What was measured

- **All 58 files in `src/` compile** under `em++ -std=c++11` with
  `-DFF_NO_NETCDF`. Zero errors. The only diagnostics are seven
  `-Wvla-cxx-extension` warnings, the latent portability issue the issue
  already flags.
- **It links and runs.** `smoke.mjs` runs a full 240 s simulation.
- **The answers match the Python binding.** `smoke.mjs` is a line-for-line port
  of the worked example in the NumPy documentation. Run against a native
  `pyforefire` built from the same tree, the two agree exactly: 349 front nodes,
  x 1980..3905, y 1763..2308, the front stretched downwind as the doc describes.
- **Speed.** The turning-wind demo runs 15 steps of 20 s over a 4 km domain in
  about 1.2 s under Node.

## Known limits

- **Single-threaded.** Emscripten pthreads need `SharedArrayBuffer` and
  COOP/COEP headers, which is exactly the deployment complexity a static page
  is meant to avoid. Nothing in the engine's simulation path threads today —
  only the HTTP server does, and it is not reachable here.
- **The embind translation unit is C++17**; the core stays C++11. embind
  refuses to compile below C++17, and mixing is fine against one libc++.
- **No file I/O worth the name.** `FS` is exported so a caller can stage
  `fuels.csv` or read back what `print[<file>]` writes, but there is no landscape
  file support at all — arrays are the only way in.
