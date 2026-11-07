# Vendored files

## draco/draco_wasm_wrapper.js / draco/draco_decoder.wasm

Official **Draco** decoder (the *glTF* build, the one the `KHR_draco_mesh_compression`
extension targets) used by `src/draco/DracoWasmDecoder.ts`.

- Source: https://github.com/google/draco (Apache License 2.0)
- Copied unchanged from the copy distributed with `three.js` v0.186.0
  (`examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js` and `draco_decoder.wasm`).
- sha256: `draco_decoder.wasm` a680d927bed9cb864ddbd63521868891af2bfbe755092761b4837487618df8ac,
  `draco_wasm_wrapper.js` 8bb2952d2ba7d67e1414f8df819410cb0434a666be53f671fff75f68843d76f6
- Upstream Apache 2.0 text: https://github.com/google/draco/blob/master/LICENSE

The wrapper is an Emscripten factory (`DracoDecoderModule`) with a CommonJS/AMD export
footer; like the Basis glue it is consumed via a raw import plus a scoped `new Function`
evaluation with the footer stripped (see `DracoWasmDecoder._initModule`).
The test fixture `tests/fixtures/draco/cube.drc` was encoded with `draco3d` 1.5.9
(Edgebreaker, POSITION 14 / NORMAL 10 / TEX_COORD 12 bit quantization, plus an unquantized
4-component TANGENT that points along +v with w = -1 on purpose, so a decoder that drops
TANGENT cannot pass the test by regenerating one).

Generated code — do not edit directly. To update, replace both files from a matching
three.js release and re-run the Draco tests.

## basis_transcoder.js / basis_transcoder.wasm

Official **Basis Universal** KTX2/ETC1S/UASTC transcoder binaries used by the
`KHR_texture_basisu` implementation (`src/basisu/BasisWasmTranscoder.ts`).

- Source: https://github.com/BinomialLLC/basis_universal (Apache License 2.0)
- Copied from the copy distributed with `three.js` v0.186.0
  (`examples/jsm/libs/basis/basis_transcoder.{js,wasm}`), which vendors the
  official BinomialLLC build unchanged. three.js itself is MIT licensed; the
  underlying Basis Universal code is Apache 2.0.
- Upstream Apache 2.0 text:
  https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE

The `.js` glue is an Emscripten factory with a CommonJS/AMD export footer. This
project is ESM and consumes it via a raw import plus a scoped `new Function`
evaluation (the footer is stripped and the `BASIS` factory is returned
directly). See `BasisWasmTranscoder._initModule` for details.

Generated code — do not edit directly. To update, replace both files from a
matching three.js/mrdoob release and re-run the transcoder tests.
