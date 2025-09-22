"use strict";

/**
 * OurMeals Frontend
 * - Fetch recipes from backend API
 * - Add/Delete recipes
 * - Maintain a date-indexed Meal Plan stored in a special plan document
 * - Generate grocery list from selected recipes
 *
 * Backend endpoints used:
 * - GET    /api/recipes
 * - POST   /api/recipes
 * - DELETE /api/recipes/:id
 * - PUT    /api/recipes/:id/mealplan
 */

// Change this when deploying the frontend separately from the backend.
// If hosted together behind the same domain, you can leave as '' (relative).
const API_BASE =
  (typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, "API_BASE"))
    ? window.API_BASE
    : ((location.hostname === "localhost" || location.hostname === "127.0.0.1") ? "http://localhost:5000" : "");

// Special hidden recipe used to store the global meal plan.
// This stays out of the visible recipe list.
const PLAN_NAME = "__WEEKLY_PLAN__";

// Meals used for the planner grid
const MEALS = ["breakfast", "lunch", "dinner"];

// State
let allRecipes = [];         // includes the plan doc
let planDoc = null;          // the special doc containing mealPlan
let editingRecipeId = null;  // when editing an existing recipe (recreate behavior)

// Elements
const recipeForm = document.getElementById("recipe-form");
const nameInput = document.getElementById("recipe-name");
const ingredientsInput = document.getElementById("recipe-ingredients");
const baseServingsInput = document.getElementById("recipe-servings");
const recipesListEl = document.getElementById("recipes-list");
const mealPlanBodyEl = document.getElementById("meal-plan-body");
const groceryListEl = document.getElementById("grocery-list");
const generateGroceryBtn = document.getElementById("generate-grocery");
/* Unified form extras (single add/edit UI) */
const saveRecipeBtn = document.getElementById("save-recipe");
const editCancelBtn = document.getElementById("edit-cancel");
const editWarningEl = document.getElementById("edit-warning");
const recipeFormTitle = document.getElementById("recipe-form-title");

// Tabs: bottom navigation and tabpanels
const tabButtons = {
  plan: document.getElementById("tab-plan"),
  recettes: document.getElementById("tab-recettes")
};
const tabPanels = {
  plan: document.getElementById("section-plan"),
  recettes: document.getElementById("section-recipes")
};

function setActiveTab(key) {
  for (const k of Object.keys(tabButtons)) {
    const btn = tabButtons[k];
    const panel = tabPanels[k];
    const selected = k === key;
    if (btn) btn.setAttribute("aria-selected", selected ? "true" : "false");
    if (panel) {
      if (selected) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "");
      }
    }
  }
  const hash = key === "plan" ? "#plan" : "#recettes";
  if (location.hash !== hash) {
    history.replaceState(null, "", hash);
  }
}

function setupTabs() {
  const defaultKey = (location.hash || "").replace("#", "");
  const initial = (defaultKey === "recettes") ? defaultKey : "plan";
  setActiveTab(initial);

  const order = ["plan", "recettes"];

  for (const [k, btn] of Object.entries(tabButtons)) {
    if (!btn) continue;

    btn.addEventListener("click", () => setActiveTab(k));

    btn.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const idx = order.indexOf(k);
        const next = e.key === "ArrowRight" ? (idx + 1) % order.length : (idx - 1 + order.length) % order.length;
        const nextKey = order[next];
        setActiveTab(nextKey);
        tabButtons[nextKey]?.focus();
        e.preventDefault();
      } else if (e.key === "Home") {
        setActiveTab("plan");
        tabButtons["plan"]?.focus();
        e.preventDefault();
      } else if (e.key === "End") {
        setActiveTab("recettes");
        tabButtons["recettes"]?.focus();
        e.preventDefault();
      }
    });
  }

  window.addEventListener("hashchange", () => {
    const key = (location.hash || "").replace("#", "");
    if (key === "plan" || key === "recettes") {
      setActiveTab(key);
    }
  });
}

// Utilities
const api = async (path, options = {}) => {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  // Some endpoints may return no content, guard with try/catch
  try {
    return await res.json();
  } catch {
    return null;
  }
};

/* Dates utilitaires pour la plage dynamique (FR) */
function toDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  x.setHours(0, 0, 0, 0);
  return x;
}
function isoWeekMonday(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const k = (x.getDay() + 6) % 7; // 0 = lundi
  return addDays(x, -k);
}
function computeRange(today = new Date()) {
  const start = addDays(today, -2);
  const nextWeekMonday = addDays(isoWeekMonday(today), 7);
  const end = addDays(nextWeekMonday, 6); // dimanche de la semaine prochaine
  const fmt = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    out.push({ date: new Date(d), key: toDateKey(d), label: fmt.format(d) });
  }
  return out;
}
function ensureDay(plan, key) {
  if (!plan[key]) plan[key] = { breakfast: "", lunch: "", dinner: "" };
  return plan[key];
}
function capitalizeFirst(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const emptyMealPlan = () => {
  return {};
};

const isPlanDoc = (doc) => doc && doc.name === PLAN_NAME;

// Data loading
async function loadRecipesAndPlan() {
  // Fetch all recipes
  allRecipes = await api("/api/recipes");

  // Try to find the plan document
  planDoc = allRecipes.find((r) => r.name === PLAN_NAME) || null;

  // If no plan doc exists, create one
  if (!planDoc) {
    planDoc = await api("/api/recipes", {
      method: "POST",
      body: JSON.stringify({
        name: PLAN_NAME,
        ingredients: [] // not used
      })
    });

    // After creating plan doc, ensure mealPlan is initialized as date-indexed object
    planDoc.mealPlan = planDoc.mealPlan || {};

    // Refresh overall list to include it
    allRecipes = await api("/api/recipes");
  }

  // Ensure mealPlan exists on plan doc
  if (!planDoc.mealPlan) {
    planDoc = await api(`/api/recipes/${planDoc._id}/mealplan`, {
      method: "PUT",
      body: JSON.stringify({ mealPlan: {} })
    });
  }
}

// Rendering
function renderRecipesList() {
  recipesListEl.innerHTML = "";
  const visibleRecipes = allRecipes.filter((r) => !isPlanDoc(r));

  if (visibleRecipes.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Aucune recette pour le moment. Ajoutez-en via le formulaire.";
    recipesListEl.appendChild(li);
    return;
  }

  for (const r of visibleRecipes) {
    const li = document.createElement("li");

    const left = document.createElement("div");
    left.className = "row";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = r.name;
    const ingCount = document.createElement("span");
    ingCount.className = "muted";
    ingCount.textContent = ` • ${r.ingredients.length} ingrédient(s)`;
    left.appendChild(name);
    left.appendChild(ingCount);

    const right = document.createElement("div");
    right.className = "row";

    const editBtn = document.createElement("button");
    editBtn.className = "secondary";
    editBtn.textContent = "Modifier";
    editBtn.addEventListener("click", () => startEditRecipe(r));

    const delBtn = document.createElement("button");
    delBtn.textContent = "Supprimer";
    delBtn.addEventListener("click", () => handleDeleteRecipe(r._id));

    right.appendChild(editBtn);
    right.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(right);

    recipesListEl.appendChild(li);
  }
}

function renderMealPlanGrid() {
  mealPlanBodyEl.innerHTML = "";

  const recipesForSelect = allRecipes.filter((r) => !isPlanDoc(r));
  const recipeOptions = [{ _id: "", name: "— Aucun —" }, ...recipesForSelect];

  const range = computeRange(new Date());

  for (const entry of range) {
    const { key: dateKey, label } = entry;
    const tr = document.createElement("tr");

    const dayCell = document.createElement("td");
    dayCell.textContent = capitalizeFirst(label);
    tr.appendChild(dayCell);

    for (const meal of MEALS) {
      const td = document.createElement("td");

      const select = document.createElement("select");
      const mealLabel = meal === "breakfast" ? "Petit-déjeuner" : (meal === "lunch" ? "Déjeuner" : "Dîner");
      select.setAttribute("aria-label", `${mealLabel} du ${capitalizeFirst(label)}`);
      for (const opt of recipeOptions) {
        const optionEl = document.createElement("option");
        optionEl.value = opt._id;
        optionEl.textContent = opt.name;
        select.appendChild(optionEl);
      }

      // Read current slot (string id or object {id, servings})
      const slotVal = (planDoc.mealPlan?.[dateKey]?.[meal]);
      let selectedId = "";
      let slotServings = null;
      if (typeof slotVal === "string") {
        selectedId = slotVal;
      } else if (slotVal && typeof slotVal === "object") {
        selectedId = typeof slotVal.id === "string" ? slotVal.id : "";
        slotServings = (slotVal.servings != null) ? Number(slotVal.servings) : null;
      }
      select.value = selectedId;

      // Servings input per cell
      const servingsInput = document.createElement("input");
      servingsInput.type = "number";
      servingsInput.inputMode = "numeric";
      servingsInput.min = "1";
      servingsInput.className = "servings-input";
      servingsInput.setAttribute("aria-label", `${mealLabel} - portions du ${capitalizeFirst(label)}`);
      servingsInput.placeholder = "Pers.";
      servingsInput.style.marginLeft = "8px";
      servingsInput.style.width = "70px";

      const selectedRecipe = allRecipes.find((r) => r._id === selectedId);
      const base = selectedRecipe && Number.isFinite(Number(selectedRecipe.baseServings)) && Number(selectedRecipe.baseServings) >= 1
        ? Math.floor(Number(selectedRecipe.baseServings))
        : 1;

      const initial = slotServings != null && Number.isFinite(Number(slotServings)) && Number(slotServings) >= 1
        ? Math.floor(Number(slotServings))
        : base;

      if (!selectedId) {
        servingsInput.value = "";
        servingsInput.disabled = true;
      } else {
        servingsInput.value = String(initial);
        servingsInput.disabled = false;
      }

      // On select change: update slot id and keep/derive servings
      select.addEventListener("change", async (e) => {
        const newId = e.target.value;
        try {
          if (!planDoc.mealPlan) planDoc.mealPlan = {};
          const dayObj = ensureDay(planDoc.mealPlan, dateKey);

          if (!newId) {
            dayObj[meal] = "";
            servingsInput.value = "";
            servingsInput.disabled = true;
          } else {
            const rec = allRecipes.find((r) => r._id === newId);
            const baseS = rec && Number(rec.baseServings) >= 1 ? Math.floor(Number(rec.baseServings)) : 1;
            let s = parseInt(servingsInput.value, 10);
            if (!Number.isFinite(s) || s < 1) s = baseS;
            servingsInput.value = String(s);
            servingsInput.disabled = false;
            dayObj[meal] = { id: newId, servings: s };
          }

          planDoc = await api(`/api/recipes/${planDoc._id}/mealplan`, {
            method: "PUT",
            body: JSON.stringify({ mealPlan: planDoc.mealPlan })
          });
        } catch (err) {
          alert("Échec de la mise à jour du plan de repas. Voir la console pour plus de détails.");
          console.error(err);
          await refreshAll();
        }
      });

      // On servings change: update slot servings
      servingsInput.addEventListener("change", async (e) => {
        const currentId = select.value;
        if (!currentId) return;
        let s = parseInt(e.target.value, 10);
        if (!Number.isFinite(s) || s < 1) s = 1;
        e.target.value = String(s);

        try {
          if (!planDoc.mealPlan) planDoc.mealPlan = {};
          const dayObj = ensureDay(planDoc.mealPlan, dateKey);
          dayObj[meal] = { id: currentId, servings: s };
          planDoc = await api(`/api/recipes/${planDoc._id}/mealplan`, {
            method: "PUT",
            body: JSON.stringify({ mealPlan: planDoc.mealPlan })
          });
        } catch (err) {
          alert("Échec de la mise à jour du plan de repas. Voir la console pour plus de détails.");
          console.error(err);
          await refreshAll();
        }
      });

      td.appendChild(select);
      td.appendChild(servingsInput);
      tr.appendChild(td);
    }

    mealPlanBodyEl.appendChild(tr);
  }
}

function renderGroceryList(items) {
  groceryListEl.innerHTML = "";
  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "Aucun ingrédient. Assignez des recettes dans le plan de repas.";
    groceryListEl.appendChild(li);
    return;
  }

  const sorted = items.slice().sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
  for (const item of sorted) {
    const li = document.createElement("li");
    li.textContent = item;
    groceryListEl.appendChild(li);
  }
}

function setGroceryStartDateBounds() {
  const input = document.getElementById("grocery-start-date");
  if (!input) return;

  const range = computeRange(new Date());
  if (!Array.isArray(range) || range.length === 0) return;

  const minKey = range[0].key;
  const maxKey = range[range.length - 1].key;
  input.min = minKey;
  input.max = maxKey;

  const todayKey = toDateKey(new Date());
  let val = todayKey;
  if (val < minKey) val = minKey;
  if (val > maxKey) val = maxKey;

  if (!input.value || input.value < minKey || input.value > maxKey) {
    input.value = val;
  }
}

/* Ingredient parsing and normalization (frontend) */
const MASS_UNITS = { kg: 1000, g: 1, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 };
const VOLUME_UNITS = { l: 1000, liter: 1000, liters: 1000, dl: 100, cl: 10, ml: 1, tsp: 5, tbsp: 15, cup: 240, cups: 240 };
const COUNT_UNITS = new Set(["unit", "pc", "piece", "x", "count"]);
const IRREGULARS = {
  // English
  tomatoes: "tomato",
  potatoes: "potato",
  leaves: "leaf",
  // French
  "tomates": "tomate",
  "oignons": "oignon",
  "poivrons": "poivron",
  "carottes": "carotte",
  "œufs": "œuf",
  "oeufs": "œuf",
  "choux": "chou",
  "eaux": "eau",
  "feuilles": "feuille",
  "gousses": "gousse",
  "tranches": "tranche",
  "pommes de terre": "pomme de terre"
};

function normalizeName(name) {
  let n = String(name || "").toLowerCase().trim().replace(/\s+/g, " ");
  // Remove common French determiners/prepositions
  n = n.replace(/^(?:de|d'|d’|du|des|de la|de l'|de l’)\s+/i, "");
  // Normalize irregulars first (EN + FR)
  if (IRREGULARS[n]) return IRREGULARS[n];
  // English plural handling
  if (n.endsWith("ies")) return n.slice(0, -3) + "y";
  if (n.endsWith("es") && !n.endsWith("ses")) return n.slice(0, -2);
  if (n.endsWith("s") && !n.endsWith("ss")) return n.slice(0, -1);
  // Specific French plural patterns
  if (n.endsWith("eaux")) return n.slice(0, -1); // eaux -> eau
  return n;
}

function normalizeUnit(unit) {
  if (!unit) return null;
  let u = String(unit).toLowerCase();
  // Strip dots/spaces for abbreviations like c.à.s.
  u = u.replace(/\./g, "").replace(/\s+/g, "");
  // Ignore French prepositions captured as "units"
  if (u === "de" || u === "d" || u === "d'" || u === "d’") return null;

  // English variants
  if (u === "kgs") u = "kg";
  if (u === "grams" || u === "gr" || u === "gms") u = "g";
  if (u === "pound" || u === "pounds") u = "lb";
  if (u === "ounce" || u === "ounces") u = "oz";
  if (u === "litre" || u === "litres") u = "l";
  if (u === "milliliter" || u === "millilitre" || u === "milliliters" || u === "millilitres") u = "ml";
  if (u === "teaspoon" || u === "teaspoons") u = "tsp";
  if (u === "tablespoon" || u === "tablespoons") u = "tbsp";
  if (u === "pcs") u = "pc";
  if (u === "pieces") u = "piece";

  // French variants
  if (u === "gramme" || u === "grammes") u = "g";
  if (u === "kilogramme" || u === "kilogrammes") u = "kg";
  if (u === "litre" || u === "litres") u = "l";
  if (u === "millilitre" || u === "millilitres") u = "ml";
  if (u === "tasse" || u === "tasses") u = "cup";

  // cuillère à café
  if (u === "cac" || u === "càc" || u === "cc" || u === "càco" || u === "cuillereacafe" || u === "cuillèreàcafé" || u === "cuillereàcafé") u = "tsp";
  // cuillère à soupe
  if (u === "cas" || u === "càs" || u === "cs" || u === "cuillereasoupe" || u === "cuillèreàsoupe" || u === "cuillereàsoupe") u = "tbsp";

  // counts
  if (u === "piece" || u === "pièce" || u === "pièces") u = "piece";
  if (u === "gousse" || u === "gousses" || u === "tranche" || u === "tranches" || u === "sachet" || u === "sachets" || u === "boite" || u === "boites" || u === "boîte" || u === "boîtes") u = "unit";

  return u;
}

function unitCategory(u) {
  if (!u) return null;
  if (u in MASS_UNITS) return "mass";
  if (u in VOLUME_UNITS) return "volume";
  if (COUNT_UNITS.has(u)) return "count";
  return null;
}

function toBase(qty, unit, category) {
  if (category === "mass") return [qty * (MASS_UNITS[unit] || 1), "g"];
  if (category === "volume") return [qty * (VOLUME_UNITS[unit] || 1), "ml"];
  if (category === "count") return [qty, "unit"];
  return [qty, unit || ""];
}

function parseIngredientClient(ing) {
  // Accept server-structured objects or legacy strings
  if (ing && typeof ing === "object") {
    const name = normalizeName(ing.name || "");
    const qty = ing.qty == null ? null : Number(ing.qty);
    const unit = normalizeUnit(ing.unit || null);
    return { qty: Number.isFinite(qty) ? qty : null, unit, name, raw: ing.raw || "" };
  }
  const text = String(ing || "").trim();
  if (!text) return null;
  const m = text.match(/^(\d+(?:[.,]\d+)?)\s*([^\s\d]+)?\s+(.*)$/u);
  let qty = null, unit = null, name = text;
  if (m) {
    qty = parseFloat(m[1].replace(",", "."));
    unit = normalizeUnit(m[2] || null);
    name = m[3];
  }
  name = normalizeName(name);
  return { qty: Number.isFinite(qty) ? qty : null, unit, name, raw: text };
}

function formatNumber(n) {
  const rounded = Math.round(n * 100) / 100;
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(rounded);
}

// Grocery list logic
function generateGroceryList(startKey) {
  const sums = new Map(); // key: "name||baseUnit" -> total qty in base
  const namesOnly = new Set();

  const range = computeRange(new Date()).filter((e) => !startKey || e.key >= startKey);

  for (const entry of range) {
    const dateKey = entry.key;
    for (const meal of MEALS) {
      const slotVal = (planDoc.mealPlan?.[dateKey]?.[meal]);
      let id = "";
      let desiredServings = null;
      if (typeof slotVal === "string") {
        id = slotVal;
      } else if (slotVal && typeof slotVal === "object") {
        id = typeof slotVal.id === "string" ? slotVal.id : "";
        if (slotVal.servings != null) {
          const s = Number(slotVal.servings);
          if (Number.isFinite(s) && s >= 1) desiredServings = Math.floor(s);
        }
      }
      if (!id) continue;

      const recipe = allRecipes.find((r) => r._id === id);
      if (!recipe) continue;

      const baseServ = Number.isFinite(Number(recipe.baseServings)) && Number(recipe.baseServings) >= 1
        ? Math.floor(Number(recipe.baseServings))
        : 1;
      const desired = (desiredServings != null) ? desiredServings : baseServ;
      const factor = desired / baseServ;

      for (const ing of (recipe.ingredients || [])) {
        const p = parseIngredientClient(ing);
        if (!p || !p.name) continue;

        if (p.qty == null) {
          namesOnly.add(p.name);
          continue;
        }

        let u = normalizeUnit(p.unit || null);
        let cat = unitCategory(u);
        if (!cat) {
          // If quantity given but no recognized unit, treat as count
          cat = "count";
          u = "unit";
        }
        const [qtyBase, baseUnit] = toBase(p.qty * factor, u, cat);
        const key = `${p.name}||${baseUnit}`;
        const prev = sums.get(key) || 0;
        sums.set(key, prev + qtyBase);
      }
    }
  }

  const namesInSums = new Set(Array.from(sums.keys()).map((k) => k.split("||")[0]));
  const items = [];

  for (const [key, total] of sums.entries()) {
    const [name, unit] = key.split("||");
    const displayUnit = unit === "unit" ? (total > 1 ? "pièces" : "pièce") : unit;
    items.push(`${formatNumber(total)} ${displayUnit ? displayUnit + " " : ""}${name}`);
  }

  for (const name of namesOnly) {
    if (!namesInSums.has(name)) {
      items.push(name);
    }
  }

  renderGroceryList(items);
}

// Recipe form handling
function startEditRecipe(recipe) {
  if (typeof setActiveTab === "function") setActiveTab("recettes");
  editingRecipeId = recipe._id;

  // Populate unified form fields
  if (nameInput) nameInput.value = recipe.name;

  const lines = (recipe.ingredients || [])
    .map((ing) => {
      if (typeof ing === "string") return ing;
      if (ing && typeof ing === "object") {
        if (ing.raw) return ing.raw;
        const parts = [];
        if (typeof ing.qty !== "undefined" && ing.qty !== null && ing.qty !== "") parts.push(String(ing.qty));
        if (ing.unit) parts.push(String(ing.unit));
        if (ing.name) parts.push(String(ing.name));
        return parts.join(" ").trim();
      }
      return "";
    })
    .filter(Boolean);

  if (ingredientsInput) ingredientsInput.value = lines.join("\n");
  if (baseServingsInput) {
    baseServingsInput.value = (recipe.baseServings && Number(recipe.baseServings) >= 1)
      ? String(Math.floor(Number(recipe.baseServings)))
      : "1";
  }

  if (editWarningEl) editWarningEl.hidden = false;
  if (editCancelBtn) editCancelBtn.hidden = false;
  if (saveRecipeBtn) saveRecipeBtn.textContent = "Mettre à jour la recette";
  if (recipeFormTitle) recipeFormTitle.textContent = "Modifier une recette";
  if (nameInput) nameInput.focus();
}

function resetForm() {
  editingRecipeId = null;
  if (recipeForm) recipeForm.reset();
  if (baseServingsInput) baseServingsInput.value = "1";
  if (saveRecipeBtn) saveRecipeBtn.textContent = "Enregistrer la recette";
  if (recipeFormTitle) recipeFormTitle.textContent = "Ajouter une recette";
  if (editWarningEl) editWarningEl.hidden = true;
  if (editCancelBtn) editCancelBtn.hidden = true;
}

async function handleDeleteRecipe(id) {
  if (!confirm("Supprimer cette recette ?")) return;
  try {
    await api(`/api/recipes/${id}`, { method: "DELETE" });

    // Clean up any references in the plan (toutes les dates)
    let changed = false;
    const keys = Object.keys(planDoc?.mealPlan || {});
    for (const dKey of keys) {
      for (const m of MEALS) {
        const slotVal = planDoc.mealPlan?.[dKey]?.[m];
        if (typeof slotVal === "string") {
          if (slotVal === id) {
            planDoc.mealPlan[dKey][m] = "";
            changed = true;
          }
        } else if (slotVal && typeof slotVal === "object") {
          if (slotVal.id === id) {
            planDoc.mealPlan[dKey][m] = "";
            changed = true;
          }
        }
      }
    }
    if (changed) {
      planDoc = await api(`/api/recipes/${planDoc._id}/mealplan`, {
        method: "PUT",
        body: JSON.stringify({ mealPlan: planDoc.mealPlan })
      });
    }

    await refreshAll();
  } catch (err) {
    alert("Échec de la suppression de la recette. Voir la console pour plus de détails.");
    console.error(err);
  }
}

recipeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const ingredientsStr = ingredientsInput.value;
  const baseServings = Math.max(1, parseInt(baseServingsInput.value, 10) || 1);

  if (!name) {
    alert("Le nom est requis.");
    return;
  }

  try {
    // If editing, delete the old recipe first (no update endpoint)
    if (editingRecipeId) {
      await api(`/api/recipes/${editingRecipeId}`, { method: "DELETE" });
      editingRecipeId = null;
    }

    // Create new recipe
    await api("/api/recipes", {
      method: "POST",
      body: JSON.stringify({
        name,
        ingredients: ingredientsStr,
        baseServings
      })
    });

    resetForm();
    await refreshAll();
  } catch (err) {
    alert("Échec de l’enregistrement de la recette. Voir la console pour plus de détails.");
    console.error(err);
  }
});


if (editCancelBtn) {
  editCancelBtn.addEventListener("click", () => {
    resetForm();
  });
}

// Grocery list button
generateGroceryBtn.addEventListener("click", () => {
  try {
    const startEl = document.getElementById("grocery-start-date");
    const startKey = startEl && startEl.value ? startEl.value : null;
    generateGroceryList(startKey);
  } catch (err) {
    alert("Échec de la génération de la liste de courses. Voir la console pour plus de détails.");
    console.error(err);
  }
});

// Refresh data and re-render UI
async function refreshAll() {
  await loadRecipesAndPlan();
  renderRecipesList();
  renderMealPlanGrid();
  setGroceryStartDateBounds();
}

/** Initialize app */
(async function init() {
  try {
    setupTabs();
    await refreshAll();
  } catch (err) {
    console.error("Initialization failed:", err);
    alert("Échec du chargement des données depuis l’API. Assurez-vous que le backend est démarré et que API_BASE est correct.");
  }
})();
