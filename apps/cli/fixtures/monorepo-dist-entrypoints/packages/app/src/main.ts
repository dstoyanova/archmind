import { lib } from "@workspace/lib";
import { feature } from "@workspace/lib/internal/feature";

export const value = lib + (feature ? 1 : 0);
