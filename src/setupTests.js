import { TextEncoder, TextDecoder } from "util";

// React Router 7 uses the standard encoding API; Jest 27 uses an older jsdom.
globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;
