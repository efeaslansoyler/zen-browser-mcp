export type RecipeStep = {
  action: string;
  target?: Record<string, string>;
  value?: string | string[];
  secret?: boolean;
  checked?: boolean;
  files?: string[];
  key?: string;
  url?: string;
  frameUrl?: string;
  image?: string;
  crop?: string;
};
export type Recipe = {
  version: number;
  id: string;
  name: string;
  note: string;
  origin: string;
  startUrl: string;
  createdAt: string;
  steps: RecipeStep[];
};
export type RecipeSummary = Omit<Recipe, "version" | "steps"> & { steps: number };
export type RecipeIO = {
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<unknown>;
  makeDirectory(path: string): Promise<unknown>;
  move(from: string, to: string): Promise<unknown>;
  remove(path: string): Promise<unknown>;
  children(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
};
export function slug(name: string): string;
export function originOf(url: string): string;
export function localDay(iso: string): string;
export function describeStep(step: RecipeStep): string;
export function formatRecipe(recipe: Recipe, options?: { dir?: string; images?: boolean }): string;
export class Recipes {
  constructor(env: { dir: string; io: RecipeIO; now?: () => Date });
  dir: string;
  get(id: string): Promise<Recipe>;
  list(options?: { origin?: string }): Promise<RecipeSummary[]>;
  remove(id: string): Promise<void>;
}
