// Import required packages
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
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

// Define the Mongoose schema for the recipes collection
// Each recipe has: name (String), ingredients ([String]),
// and mealPlan (object with days -> meals -> String recipeId)
const recipeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true
    },
    ingredients: [
      {
        type: String,
        required: true,
        trim: true
      }
    ],
    mealPlan: {
      monday: {
        breakfast: { type: String, default: '' },
        lunch: { type: String, default: '' },
        dinner: { type: String, default: '' }
      },
      tuesday: {
        breakfast: { type: String, default: '' },
        lunch: { type: String, default: '' },
        dinner: { type: String, default: '' }
      },
      wednesday: {
        breakfast: { type: String, default: '' },
        lunch: { type: String, default: '' },
        dinner: { type: String, default: '' }
      },
      thursday: {
        breakfast: { type: String, default: '' },
        lunch: { type: String, default: '' },
        dinner: { type: String, default: '' }
      },
      friday: {
        breakfast: { type: String, default: '' },
        lunch: { type: String, default: '' },
        dinner: { type: String, default: '' }
      },
      saturday: {
        breakfast: { type: String, default: '' },
        lunch: { type: String, default: '' },
        dinner: { type: String, default: '' }
      },
      sunday: {
        breakfast: { type: String, default: '' },
        lunch: { type: String, default: '' },
        dinner: { type: String, default: '' }
      }
    }
  },
  {
    timestamps: true // createdAt and updatedAt fields
  }
);

// Create the Recipe model
const Recipe = mongoose.model('Recipe', recipeSchema);

/* Health check/root route */
app.get('/', (_req, res) => {
  res.send('OurMeals API is running');
});

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
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// POST /api/recipes - Add a new recipe
app.post('/api/recipes', async (req, res) => {
  try {
    let { name, ingredients } = req.body;

    // Basic validation
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    // Normalize ingredients to an array of non-empty trimmed strings
    if (typeof ingredients === 'string') {
      // Support either comma-separated or newline-separated input
      ingredients = ingredients
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    if (!Array.isArray(ingredients)) {
      return res
        .status(400)
        .json({ error: 'Ingredients must be an array or a string list' });
    }

    const cleanIngredients = ingredients
      .map((s) => String(s).trim())
      .filter((s) => s.length > 0);

    const newRecipe = new Recipe({
      name: String(name).trim(),
      ingredients: cleanIngredients,
      mealPlan: emptyMealPlan()
    });

    const saved = await newRecipe.save();
    res.status(201).json(saved);
  } catch (error) {
    console.error('POST /api/recipes error:', error);
    res.status(500).json({ error: 'Failed to add recipe' });
  }
});

// DELETE /api/recipes/:id - Delete a recipe by ID
app.delete('/api/recipes/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid recipe ID' });
    }

    const deleted = await Recipe.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.json({ message: 'Recipe deleted', id });
  } catch (error) {
    console.error('DELETE /api/recipes/:id error:', error);
    res.status(500).json({ error: 'Failed to delete recipe' });
  }
});

// PUT /api/recipes/:id/mealplan - Update weekly meal plan for a specific recipe
app.put('/api/recipes/:id/mealplan', async (req, res) => {
  try {
    const { id } = req.params;
    const { mealPlan } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid recipe ID' });
    }

    if (typeof mealPlan !== 'object' || mealPlan === null) {
      return res.status(400).json({ error: 'mealPlan must be an object' });
    }

    // Only allow known structure (days with breakfast/lunch/dinner as strings)
    const days = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday'
    ];
    const cleaned = emptyMealPlan();
    for (const day of days) {
      if (mealPlan[day] && typeof mealPlan[day] === 'object') {
        cleaned[day].breakfast =
          typeof mealPlan[day].breakfast === 'string'
            ? mealPlan[day].breakfast
            : '';
        cleaned[day].lunch =
          typeof mealPlan[day].lunch === 'string' ? mealPlan[day].lunch : '';
        cleaned[day].dinner =
          typeof mealPlan[day].dinner === 'string' ? mealPlan[day].dinner : '';
      }
    }

    const updated = await Recipe.findByIdAndUpdate(
      id,
      { mealPlan: cleaned },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.json(updated);
  } catch (error) {
    console.error('PUT /api/recipes/:id/mealplan error:', error);
    res.status(500).json({ error: 'Failed to update meal plan' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
