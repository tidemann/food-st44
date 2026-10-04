import { Routes } from '@angular/router';
import { NotFound } from './pages/not-found';
import { RecipeDetail } from './recipes/recipe-detail';
import { RecipeList } from './recipes/recipe-list';

// Each page sets its own <title> (inventory §2), so no route has a `title`.
export const routes: Routes = [
  { path: '', component: RecipeList, pathMatch: 'full' },
  // The new/edit/delete forms are M1 part 2. Until then these paths are not pages yet.
  { path: 'recipes/new', component: NotFound },
  { path: 'recipes/:id', component: RecipeDetail },
  { path: '**', component: NotFound },
];
