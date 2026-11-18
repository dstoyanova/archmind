import { stdout } from "node:process";

import { createExplorerOpenApiDocument } from "./explorer-openapi.js";

stdout.write(`${JSON.stringify(createExplorerOpenApiDocument(), null, 2)}\n`);
