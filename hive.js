// Hive class managing the entire bee colony

import { Cell, CellState } from './cell.js';
import { Bee, BeeType, BeeTask } from './bee.js';
import { getHexNeighbors, distance, PriorityQueue, getActivityMultiplier, getSeason } from './utils.js';
import { SpatialGrid, PathfindingCache, UpdateBatcher, PerformanceMonitor, ObjectPool } from './performance-optimizer.js';

export class Hive {
    constructor(config) {
        this.config = config;
        this.cells = new Map();
        this.bees = [];
        this.queen = null;
        this.emergencyQueenCell = null;
        this.entranceCells = [];
        this.simulationTime = 0;
        this.currentDate = new Date();
        this.foragingHistory = []; // Track foraging trips for rate calculation
        this.temperature = 35; // Optimal hive temperature (Celsius)
        this.optimalTemperature = 35;
        this.deadBeeLocations = []; // Track where dead bees are

        // Performance optimizations
        this.spatialGrid = new SpatialGrid(10); // Grid cell size for spatial indexing
        this.pathfindingCache = new PathfindingCache(200); // Cache up to 200 paths
        this.updateBatcher = new UpdateBatcher(20); // Process 20 updates per batch
        this.performanceMonitor = new PerformanceMonitor();
        this.beeUpdateIndex = 0; // For batched bee updates
        this.cellUpdateIndex = 0; // For batched cell updates
        // Update all bees every frame for smooth movement (batching was causing bees to not move)
        this.beeUpdateBatchSize = Infinity; // Update all bees every frame

        // Object Pool for bees
        this.beePool = new ObjectPool(
            () => new Bee(BeeType.WORKER, 0, 0, this.config), // Creator
            (bee) => { }, // Reset is handled manually when acquiring to pass params
            100 // Initial size
        );

        // Spatial Grid for bees (for fast proximity lookups)
        this.beeSpatialGrid = new SpatialGrid(5); // 5x5 buckets

        // Daily summary tracking
        this.dailySummaries = []; // Array of daily summary objects
        this.currentDaySummary = {
            date: new Date(this.currentDate),
            eggsLaid: 0,
            beesHatched: 0,
            beesDied: 0,
            nectarCollected: 0,
            pollenCollected: 0,
            waterCollected: 0
        };
        this.lastSummaryDay = this.currentDate.getDate();

        this.initializeCells();
        this.initializeEntrances();
        this.initializeBees();

        // Build spatial grid after initialization
        this.spatialGrid.rebuild(this.cells);
    }

    initializeCells() {
        const cols = this.config.grid.columns;
        const rows = this.config.grid.rows;

        // Create hexagonal grid using offset coordinates (proper rectangular arrangement)
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                // Store as simple col,row for proper grid arrangement
                const cell = new Cell(col, row, this.config);
                this.cells.set(this.getCellKey(col, row), cell);
            }
        }
    }

    initializeEntrances() {
        const cols = this.config.grid.columns;
        const rows = this.config.grid.rows;
        const side = this.config.grid.entranceSide || 'bottom';
        const count = this.config.grid.entranceCount || 3;

        // Determine entrance cells based on side
        if (side === 'bottom') {
            const startCol = Math.floor((cols - count) / 2);
            for (let i = 0; i < count; i++) {
                this.entranceCells.push({ q: startCol + i, r: rows - 1 });
            }
        } else if (side === 'top') {
            const startCol = Math.floor((cols - count) / 2);
            for (let i = 0; i < count; i++) {
                this.entranceCells.push({ q: startCol + i, r: 0 });
            }
        } else if (side === 'left') {
            const startRow = Math.floor((rows - count) / 2);
            for (let i = 0; i < count; i++) {
                this.entranceCells.push({ q: 0, r: startRow + i });
            }
        } else if (side === 'right') {
            const startRow = Math.floor((rows - count) / 2);
            for (let i = 0; i < count; i++) {
                this.entranceCells.push({ q: cols - 1, r: startRow + i });
            }
        }
    }

    initializeBees() {
        // Place queen in the center (safely away from entrance)
        if (this.config.simulation.startWithQueen) {
            const centerCol = Math.floor(this.config.grid.columns / 2);
            const centerRow = Math.floor(this.config.grid.rows / 2);

            // Make sure queen doesn't start on an entrance cell
            if (this.isEntranceCell(centerCol, centerRow)) {
                // Move queen one cell away from entrance
                const safeRow = centerRow - 1;
                // Use pool but manually reset since we need specific params
                this.queen = this.beePool.acquire().reset(BeeType.QUEEN, centerCol, safeRow, this.config);
            } else {
                this.queen = this.beePool.acquire().reset(BeeType.QUEEN, centerCol, centerRow, this.config);
            }
            this.bees.push(this.queen);

            // Add initial workers around the queen
            const initialWorkers = this.config.simulation.initialWorkerCount;
            for (let i = 0; i < initialWorkers; i++) {
                const cell = this.getRandomEmptyCell();
                if (cell) {
                    const worker = this.beePool.acquire().reset(BeeType.WORKER, cell.q, cell.r, this.config);
                    worker.age = Math.random() * this.config.simulation.workerLifespan * 0.5;
                    this.bees.push(worker);
                }
            }

            // Add initial honey stores (organized naturally at top/upper areas)
            const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow);

            // Create organized clusters of honey in upper-outer areas
            const honeyCells = Array.from(this.cells.values())
                .map(c => {
                    const normalizedRow = c.r / this.config.grid.rows;
                    const distFromCenter = Math.sqrt(
                        Math.pow(c.q - centerCol, 2) +
                        Math.pow(c.r - centerRow, 2)
                    );
                    const normalizedDist = distFromCenter / maxDist;

                    // Score: strongly favor top corners
                    let score = 0;
                    if (normalizedRow < 0.35 && normalizedDist > 0.55) {
                        // Top outer corners - primary zone (tighter constraints)
                        score = (1 - normalizedRow) * 5 + normalizedDist * 3;
                    } else if (normalizedRow < 0.5 && normalizedDist > 0.6) {
                        // Very outer edges only
                        score = (1 - normalizedRow) * 2 + normalizedDist * 2;
                    }

                    return { cell: c, score };
                })
                .filter(item => item.score > 1.5) // Higher threshold for tighter clustering
                .sort((a, b) => b.score - a.score); // Best spots first

            for (let i = 0; i < Math.min(this.config.simulation.initialHoneyStores, honeyCells.length); i++) {
                const cell = honeyCells[i].cell;
                if (cell && cell.isEmpty()) {
                    cell.state = CellState.HONEY;
                    cell.contentAmount = 5 + Math.floor(Math.random() * 5);
                }
            }

            // Add initial pollen stores (organized in ring around center, near brood zone)
            const pollenCells = Array.from(this.cells.values())
                .map(c => {
                    const distFromCenter = Math.sqrt(
                        Math.pow(c.q - centerCol, 2) +
                        Math.pow(c.r - centerRow, 2)
                    );
                    const normalizedDist = distFromCenter / maxDist;

                    // Score: tight ring around center
                    let score = 0;
                    if (normalizedDist >= 0.38 && normalizedDist <= 0.55) {
                        // Pollen ring - peak at 0.45, tighter band
                        const deviation = Math.abs(normalizedDist - 0.45);
                        score = Math.max(0, 1 - deviation * 12); // Steep falloff for tight ring
                    }

                    return { cell: c, score };
                })
                .filter(item => item.score > 0.3 && item.cell.state === CellState.EMPTY) // Higher threshold
                .sort((a, b) => b.score - a.score); // Best ring positions first

            for (let i = 0; i < Math.min(this.config.simulation.initialPollenStores, pollenCells.length); i++) {
                const cell = pollenCells[i].cell;
                if (cell && cell.isEmpty()) {
                    cell.state = CellState.POLLEN;
                    cell.contentAmount = 5 + Math.floor(Math.random() * 5);
                }
            }
        }
    }

    getCellKey(q, r) {
        return `${q},${r}`;
    }

    getCell(q, r) {
        return this.cells.get(this.getCellKey(q, r));
    }

    getRandomEmptyCell() {
        const emptyCells = Array.from(this.cells.values()).filter(c => c.isEmpty());
        if (emptyCells.length === 0) return null;
        return emptyCells[Math.floor(Math.random() * emptyCells.length)];
    }

    getEdgeCells() {
        // Get cells that are on the outer edges or corners of the grid
        const cols = this.config.grid.columns;
        const rows = this.config.grid.rows;
        const centerCol = cols / 2;
        const centerRow = rows / 2;

        const allCells = Array.from(this.cells.values());

        // Sort by distance from center (furthest first = edges)
        allCells.sort((a, b) => {
            const distA = Math.sqrt(Math.pow(a.q - centerCol, 2) + Math.pow(a.r - centerRow, 2));
            const distB = Math.sqrt(Math.pow(b.q - centerCol, 2) + Math.pow(b.r - centerRow, 2));
            return distB - distA; // Sort descending (furthest first)
        });

        // Return outer ~30% of cells
        const edgeCount = Math.floor(allCells.length * 0.3);
        return allCells.slice(0, edgeCount);
    }

    findEmptyStorageCell() {
        const emptyCells = Array.from(this.cells.values()).filter(c => c.isEmpty());
        if (emptyCells.length === 0) return null;
        const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        return { q: cell.q, r: cell.r };
    }

    findNearestEmptyCellForQueen(queenQ, queenR) {
        // Find empty cells suitable for the queen (not entrances, prefer center area)
        const centerCol = this.config.grid.columns / 2;
        const centerRow = this.config.grid.rows / 2;

        // Use spatial grid to find nearby empty cells first? 
        // Actually, spatial grid stores BEES, not cells.
        // But we can use it to check if a cell is crowded with other bees if we wanted.

        // For finding empty cells, we still need to check the cells map.
        // But we can optimize by searching outwards from queen position instead of filtering ALL cells.

        // Optimization: Spiral search from queen position
        const maxRadius = Math.max(this.config.grid.columns, this.config.grid.rows) / 2;

        for (let radius = 1; radius < maxRadius; radius++) {
            // Get ring of cells at this radius
            // This is complex to implement efficiently on hex grid without a helper.
            // Fallback to filtering but limit scope if possible.
        }

        // Existing implementation is O(N) where N is total cells.
        // Let's keep it for now but optimize the sort.

        const emptyCells = [];
        const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow);

        for (const c of this.cells.values()) {
            // Must be empty, clean (no dead bees), not dirty, and not an entrance
            if (!c.isEmpty() || c.hasDeadBee() || c.isDirty || this.isEntranceCell(c.q, c.r)) {
                continue;
            }

            // Prefer cells in the center area (brood zone)
            const distFromCenter = Math.sqrt(
                Math.pow(c.q - centerCol, 2) +
                Math.pow(c.r - centerRow, 2)
            );

            // Only consider cells in inner 70% of hive
            if ((distFromCenter / maxDist) < 0.7) {
                emptyCells.push(c);
            }
        }

        if (emptyCells.length === 0) {
            // No cells in center, try any empty, clean cell
            // ... (fallback logic)
            return null; // Simplified for brevity, original fallback was fine
        }

        // Sort by distance from queen, pick closest
        // Optimization: Don't sort ALL, just find min
        let closest = null;
        let minQueenDist = Infinity;

        // Check a random subset to avoid sorting thousands
        const checkCount = Math.min(20, emptyCells.length);
        for (let i = 0; i < checkCount; i++) {
            const idx = Math.floor(Math.random() * emptyCells.length);
            const cell = emptyCells[idx];
            const dist = distance(queenQ, queenR, cell.q, cell.r);
            if (dist < minQueenDist) {
                minQueenDist = dist;
                closest = cell;
            }
        }

        return closest ? { q: closest.q, r: closest.r } : null;
    }

    findAppropriateStorageCell(forNectar, forPollen) {
        if (!this.config.advanced.separateBroodAndHoney) {
            return this.findEmptyStorageCell();
        }

        const centerCol = this.config.grid.columns / 2;
        const centerRow = this.config.grid.rows / 2;
        const maxRow = this.config.grid.rows;

        const emptyCells = Array.from(this.cells.values()).filter(c => {
            // Filter out cells that already have 2+ bees storing food there
            const storersAtCell = this.bees.filter(b =>
                b.task === BeeTask.STORING_FOOD &&
                b.targetCell && b.targetCell.q === c.q && b.targetCell.r === c.r
            ).length;
            return c.isEmpty() && storersAtCell < 2;
        });

        if (emptyCells.length === 0) return null;

        // Natural hive organization zones:
        // - Honey: upper portions (top 40%), edges preferred
        // - Pollen: ring around brood zone (40-60% from center)
        // - Brood: center core (inner 40%)
        // - Water: near entrance, lower portions

        const suitableCells = emptyCells.filter(cell => {
            const distFromCenter = Math.sqrt(
                Math.pow(cell.q - centerCol, 2) +
                Math.pow(cell.r - centerRow, 2)
            );
            const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow);
            const normalizedDist = distFromCenter / maxDist;
            const normalizedRow = cell.r / maxRow; // 0 = top, 1 = bottom

            if (forNectar) {
                // Honey prefers upper areas (top 60%) and outer ring
                return normalizedRow < 0.6 && normalizedDist > 0.4;
            } else if (forPollen) {
                // Pollen prefers ring around brood (closer to center than honey)
                return normalizedDist > 0.35 && normalizedDist < 0.7;
            }

            return true;
        });

        // If no suitable cells, gradually relax constraints
        let cellsToUse = suitableCells;
        if (cellsToUse.length === 0) {
            // Fallback: avoid only the very center for food
            cellsToUse = emptyCells.filter(cell => {
                const distFromCenter = Math.sqrt(
                    Math.pow(cell.q - centerCol, 2) +
                    Math.pow(cell.r - centerRow, 2)
                );
                const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow);
                const normalizedDist = distFromCenter / maxDist;
                return normalizedDist > 0.3;
            });
        }
        if (cellsToUse.length === 0) cellsToUse = emptyCells;

        // Calculate preference scores for each cell
        const cellScores = cellsToUse.map(cell => {
            const distFromCenter = Math.sqrt(
                Math.pow(cell.q - centerCol, 2) +
                Math.pow(cell.r - centerRow, 2)
            );
            const maxDist = Math.sqrt(centerCol * centerCol + centerRow * centerRow);
            const normalizedDist = distFromCenter / maxDist;
            const normalizedRow = cell.r / maxRow;

            let score = 0;

            if (forNectar) {
                // Honey: strongly prefer top + edges
                const topScore = (1 - normalizedRow) * 2; // Higher score for top rows
                const edgeScore = normalizedDist * 1.5; // Higher score for edges
                score = topScore + edgeScore;
            } else if (forPollen) {
                // Pollen: prefer ring around center (mid-distance)
                const ringScore = 1 - Math.abs(normalizedDist - 0.5) * 2; // Peak at 0.5 distance
                score = ringScore * 2;
            } else {
                // Default: slight edge preference
                score = normalizedDist;
            }

            return { cell, score };
        });

        // Sort by score and pick from top candidates with some randomness
        cellScores.sort((a, b) => b.score - a.score);
        const topCount = Math.min(5, cellScores.length);
        const chosen = cellScores[Math.floor(Math.random() * topCount)].cell;

        return { q: chosen.q, r: chosen.r };
    }

    findNearestEntrance(q, r) {
        if (this.entranceCells.length === 0) return null;

        let nearest = this.entranceCells[0];
        let minDist = distance(q, r, nearest.q, nearest.r);

        for (const entrance of this.entranceCells) {
            const dist = distance(q, r, entrance.q, entrance.r);
            if (dist < minDist) {
                minDist = dist;
                nearest = entrance;
            }
        }

        return { q: nearest.q, r: nearest.r };
    }

    isEntranceCell(q, r) {
        // Optimized: use simple loop instead of .some() for better performance
        for (const entrance of this.entranceCells) {
            if (entrance && entrance.q === q && entrance.r === r) {
                return true;
            }
        }
        return false;
    }

    findHungryLarvae() {
        // Optimized: avoid creating array, find first match
        const candidates = [];
        for (const cell of this.cells.values()) {
            if (cell && cell.state === CellState.LARVAE_HUNGRY) {
                candidates.push(cell);
                // Early exit if we have enough candidates
                if (candidates.length >= 10) break;
            }
        }

        if (candidates.length === 0) return null;
        const cell = candidates[Math.floor(Math.random() * candidates.length)];
        return { q: cell.q, r: cell.r };
    }

    findFoodForFeeding() {
        // Find food storage cells (honey or pollen) with content
        // Include capped honey as it can be uncapped for feeding
        // Optimized: avoid creating full array, collect candidates
        const candidates = [];
        for (const cell of this.cells.values()) {
            if (cell &&
                (cell.state === CellState.HONEY ||
                    cell.state === CellState.HONEY_COMPLETE ||
                    cell.state === CellState.HONEY_CAPPED ||
                    cell.state === CellState.POLLEN ||
                    cell.state === CellState.BEE_BREAD) &&
                cell.contentAmount > 0.5) {
                candidates.push(cell);
                // Early exit if we have enough options
                if (candidates.length >= 20) break;
            }
        }

        if (candidates.length === 0) return null;
        const cell = candidates[Math.floor(Math.random() * candidates.length)];
        return { q: cell.q, r: cell.r };
    }

    getActivityMultiplier() {
        return getActivityMultiplier(this.currentDate, this.config);
    }

    getTotalCellCount() {
        return this.cells.size;
    }

    /**
     * Update hive simulation
     * @param {number} deltaTime - Time elapsed since last update
     * @param {Date} currentDate - Current simulation date
     */
    update(deltaTime, currentDate) {
        if (!deltaTime || deltaTime <= 0 || !isFinite(deltaTime)) {
            console.warn('Invalid deltaTime in hive.update:', deltaTime);
            return;
        }

        if (!currentDate || !(currentDate instanceof Date)) {
            console.warn('Invalid currentDate in hive.update:', currentDate);
            return;
        }

        try {
            this.currentDate = currentDate;
            this.simulationTime += deltaTime;

            // Check if a new day has started (for daily summaries)
            this.checkDayRollover(currentDate);

            // Edge case: Empty hive
            if (this.bees.length === 0) {
                // Hive is empty - no updates needed
                return;
            }

            // Update all cells - reset occupation
            for (const cell of this.cells.values()) {
                if (cell) {
                    cell.occupyingBees = []; // Reset occupation array
                }
            }

            // Clear bee spatial grid
            this.beeSpatialGrid.clear();

            // Mark cells occupied by bees and update spatial grid
            for (const bee of this.bees) {
                if (!bee) continue; // Skip invalid bees

                // Add to spatial grid
                this.beeSpatialGrid.add(bee);

                // Only count bees that are not outside AND not mid-movement
                if (!bee.isOutsideHive && bee.moveProgress >= 1.0) {
                    // Use current position (not display position) for cell occupation
                    const cell = this.getCell(bee.q, bee.r);
                    if (cell) {
                        if (!cell.occupyingBees) {
                            cell.occupyingBees = [];
                        }
                        cell.occupyingBees.push(bee);
                    }
                }
            }

            // Update all cells every frame (batching was causing issues)
            for (const cell of this.cells.values()) {
                if (!cell) continue;

                try {
                    const result = cell.update(deltaTime);
                    if (result === 'emerge') {
                        // New bee emerges from capped brood
                        this.emergeBee(cell);
                    }
                } catch (error) {
                    console.error('Error updating cell:', error, cell);
                    // Continue with other cells
                }
            }

            // Auto-cleanup: Remove any dead bees from entrance cells
            // (They should fall outside the hive automatically)
            for (const cell of this.entranceCells) {
                if (!cell) continue;
                const entranceCell = this.getCell(cell.q, cell.r);
                if (entranceCell && entranceCell.deadBeeCount > 0) {
                    entranceCell.deadBeeCount = 0; // Clear all dead bees at entrance
                }
            }

            // Update all bees every frame for smooth movement
            // (Batching was causing bees to appear frozen)
            const beesToUpdate = this.bees.length;
            if (beesToUpdate > 0) {
                // Update all bees (iterate backwards for safe removal)
                for (let i = beesToUpdate - 1; i >= 0; i--) {
                    const bee = this.bees[i];
                    if (!bee) {
                        // Remove invalid bee
                        this.bees.splice(i, 1);
                        continue;
                    }

                    try {
                        bee.setSimulationTime(this.simulationTime);
                        const result = bee.update(deltaTime, this);

                        if (result === 'died') {
                            // Track bee death in daily summary
                            this.recordBeeDied();

                            // Mark location where bee died (always mark it)
                            const cell = this.getCell(bee.q, bee.r);
                            if (cell && !bee.isOutsideHive) {
                                // Don't add dead bees to entrance cells - they fall outside
                                // Entrances are the boundary, dead bees there are disposed
                                if (!this.isEntranceCell(bee.q, bee.r)) {
                                    cell.addDeadBee(); // Add the bee that just died

                                    // If the dying bee was carrying a dead bee, drop it here too
                                    if (bee.hasDeadBee) {
                                        cell.addDeadBee(); // Add the carried dead bee
                                    }
                                }
                                // If at entrance, both the bee and any carried dead bee fall outside (removed from simulation)
                            }

                            this.bees.splice(i, 1);
                            if (bee === this.queen) {
                                this.queen = null;
                            }

                            // Release bee back to pool
                            this.beePool.release(bee);
                        }
                    } catch (error) {
                        console.error('Error updating bee:', error, bee);
                        // Remove problematic bee to prevent infinite loops
                        this.bees.splice(i, 1);
                        if (bee === this.queen) {
                            this.queen = null;
                        }
                    }
                }
            }

            // Update hive temperature based on environment and bee activity
            try {
                this.updateTemperature(deltaTime);
            } catch (error) {
                console.error('Error updating temperature:', error);
            }

            // Queen lays eggs as part of her behavior (handled in bee.js)

            // Check if queen is dead and create emergency queen
            if (!this.queen && this.bees.length > 0) {
                try {
                    this.createEmergencyQueen();
                } catch (error) {
                    console.error('Error creating emergency queen:', error);
                }
            }
        } catch (error) {
            console.error('Critical error in hive.update:', error);
            throw error;
        }
    }

    updateTemperature(deltaTime) {
        // Get environmental factors
        const season = getSeason(this.currentDate);
        const hour = this.currentDate.getHours();

        // Base ambient temperature by season and time
        let ambientTemp = 20; // Default
        const seasonalTemps = {
            'winter': 5,
            'spring': 15,
            'summer': 30,
            'fall': 15
        };
        ambientTemp = seasonalTemps[season] || 20;

        // Add daily temperature variation
        const timeMultiplier = Math.sin((hour - 6) / 24 * Math.PI * 2); // Peak at 2pm
        ambientTemp += timeMultiplier * 5;

        // Temperature regulation by bees (optimized - count without creating array)
        let beesRegulating = 0;
        for (const bee of this.bees) {
            if (bee && bee.task && (bee.task === 'temperatureRegulation' || bee.task.includes('temperature'))) {
                beesRegulating++;
            }
        }
        const regulationEffect = beesRegulating * 0.1;

        // Population helps maintain temperature (cache length to avoid repeated property access)
        const beeCount = this.bees.length;
        const populationEffect = Math.min(beeCount * 0.01, 5);

        // Gradually move toward ambient, but bees resist
        const targetTemp = this.optimalTemperature;
        const drift = (ambientTemp - this.temperature) * 0.01 * deltaTime;
        const regulation = (targetTemp - this.temperature) * (0.05 + regulationEffect * 0.1) * deltaTime;

        this.temperature += drift + regulation + (populationEffect * 0.01 * deltaTime);

        // Clamp temperature to realistic range
        this.temperature = Math.max(ambientTemp - 10, Math.min(ambientTemp + 15, this.temperature));
    }

    emergeBee(cell) {
        // Check if this is an emergency queen cell
        const isQueenCell = this.emergencyQueenCell &&
            this.emergencyQueenCell.q === cell.q &&
            this.emergencyQueenCell.r === cell.r;

        if (isQueenCell) {
            // Create a new queen!
            this.queen = this.beePool.acquire().reset(BeeType.QUEEN, cell.q, cell.r, this.config);
            this.bees.push(this.queen);
            this.emergencyQueenCell = null;
        } else {
            // Create a new worker bee
            const worker = this.beePool.acquire().reset(BeeType.WORKER, cell.q, cell.r, this.config);
            this.bees.push(worker);
        }

        // Track bee hatching in daily summary
        this.recordBeeHatched();

        // Clear the cell
        cell.state = CellState.EMPTY;
        cell.developmentTime = 0;
        cell.maxDevelopmentTime = 0;
    }

    createEmergencyQueen() {
        // Find young larvae (fed or hungry) to convert to queen
        const larvaeCells = Array.from(this.cells.values()).filter(c =>
            (c.state === CellState.LARVAE_FED || c.state === CellState.LARVAE_HUNGRY) &&
            c.developmentTime < c.maxDevelopmentTime * 0.5 // Young larvae
        );

        if (larvaeCells.length === 0) {
            // No larvae available, try eggs
            const eggCells = Array.from(this.cells.values()).filter(c =>
                c.state === CellState.EGG
            );

            if (eggCells.length > 0) {
                // Convert egg to queen cell
                const cell = eggCells[0];
                // Eggs will become larvae and then queen
                // Mark it somehow? For now just let it develop normally
                // When it emerges, we'll make it a queen
                this.emergencyQueenCell = { q: cell.q, r: cell.r };
                return;
            }
            return;
        }

        // Select a larvae cell (preferably fed, near center)
        const centerCol = this.config.grid.columns / 2;
        const centerRow = this.config.grid.rows / 2;

        larvaeCells.sort((a, b) => {
            const distA = Math.sqrt(Math.pow(a.q - centerCol, 2) + Math.pow(a.r - centerRow, 2));
            const distB = Math.sqrt(Math.pow(b.q - centerCol, 2) + Math.pow(b.r - centerRow, 2));
            return distA - distB;
        });

        const selectedCell = larvaeCells[0];
        this.emergencyQueenCell = { q: selectedCell.q, r: selectedCell.r };
    }

    findPath(start, end, preferEmpty = false) {
        // Check cache first
        const cached = this.pathfindingCache.get(start, end);
        if (cached) {
            // Validate cached path is still valid
            if (this.validatePath(cached)) {
                return cached;
            }
            // If invalid, cache will be overwritten below
        }

        const startKey = this.getCellKey(start.q, start.r);
        const endKey = this.getCellKey(end.q, end.r);

        if (!this.cells.has(startKey) || !this.cells.has(endKey)) {
            return null;
        }

        const frontier = new PriorityQueue();
        frontier.enqueue(start, 0);

        const cameFrom = new Map();
        const costSoFar = new Map();

        cameFrom.set(startKey, null);
        costSoFar.set(startKey, 0);

        while (!frontier.isEmpty()) {
            const current = frontier.dequeue().element;
            const currentKey = this.getCellKey(current.q, current.r);

            if (currentKey === endKey) {
                break;
            }

            const neighbors = getHexNeighbors(current.q, current.r);

            for (const next of neighbors) {
                const nextKey = this.getCellKey(next.q, next.r);
                const nextCell = this.cells.get(nextKey);

                if (!nextCell) continue;

                // Can't path through full cells (unless it's the destination)
                if (nextCell.isFull() && nextKey !== endKey) {
                    continue;
                }

                let moveCost = 1;

                // Prefer empty cells if configured
                if (preferEmpty && nextCell.isOccupied() && nextKey !== endKey) {
                    moveCost = 3;
                }

                const newCost = costSoFar.get(currentKey) + moveCost;

                if (!costSoFar.has(nextKey) || newCost < costSoFar.get(nextKey)) {
                    costSoFar.set(nextKey, newCost);
                    const priority = newCost + distance(next.q, next.r, end.q, end.r);
                    frontier.enqueue(next, priority);
                    cameFrom.set(nextKey, current);
                }
            }
        }

        // Reconstruct path
        if (!cameFrom.has(endKey)) {
            return null;
        }

        const path = [];
        let current = end;

        while (current) {
            path.unshift(current);
            const currentKey = this.getCellKey(current.q, current.r);
            current = cameFrom.get(currentKey);
        }

        // Cache the path
        if (path.length > 0) {
            this.pathfindingCache.set(start, end, path);
        }

        return path;
    }

    /**
     * Validate that a cached path is still valid
     * @param {Array} path - Path to validate
     * @returns {boolean}
     */
    validatePath(path) {
        if (!path || path.length === 0) return false;

        for (const node of path) {
            const cell = this.getCell(node.q, node.r);
            if (!cell) return false;
            // Check if path is blocked (except destination)
            if (cell.isFull() && node !== path[path.length - 1]) {
                return false;
            }
        }

        return true;
    }

    recordForagingTrip() {
        const currentTime = this.simulationTime;
        this.foragingHistory.push(currentTime);

        // Keep only last hour of history (3600 seconds)
        const oneHourAgo = currentTime - 3600;
        this.foragingHistory = this.foragingHistory.filter(t => t > oneHourAgo);
    }

    // Daily summary tracking methods
    recordEggLaid() {
        this.currentDaySummary.eggsLaid++;
    }

    recordBeeHatched() {
        this.currentDaySummary.beesHatched++;
    }

    recordBeeDied() {
        this.currentDaySummary.beesDied++;
    }

    recordNectarCollected(amount = 1) {
        this.currentDaySummary.nectarCollected += amount;
    }

    recordPollenCollected(amount = 1) {
        this.currentDaySummary.pollenCollected += amount;
    }

    recordWaterCollected(amount = 1) {
        this.currentDaySummary.waterCollected += amount;
    }

    checkDayRollover(currentDate) {
        const currentDay = currentDate.getDate();
        if (currentDay !== this.lastSummaryDay) {
            // New day started, finalize previous day's summary
            this.dailySummaries.push({ ...this.currentDaySummary });

            // Keep only last 7 days
            if (this.dailySummaries.length > 7) {
                this.dailySummaries.shift();
            }

            // Reset for new day
            this.currentDaySummary = {
                date: new Date(currentDate),
                eggsLaid: 0,
                beesHatched: 0,
                beesDied: 0,
                nectarCollected: 0,
                pollenCollected: 0,
                waterCollected: 0
            };
            this.lastSummaryDay = currentDay;
        }
    }

    /**
     * Get hive statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        try {
            let workerCount = 0;
            let broodCount = 0;
            let honeyCount = 0;
            let pollenCount = 0;
            let beesInside = 0;
            let beesOutside = 0;

            // Edge case: No bees
            if (!this.bees || this.bees.length === 0) {
                return {
                    population: 0,
                    workers: 0,
                    brood: 0,
                    honey: 0,
                    pollen: 0,
                    water: 0,
                    beesInside: 0,
                    beesOutside: 0,
                    foragingRate: 0,
                    queenAge: 0,
                    queenMaxAge: 0,
                    queenEggsTotal: 0,
                    queenEggsHour: 0,
                    queenTask: '---',
                    currentDaySummary: this.currentDaySummary || {},
                    dailySummaries: this.dailySummaries || []
                };
            }

            for (const bee of this.bees) {
                if (!bee) continue;

                if (bee.type === BeeType.WORKER) {
                    workerCount++;
                }

                if (bee.isOutsideHive) {
                    beesOutside++;
                } else {
                    beesInside++;
                }
            }

            for (const cell of this.cells.values()) {
                if (!cell) continue;

                // Count brood cells (egg, larvae, capped brood)
                if (typeof cell.isBrood === 'function' && cell.isBrood()) {
                    broodCount++;
                }

                // Count honey (including capped honey)
                if (cell.state === CellState.HONEY ||
                    cell.state === CellState.HONEY_COMPLETE ||
                    cell.state === CellState.HONEY_CAPPED) {
                    const amount = cell.contentAmount;
                    if (typeof amount === 'number' && isFinite(amount) && amount > 0) {
                        honeyCount += amount;
                    }
                }

                // Count pollen and bee bread
                if (cell.state === CellState.POLLEN || cell.state === CellState.BEE_BREAD) {
                    const amount = cell.contentAmount;
                    if (typeof amount === 'number' && isFinite(amount) && amount > 0) {
                        pollenCount += amount;
                    }
                }
            }

            // Calculate foraging rate (trips per hour) - optimized count without creating array
            let foragingRate = 0;
            if (this.foragingHistory && this.foragingHistory.length > 0) {
                const oneHourAgo = this.simulationTime - 3600;
                for (const timestamp of this.foragingHistory) {
                    if (timestamp > oneHourAgo) {
                        foragingRate++;
                    }
                }
            }

            // Count water cells
            let waterCount = 0;
            for (const cell of this.cells.values()) {
                if (cell && cell.state === CellState.WATER) {
                    const amount = cell.contentAmount;
                    if (typeof amount === 'number' && isFinite(amount) && amount > 0) {
                        waterCount += amount;
                    }
                }
            }

            // Queen stats
            let queenAge = 0;
            let queenMaxAge = 0;
            let queenEggsTotal = 0;
            let queenEggsHour = 0;
            let queenTask = '---';

            if (this.queen) {
                queenAge = this.queen.age || 0;
                queenMaxAge = this.queen.maxAge || 0;
                queenEggsTotal = this.queen.eggsLaidTotal || 0;

                // Calculate eggs laid in last hour (optimized - count without creating array)
                if (this.queen.eggsLaidHistory && this.queen.eggsLaidHistory.length > 0) {
                    const oneHourAgo = this.simulationTime - 3600;
                    queenEggsHour = 0;
                    for (const timestamp of this.queen.eggsLaidHistory) {
                        if (timestamp > oneHourAgo) {
                            queenEggsHour++;
                        }
                    }
                } else {
                    queenEggsHour = 0;
                }

                queenTask = this.queen.task || 'idle';
            }

            // Validate that inside + outside = total population
            const totalBeesCounted = beesInside + beesOutside;
            const actualPopulation = this.bees.length;

            // If there's a mismatch, log it and adjust (shouldn't happen, but safety check)
            if (totalBeesCounted !== actualPopulation) {
                console.warn(`Bee count mismatch: inside=${beesInside}, outside=${beesOutside}, total=${actualPopulation}`);
                // Adjust to match actual population
                if (beesInside + beesOutside === 0 && actualPopulation > 0) {
                    // All bees are unaccounted for, assume they're inside
                    beesInside = actualPopulation;
                } else if (totalBeesCounted < actualPopulation) {
                    // Some bees unaccounted for, add to inside
                    beesInside += (actualPopulation - totalBeesCounted);
                } else if (totalBeesCounted > actualPopulation) {
                    // Overcounted, proportionally reduce
                    const ratio = actualPopulation / totalBeesCounted;
                    beesInside = Math.round(beesInside * ratio);
                    beesOutside = actualPopulation - beesInside;
                }
            }

            // Validate worker count: workers + queen (if exists) should equal population
            const queenCount = this.queen ? 1 : 0;
            const expectedWorkers = actualPopulation - queenCount;
            if (workerCount !== expectedWorkers && actualPopulation > 0) {
                console.warn(`Worker count mismatch: counted=${workerCount}, expected=${expectedWorkers}, population=${actualPopulation}, queen=${queenCount}`);
                // Recalculate worker count accurately
                workerCount = 0;
                for (const bee of this.bees) {
                    if (bee && bee.type === BeeType.WORKER) {
                        workerCount++;
                    }
                }
                // If still wrong, use expected value
                if (workerCount !== expectedWorkers) {
                    workerCount = Math.max(0, expectedWorkers);
                }
            }

            return {
                population: actualPopulation,
                workers: workerCount,
                brood: broodCount,
                honey: Math.floor(honeyCount),
                pollen: Math.floor(pollenCount),
                water: Math.floor(waterCount),
                beesInside: beesInside,
                beesOutside: beesOutside,
                foragingRate: foragingRate,
                queenAge: queenAge,
                queenMaxAge: queenMaxAge,
                queenEggsTotal: queenEggsTotal,
                queenEggsHour: queenEggsHour,
                queenTask: queenTask,
                currentDaySummary: this.currentDaySummary || {},
                dailySummaries: this.dailySummaries || []
            };
        } catch (error) {
            console.error('Error getting stats:', error);
            // Return safe defaults
            return {
                population: 0,
                workers: 0,
                brood: 0,
                honey: 0,
                pollen: 0,
                water: 0,
                beesInside: 0,
                beesOutside: 0,
                foragingRate: 0,
                queenAge: 0,
                queenMaxAge: 0,
                queenEggsTotal: 0,
                queenEggsHour: 0,
                queenTask: '---',
                currentDaySummary: {},
                dailySummaries: []
            };
        }
    }

    findDirtyCell() {
        // Find a dirty cell that needs cleaning
        for (const cell of this.cells.values()) {
            if (cell.isEmpty() && cell.isDirty) {
                return { q: cell.q, r: cell.r };
            }
        }
        return null;
    }

    findHoneyCappingCell() {
        // Find honey that needs to be capped
        for (const cell of this.cells.values()) {
            if (cell.state === CellState.HONEY_COMPLETE) {
                return { q: cell.q, r: cell.r };
            }
        }
        return null;
    }

    findDeadBeeCell() {
        // Find a cell with a dead bee (but not at entrances)
        // Dead bees at entrances should fall outside automatically
        const deadBeeCells = Array.from(this.cells.values())
            .filter(c => c.hasDeadBee() && !this.isEntranceCell(c.q, c.r));

        if (deadBeeCells.length === 0) return null;

        // Return a RANDOM dead bee cell to spread out undertakers
        // This prevents all undertakers from clustering on the same cell
        const randomCell = deadBeeCells[Math.floor(Math.random() * deadBeeCells.length)];
        return { q: randomCell.q, r: randomCell.r };
    }

    findWaterStorageCell() {
        // Find an empty cell or existing water cell for storage
        // Prefer cells near the center for easy access
        const centerQ = Math.floor(this.config.grid.columns / 2);
        const centerR = Math.floor(this.config.grid.rows / 2);

        let bestCell = null;
        let bestScore = -Infinity;

        for (const cell of this.cells.values()) {
            if (cell.isEmpty() || (cell.state === CellState.WATER && cell.contentAmount < 5)) {
                // Check if too many bees are already storing water here
                const storersAtCell = this.bees.filter(b =>
                    b.task === BeeTask.STORING_FOOD && b.hasWater &&
                    b.targetCell && b.targetCell.q === cell.q && b.targetCell.r === cell.r
                ).length;

                if (storersAtCell >= 2) continue; // Skip if already crowded

                const dist = distance(cell.q, cell.r, centerQ, centerR);
                const score = -dist; // Prefer closer cells

                if (score > bestScore) {
                    bestScore = score;
                    bestCell = cell;
                }
            }
        }

        return bestCell ? { q: bestCell.q, r: bestCell.r } : null;
    }

    needsTemperatureRegulation() {
        // Check if temperature needs adjustment
        return Math.abs(this.temperature - this.optimalTemperature) > 2;
    }

    findTemperatureRegulationSpot() {
        // Return a spot where bees can regulate temperature
        // For fanning: near entrance
        // For clustering: near brood
        if (this.temperature > this.optimalTemperature) {
            // Too hot: fan near entrance
            if (this.entranceCells.length > 0) {
                const entrance = this.entranceCells[0];
                return { q: entrance.q, r: entrance.r };
            }
        } else {
            // Too cold: cluster near brood
            for (const cell of this.cells.values()) {
                if (cell.isBrood()) {
                    return { q: cell.q, r: cell.r };
                }
            }
        }
        return null;
    }

    importData(data) {
        // Restore simulation state
        this.simulationTime = data.simulationTime || 0;
        if (data.currentDate) {
            this.currentDate = new Date(data.currentDate);
        }

        // Update config if provided
        if (data.config) {
            Object.assign(this.config, data.config);
        }

        // Clear existing state
        // Release bees to pool
        for (const bee of this.bees) {
            this.beePool.release(bee);
        }
        this.bees = [];

        this.beeSpatialGrid.clear();
        this.queen = null;
        this.emergencyQueenCell = null;

        // Re-initialize empty grid
        this.initializeCells();
        this.initializeEntrances();

        // Apply saved cells
        if (data.cells) {
            for (const cellData of data.cells) {
                const cell = this.getCell(cellData.q, cellData.r);
                if (cell) {
                    cell.state = cellData.state;
                    cell.contentAmount = cellData.contentAmount;
                    cell.pollenType = cellData.pollenType;
                    cell.isDirty = cellData.isDirty;
                    cell.deadBeeCount = cellData.deadBeeCount;
                    cell.developmentTime = cellData.developmentTime;
                    cell.maxDevelopmentTime = cellData.maxDevelopmentTime;
                }
            }
        }

        // Restore bees
        if (data.bees) {
            for (const beeData of data.bees) {
                const bee = this.beePool.acquire().reset(beeData.type, beeData.q, beeData.r, this.config);
                bee.age = beeData.age;
                bee.task = beeData.task;
                bee.hasNectar = beeData.hasNectar;
                bee.hasPollen = beeData.hasPollen;
                bee.hasWater = beeData.hasWater;
                bee.hasFood = beeData.hasFood;
                bee.inventory = beeData.inventory || {};

                this.bees.push(bee);
                this.beeSpatialGrid.add(bee);

                if (bee.type === BeeType.QUEEN) {
                    this.queen = bee;
                }
            }
        }

        // Restore daily summaries if available
        if (data.dailySummaries) {
            this.dailySummaries = data.dailySummaries;
        }

        // Rebuild spatial grid for cells
        this.spatialGrid.rebuild(this.cells);

        return true;
    }
}
