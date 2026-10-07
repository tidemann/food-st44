import { Routes } from '@angular/router';
import { editorOnly } from './auth';
import { NoAccess } from './pages/no-access';
import { NotFound } from './pages/not-found';
import { readingAvailable } from './recipes/read-photo';
import { RecipeCook } from './recipes/recipe-cook';
import { RecipeDelete } from './recipes/recipe-delete';
import { RecipeDetail } from './recipes/recipe-detail';
import { RecipeEdit } from './recipes/recipe-edit';
import { RecipeFromPhoto } from './recipes/recipe-from-photo';
import { RecipeImport } from './recipes/recipe-import';
import { RecipeList } from './recipes/recipe-list';
import { RecipeNew } from './recipes/recipe-new';

// Each page sets its own <title> (inventory §2), so no route has a `title`.
// The forms only match for editors (M2). Anyone else falls through to NoAccess on the same
// address, so no form is ever built for them.
export const routes: Routes = [
  { path: '', component: RecipeList, pathMatch: 'full' },
  { path: 'recipes/new', component: RecipeNew, canMatch: [editorOnly] },
  { path: 'recipes/new', component: NoAccess },
  // M4: only with reading switched on; anyone else lands on the form, or on NoAccess.
  {
    path: 'recipes/new/photo',
    component: RecipeFromPhoto,
    canMatch: [editorOnly, readingAvailable],
  },
  { path: 'recipes/new/photo', redirectTo: 'recipes/new' },
  // M5: from a link or pasted text. No AI and no switch: there for every editor.
  {
    path: 'recipes/new/link',
    component: RecipeImport,
    canMatch: [editorOnly],
    data: { source: 'link' },
  },
  { path: 'recipes/new/link', redirectTo: 'recipes/new' },
  {
    path: 'recipes/new/text',
    component: RecipeImport,
    canMatch: [editorOnly],
    data: { source: 'text' },
  },
  { path: 'recipes/new/text', redirectTo: 'recipes/new' },
  { path: 'recipes/:id', component: RecipeDetail },
  // Cooking mode: for everyone, no sign-in (ST-752).
  { path: 'recipes/:id/cook', component: RecipeCook },
  { path: 'recipes/:id/edit', component: RecipeEdit, canMatch: [editorOnly] },
  { path: 'recipes/:id/edit', component: NoAccess },
  { path: 'recipes/:id/delete', component: RecipeDelete, canMatch: [editorOnly] },
  { path: 'recipes/:id/delete', component: NoAccess },
  { path: '**', component: NotFound },
];
