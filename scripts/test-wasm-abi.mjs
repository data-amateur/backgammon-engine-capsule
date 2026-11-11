import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const moduleUrl = pathToFileURL(
  path.join(repositoryRoot, "build/gnubg/wasm-abi/gnubg-wasm-abi.mjs"),
);
const { default: createModule } = await import(moduleUrl.href);
const module = await createModule();

assert.equal(module._bgc_wasm_abi_version(), 0x0001_0000);
assert.equal(module._bgc_wasm_abi_descriptor_size(), 128);
assert.equal(module._bgc_wasm_get_abi_descriptor(0, 128), 1);

const pointer = module._malloc(128);
assert.notEqual(pointer, 0);

try {
  module.HEAPU8.fill(0xa5, pointer, pointer + 128);
  const unchanged = module.HEAPU8.slice(pointer, pointer + 128);
  assert.equal(module._bgc_wasm_get_abi_descriptor(pointer, 127), 1);
  assert.deepEqual(module.HEAPU8.slice(pointer, pointer + 128), unchanged);
  assert.equal(module._bgc_wasm_get_abi_descriptor(pointer, 128), 0);

  const view = new DataView(module.HEAPU8.buffer, pointer, 128);
  const expectedFields = [
    [0, 0x0001_0000],
    [4, 128],
    [8, 0x0102_0304],
    [12, 4],
    [16, 8],
    [20, 2],
    [24, 52],
    [28, 16],
    [32, 20],
    [36, 20],
    [40, 120],
    [44, 8],
    [48, 24],
    [52, 104],
    [56, 16],
    [60, 8],
    [64, 256],
    [68, 32],
    [72, 176],
    [76, 32],
    [80, 192],
    [84, 64],
  ];

  for (const [offset, value] of expectedFields) {
    assert.equal(view.getUint32(offset, true), value, `descriptor +${offset}`);
  }
  for (let offset = 88; offset < 128; offset += 4) {
    assert.equal(view.getUint32(offset, true), 0, `reserved +${offset}`);
  }
} finally {
  module._free(pointer);
}

assert.equal(module._bgc_wasm_analysis_descriptor_size(), 64);
assert.equal(module._bgc_wasm_get_analysis_descriptor(0, 64), 1);
const analysisPointer = module._malloc(64);
assert.notEqual(analysisPointer, 0);

try {
  module.HEAPU8.fill(0xa5, analysisPointer, analysisPointer + 64);
  const unchanged = module.HEAPU8.slice(analysisPointer, analysisPointer + 64);
  assert.equal(module._bgc_wasm_get_analysis_descriptor(analysisPointer, 63), 1);
  assert.deepEqual(module.HEAPU8.slice(analysisPointer, analysisPointer + 64), unchanged);
  assert.equal(module._bgc_wasm_get_analysis_descriptor(analysisPointer, 64), 0);
  const view = new DataView(module.HEAPU8.buffer, analysisPointer, 64);
  const expected = [0x0001_0000, 64, 0x0102_0304, 4, 312, 64, 152, 20, 4096, 5, 6];
  for (let index = 0; index < expected.length; index += 1) {
    assert.equal(view.getUint32(index * 4, true), expected[index], `analysis descriptor +${index * 4}`);
  }
  for (let offset = 44; offset < 64; offset += 4) {
    assert.equal(view.getUint32(offset, true), 0, `analysis reserved +${offset}`);
  }
} finally {
  module._free(analysisPointer);
}

console.log("Pinned Emscripten wasm32 ABI smoke test passed");
