// Copyright 2020 Carton contributors
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

import { WASI } from "@wasmer/wasi";
import { WasmFs } from "@wasmer/wasmfs";

export const WasmRunner = (rawOptions, ImportUnit) => {
  const options = defaultRunnerOptions(rawOptions);

  let importUnit;
  if (ImportUnit) {
    importUnit = new ImportUnit();
  }

  const wasmFs = createWasmFS(
    (stdout) => {
      console.log(stdout);
      options.onStdout(stdout);
    },
    (stderr) => {
      console.error(stderr);
      options.onStderr(stderr);
    }
  );

  const wasi = new WASI({
    args: options.args,
    env: {},
    bindings: {
      ...WASI.defaultBindings,
      fs: wasmFs.fs,
    },
  });

  const createWasmImportObject = (extraWasmImports) => {
    let importObject;
    if (importUnit) {
      importObject = importUnit.importObject;
    } else {
      importObject = {};
    }

    importObject.wasi_snapshot_preview1 = wrapWASI(wasi);

    if (extraWasmImports) {
      // Shallow clone
      for (const key in extraWasmImports) {
        importObject[key] = extraWasmImports[key];
      }
    }

    return importObject;
  };

  return {
    async run(wasmBytes, extraWasmImports) {
      if (!extraWasmImports) {
        extraWasmImports = {};
      }
      extraWasmImports.__stack_sanitizer = {
        report_stack_overflow: () => {
          throw new Error("Detected stack buffer overflow.");
        },
      };
      const importObject = createWasmImportObject(extraWasmImports);
      const module = await WebAssembly.instantiate(wasmBytes, importObject);

      // Node support
      const instance = "instance" in module ? module.instance : module;

      const context = { instance };

      if (importUnit) {
        importUnit.setContext(context);
      }

      // Start the WebAssembly WASI instance
      wasi.start(instance);

      if (importUnit) {
        importUnit.start();
      }

      // Initialize and start Reactor
      if (instance.exports._initialize) {
        instance.exports._initialize();
        instance.exports.main();
      }
    },
  };
};

const defaultRunnerOptions = (options) => {
  if (!options) return defaultRunnerOptions({});
  if (!options.onStdout) {
    options.onStdout = () => {};
  }
  if (!options.onStderr) {
    options.onStderr = () => {};
  }
  if (!options.args) {
    options.args = [];
  }
  return options;
};

const createWasmFS = (onStdout, onStderr) => {
  // Instantiate a new WASI Instance
  const wasmFs = new WasmFs();

  // Output stdout and stderr to console
  const originalWriteSync = wasmFs.fs.writeSync;
  wasmFs.fs.writeSync = (fd, buffer, offset, length, position) => {
    const text = new TextDecoder("utf-8").decode(buffer);
    if (text !== "\n") {
      switch (fd) {
        case 1:
          onStdout(text);
          break;
        case 2:
          onStderr(text);
          break;
      }
    }
    return originalWriteSync(fd, buffer, offset, length, position);
  };

  return wasmFs;
};

const wrapWASI = (wasiObject) => {
  // PATCH: @wasmer-js/wasi@0.x forgets to call `refreshMemory` in `clock_res_get`,
  // which writes its result to memory view. Without the refresh the memory view,
  // it accesses a detached array buffer if the memory is grown by malloc.
  // But they wasmer team discarded the 0.x codebase at all and replaced it with
  // a new implementation written in Rust. The new version 1.x is really unstable
  // and not production-ready as far as katei investigated in Apr 2022.
  // So override the broken implementation of `clock_res_get` here instead of
  // fixing the wasi polyfill.
  // Reference: https://github.com/wasmerio/wasmer-js/blob/55fa8c17c56348c312a8bd23c69054b1aa633891/packages/wasi/src/index.ts#L557
  const original_clock_res_get = wasiObject.wasiImport["clock_res_get"];

  wasiObject.wasiImport["clock_res_get"] = (clockId, resolution) => {
    wasiObject.refreshMemory();
    return original_clock_res_get(clockId, resolution);
  };
  return wasiObject.wasiImport;
};

// encapsulate the swift runtime in an import unit
export function encapsulateSwiftRuntime(swiftRuntimeClass) {
  return class {
    static SwiftRuntime = swiftRuntimeClass;
    constructor() {
      this.swiftRuntime = new swiftRuntimeClass();
    }
    get importObject() {
      return { javascript_kit: this.swiftRuntime.wasmImports };
    }
    setContext(context) {
      if (context.instance.exports.swjs_library_version) {
        this.swiftRuntime.setInstance(context.instance);
      }
    }
    start() {}
  }
}

export async function importWasmImportUnit(module, verbose) {
  try {
    const { ImportUnit, SwiftRuntime } = await import(module);
    if (ImportUnit) {
      return ImportUnit;
    }
    if (SwiftRuntime) {
      return encapsulateSwiftRuntime(SwiftRuntime);
    }
  } catch {}
  return null;
}
