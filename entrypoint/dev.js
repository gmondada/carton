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

import ReconnectingWebSocket from "reconnecting-websocket";
import { WasmRunner, importWasmImportUnit } from "./common.js";

const socket = new ReconnectingWebSocket(`ws://${location.host}/watcher`);

socket.addEventListener("message", (message) => {
  if (message.data === "reload") {
    location.reload();
  }
});

const startWasiTask = async () => {
  // Fetch our Wasm File
  const response = await fetch("/main.wasm");
  const responseArrayBuffer = await response.arrayBuffer();

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

  const wasmRunner = WasmRunner(
    {
      onStderr() {
        const prevLimit = Error.stackTraceLimit;
        Error.stackTraceLimit = 1000;
        socket.send(
          JSON.stringify({
            kind: "stackTrace",
            stackTrace: new Error().stack,
          })
        );
        Error.stackTraceLimit = prevLimit;
      },
    },
    importUnitClass
  );

  // Instantiate the WebAssembly file
  const wasmBytes = new Uint8Array(responseArrayBuffer).buffer;
  await wasmRunner.run(wasmBytes);
};

function handleError(e) {
  console.error(e);
  if (e instanceof WebAssembly.RuntimeError) {
    console.log(e.stack);
  }
}

try {
  startWasiTask().catch(handleError);
} catch (e) {
  handleError(e);
}
