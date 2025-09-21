"use strict";

/**
 * OurMeals Frontend
 * - Fetch recipes from backend API
 * - Add/Delete recipes
 * - Maintain a Weekly Meal Plan stored in a special plan document
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

// Special hidden recipe used to store the global weekly meal plan.
// This stays out of the visible recipe list.
const PLAN_NAME = "__WEEKLY_PLAN__";

// Days and meals used for the planner grid
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MEALS = ["breakfast", "lunch", "dinner"];

// State
let allRecipes = [];         // includes the plan doc
let planDoc = null;          // the special doc containing mealPlan
let editingRecipeId = null;  // when editing an existing recipe (recreate behavior)

// Elements
const recipeForm = document.getElementById("recipe-form");
const nameInput = document.getElementById("recipe-name");
const ingredientsInput = document.getElementById("recipe-ingredients");
const recipesListEl = document.getElementById("recipes-list");
const mealPlanBodyEl = document.getElementById("meal-plan-body");
const groceryListEl = document.getElementById("grocery-list");
const generateGroceryBtn = document.getElementById("generate-grocery");
const cancelEditBtn = document.getElementById("cancel-edit");
const editWarningEl = document.getElementById("edit-warning");

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

const emptyMealPlan = () => {
  const obj = {};
  for (const d of DAYS) {
    obj[d] = { breakfast: "", lunch: "", dinner: "" };
  }
  return obj;
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
        ingredients: [],         // not used
      })
    });

    // After creating plan doc, ensure mealPlan is initialized (backend defaults it, but double-sure)
    planDoc.mealPlan = planDoc.mealPlan || emptyMealPlan();

    // Refresh overall list to include it
    allRecipes = await api("/api/recipes");
  }

  // Ensure mealPlan exists on plan doc
  if (!planDoc.mealPlan) {
    planDoc = await api(`/api/recipes/${planDoc._id}/mealplan`, {
      method: "PUT",
      body: JSON.stringify({ mealPlan: emptyMealPlan() })
    });
  }
}

// Rendering
function renderRecipesList() {
  recipesListEl.innerHTML = "";
  const visibleRecipes = allRecipes.filter((r) => !isPlanDoc(r));

  if (visibleRecipes.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No recipes yet. Add one above.";
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
    ingCount.textContent = ` • ${r.ingredients.length} ingredient(s)`;
    left.appendChild(name);
    left.appendChild(ingCount);

    const right = document.createElement("div");
    right.className = "row";

    const editBtn = document.createElement("button");
    editBtn.className = "secondary";
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", () => startEditRecipe(r));

    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
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
  const recipeOptions = [{ _id: "", name: "— None —" }, ...recipesForSelect];

  for (const day of DAYS) {
    const tr = document.createElement("tr");

    const dayCell = document.createElement("td");
    dayCell.textContent = day[0].toUpperCase() + day.slice(1);
    tr.appendChild(dayCell);

    for (const meal of MEALS) {
      const td = document.createElement("td");
      const select = document.createElement("select");

      // Populate options
      for (const opt of recipeOptions) {
        const optionEl = document.createElement("option");
        optionEl.value = opt._id;
        optionEl.textContent = opt.name;
        select.appendChild(optionEl);
      }

      // Set current value from plan
      const currentVal = (planDoc.mealPlan?.[day]?.[meal]) || "";
      select.value = currentVal;

      // On change: update local plan and send to backend
      select.addEventListener("change", async (e) => {
        try {
          const newId = e.target.value;
          // Update local plan
          if (!planDoc.mealPlan) planDoc.mealPlan = emptyMealPlan();
          planDoc.mealPlan[day][meal] = newId;

          // Persist entire mealPlan to backend
          planDoc = await api(`/api/recipes/${planDoc._id}/mealplan`, {
            method: "PUT",
            body: JSON.stringify({ mealPlan: planDoc.mealPlan })
          });
        } catch (err) {
          alert("Failed to update meal plan. See console for details.");
          console.error(err);
          // Re-render to reflect server truth if any
          await refreshAll();
        }
      });

      td.appendChild(select);
      tr.appendChild(td);
    }

    mealPlanBodyEl.appendChild(tr);
  }
}

function renderGroceryList(items) {
  groceryListEl.innerHTML = "";
  if (!items || items.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No ingredients. Assign recipes in the meal plan first.";
    groceryListEl.appendChild(li);
    return;
  }

  const sorted = items.slice().sort((a, b) => a.localeCompare(b));
  for (const item of sorted) {
    const li = document.createElement("li");
    li.textContent = item;
    groceryListEl.appendChild(li);
  }
}

/* Ingredient parsing and normalization (frontend) */
const MASS_UNITS = { kg: 1000, g: 1, lb: 453.59237, lbs: 453.59237, oz: 28.349523125 };
const VOLUME_UNITS = { l: 1000, liter: 1000, liters: 1000, dl: 100, cl: 10, ml: 1, tsp: 5, tbsp: 15, cup: 240, cups: 240 };
const COUNT_UNITS = new Set(["unit", "pc", "piece", "x", "count"]);
const IRREGULARS = { tomatoes: "tomato", potatoes: "potato", leaves: "leaf" };

function normalizeName(name) {
  const n = String(name || "").toLowerCase().trim().replace(/\s+/g, " ");
  if (IRREGULARS[n]) return IRREGULARS[n];
  if (n.endsWith("ies")) return n.slice(0, -3) + "y";
  if (n.endsWith("es") && !n.endsWith("ses")) return n.slice(0, -2);
  if (n.endsWith("s") && !n.endsWith("ss")) return n.slice(0, -1);
  return n;
}

function normalizeUnit(unit) {
  if (!unit) return null;
  let u = String(unit).toLowerCase();
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
  const m = text.match(/^(\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\s+(.*)$/);
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
  return Number.isInteger(rounded) ? String(rounded) : String(rounded.toFixed(2)).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

// Grocery list logic
function generateGroceryList() {
  const uniqueIds = new Set();
  for (const day of DAYS) {
    for (const meal of MEALS) {
      const id = planDoc.mealPlan?.[day]?.[meal];
      if (id) uniqueIds.add(id);
    }
  }

  const sums = new Map(); // key: "name||baseUnit" -> total qty in base
  const namesOnly = new Set();

  for (const id of uniqueIds) {
    const recipe = allRecipes.find((r) => r._id === id);
    if (!recipe) continue;
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
      const [qtyBase, baseUnit] = toBase(p.qty, u, cat);
      const key = `${p.name}||${baseUnit}`;
      const prev = sums.get(key) || 0;
      sums.set(key, prev + qtyBase);
    }
  }

  const namesInSums = new Set(Array.from(sums.keys()).map((k) => k.split("||")[0]));
  const items = [];

  for (const [key, total] of sums.entries()) {
    const [name, unit] = key.split("||");
    items.push(`${formatNumber(total)} ${unit} ${name}`);
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
  editingRecipeId = recipe._id;
  nameInput.value = recipe.name;
  const lines = (recipe.ingredients || []).map((ing) => {
    if (typeof ing === "string") return ing;
    if (ing && typeof ing === "object") {
      if (ing.raw) return ing.raw;
      const parts = [];
      if (ing.qty != null && ing.qty !== "") parts.push(String(ing.qty));
      if (ing.unit) parts.push(String(ing.unit));
      if (ing.name) parts.push(String(ing.name));
      return parts.join(" ").trim();
    }
    return "";
  }).filter(Boolean);
  ingredientsInput.value = lines.join("\n");
  cancelEditBtn.hidden = false;
  editWarningEl.hidden = false;
  nameInput.focus();
}

function resetForm() {
  editingRecipeId = null;
  recipeForm.reset();
  cancelEditBtn.hidden = true;
  editWarningEl.hidden = true;
}

async function handleDeleteRecipe(id) {
  if (!confirm("Delete this recipe?")) return;
  try {
    await api(`/api/recipes/${id}`, { method: "DELETE" });

    // Clean up any references in the plan
    let changed = false;
    for (const d of DAYS) {
      for (const m of MEALS) {
        if ((planDoc.mealPlan?.[d]?.[m] || "") === id) {
          planDoc.mealPlan[d][m] = "";
          changed = true;
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
    alert("Failed to delete recipe. See console for details.");
    console.error(err);
  }
}

recipeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = nameInput.value.trim();
  const ingredientsStr = ingredientsInput.value;

  if (!name) {
    alert("Name is required.");
    return;
  }

  try {
    // If editing: recreate by deleting old then creating new
    if (editingRecipeId) {
      await api(`/api/recipes/${editingRecipeId}`, { method: "DELETE" });
      editingRecipeId = null;
    }

    // Create new recipe
    await api("/api/recipes", {
      method: "POST",
      body: JSON.stringify({
        name,
        ingredients: ingredientsStr // server will normalize to array
      })
    });

    resetForm();
    await refreshAll();
  } catch (err) {
    alert("Failed to save recipe. See console for details.");
    console.error(err);
  }
});

cancelEditBtn.addEventListener("click", () => {
  resetForm();
});

// Grocery list button
generateGroceryBtn.addEventListener("click", () => {
  try {
    generateGroceryList();
  } catch (err) {
    alert("Failed to generate grocery list. See console for details.");
    console.error(err);
  }
});

// Refresh data and re-render UI
async function refreshAll() {
  await loadRecipesAndPlan();
  renderRecipesList();
  renderMealPlanGrid();
}

// Initialize app
(async function init() {
  try {
    await refreshAll();
  } catch (err) {
    console.error("Initialization failed:", err);
    alert("Failed to load data from API. Ensure the backend is running and API_BASE is correct.");
  }
})();
