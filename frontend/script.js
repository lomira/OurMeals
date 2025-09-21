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

function renderGroceryList(ingredients) {
  groceryListEl.innerHTML = "";
  if (ingredients.size === 0) {
    const li = document.createElement("li");
    li.textContent = "No ingredients. Assign recipes in the meal plan first.";
    groceryListEl.appendChild(li);
    return;
  }

  const sorted = Array.from(ingredients).sort((a, b) => a.localeCompare(b));
  for (const item of sorted) {
    const li = document.createElement("li");
    li.textContent = item;
    groceryListEl.appendChild(li);
  }
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

  const ingredients = new Set();
  for (const id of uniqueIds) {
    const recipe = allRecipes.find((r) => r._id === id);
    if (!recipe) continue;
    for (const ing of recipe.ingredients || []) {
      const norm = String(ing).trim();
      if (norm) {
        // Basic de-duplication (case-insensitive)
        ingredients.add(norm.toLowerCase());
      }
    }
  }

  renderGroceryList(ingredients);
}

// Recipe form handling
function startEditRecipe(recipe) {
  editingRecipeId = recipe._id;
  nameInput.value = recipe.name;
  ingredientsInput.value = (recipe.ingredients || []).join("\n");
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
