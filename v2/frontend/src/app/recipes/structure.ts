// Ingredient groups and method phases on the recipe form (ST-1962, ST-1966 §2 and §6).
// A recipe is one list and one method until the editor splits it; the API's rules decide what
// may be saved, this only keeps the blocks while they are edited and names them in messages.
import type { IngredientGroupInput, PhaseInput, Recipe, RecipeInput } from '../api/types';

/** A group or phase on the form. `key` keeps its fields (and focus) with it when it moves. */
export type GroupBlock = IngredientGroupInput & { key: number };
export type PhaseBlock = PhaseInput & { key: number };

let lastKey = 0;

export function newGroup(ingredients = ''): GroupBlock {
  return { key: ++lastKey, title: '', ingredients };
}

export function newPhase(instructions = ''): PhaseBlock {
  return { key: ++lastKey, title: '', time: '', instructions };
}

/** The groups to edit, or null for a plain list (one untitled group, or none given). */
export function groupsToEdit(initial: RecipeInput | Recipe): GroupBlock[] | null {
  const groups = initial.ingredient_groups ?? [];
  const plain = groups.length === 0 || (groups.length === 1 && !groups[0]?.title);
  return plain ? null : groups.map((group) => ({ ...newGroup(group.ingredients), ...group }));
}

/** The phases to edit, or null for a method without phases. */
export function phasesToEdit(initial: RecipeInput | Recipe): PhaseBlock[] | null {
  const phases = initial.phases ?? [];
  return phases.length ? phases.map((phase) => ({ ...newPhase(), ...phase })) : null;
}

/** The API's shape: the blocks without their keys. */
export function groupsToSave(groups: readonly GroupBlock[]): IngredientGroupInput[] {
  return groups.map(({ title, ingredients }) => ({ title, ingredients }));
}

export function phasesToSave(phases: readonly PhaseBlock[]): PhaseInput[] {
  return phases.map(({ title, time, instructions }) => ({ title, time, instructions }));
}

/** "Flytt opp" (-1) / "Flytt ned" (+1). Past either end it changes nothing. */
export function move<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  const moved = [...items];
  const [item] = moved.splice(index, 1);
  if (item === undefined || to < 0 || to > moved.length) return [...items];
  moved.splice(to, 0, item);
  return moved;
}

/** "Slå sammen til én liste": every group's lines in order, the titles gone. */
export function mergeGroups(groups: readonly GroupBlock[]): string {
  return groups
    .map((group) => group.ingredients.trim())
    .filter(Boolean)
    .join('\n');
}

/** The method as one text: every phase's steps in order, titles and times gone. */
export function mergePhases(phases: readonly PhaseBlock[]): string {
  return phases
    .map((phase) => phase.instructions.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * One row per line: the fallback where CSS field-sizing does not size the field to its text
 * (ST-1966 picture 4).
 */
export function rowsFor(text: string, min = 3): number {
  return Math.max(min, text.split('\n').length);
}

/** «gruppen «Glaze»», or «gruppe 2» while it has no title: for labels and the status line. */
export function groupName(group: GroupBlock, index: number): string {
  const title = group.title.trim();
  return title ? `gruppen «${title}»` : `gruppe ${String(index + 1)}`;
}

export function phaseName(phase: PhaseBlock, index: number): string {
  const title = phase.title.trim();
  return title ? `fasen «${title}»` : `fase ${String(index + 1)}`;
}

export function capitalise(text: string): string {
  return text.charAt(0).toLocaleUpperCase('nb') + text.slice(1);
}

const BLOCK_FIELD = /^(ingredient_groups|phases)\.(\d+)\.(title|ingredients|instructions|time)$/;

/** A 422 key for a field in a group or a phase: "ingredient_groups.1.title". */
export function isBlockField(key: string): boolean {
  return BLOCK_FIELD.test(key);
}

/** The form field a 422 key belongs to: "ingredient_groups.1.title" → "group-1-title". */
export function blockFieldId(key: string): string {
  const [, kind = '', index = '', field = ''] = BLOCK_FIELD.exec(key) ?? [];
  return `${kind === 'phases' ? 'phase' : 'group'}-${index}-${field}`;
}

/**
 * The summary's line for a group's or a phase's error: it names the block, since "Tittel på
 * gruppen" is on every group. The message under the field is the API's.
 */
export function blockSummary(
  key: string,
  message: string,
  groups: readonly GroupBlock[],
  phases: readonly PhaseBlock[],
): string {
  const [, kind, at = '', field] = BLOCK_FIELD.exec(key) ?? [];
  const index = Number(at);
  const n = String(index + 1);
  const title = (kind === 'phases' ? phases[index]?.title : groups[index]?.title)?.trim();
  const named = title ? ` «${title}»` : '';
  if (kind === 'ingredient_groups' && field === 'title') {
    return `Gruppe ${n} må ha en tittel når oppskriften har flere grupper.`;
  }
  if (kind === 'ingredient_groups' && field === 'ingredients') {
    return `Gruppe ${n}${named} må ha minst én ingrediens.`;
  }
  if (kind === 'phases' && field === 'instructions') {
    return `Fase ${n}${named} må ha minst ett steg.`;
  }
  if (kind === 'phases' && field === 'title') return `Fase ${n} må ha en tittel.`;
  return message;
}
