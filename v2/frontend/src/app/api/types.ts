// Named aliases over the types generated from the backend's OpenAPI schema (schema.d.ts,
// produced by `npm run generate:api`). Never hand-write an API type: change the Django Ninja
// schema, re-export openapi.json, and let the compiler show what broke.
import type { components } from './schema';

export type Health = components['schemas']['Health'];
