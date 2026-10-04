import { Routes } from '@angular/router';
import { NotFound } from './pages/not-found';
import { RecipeDelete } from './recipes/recipe-delete';
import { RecipeDetail } from './recipes/recipe-detail';
import { RecipeEdit } from './recipes/recipe-edit';
import { RecipeList } from './recipes/recipe-list';
import { RecipeNew } from './recipes/recipe-new';

// Each page sets its own <title> (inventory §2), so no route has a `title`.
export const routes: Routes = [
  { path: '', component: RecipeList, pathMatch: 'full' },
  { path: 'recipes/new', component: RecipeNew },
  { path: 'recipes/:id', component: RecipeDetail },
  { path: 'recipes/:id/edit', component: RecipeEdit },
  { path: 'recipes/:id/delete', component: RecipeDelete },
  { path: '**', component: NotFound },
];
