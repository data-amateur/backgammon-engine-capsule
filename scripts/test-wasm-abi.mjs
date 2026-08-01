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

console.log("Pinned Emscripten wasm32 ABI smoke test passed");
