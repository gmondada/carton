// Copyright 2022 Carton contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import fs from "fs/promises";
import { WasmRunner, importWasmImportUnit } from "./common.js";

const args = [...process.argv];
args.shift();
args.shift();
const [wasmFile, ...testArgs] = args;

if (!wasmFile) {
  throw Error("No WASM test file specified, can not run tests");
}

const startWasiTask = async () => {
  const wasmBytes = await fs.readFile(wasmFile);

  let importUnitClass = await importWasmImportUnit(
    "./wasm-import-unit.mjs"
  );
  if (!importUnitClass) {
    console.log(
      "Import Unit not available, fallback to JavaScriptKit"
    );
    importUnitClass = await importWasmImportUnit(
      "./JavaScriptKit_JavaScriptKit.resources/Runtime/index.mjs"
    );
  }
  if (!importUnitClass) {
    console.log(
      "Import Unit and JavaScriptKit not available, running without any runtime."
    );
  }
  if (importUnitClass && importUnitClass.SwiftRuntime) {
    console.log(
      "Import Unit encapsulating the JavaScriptKit runtime."
    );
  }

  // Make `require` function available in the Swift environment. By default it's only available in the local scope,
  // but not on the `global` object.
  global.require = require;

  const wasmRunner = WasmRunner({ args: testArgs }, importUnitClass);

  await wasmRunner.run(wasmBytes);
};

startWasiTask().catch((e) => {
  throw e;
});
