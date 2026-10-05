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
/** `GET /api/auth/me`: who is reading, and whether they may change recipes. */
export type Me = components['schemas']['MeOut'];
/** `GET /api/recipes/read-photo`: whether "Les oppskrift fra bilde" is offered (M4). */
export type PhotoReading = components['schemas']['PhotoReadingOut'];
/** `POST /api/recipes/read-photo`: the recipe read from a photo, or `readable: false`. */
export type RecipeDraft = components['schemas']['RecipeDraftOut'];
/** `POST /api/recipes/import-link` (M5): the page whose recipe data to read. */
export type LinkImport = components['schemas']['LinkImportIn'];
/** `POST /api/recipes/import-text` (M5): a recipe pasted as plain text. */
export type TextImport = components['schemas']['TextImportIn'];
/**
 * The import-text answer: a RecipeDraft read by the AI provider (`read_by: 'ai'`), or split by
 * simple rules when reading is off or failed (`read_by: 'rules'`, `notice` says why).
 */
export type TextDraft = components['schemas']['TextDraftOut'];
