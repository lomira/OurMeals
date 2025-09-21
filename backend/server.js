// Import required packages
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Parse JSON request bodies

/* Connect to MongoDB using URI from .env (fallback to local for development) */
const mongoUri =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ourmeals';

if (!process.env.MONGODB_URI) {
  console.warn(
    'MONGODB_URI is not set. Falling back to local MongoDB at mongodb://127.0.0.1:27017/ourmeals'
  );
}

mongoose
  .connect(mongoUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  })
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Helper to build an empty weekly meal plan
const emptyMealPlan = () => ({
  monday: { breakfast: '', lunch: '', dinner: '' },
  tuesday: { breakfast: '', lunch: '', dinner: '' },
  wednesday: { breakfast: '', lunch: '', dinner: '' },
  thursday: { breakfast: '', lunch: '', dinner: '' },
  friday: { breakfast: '', lunch: '', dinner: '' },
  saturday: { breakfast: '', lunch: '', dinner: '' },
  sunday: { breakfast: '', lunch: '', dinner: '' }
});

/* Ingredient parsing and normalization */
const MASS_UNITS = {
  kg: 1000,
  g: 1,
  lb: 453.59237,
  lbs: 453.59237,
  oz: 28.349523125
};

const VOLUME_UNITS = {
  l: 1000,
  liter: 1000,
  liters: 1000,
  dl: 100,
  cl: 10,
  ml: 1,
  tsp: 5,
  tbsp: 15,
  cup: 240,
  cups: 240
};

const COUNT_UNITS = new Set(['unit', 'pc', 'piece', 'x', 'count']);

const IRREGULARS = {
  // English
  tomatoes: 'tomato',
  potatoes: 'potato',
  leaves: 'leaf',
  // French
  'tomates': 'tomate',
  'oignons': 'oignon',
  'poivrons': 'poivron',
  'carottes': 'carotte',
  'œufs': 'œuf',
  'oeufs': 'œuf',
  'choux': 'chou',
  'eaux': 'eau',
  'feuilles': 'feuille',
  'gousses': 'gousse',
  'tranches': 'tranche',
  'pommes de terre': 'pomme de terre'
};

function singularizeName(name) {
  let n = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
  // Strip common French determiners/prepositions
  n = n.replace(/^(?:de|d'|d’|du|des|de la|de l'|de l’)\s+/i, '');
  if (IRREGULARS[n]) return IRREGULARS[n];
  // English plural handling
  if (n.endsWith('ies')) return n.slice(0, -3) + 'y';
  if (n.endsWith('es') && !n.endsWith('ses')) return n.slice(0, -2);
  if (n.endsWith('s') && !n.endsWith('ss')) return n.slice(0, -1);
  // French pattern eaux -> eau
  if (n.endsWith('eaux')) return n.slice(0, -1);
  return n;
}

function parseIngredientString(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  // qty (int/float) + optional unit (unicode) + name
  const m = text.match(/^(\d+(?:[.,]\d+)?)\s*([^\s\d]+)?\s+(.*)$/u);
  let qty = null, unit = null, name = text;
  if (m) {
    qty = parseFloat(m[1].replace(',', '.'));
    unit = m[2] ? m[2].toLowerCase() : null;
    name = m[3];
  }
  name = singularizeName(name.replace(/\s+/g, ' '));
  if (unit) {
    unit = unit.toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
    if (unit === 'kgs') unit = 'kg';
    if (unit === 'grams' || unit === 'gr' || unit === 'gms' || unit === 'gramme' || unit === 'grammes') unit = 'g';
    if (unit === 'kilogramme' || unit === 'kilogrammes') unit = 'kg';
    if (unit === 'pound' || unit === 'pounds') unit = 'lb';
    if (unit === 'ounce' || unit === 'ounces') unit = 'oz';
    if (unit === 'litre' || unit === 'litres') unit = 'l';
    if (unit === 'milliliter' || unit === 'millilitre' || unit === 'milliliters' || unit === 'millilitres') unit = 'ml';
    // spoons
    if (unit === 'teaspoon' || unit === 'teaspoons' || unit === 'cac' || unit === 'càc' || unit === 'cc' || unit === 'cuillereacafe' || unit === 'cuillèreàcafé' || unit === 'cuillereàcafé') unit = 'tsp';
    if (unit === 'tablespoon' || unit === 'tablespoons' || unit === 'cas' || unit === 'càs' || unit === 'cs' || unit === 'cuillereasoupe' || unit === 'cuillèreàsoupe' || unit === 'cuillereàsoupe') unit = 'tbsp';
    // cups
    if (unit === 'tasse' || unit === 'tasses') unit = 'cup';
    // pieces
    if (unit === 'pcs') unit = 'pc';
    if (unit === 'pieces' || unit === 'piece' || unit === 'pièce' || unit === 'pièces') unit = 'piece';
    // counts map to "unit"
    if (unit === 'gousse' || unit === 'gousses' || unit === 'tranche' || unit === 'tranches' || unit === 'sachet' || unit === 'sachets' || unit === 'boite' || unit === 'boites' || unit === 'boîte' || unit === 'boîtes') unit = 'unit';
    // ignore French prepositions captured as unit
    if (unit === 'de' || unit === 'd' || unit === "d'" || unit === 'd’') unit = null;
  }
  return { qty: isNaN(qty) ? null : qty, unit, name, raw: text };
}

function normalizeIngredient(input) {
  if (typeof input === 'string') {
    const p = parseIngredientString(input);
    if (!p) return null;
    return p;
  }
  if (input && typeof input === 'object') {
    const raw = input.raw || '';
    const name = singularizeName(String(input.name || ''));
    const qtyNum = input.qty == null ? null : Number(input.qty);
    let unit = input.unit ? String(input.unit).toLowerCase() : null;
    if (unit) {
      unit = unit.toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
      if (unit === 'kgs') unit = 'kg';
      if (unit === 'grams' || unit === 'gr' || unit === 'gms' || unit === 'gramme' || unit === 'grammes') unit = 'g';
      if (unit === 'kilogramme' || unit === 'kilogrammes') unit = 'kg';
      if (unit === 'pound' || unit === 'pounds') unit = 'lb';
      if (unit === 'ounce' || unit === 'ounces') unit = 'oz';
      if (unit === 'litre' || unit === 'litres') unit = 'l';
      if (unit === 'milliliter' || unit === 'millilitre' || unit === 'milliliters' || unit === 'millilitres') unit = 'ml';
      if (unit === 'teaspoon' || unit === 'teaspoons' || unit === 'cac' || unit === 'càc' || unit === 'cc' || unit === 'cuillereacafe' || unit === 'cuillèreàcafé' || unit === 'cuillereàcafé') unit = 'tsp';
      if (unit === 'tablespoon' || unit === 'tablespoons' || unit === 'cas' || unit === 'càs' || unit === 'cs' || unit === 'cuillereasoupe' || unit === 'cuillèreàsoupe' || unit === 'cuillereàsoupe') unit = 'tbsp';
      if (unit === 'tasse' || unit === 'tasses') unit = 'cup';
      if (unit === 'pcs') unit = 'pc';
      if (unit === 'pieces' || unit === 'piece' || unit === 'pièce' || unit === 'pièces') unit = 'piece';
      if (unit === 'gousse' || unit === 'gousses' || unit === 'tranche' || unit === 'tranches' || unit === 'sachet' || unit === 'sachets' || unit === 'boite' || unit === 'boites' || unit === 'boîte' || unit === 'boîtes') unit = 'unit';
      if (unit === 'de' || unit === 'd' || unit === "d'" || unit === 'd’') unit = null;
    }
    return { qty: isNaN(qtyNum) ? null : qtyNum, unit, name, raw };
  }
  return null;
}

function parseIngredientsList(value) {
  // Accept string (split by newline/comma) or array of strings/objects
  let arr = value;
  if (typeof value === 'string') {
    arr = value.split(/[\n,]/).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const item of arr) {
    const norm = normalizeIngredient(item);
    if (norm && norm.name) out.push(norm);
  }
  return out;
}

/* Schema */
/* Define the Mongoose schema for the recipes collection
Each recipe has: name (String), ingredients (Array of structured objects),
and mealPlan (object with days -> meals -> String recipeId) */
const recipeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    ingredients: {
      type: [mongoose.Schema.Types.Mixed], // supports legacy strings and new structured objects
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr),
        message: 'Ingredients must be an array'
      }
    },
    baseServings: {
      type: Number,
      default: 1,
      min: 1
    },
    mealPlan: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({})
    }
  },
  {
    timestamps: true // createdAt and updatedAt fields
  }
);

// Create the Recipe model
const Recipe = mongoose.model('Recipe', recipeSchema);

/* Root route will be served by static frontend below */

/* Health endpoint with DB status */
app.get('/api/health', (_req, res) => {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const dbState = states[mongoose.connection.readyState] || 'unknown';
  res.json({
    status: 'ok',
    db: dbState
  });
});

// GET /api/recipes - Fetch all recipes
app.get('/api/recipes', async (_req, res) => {
  try {
    const recipes = await Recipe.find().sort({ createdAt: -1 });
    res.json(recipes);
  } catch (error) {
    console.error('GET /api/recipes error:', error);
    res.status(500).json({ error: 'Échec de la récupération des recettes' });
  }
});

// POST /api/recipes - Add a new recipe
app.post('/api/recipes', async (req, res) => {
  try {
    let { name, ingredients, baseServings } = req.body;

    // Basic validation
    if (!name) {
      return res.status(400).json({ error: 'Le nom est requis' });
    }

    // Parse ingredients into structured objects
    const structured = parseIngredientsList(ingredients);
    if (!structured) {
      return res
        .status(400)
        .json({ error: 'Les ingrédients doivent être un tableau ou une liste de texte' });
    }

    const newRecipe = new Recipe({
      name: String(name).trim(),
      ingredients: structured,
      baseServings:
        Number.isFinite(Number(baseServings)) && Number(baseServings) >= 1
          ? Math.floor(Number(baseServings))
          : 1,
      mealPlan: {}
    });

    const saved = await newRecipe.save();
    res.status(201).json(saved);
  } catch (error) {
    console.error('POST /api/recipes error:', error);
    res.status(500).json({ error: 'Échec de l’ajout de la recette' });
  }
});

// DELETE /api/recipes/:id - Delete a recipe by ID
app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID de recette invalide' });
    }

    const deleted = await Recipe.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Recette introuvable' });
    }

    res.json({ message: 'Recette supprimée', id });
  } catch (error) {
    console.error('DELETE /api/recipes/:id error:', error);
    res.status(500).json({ error: 'Échec de la suppression de la recette' });
  }
});

// PUT /api/recipes/:id/mealplan - Update weekly meal plan for a specific recipe
app.put('/api/recipes/:id/mealplan', async (req, res) => {
  try {
    const { id } = req.params;
    const { mealPlan } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'ID de recette invalide' });
    }

    if (typeof mealPlan !== 'object' || mealPlan === null) {
      return res.status(400).json({ error: 'mealPlan doit être un objet' });
    }

    // Expect date-indexed plan: keys 'YYYY-MM-DD' -> { breakfast, lunch, dinner }
    const cleaned = {};
    const isIsoDateKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k);
    const sanitizeSlot = (v) => {
      if (typeof v === 'string') {
        return v; // recipe id string
      }
      if (v && typeof v === 'object') {
        const id = typeof v.id === 'string' ? v.id : '';
        let servings = null;
        if (v.servings != null) {
          const s = Number(v.servings);
          if (Number.isFinite(s) && s >= 1) servings = Math.floor(s);
        }
        return id ? { id, servings } : '';
      }
      return '';
    };

    for (const [key, value] of Object.entries(mealPlan)) {
      if (!isIsoDateKey(key) || typeof value !== 'object' || value === null) continue;
      const dayObj = { breakfast: '', lunch: '', dinner: '' };
      dayObj.breakfast = sanitizeSlot(value.breakfast);
      dayObj.lunch = sanitizeSlot(value.lunch);
      dayObj.dinner = sanitizeSlot(value.dinner);
      cleaned[key] = dayObj;
    }

    const updated = await Recipe.findByIdAndUpdate(
      id,
      { mealPlan: cleaned },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Recette introuvable' });
    }

    res.json(updated);
  } catch (error) {
    console.error('PUT /api/recipes/:id/mealplan error:', error);
    res.status(500).json({ error: 'Échec de la mise à jour du plan de repas' });
  }
});

// Serve frontend static files
const frontendDir = path.join(__dirname, '../frontend');
app.use(express.static(frontendDir));

// SPA fallback: send index.html for non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Non trouvé' });
  }
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
