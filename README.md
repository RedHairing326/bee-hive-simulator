# 🐝 Bee Hive Simulator

A real-time bee hive simulator that displays a hexagonal honeycomb with realistic bee behavior, synchronized with real-world time and seasons.

## Features

- **Hexagonal Grid**: Properly tiled hexagonal cells forming a realistic honeycomb structure
- **Real-Time Simulation**: Synced with actual time - bees sleep at night, forage during the day
- **Multi-Bee Cells**: Up to 9 bees can occupy a single cell, displayed in a 3x3 grid pattern
  - Queen is always centered when present in a multi-bee cell
  - Full cells (9 bees) block pathfinding, forcing bees to route around them
- **Realistic Bee Lifecycle**: 
  - Egg → Larvae → Pupa → Adult bee (21 days for workers)
  - Worker aging with visual color variation
  - Queen bee that lays eggs and requires feeding (3 year lifespan)
  - **Queen stays safe**: Queen never leaves the hive or wanders to entrance cells
  - **Emergency queen creation**: Workers can raise a new queen from young larvae if the queen dies
- **Cell States**: Empty, Egg, Hungry Larvae, Fed Larvae, Capped Brood, Nectar, Honey, Pollen, Bee Bread
- **Worker Behavior**:
  - Young workers (0-21 days) nurse brood and feed the queen
  - Older workers (21+ days) forage for nectar and pollen
  - Workers use entrance cells to leave/return to the hive
  - Very old workers slow down and may die while foraging outside
  - Smooth visible movement between cells (not instant teleportation)
- **Hive Organization**:
  - Bees naturally separate brood (center) from honey/pollen (edges)
  - **Intelligent food management**: Workers stop foraging when food stores exceed 40% of hive capacity
  - **Strict zoning**: Food storage ONLY in outer 50% of cells, keeping center clear for brood
  - Bees gradually consume stored food to prevent overfilling
  - Initial honey and pollen stores placed around outer edges (realistic organization)
  - Queen moves around the hive, laying eggs in cells she stands on
  - Egg-laying takes ~20 seconds per egg
  - **Smart queen pathfinding**: Queen travels to distant empty cells when surrounded by brood
  - Queen stays in center area (brood zone) and avoids entrance cells
  - Entrance cells marked with green rings at bottom of hive
- **Environmental Factors**:
  - Seasonal effects on pollen availability (Spring, Summer, Fall, Winter)
  - Time-of-day activity multipliers
  - Configurable randomness
- **Visual Theme**: Automatic light/dark mode switching based on time of day
- **Hive Health Display**: Minimalistic HUD showing:
  - Population, workers, brood counts
  - Honey and pollen stores
  - Bees inside vs. outside the hive
  - Foraging rate (trips per hour)
  - Elapsed simulation time
- **Configurable Everything**: Extensive config file for colors, rates, timings, and more
- **Time Controls**: Optional time multiplier slider (1x to 1000x) and start time selector

## Getting Started

### Installation

1. Download or clone all files to a directory
2. Run the simulator using one of the methods below

**Note**: Due to ES6 module restrictions in browsers, the simulator needs to run on a local web server.

#### 🚀 Quick Start (Windows)
Simply double-click `launch.bat` - it will:
- Check if Python is installed
- Start a local web server
- Open the simulator in your browser automatically

**Requirements**: Python 3 must be installed ([Download here](https://www.python.org/downloads/))

When done, press `Ctrl+C` in the command window to stop the server.

#### Option 2: Manual Python Server
```bash
# Python 3
python -m http.server 8000

# Then open http://localhost:8000 in your browser
```

#### Option 3: Using Node.js
```bash
npx http-server -p 8000
```

That's it! No build process or npm dependencies required.

### Usage

The simulation starts automatically when you open `index.html`. 

- **Hexagonal Cells**: Each cell has a neutral background with a **colored ring** that indicates the cell state
- **Bee Dots**: A **colored dot** in the center of each cell shows what bee is present:
  - Pink dot = Queen bee
  - Black/gray dots = Worker bees (color varies with age from black to light gray)
- **Progress Rings**: Additional yellow rings show development progress for brood
- **Content Indicators**: Arcs show how full food storage cells are

## Configuration

Edit `config.json` to customize the simulation:

### Grid Settings
```json
"grid": {
  "columns": 10,      // Number of columns
  "rows": 7,          // Number of rows
  "hexSize": 40       // Size of each hexagon in pixels
}
```

### Colors
Customize colors for:
- Cell states (empty, egg, larvae, brood, nectar, honey, pollen, bee bread)
- Bee types and ages (queen, young worker, old worker, etc.)
- Borders and highlights

### Simulation Parameters
- Initial population and food stores
- Bee lifespans (days)
- Development durations for each life stage
- Foraging and nursing durations
- Food conversion rates

### Environment
- Seasonal multipliers (spring: 1.5x, summer: 2x, fall: 0.8x, winter: 0.1x)
- Hourly activity multipliers (0.0 at night, 1.5x at midday)
- Dark mode hours (default: 7 PM to 7 AM)
- Base pollen rate and randomness

### UI Options
```json
"ui": {
  "showControls": true,           // Show time multiplier slider
  "showHUD": true,                // Show hive statistics
  "showLegend": true,             // Show cell state legend
  "defaultTimeMultiplier": 1,     // Starting speed
  "maxTimeMultiplier": 1000,      // Maximum speed
  "useCurrentTime": true          // Start at current real-world time
}
```

## How It Works

### Time System
The simulation uses a realistic time scale where 1 simulation day = 21 days in bee development:
- Worker egg to adult: 21 days
- Worker lifespan: 42 days (6 weeks)
- Queen lifespan: 1460 days (4 years)

Use the time multiplier to speed up observation (100x = watch a full day cycle in ~15 minutes).

### Bee Behavior
- **Queen**: Stays near the center, lays eggs in neighboring empty cells
- **Young Workers**: Feed larvae, attend to the queen
- **Mature Workers**: Forage for nectar and pollen during daylight hours
- **Old Workers**: Move slower, higher chance of dying while foraging

### Cell Development
- **Egg** (3 days) → **Larvae** (6 days, needs feeding) → **Capped Brood** (12 days) → **New Bee Emerges**
- **Nectar** slowly converts to **Honey** through worker activity
- **Pollen** slowly converts to **Bee Bread** (fermented pollen)

### Pathfinding
Bees use A* pathfinding to navigate the comb, preferring routes through empty cells when available.

## Visual Guide

### How to Read Each Cell

Each hexagonal cell has two independent color indicators:

1. **The Hexagonal Ring (Border)** = Cell State
   - Beige: Empty cell
   - White: Egg
   - Light Peach: Hungry larvae (needs feeding)
   - Peach: Fed larvae
   - Brown: Capped brood (pupating)
   - Light Blue: Nectar
   - Gold: Honey
   - Orange: Pollen
   - Dark Orange: Bee bread

2. **The Center Dot** = Bee Present (if any)
   - Pink: Queen bee
   - Black: Young worker (just emerged)
   - Dark Gray: Middle-aged worker
   - Gray: Old worker
   - Light Gray: Very old worker (near end of life)

**Example**: A cell with a **peach ring** and a **black dot** = Fed larvae cell with a young worker tending to it

## Tips

1. **Watch the Daily Cycle**: Set time multiplier to 10-50x to observe how bee activity changes throughout the day
2. **Observe Seasons**: Set to 100-500x to see how the hive population grows in spring/summer and contracts in winter
3. **Monitor Food Stores**: Keep an eye on honey and pollen levels - the hive needs enough food to survive winter
4. **Population Dynamics**: Watch how the queen's egg-laying rate affects overall population growth
5. **Worker Lifespan**: Notice how worker bees gradually change color as they age

## Technical Details

- Built with vanilla JavaScript (ES6 modules)
- HTML5 Canvas for rendering
- No external dependencies
- Hexagonal grid using axial coordinate system
- A* pathfinding algorithm for bee movement
- Runs at 60 FPS with efficient rendering

## Browser Compatibility

Works in all modern browsers that support:
- ES6 modules
- HTML5 Canvas
- CSS Grid

Tested in Chrome, Firefox, Edge, and Safari.

## License

Feel free to use and modify this simulator for educational or personal purposes.

---

Enjoy watching your virtual bee colony thrive! 🐝🍯

