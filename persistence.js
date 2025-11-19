import { BeeType, BeeTask } from './bee.js';
import { CellState } from './cell.js';

export class PersistenceManager {
    constructor() {
        this.SAVE_KEY = 'hive_save_v1';
        this.lastSaveTime = 0;
    }

    hasSave() {
        return !!localStorage.getItem(this.SAVE_KEY);
    }

    save(hive) {
        try {
            console.log('Saving hive state...');
            const startTime = performance.now();

            const data = {
                timestamp: Date.now(),
                simulationTime: hive.simulationTime,
                currentDate: hive.currentDate.getTime(),
                config: hive.config,
                stats: hive.getStats(),
                dailySummaries: hive.dailySummaries,
                cells: [],
                bees: []
            };

            // Serialize Cells (only non-empty ones to save space)
            for (const cell of hive.cells.values()) {
                if (!cell.isEmpty() || cell.isDirty || cell.hasDeadBee()) {
                    data.cells.push({
                        q: cell.q,
                        r: cell.r,
                        state: cell.state,
                        contentAmount: cell.contentAmount,
                        pollenType: cell.pollenType,
                        isDirty: cell.isDirty,
                        deadBeeCount: cell.deadBeeCount,
                        developmentTime: cell.developmentTime,
                        maxDevelopmentTime: cell.maxDevelopmentTime
                    });
                }
            }

            // Serialize Bees
            for (const bee of hive.bees) {
                data.bees.push({
                    type: bee.type,
                    q: bee.q,
                    r: bee.r,
                    age: bee.age,
                    task: bee.task,
                    hasNectar: bee.hasNectar,
                    hasPollen: bee.hasPollen,
                    hasWater: bee.hasWater,
                    hasFood: bee.hasFood,
                    inventory: bee.inventory
                });
            }

            const json = JSON.stringify(data);
            localStorage.setItem(this.SAVE_KEY, json);

            const duration = performance.now() - startTime;
            console.log(`Hive saved in ${duration.toFixed(2)}ms. Size: ${(json.length / 1024).toFixed(2)}KB`);
            return true;
        } catch (error) {
            console.error('Failed to save hive:', error);
            return false;
        }
    }

    load() {
        try {
            const json = localStorage.getItem(this.SAVE_KEY);
            if (!json) return null;
            return JSON.parse(json);
        } catch (error) {
            console.error('Failed to load hive:', error);
            return null;
        }
    }

    clear() {
        localStorage.removeItem(this.SAVE_KEY);
        console.log('Save data cleared.');
    }
}
