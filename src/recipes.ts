// `recipes list|show|rm`: the "show me once" recipes saved by the browser, read straight from
// their folder (the browser doesn't have to run).
import fs from "node:fs/promises";
import path from "node:path";
import { Recipes, formatRecipe, type RecipeIO } from "../browser/Recipes.sys.mjs";
import { L } from "./i18n.ts";
import { RECIPES_DIR } from "./paths.ts";

export const nodeIO: RecipeIO = {
  readText: (file) => fs.readFile(file, "utf8"),
  writeText: (file, text) => fs.writeFile(file, text, { mode: 0o600 }),
  makeDirectory: (dir) => fs.mkdir(dir, { recursive: true, mode: 0o700 }),
  move: (from, to) => fs.rename(from, to),
  remove: (target) => fs.rm(target, { recursive: true, force: true }),
  children: async (dir) => (await fs.readdir(dir)).map((name) => path.join(dir, name)),
  exists: (target) =>
    fs.access(target).then(
      () => true,
      () => false,
    ),
};

export async function recipesCommand(args: string[], store = new Recipes({ dir: RECIPES_DIR, io: nodeIO })) {
  const [action = "list", id] = args;
  if (action === "list") {
    const all = await store.list();
    if (!all.length) return L(`No recipes in ${store.dir}.`, `${store.dir} içinde tarif yok.`);
    return all
      .map((r) => `${r.id.padEnd(30)}  ${r.name}  (${r.steps} ${L("steps", "adım")}, ${r.createdAt.slice(0, 10)})`)
      .join("\n");
  }
  if ((action === "show" || action === "rm") && id) {
    const recipe = await store.get(id);
    if (action === "show") return formatRecipe(recipe, { dir: path.join(store.dir, id), images: true });
    await store.remove(id);
    return L(`✓ removed “${recipe.name}”`, `✓ “${recipe.name}” silindi`);
  }
  throw new Error("Usage: recipes [list] | show <id> | rm <id>");
}
