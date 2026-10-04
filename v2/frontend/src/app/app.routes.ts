import { Routes } from '@angular/router';
import { DeletePage } from './pages/delete';
import { DetailPage } from './pages/detail';
import { EditPage } from './pages/edit';
import { ListPage } from './pages/list';
import { NewPage } from './pages/new';
import { NotFoundPage } from './pages/not-found';

// The same URLs as v1 (inventory §1). Route params and query params (`q`, `flash`) arrive as
// component inputs (withComponentInputBinding). Every page sets its own tab title.
export const routes: Routes = [
  { path: '', component: ListPage },
  { path: 'recipes/new', component: NewPage },
  { path: 'recipes/:id', component: DetailPage },
  { path: 'recipes/:id/edit', component: EditPage },
  { path: 'recipes/:id/delete', component: DeletePage },
  { path: '**', component: NotFoundPage, data: { kind: 'page' } },
];
