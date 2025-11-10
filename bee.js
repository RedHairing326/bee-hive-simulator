// Bee class representing individual bees in the hive

import { getHexNeighbors, distance, lerpColor } from './utils.js';
import { CellState } from './cell.js';

export const BeeType = {
    QUEEN: 'queen',
    WORKER: 'worker'
};

export const BeeTask = {
    IDLE: 'idle',
    FORAGING: 'foraging',
    NURSING: 'nursing',
    FEEDING_QUEEN: 'feedingQueen',
    STORING_FOOD: 'storingFood',
    RETURNING: 'returning',
    CLEANING: 'cleaning',
    CAPPING_HONEY: 'cappingHoney',
    UNDERTAKING: 'undertaking',
    ATTENDING_QUEEN: 'attendingQueen',
    WATER_COLLECTION: 'waterCollection',
    TEMPERATURE_REGULATION: 'temperatureRegulation',
    COLLECTING_FOOD: 'collectingFood'
};

export class Bee {
    constructor(type, q, r, config) {
        this.type = type;
        this.q = q;
        this.r = r;
        this.targetQ = q;
        this.targetR = r;
        this.moveProgress = 1.0; // 1.0 means arrived at target
        this.age = 0;
        this.maxAge = type === BeeType.QUEEN ? config.simulation.queenLifespan : config.simulation.workerLifespan;
        this.task = BeeTask.IDLE;
        this.taskTimer = 0;
        this.targetCell = null;
        this.nextTask = null; // Task to do after completing current task
        this.nextTargetCell = null; // Target cell for next task
        this.path = [];
        this.hasNectar = false;
        this.hasPollen = false;
        this.hasWater = false;
        this.hasDeadBee = false; // Carrying a dead bee for undertaking
        this.hasFood = false; // Carrying food for feeding (honey or pollen)
        this.isOutsideHive = false; // Track if bee is outside
        this.config = config;
        this.lastTaskAssignTime = 0;
        this.simulationTime = 0;
        
        // Queen-specific stats
        if (type === BeeType.QUEEN) {
            this.eggsLaidTotal = 0;
            this.eggsLaidHistory = []; // Track timestamps of eggs laid for hourly rate
        }
    }
    
    getColor() {
        if (this.type === BeeType.QUEEN) {
            return this.config.colors.bees.queen;
        }
        
        // Worker bees with age-based color variation
        if (!this.config.advanced.workerAgeColorVariation) {
            return this.config.colors.bees.workerYoung;
        }
        
        const ageRatio = this.age / this.maxAge;
        
        if (ageRatio < 0.25) {
            return this.config.colors.bees.workerYoung;
        } else if (ageRatio < 0.5) {
            return lerpColor(
                this.config.colors.bees.workerYoung,
                this.config.colors.bees.workerMiddle,
                (ageRatio - 0.25) / 0.25
            );
        } else if (ageRatio < 0.75) {
            return lerpColor(
                this.config.colors.bees.workerMiddle,
                this.config.colors.bees.workerOld,
                (ageRatio - 0.5) / 0.25
            );
        } else {
            return lerpColor(
                this.config.colors.bees.workerOld,
                this.config.colors.bees.workerVeryOld,
                (ageRatio - 0.75) / 0.25
            );
        }
    }
    
    isYoung() {
        return this.age / this.maxAge < 0.5;
    }
    
    isOld() {
        return this.age / this.maxAge > 0.8;
    }
    
    isVeryOld() {
        return this.age / this.maxAge > 0.95;
    }
    
    getSpeedMultiplier() {
        if (!this.config.advanced.agingSlowdownFactor) {
            return 1;
        }
        
        const ageRatio = this.age / this.maxAge;
        if (ageRatio < 0.5) {
            return 1;
        }
        
        // Slow down as they age
        return Math.max(0.3, 1 - (ageRatio - 0.5) * this.config.advanced.agingSlowdownFactor * 10);
    }
    
    update(deltaTime, hive) {
        this.age += deltaTime;
        
        // SAFETY: Queen should NEVER be outside the hive
        if (this.type === BeeType.QUEEN && this.isOutsideHive) {
            this.isOutsideHive = false;
            console.warn('Queen was outside hive - corrected!');
        }
        
        // Check if bee dies of old age
        if (this.age >= this.maxAge) {
            return 'died';
        }
        
        // Very old foragers have a chance to die while outside (only when outside)
        if (this.isVeryOld() && this.task === BeeTask.FORAGING && this.isOutsideHive) {
            if (Math.random() < this.config.advanced.foragerDeathChance) {
                return 'died';
            }
        }
        
        // Update task timer
        if (this.taskTimer > 0) {
            this.taskTimer -= deltaTime * this.getSpeedMultiplier();
            
            if (this.taskTimer <= 0) {
                this.completeTask(hive);
            }
        }
        
        // Handle smooth movement
        if (this.moveProgress < 1.0) {
            // Bee is moving between cells
            const moveSpeed = this.config.advanced.movementSpeed * this.getSpeedMultiplier();
            const progressDelta = deltaTime * moveSpeed;
            
            // Cap progress per frame to prevent teleporting at high speeds
            // Max 0.25 per frame means at least 4 frames to move one cell
            const maxProgressPerFrame = 0.25;
            this.moveProgress += Math.min(progressDelta, maxProgressPerFrame);
            
            if (this.moveProgress >= 1.0) {
                this.moveProgress = 1.0;
                // Arrived at target cell
                this.q = this.targetQ;
                this.r = this.targetR;
                
                // Check if we have more path to follow
                if (this.path && this.path.length > 0) {
                    this.startMovingToNextCell();
                } else {
                    this.onReachDestination(hive);
                }
            }
        } else if (this.path && this.path.length > 0) {
            // Start moving to next cell in path
            this.startMovingToNextCell();
        }
        
        // If idle and no task, assign new task
        // Prevent infinite loops by limiting task assignment attempts
        if (this.task === BeeTask.IDLE && this.taskTimer <= 0 && this.moveProgress >= 1.0) {
            // Don't assign tasks every frame - add a small cooldown
            if (!this.lastTaskAssignTime || (this.simulationTime - this.lastTaskAssignTime) > 0.1) {
                this.lastTaskAssignTime = this.simulationTime;
                this.assignTask(hive);
            }
        }
        
        return null;
    }
    
    setSimulationTime(time) {
        this.simulationTime = time;
    }
    
    startMovingToNextCell() {
        if (this.path && this.path.length > 0) {
            const next = this.path.shift();
            
            // Safety check: ensure target is valid
            if (next && typeof next.q !== 'undefined' && typeof next.r !== 'undefined') {
                this.targetQ = next.q;
                this.targetR = next.r;
                this.moveProgress = 0.0;
            } else {
                // Invalid path node, clear path and stay put
                console.warn('Invalid path node detected, clearing path');
                this.path = [];
                this.moveProgress = 1.0;
                this.taskTimer = 5; // Wait before trying again
            }
        }
    }
    
    getDisplayPosition() {
        // Return interpolated position for rendering
        if (this.moveProgress >= 1.0) {
            return { q: this.q, r: this.r };
        }
        
        // Linear interpolation between current and target
        const t = this.moveProgress;
        return {
            q: this.q + (this.targetQ - this.q) * t,
            r: this.r + (this.targetR - this.r) * t
        };
    }
    
    assignTask(hive) {
        try {
        if (this.type === BeeType.QUEEN) {
            // Queen looks for a place to lay an egg
            const currentCell = hive.getCell(this.q, this.r);
            
            // Check if current cell is suitable for laying an egg
            // Must be empty, clean (no dead bees), and not dirty
            if (currentCell && currentCell.isEmpty() && !currentCell.hasDeadBee() && !currentCell.isDirty && this.moveProgress >= 1.0) {
                // Lay egg in current cell
                this.task = BeeTask.IDLE;
                this.taskTimer = this.config.simulation.queenEggLayingInterval;
                return;
            }
            
            // Look for nearby empty cells to move to
            // Queen can also move to cells with other bees (up to max capacity)
            const emptyNeighbors = this.getEmptyNeighborCells(hive);
            const availableNeighbors = getHexNeighbors(this.q, this.r).filter(n => {
                const cell = hive.getCell(n.q, n.r);
                // Cell must be empty, clean, and not an entrance
                return cell && cell.isEmpty() && !cell.hasDeadBee() && !cell.isDirty && !hive.isEntranceCell(n.q, n.r);
            });
            
            if (availableNeighbors.length > 0) {
                // Move to an available neighbor cell
                const target = availableNeighbors[Math.floor(Math.random() * availableNeighbors.length)];
                this.task = BeeTask.IDLE;
                this.targetCell = { q: target.q, r: target.r };
                this.path = [target];
                this.startMovingToNextCell();
                this.taskTimer = 2; // Short delay before checking again
                return;
            }
            
            // No neighboring empty cells, look for distant empty cells to pathfind to
            const distantEmptyCell = hive.findNearestEmptyCellForQueen(this.q, this.r);
            
            if (distantEmptyCell) {
                // Found an empty cell further away - pathfind to it
                this.task = BeeTask.IDLE;
                this.targetCell = distantEmptyCell;
                this.findPath(hive);
                
                if (this.path && this.path.length > 0) {
                    // Successfully found path to distant cell
                    this.startMovingToNextCell();
                    this.taskTimer = 2;
                    return;
                }
            }
            
            // No empty cells anywhere, try wandering to any valid neighbor
            // IMPORTANT: Queen should never wander to entrance cells!
            const neighbors = getHexNeighbors(this.q, this.r);
            const validNeighbors = neighbors.filter(n => {
                const cell = hive.getCell(n.q, n.r);
                // Cell must exist, not be an entrance, and not be full
                return cell !== null && 
                       !hive.isEntranceCell(n.q, n.r) && 
                       !cell.isFull();
            });
            
            if (validNeighbors.length > 0) {
                const target = validNeighbors[Math.floor(Math.random() * validNeighbors.length)];
                this.task = BeeTask.IDLE;
                this.targetCell = { q: target.q, r: target.r };
                this.path = [target];
                this.startMovingToNextCell();
                this.taskTimer = 5; // Wander for a bit
            } else {
                // Can't move anywhere, just stay put and wait
                // Add longer timer to prevent constant retries
                this.task = BeeTask.IDLE;
                this.taskTimer = 20 + Math.random() * 10; // Wait 20-30 seconds
            }
            return;
        }
        
        // Worker behavior
        const activityMultiplier = hive.getActivityMultiplier();
        
        // CRITICAL TASKS FIRST (even at night): Nursing and feeding queen
        // Real bees care for brood 24/7
        if (this.isYoung()) {
            // Check how many bees are already attending to the queen
            const beesWithQueen = hive.queen ? hive.bees.filter(b => 
                (b.task === BeeTask.ATTENDING_QUEEN || b.task === BeeTask.FEEDING_QUEEN) &&
                b.targetCell && b.targetCell.q === hive.queen.q && b.targetCell.r === hive.queen.r
            ).length : 0;
            
            // Limit queen attendants to max 3 bees at once
            if (beesWithQueen < 3) {
                // Attend to queen (groom, follow, care for her)
                if (hive.queen && Math.random() < 0.1) {
                    this.task = BeeTask.ATTENDING_QUEEN;
                    this.targetCell = { q: hive.queen.q, r: hive.queen.r };
                    this.findPath(hive);
                    return;
                }
                
                // Check if queen needs feeding
                if (hive.queen && Math.random() < 0.15) {
                    // If we don't have food, go collect it first
                    if (!this.hasFood) {
                        const foodCell = hive.findFoodForFeeding();
                        if (foodCell) {
                            this.task = BeeTask.COLLECTING_FOOD;
                            this.nextTask = BeeTask.FEEDING_QUEEN;
                            this.targetCell = foodCell;
                            this.findPath(hive);
                            return;
                        }
                    } else {
                        // We have food, go feed the queen
                        this.task = BeeTask.FEEDING_QUEEN;
                        this.targetCell = { q: hive.queen.q, r: hive.queen.r };
                        this.findPath(hive);
                        return;
                    }
                }
            }
            
            // Check for hungry larvae (but don't overcrowd them)
            const hungryLarvae = hive.findHungryLarvae();
            if (hungryLarvae) {
                const larvaeCell = hive.getCell(hungryLarvae.q, hungryLarvae.r);
                
                // Check if this cell already has nurses assigned OR bees occupying it
                const nursesAtCell = hive.bees.filter(b => 
                    b.task === BeeTask.NURSING &&
                    b.targetCell && b.targetCell.q === hungryLarvae.q && b.targetCell.r === hungryLarvae.r
                ).length;
                
                const beesInCell = larvaeCell && larvaeCell.occupyingBees ? larvaeCell.occupyingBees.length : 0;
                const hasDeadBee = larvaeCell && larvaeCell.hasDeadBee();
                
                // Only assign if less than 2 nurses AND cell isn't crowded (max 3 total bees) AND no dead bee
                if (nursesAtCell < 2 && beesInCell < 3 && !hasDeadBee) {
                    // If we don't have food, go collect it first
                    if (!this.hasFood) {
                        const foodCell = hive.findFoodForFeeding();
                        if (foodCell) {
                            this.task = BeeTask.COLLECTING_FOOD;
                            this.nextTask = BeeTask.NURSING;
                            this.nextTargetCell = hungryLarvae; // Store larvae location
                            this.targetCell = foodCell;
                            this.findPath(hive);
                            return;
                        }
                    } else {
                        // We have food, go nurse the larvae
                        this.task = BeeTask.NURSING;
                        this.targetCell = hungryLarvae;
                        this.findPath(hive);
                        return;
                    }
                }
            }
        }
        
        // UNDERTAKING - HIGHEST PRIORITY (remove dead bees to keep hive clean)
        // ANY worker can handle this critical task, DAY OR NIGHT
        // Dead bees spread disease and MUST be removed immediately
        // This check happens BEFORE the night-time idle check!
        const deadBeeCell = hive.findDeadBeeCell();
        if (deadBeeCell) {
            // Check if another undertaker is already assigned to this cell
            const undertakersAtCell = hive.bees.filter(b => 
                b.task === BeeTask.UNDERTAKING && !b.hasDeadBee &&
                b.targetCell && b.targetCell.q === deadBeeCell.q && b.targetCell.r === deadBeeCell.r
            ).length;
            
            // Count total dead bees to determine urgency
            const totalDeadBees = Array.from(hive.cells.values()).filter(c => c.hasDeadBee()).length;
            
            // Scale undertakers based on dead bee count - more dead bees = more undertakers per cell
            // This creates an aggressive cleanup response to prevent overwhelming the hive
            let maxUndertakersPerDeadBee;
            if (totalDeadBees >= 20) {
                maxUndertakersPerDeadBee = 4; // CRISIS mode - 4 undertakers per dead bee
            } else if (totalDeadBees >= 10) {
                maxUndertakersPerDeadBee = 3; // High urgency - 3 undertakers per dead bee
            } else if (totalDeadBees >= 5) {
                maxUndertakersPerDeadBee = 2; // Medium urgency - 2 undertakers per dead bee
            } else {
                maxUndertakersPerDeadBee = 1; // Normal - 1 undertaker per dead bee
            }
            
            if (undertakersAtCell < maxUndertakersPerDeadBee) {
                this.task = BeeTask.UNDERTAKING;
                this.targetCell = deadBeeCell;
                this.findPath(hive);
                return;
            }
        }
        
        // HIVE MAINTENANCE TASKS (work 24/7, even at night)
        
        // Clean dirty cells
        const dirtyCell = hive.findDirtyCell();
        if (dirtyCell && Math.random() < 0.5) {
            const cleanersAtCell = hive.bees.filter(b => 
                b.task === BeeTask.CLEANING &&
                b.targetCell && b.targetCell.q === dirtyCell.q && b.targetCell.r === dirtyCell.r
            ).length;
            
            if (cleanersAtCell === 0) {
                this.task = BeeTask.CLEANING;
                this.targetCell = dirtyCell;
                this.findPath(hive);
                return;
            }
        }
        
        // Temperature regulation (especially important at night for brood)
        if (hive.needsTemperatureRegulation && hive.needsTemperatureRegulation()) {
            const tempCell = hive.findTemperatureRegulationSpot();
            if (tempCell && Math.random() < 0.4) {
                const regulatorsAtSpot = hive.bees.filter(b => 
                    b.task === BeeTask.TEMPERATURE_REGULATION &&
                    b.targetCell && b.targetCell.q === tempCell.q && b.targetCell.r === tempCell.r
                ).length;
                
                if (regulatorsAtSpot < 5) {
                    this.task = BeeTask.TEMPERATURE_REGULATION;
                    this.targetCell = tempCell;
                    this.findPath(hive);
                    return;
                }
            }
        }
        
        // DAYTIME-ONLY TASKS
        // If it's nighttime, skip foraging and other outdoor activities
        if (activityMultiplier < 0.1) {
            // At night, bees without tasks just rest
            this.task = BeeTask.IDLE;
            this.taskTimer = 10;
            return;
        }
        
        // OLDER WORKER TASKS (during daytime)
        if (!this.isYoung() && activityMultiplier > 0.5) {
            
            // Cap completed honey cells
            const honeyCappingCell = hive.findHoneyCappingCell();
            if (honeyCappingCell && Math.random() < 0.4) {
                // Check if someone is already capping this cell
                const cappersAtCell = hive.bees.filter(b => 
                    b.task === BeeTask.CAPPING_HONEY &&
                    b.targetCell && b.targetCell.q === honeyCappingCell.q && b.targetCell.r === honeyCappingCell.r
                ).length;
                
                if (cappersAtCell === 0) {
                    this.task = BeeTask.CAPPING_HONEY;
                    this.targetCell = honeyCappingCell;
                    this.findPath(hive);
                    return;
                }
            }
            
            // Collect water if hive is hot or needs water
            const stats = hive.getStats();
            const needsWater = (hive.temperature && hive.temperature > hive.optimalTemperature) || 
                              (stats.water || 0) < stats.population * 0.05;
            if (needsWater && Math.random() < 0.3) {
                const entrance = hive.findNearestEntrance(this.q, this.r);
                if (entrance) {
                    this.task = BeeTask.WATER_COLLECTION;
                    this.targetCell = entrance;
                    this.findPath(hive);
                    return;
                }
            }
            
            // Forage for food
            const totalFood = stats.honey + stats.pollen;
            const totalCells = hive.getTotalCellCount();
            const foodRatio = totalFood / totalCells;
            
            // If more than 35% of cells are food, focus on other tasks
            // This ensures good food reserves for the population
            if (foodRatio > 0.35) {
                // Too much food, do something else
                this.task = BeeTask.IDLE;
                this.taskTimer = 10 + Math.random() * 10;
                return;
            }
            
            // Find entrance to leave hive (but don't if already at one)
            if (hive.isEntranceCell(this.q, this.r)) {
                // Already at entrance, rest here before deciding next task
                this.task = BeeTask.IDLE;
                this.taskTimer = 15 + Math.random() * 15;
                return;
            }
            
            const entrance = hive.findNearestEntrance(this.q, this.r);
            if (entrance) {
                this.task = BeeTask.FORAGING;
                this.targetCell = entrance;
                this.findPath(hive);
                return;
            }
        }
        
        // Older workers can help with nursing if needed (especially at night)
        if (!this.isYoung()) {
            const hungryLarvae = hive.findHungryLarvae();
            if (hungryLarvae && Math.random() < 0.5) {
                const larvaeCell = hive.getCell(hungryLarvae.q, hungryLarvae.r);
                
                // Check if this cell already has nurses assigned OR bees occupying it
                const nursesAtCell = hive.bees.filter(b => 
                    b.task === BeeTask.NURSING &&
                    b.targetCell && b.targetCell.q === hungryLarvae.q && b.targetCell.r === hungryLarvae.r
                ).length;
                
                const beesInCell = larvaeCell && larvaeCell.occupyingBees ? larvaeCell.occupyingBees.length : 0;
                const hasDeadBee = larvaeCell && larvaeCell.hasDeadBee();
                
                // Only assign if less than 2 nurses AND cell isn't crowded (max 3 total bees) AND no dead bee
                if (nursesAtCell < 2 && beesInCell < 3 && !hasDeadBee) {
                    // If we don't have food, go collect it first
                    if (!this.hasFood) {
                        const foodCell = hive.findFoodForFeeding();
                        if (foodCell) {
                            this.task = BeeTask.COLLECTING_FOOD;
                            this.nextTask = BeeTask.NURSING;
                            this.nextTargetCell = hungryLarvae; // Store larvae location
                            this.targetCell = foodCell;
                            this.findPath(hive);
                            return;
                        }
                    } else {
                        // We have food, go nurse the larvae
                        this.task = BeeTask.NURSING;
                        this.targetCell = hungryLarvae;
                        this.findPath(hive);
                        return;
                    }
                }
            }
        }
        
        // Default to idle - but idle bees should wander!
        // If there are dead bees, check for work very frequently
        const totalDeadBees = Array.from(hive.cells.values()).filter(c => c.hasDeadBee()).length;
        if (totalDeadBees > 0) {
            this.taskTimer = 1 + Math.random() * 2; // 1-3 seconds when dead bees present
        } else {
            this.taskTimer = Math.random() * 10 + 5; // 5-15 seconds normally
        }
        this.task = BeeTask.IDLE;
        
        // 50% chance to wander to a random neighbor instead of staying still
        if (Math.random() < 0.5 && this.moveProgress >= 1.0) {
            const neighbors = getHexNeighbors(this.q, this.r);
            const validNeighbors = neighbors.filter(n => {
                const cell = hive.getCell(n.q, n.r);
                // Can move to any valid cell that's not an entrance and not full
                return cell !== null && 
                       !hive.isEntranceCell(n.q, n.r) && 
                       !cell.isFull();
            });
            
            if (validNeighbors.length > 0) {
                const target = validNeighbors[Math.floor(Math.random() * validNeighbors.length)];
                this.targetCell = { q: target.q, r: target.r };
                this.path = [target];
                this.startMovingToNextCell();
            }
        }
        } catch (error) {
            // Catch any errors to prevent freezing
            console.error('Error in assignTask:', error);
            this.task = BeeTask.IDLE;
            this.taskTimer = 10; // Wait before retrying
        }
    }
    
    completeTask(hive) {
        // Special handling for queen laying eggs
        if (this.type === BeeType.QUEEN && this.task === BeeTask.IDLE) {
            const currentCell = hive.getCell(this.q, this.r);
            if (currentCell && currentCell.isEmpty()) {
                currentCell.setEgg();
                
                // Track egg laid
                this.eggsLaidTotal++;
                this.eggsLaidHistory.push(this.simulationTime);
                
                // Keep only last hour of history (3600 seconds)
                const oneHourAgo = this.simulationTime - 3600;
                this.eggsLaidHistory = this.eggsLaidHistory.filter(t => t > oneHourAgo);
                
                // After laying egg, wait a moment before next action
                this.taskTimer = 1;
            } else {
                // Cell wasn't empty, try again soon
                this.taskTimer = 0;
            }
            return;
        }
        
        switch (this.task) {
            case BeeTask.FORAGING:
                if (!this.isOutsideHive) {
                    // Just reached entrance, now go outside
                    this.isOutsideHive = true;
                    this.taskTimer = this.config.simulation.workerForagingDuration / hive.getActivityMultiplier();
                } else {
                    // Finished foraging outside, return to entrance
                    this.isOutsideHive = false;
                    const foragingSuccess = Math.random() < 0.85; // Increased from 0.7
                    if (foragingSuccess) {
                        // More likely to bring back nectar, and better chance of both
                        this.hasNectar = Math.random() < 0.7;
                        this.hasPollen = !this.hasNectar || Math.random() < 0.5;
                    }
                    
                    // Record completed foraging trip
                    hive.recordForagingTrip();
                    
                    // Bee is already at entrance after foraging, go directly to finding storage
                    if (this.hasNectar || this.hasPollen) {
                        // Check if hive can accept more food
                        const stats = hive.getStats();
                        const totalFood = stats.honey + stats.pollen;
                        const totalCells = hive.getTotalCellCount();
                        const foodRatio = totalFood / totalCells;
                        
                        if (foodRatio >= 0.35) {
                            // Hive is full, discard cargo
                            this.hasNectar = false;
                            this.hasPollen = false;
                            this.task = BeeTask.IDLE;
                            this.taskTimer = 20 + Math.random() * 20; // Rest before next task
                        } else {
                            // Find storage cell
                            const storageCell = hive.findAppropriateStorageCell(this.hasNectar, this.hasPollen);
                            if (storageCell) {
                                this.task = BeeTask.STORING_FOOD;
                                this.targetCell = storageCell;
                                this.findPath(hive);
                            } else {
                                // No storage available, rest before trying again
                                this.task = BeeTask.IDLE;
                                this.taskTimer = 15 + Math.random() * 15;
                            }
                        }
                    } else {
                        // No cargo, rest before next task
                        this.task = BeeTask.IDLE;
                        this.taskTimer = 20 + Math.random() * 20;
                    }
                }
                break;
                
            case BeeTask.COLLECTING_FOOD:
                // Collected food from storage, now continue to next task
                if (this.targetCell) {
                    const cell = hive.getCell(this.targetCell.q, this.targetCell.r);
                    if (cell && cell.contentAmount > 0) {
                        // Consume a small amount of food
                        if (cell.state === CellState.HONEY || cell.state === CellState.HONEY_COMPLETE) {
                            cell.consumeHoney(0.5);
                        } else if (cell.state === CellState.POLLEN || cell.state === CellState.BEE_BREAD) {
                            cell.consumePollen(0.5);
                        }
                        this.hasFood = true;
                    }
                }
                
                // Continue to next task
                if (this.nextTask === BeeTask.NURSING && this.nextTargetCell) {
                    this.task = BeeTask.NURSING;
                    this.targetCell = this.nextTargetCell;
                    this.nextTask = null;
                    this.nextTargetCell = null;
                    this.findPath(hive);
                } else if (this.nextTask === BeeTask.FEEDING_QUEEN && hive.queen) {
                    this.task = BeeTask.FEEDING_QUEEN;
                    this.targetCell = { q: hive.queen.q, r: hive.queen.r };
                    this.nextTask = null;
                    this.findPath(hive);
                } else {
                    // No valid next task
                    this.task = BeeTask.IDLE;
                    this.hasFood = false; // Lost the food if no task
                }
                break;
                
            case BeeTask.NURSING:
                // Feed larvae at target
                if (this.targetCell) {
                    const cell = hive.getCell(this.targetCell.q, this.targetCell.r);
                    if (cell && this.hasFood) {
                        cell.feedLarvae();
                        this.hasFood = false; // Consumed the food
                    }
                }
                this.task = BeeTask.IDLE;
                this.targetCell = null;
                break;
                
            case BeeTask.FEEDING_QUEEN:
                // Queen has been fed
                this.hasFood = false; // Consumed the food
                this.task = BeeTask.IDLE;
                this.targetCell = null;
                break;
                
            case BeeTask.STORING_FOOD:
                // Food stored
                this.hasNectar = false;
                this.hasPollen = false;
                this.task = BeeTask.IDLE;
                this.targetCell = null;
                break;
                
            case BeeTask.CLEANING:
                // Finished cleaning the dirty cell
                this.task = BeeTask.IDLE;
                this.targetCell = null;
                break;
                
            case BeeTask.CAPPING_HONEY:
                // Finished capping the honey cell
                this.task = BeeTask.IDLE;
                this.targetCell = null;
                break;
                
            case BeeTask.UNDERTAKING:
                // Check if we're carrying a dead bee
                if (this.hasDeadBee) {
                    // We've reached the entrance with the dead bee
                    // ACTUALLY dispose of it (remove from hive entirely)
                    // The dead bee is thrown out of the hive, not left at entrance
                    this.hasDeadBee = false;
                    this.task = BeeTask.IDLE;
                    this.targetCell = null;
                    // Dead bee is now outside the hive - it's gone!
                } else {
                    // We've finished picking up the dead bee, now carry it to entrance
                    this.hasDeadBee = true;
                    const entrance = hive.findNearestEntrance(this.q, this.r);
                    if (entrance) {
                        this.targetCell = entrance;
                        this.findPath(hive);
                    } else {
                        // No entrance found, drop it back in current cell
                        const currentCell = hive.getCell(this.q, this.r);
                        if (currentCell) {
                            currentCell.addDeadBee(); // Put it back
                        }
                        this.hasDeadBee = false;
                        this.task = BeeTask.IDLE;
                        this.targetCell = null;
                    }
                }
                break;
                
            case BeeTask.ATTENDING_QUEEN:
                // Finished attending to queen (grooming, etc.)
                this.task = BeeTask.IDLE;
                this.targetCell = null;
                break;
                
            case BeeTask.WATER_COLLECTION:
                if (!this.isOutsideHive) {
                    // Just reached entrance, go outside to collect water
                    this.isOutsideHive = true;
                    this.taskTimer = this.config.simulation.waterCollectionDuration || 30;
                } else {
                    // Finished collecting water, return to entrance
                    this.isOutsideHive = false;
                    const collectionSuccess = Math.random() < 0.9;
                    if (collectionSuccess) {
                        this.hasWater = true;
                    }
                    
                    // Find storage for water
                    if (this.hasWater) {
                        const waterCell = hive.findWaterStorageCell();
                        if (waterCell) {
                            this.task = BeeTask.STORING_FOOD; // Reuse storing food task
                            this.targetCell = waterCell;
                            this.findPath(hive);
                        } else {
                            this.task = BeeTask.IDLE;
                        }
                    } else {
                        this.task = BeeTask.IDLE;
                    }
                }
                break;
                
            case BeeTask.TEMPERATURE_REGULATION:
                // Finished temperature regulation (fanning/clustering)
                this.taskTimer = 10; // Continue for a bit
                this.task = BeeTask.IDLE;
                this.targetCell = null;
                break;
        }
    }
    
    onReachDestination(hive) {
        if (this.task === BeeTask.RETURNING && this.targetCell) {
            // Check if we're at entrance
            if (hive.isEntranceCell(this.targetCell.q, this.targetCell.r)) {
                // Just entered hive, check if we should store food
                const stats = hive.getStats();
                const totalFood = stats.honey + stats.pollen;
                const totalCells = hive.getTotalCellCount();
                const foodRatio = totalFood / totalCells;
                
                // If hive is already at 35% food, don't store more (discard)
                // This is higher than the foraging threshold (25%) to allow buffer
                if (foodRatio >= 0.35) {
                    this.hasNectar = false;
                    this.hasPollen = false;
                    this.task = BeeTask.IDLE;
                    this.targetCell = null;
                } else {
                    // Find storage
                    const storageCell = hive.findAppropriateStorageCell(this.hasNectar, this.hasPollen);
                    if (storageCell) {
                        this.task = BeeTask.STORING_FOOD;
                        this.targetCell = storageCell;
                        this.findPath(hive);
                    } else {
                        this.task = BeeTask.IDLE;
                        this.targetCell = null;
                    }
                }
            } else {
                // Reached storage cell
                const cell = hive.getCell(this.targetCell.q, this.targetCell.r);
                if (cell) {
                    if (this.hasNectar) {
                        // Each foraging trip brings back 3-5 units
                        cell.addNectar(3 + Math.floor(Math.random() * 3));
                    }
                    if (this.hasPollen) {
                        // Each foraging trip brings back 3-5 units
                        cell.addPollen(3 + Math.floor(Math.random() * 3));
                    }
                }
                this.hasNectar = false;
                this.hasPollen = false;
                this.task = BeeTask.IDLE;
                this.targetCell = null;
            }
        } else if (this.task === BeeTask.FORAGING) {
            // Reached entrance to go outside
            this.completeTask(hive);
        } else if (this.task === BeeTask.WATER_COLLECTION) {
            // Reached entrance to collect water
            this.completeTask(hive);
        } else if (this.task === BeeTask.COLLECTING_FOOD) {
            // Reached food storage cell
            this.completeTask(hive);
        } else if (this.task === BeeTask.NURSING) {
            this.taskTimer = this.config.simulation.workerNurseDuration;
        } else if (this.task === BeeTask.FEEDING_QUEEN) {
            this.taskTimer = this.config.simulation.queenFeedingInterval;
        } else if (this.task === BeeTask.ATTENDING_QUEEN) {
            this.taskTimer = 15; // Time spent grooming/attending
        } else if (this.task === BeeTask.CLEANING) {
            // Perform the cleaning action
            if (this.targetCell) {
                const cell = hive.getCell(this.targetCell.q, this.targetCell.r);
                if (cell) {
                    cell.clean();
                }
            }
            this.taskTimer = 10; // Time to clean a cell
        } else if (this.task === BeeTask.CAPPING_HONEY) {
            // Perform the capping action
            if (this.targetCell) {
                const cell = hive.getCell(this.targetCell.q, this.targetCell.r);
                if (cell) {
                    cell.capHoney();
                }
            }
            this.taskTimer = 12; // Time to cap honey
        } else if (this.task === BeeTask.UNDERTAKING) {
            // Check if we're at the dead bee cell or at the entrance
            if (this.hasDeadBee && hive.isEntranceCell(this.q, this.r)) {
                // Arrived at entrance with dead bee, dispose it
                this.completeTask(hive);
            } else if (!this.hasDeadBee && this.targetCell) {
                // Arrived at dead bee cell, remove it
                const cell = hive.getCell(this.targetCell.q, this.targetCell.r);
                if (cell) {
                    cell.removeDeadBee();
                }
                this.taskTimer = 1; // Time to pick up and prepare to carry (nearly instant!)
            }
        } else if (this.task === BeeTask.TEMPERATURE_REGULATION) {
            this.taskTimer = 15; // Time spent regulating temperature
        } else if (this.task === BeeTask.STORING_FOOD) {
            const cell = hive.getCell(this.targetCell.q, this.targetCell.r);
            if (cell) {
                if (this.hasNectar) {
                    // Each foraging trip brings back 3-5 units
                    cell.addNectar(3 + Math.floor(Math.random() * 3));
                }
                if (this.hasPollen) {
                    // Each foraging trip brings back 3-5 units
                    cell.addPollen(3 + Math.floor(Math.random() * 3));
                }
                if (this.hasWater) {
                    cell.addWater(1);
                }
            }
            this.hasNectar = false;
            this.hasPollen = false;
            this.hasWater = false;
            this.task = BeeTask.IDLE;
            this.targetCell = null;
        }
    }
    
    getEmptyNeighborCells(hive) {
        const neighbors = getHexNeighbors(this.q, this.r);
        return neighbors.filter(n => {
            const cell = hive.getCell(n.q, n.r);
            // For queens, exclude entrance cells
            if (this.type === BeeType.QUEEN) {
                return cell && cell.isEmpty() && !hive.isEntranceCell(n.q, n.r);
            }
            return cell && cell.isEmpty();
        });
    }
    
    findPath(hive) {
        if (!this.targetCell || !this.config.advanced.pathfindingEnabled) {
            return;
        }
        
        const path = hive.findPath(
            { q: this.q, r: this.r },
            this.targetCell,
            this.config.advanced.preferEmptyRoutes
        );
        
        if (path && path.length > 1) {
            this.path = path.slice(1); // Exclude current position
        }
    }
}

