import { Routes } from '@angular/router';
import { AssistantApprove } from './assistant/approve';
import { AssistantHelp } from './assistant/help';
import { AssistantKeyDelete } from './assistant/key-delete';
import { AssistantKeyNew } from './assistant/key-new';
import { AssistantKeys } from './assistant/keys';
import { editorOnly } from './auth';
import { NoAccess } from './pages/no-access';
import { NotFound } from './pages/not-found';
import { PlanDay } from './plan/plan-day';
import { PlanWeek } from './plan/plan-week';
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
  // Connecting an assistant (ST-833): the help page for everyone, the keys for editors.
  { path: 'assistent', component: AssistantHelp },
  { path: 'assistent/nokler', component: AssistantKeys, canMatch: [editorOnly] },
  { path: 'assistent/nokler', component: NoAccess },
  { path: 'assistent/nokler/ny', component: AssistantKeyNew, canMatch: [editorOnly] },
  { path: 'assistent/nokler/ny', component: NoAccess },
  { path: 'assistent/nokler/:id/slett', component: AssistantKeyDelete, canMatch: [editorOnly] },
  { path: 'assistent/nokler/:id/slett', component: NoAccess },
  // The Claude app's approval step (ST-834). Open to everyone: the backend answers who is
  // signed in, and the scope follows the editor list.
  { path: 'assistent/godkjenn', component: AssistantApprove },
  // The week plan (ST-1231): private to the household, so editors only, the week included.
  { path: 'ukeplan', component: PlanWeek, canMatch: [editorOnly] },
  { path: 'ukeplan', component: NoAccess },
  { path: 'ukeplan/:date', component: PlanDay, canMatch: [editorOnly] },
  { path: 'ukeplan/:date', component: NoAccess },
  { path: '**', component: NotFound },
];
