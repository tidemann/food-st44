// Named aliases over the types generated from the backend's OpenAPI schema (schema.d.ts,
// produced by `npm run generate:api`). Never hand-write an API type: change the Django Ninja
// schema, re-export openapi.json, and let the compiler show what broke.
import type { components } from './schema';

export type Recipe = components['schemas']['RecipeOut'];
export type RecipeInput = components['schemas']['RecipeIn'];
/** 404 body: `{ detail: "Not Found" }`. */
export type ApiError = components['schemas']['ErrorOut'];
/** 422 body: one message per field, e.g. `{ errors: { title: "Tittelen må fylles ut." } }`. */
export type ValidationErrors = components['schemas']['ValidationErrors'];
